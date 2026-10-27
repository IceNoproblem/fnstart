import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';
import { CONFIG, ICON_DIR } from './config.js';
import { dockerApi, dockerAvailable, systemEndpointCandidates } from './docker.js';
import { hostListenPorts, rankPorts, tcpAlive, isWebCandidate } from './ports.js';
import { hostNetworkOwners } from './owner.js';

/** 极简 GET：可控超时、只读前 N 字节、不发 Accept-Encoding 避免解压 */
export function rawGet(target, { timeout = CONFIG.probeTimeout, maxBytes = 16384, redirects = 2 } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(target);
    } catch {
      return resolve(null);
    }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        rejectUnauthorized: false,
        headers: {
          Accept: 'text/html,application/xhtml+xml,image/*,*/*',
          'Accept-Encoding': 'identity',
          'User-Agent': 'fnstart/1.0 (+self-hosted startpage)',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && redirects > 0) {
          res.resume();
          return resolve(rawGet(new URL(loc, u).toString(), { timeout, maxBytes, redirects: redirects - 1 }));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size <= maxBytes) chunks.push(c);
          if (size >= maxBytes) res.destroy();
        });
        const done = () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: u.toString() });
        res.on('end', done);
        res.on('close', done);
        res.on('error', () => resolve(null));
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

const decode = (buf, headers) => {
  const ct = String(headers?.['content-type'] || '');
  const m = /charset=([\w-]+)/i.exec(ct);
  const enc = (m?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(enc === 'gbk' || enc === 'gb2312' ? 'gbk' : enc).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
};

const pickTitle = (html) => {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  if (!m) return '';
  return m[1]
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
};

const WEAK_NAMES = new Set(['', 'home', 'index', 'login', '登录', '首页', 'dashboard', 'web', '欢迎', 'errors', 'error', '404', 'not found', 'default']);

/** 明显不是服务首页的标题 */
const WEAK_TITLE_RE = /^(404|400|401|403|405|500|502|503|504|error|not found|bad gateway|unauthorized|forbidden|bad request|service unavailable|it works|index of|apache2|welcome to nginx|test page|default page|coming soon|无权限|未找到)/i;

const isHttpsHint = (r) => r && /plain HTTP request was sent to HTTPS port/i.test(r.html || '');

/** 从标题里挤出一个干净的服务名 */
export const cleanName = (title, fallback = '') => {
  let t = String(title || '').trim();
  if (!t) return fallback;
  t = t.split(/\s+[|\-–—·:]\s+|\s*[|｜]\s*/)[0].trim() || t;
  if (WEAK_NAMES.has(t.toLowerCase())) return fallback;
  return t.slice(0, 40) || fallback;
};

const ICON_RELS = /(?:^|\s)(?:shortcut\s+icon|icon|apple-touch-icon(?:-precomposed)?)(?:\s|$)/i;
const findIconHref = (html) => {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const found = [];
  for (const tag of links) {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    if (!ICON_RELS.test(rel)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /sizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || '';
    found.push({ href, px: parseInt(sizes, 10) || 0 });
  }
  found.sort((a, b) => b.px - a.px);
  return found[0]?.href || '';
};

const EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif',
};

export const saveIconBuf = async (buf, ext) => {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const file = `${hash}.${ext}`;
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.writeFile(path.join(ICON_DIR, file), buf);
  return `/icons/${file}`;
};

/** 抓一个站点的图标并存到本地 */
export async function fetchIcon(siteUrl, htmlHint) {
  try {
    const base = new URL(siteUrl);
    const candidates = [];
    if (htmlHint) {
      const href = findIconHref(htmlHint);
      if (href) candidates.push(new URL(href, base).toString());
    }
    candidates.push(new URL('/favicon.ico', base).toString());

    for (const c of candidates) {
      if (c.startsWith('data:')) {
        const m = /^data:(image\/[\w.+-]+);base64,(.+)$/is.exec(c);
        if (m) {
          const ext = EXT_BY_TYPE[m[1].toLowerCase()] || 'png';
          return await saveIconBuf(Buffer.from(m[2], 'base64'), ext);
        }
        continue;
      }
      const res = await rawGet(c, { timeout: 2500, maxBytes: 256 * 1024 });
      if (!res || res.status !== 200 || !res.body?.length || res.body.length < 70) continue;
      const ct = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[ct] || (c.endsWith('.svg') ? 'svg' : c.endsWith('.png') ? 'png' : 'ico');
      return await saveIconBuf(res.body, ext);
    }
  } catch {
    /* 抓不到就算了，前端用首字母占位 */
  }
  return '';
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

const probeOne = async (probeUrl) => {
  const res = await rawGet(probeUrl, { timeout: CONFIG.probeTimeout, maxBytes: 28672 });
  if (!res || res.status >= 400) {
    // 400/426 也可能是 https 端口，交给调用方换协议重试
    if (res && res.status === 400) {
      const html = decode(res.body || Buffer.alloc(0), res.headers);
      return { status: res.status, html, title: pickTitle(html), bad: true };
    }
    return null;
  }
  const ct = String(res.headers['content-type'] || '').toLowerCase();
  const looksHtml = ct.includes('text/html') || ct.includes('application/xhtml') || ct.includes('text/plain');
  if (!looksHtml) return null;
  const html = decode(res.body, res.headers);
  const title = pickTitle(html);
  if (!title && !/<html|<body|<div|<script/i.test(html)) return null;
  return { status: res.status, title, html };
};

/** 端口可能跑 https 的，先试 https 省一次往返 */
const HTTPS_HINT_PORTS = new Set([443, 4443, 5443, 6443, 8443, 9443, 5667, 8089, 10443]);

/** 探测一个端口，http/https 都不放过 */
const probePort = async (host, port) => {
  const order = HTTPS_HINT_PORTS.has(port) ? ['https', 'http'] : ['http', 'https'];
  for (const scheme of order) {
    const probeUrl = `${scheme}://${host}:${port}/`;
    const r = await probeOne(probeUrl);
    if (!r) continue;
    if (r.bad || isHttpsHint(r)) continue; // 协议不对，换下一个
    return { ...r, probeUrl, scheme };
  }
  return null;
};

let discoveryCache = { at: 0, host: '', data: null };
const CACHE_MS = 20_000;

const rawContainers = async () => {
  try {
    return await dockerApi('/containers/json?all=0');
  } catch {
    return [];
  }
};

/**
 * 扫描 NAS 上所有 Web 服务。
 * host：浏览器访问导航页用的主机名，生成的卡片地址以它为准。
 * 探测走 127.0.0.1（host 网络下即宿主机本机），避免绕一圈回来。
 */
export async function discover(host, { force = false, selfPort = 0, extraPorts = [] } = {}) {
  if (!force && discoveryCache.data && discoveryCache.host === host && Date.now() - discoveryCache.at < CACHE_MS) {
    return discoveryCache.data;
  }

  const dockerReady = await dockerAvailable();
  const containers = dockerReady ? await rawContainers() : [];

  // 端口 → 容器名（只有 bridge 模式的映射端口能这样归属）
  const owner = new Map();
  const images = new Map();
  for (const c of containers) {
    const name = (c.Names?.[0] || '').replace(/^\//, '');
    images.set(name, c.Image || '');
    for (const p of c.Ports || []) {
      if (p.PublicPort && (!p.Type || p.Type === 'tcp')) owner.set(p.PublicPort, name);
    }
  }

  const localPorts = await hostListenPorts();
  const usingProc = localPorts.length > 0;
  const probeHost = usingProc ? '127.0.0.1' : host;

  // host 网络的容器在容器列表里没有端口映射，从进程持有的 socket 反查端口归属。
  // 需要把宿主机 /proc 挂进容器（见 docker-compose.yml），没挂就静默跳过。
  if (dockerReady && usingProc) {
    try {
      for (const [port, name] of await hostNetworkOwners(containers)) {
        if (!owner.has(port)) owner.set(port, name);
      }
    } catch {
      /* 拿不到宿主机进程表就算了，不影响按标题命名 */
    }
  }

  let portPool;
  if (usingProc) {
    portPool = localPorts;
  } else {
    // 拿不到 /proc（比如 macOS 本机调试）：退回 docker 映射端口 + 端口提示
    const sys = systemEndpointCandidates(host).map((s) => Number(new URL(s.url).port));
    portPool = [...new Set([...owner.keys(), ...sys, ...extraPorts].filter(Boolean))];
  }
  const ports = rankPorts(portPool.filter((p) => p !== selfPort), 80);

  // 先 TCP 探活，过滤掉没人监听的端口，减少一半以上无效请求
  const aliveFlags = await pool(ports, 24, async (p) => ((await tcpAlive(probeHost, p, 350)) ? p : null));
  const alive = aliveFlags.filter(Boolean);

  const probed = await pool(alive, 10, async (p) => {
    const r = await probePort(probeHost, p);
    if (!r) return null;
    const container = owner.get(p) || '';
    const weak = !r.title || WEAK_TITLE_RE.test(r.title);
    // 弱标题（404/Error/空）且没有容器能归属 → 当它不是一个服务
    if (weak && !container) return null;
    const fallback = container || `端口 ${p}`;
    const name = cleanName(weak ? '' : r.title, fallback);
    return {
      port: p,
      scheme: r.scheme,
      probeUrl: r.probeUrl,
      url: `${r.scheme}://${host}:${p}`,
      name,
      title: r.title,
      container,
      image: container ? images.get(container) || '' : '',
      source: container ? 'docker' : 'host',
      html: r.html,
    };
  });

  // 同名服务只留一个（常见于同一服务同时占 80/443 或 http/https 双端口）
  // 80/443 通常被反向代理占着、返回默认站点，排到后面让真实端口优先
  const valid = probed
    .filter(Boolean)
    .sort((a, b) => {
      const ra = a.port === 80 || a.port === 443 ? 1 : 0;
      const rb = b.port === 80 || b.port === 443 ? 1 : 0;
      return ra - rb || a.port - b.port;
    });

  const seenName = new Set();
  const usedUrl = new Set();
  const services = [];
  for (const s of valid) {
    const key = s.url.toLowerCase();
    if (usedUrl.has(key)) continue;
    const nk = s.name.toLowerCase();
    if (s.name.length > 2 && seenName.has(nk)) continue;
    usedUrl.add(key);
    seenName.add(nk);
    services.push(s);
  }

  services.sort((a, b) => a.port - b.port);

  const data = {
    ok: true,
    host,
    dockerReady,
    mode: usingProc ? 'host-scan' : 'docker-map',
    scanned: alive.length,
    count: services.length,
    containers: containers.length,
    services: services.map((s) => ({
      name: s.name,
      url: s.url,
      title: s.title,
      container: s.container,
      image: s.image,
      source: s.source,
      port: s.port,
    })),
    _raw: services,
  };

  discoveryCache = { at: Date.now(), host, data };
  return data;
}

/** 扫描 + 抓图标 */
export async function discoverWithIcons(host, opts = {}) {
  const result = await discover(host, opts);
  const raw = result._raw || [];
  await pool(raw, 6, async (svc) => {
    svc.icon = await fetchIcon(svc.probeUrl, svc.html);
    return svc;
  });
  const out = {
    ...result,
    services: raw.map((s) => ({
      name: s.name,
      url: s.url,
      icon: s.icon || '',
      title: s.title,
      container: s.container,
      source: s.source,
      port: s.port,
    })),
  };
  delete out._raw;
  out.count = out.services.length;
  return out;
}
