import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns';
import crypto from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';
import { CONFIG, ICON_DIR } from './config.js';
import { dockerApi, dockerAvailable, systemEndpointCandidates } from './docker.js';
import { hostListenPorts, rankPorts, tcpAlive, isWebCandidate } from './ports.js';
import { hostNetworkOwners } from './owner.js';

/* ---------------- 防 SSRF：按解析后的真实 IP 判定 ---------------- */

/**
 * 这个 IP 是不是「不该让服务端去连」的目标。
 *
 * 为什么不能只看主机名：`127-0-0-1.sslip.io` 这类域名解析出来就是 127.0.0.1，
 * 但字符串里连一个 `127` 都看不出来。所以判断必须落在解析结果上。
 */
export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    const [a, b] = p;
    if (a === 0) return true; // 本网络
    if (a === 10) return true; // 私有 A
    if (a === 127) return true; // 环回
    if (a === 169 && b === 254) return true; // 链路本地（云元数据 169.254.169.254 在这段）
    if (a === 172 && b >= 16 && b <= 31) return true; // 私有 B
    if (a === 192 && b === 168) return true; // 私有 C
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / Tailscale 等
    if (a >= 224) return true; // 组播与保留段
    return false;
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    // IPv4 映射 / 兼容写法：::ffff:127.0.0.1 与 ::ffff:7f00:1 都要认
    const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(low);
    if (dotted) return isPrivateIp(dotted[1]);
    const hexed = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low);
    if (hexed) {
      const hi = parseInt(hexed[1], 16);
      const lo = parseInt(hexed[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^f[cd]/.test(low)) return true; // ULA
    if (/^fe[89ab]/.test(low)) return true; // 链路本地
    return false;
  }
  return true; // 不是合法 IP：一律当危险，宁可抓不到图标
}

/**
 * 受控 DNS 解析：解析完立刻判定，私有地址直接拒绝连接。
 *
 * 关键点 —— 把校验放在 `lookup` 里，而不是「先解析一次判断、再让 http 自己解析一次」。
 * 后者中间存在时间窗，攻击者可以用 DNS 重绑定让两次解析结果不同（第二次给 127.0.0.1）。
 * 走 lookup 意味着「判定用的 IP」就是「即将连接的那个 IP」，没有可乘之机。
 */
const blockErr = (addr) => {
  const e = new Error(`blocked private address: ${addr}`);
  e.code = 'EBLOCKED';
  return e;
};

const guardedLookup = (hostname, options, callback) => {
  const opts = typeof options === 'object' && options ? { ...options } : { family: options || 0 };
  /*
   * 注意：**不能把 all 删掉**。
   * Node 20+ 默认开 autoSelectFamily（Happy Eyeballs），它会以 all: true 调 lookup
   * 并期待回调返回 [{address, family}] 数组。这里要是擅自改成单值，
   * Node 拿到 undefined 会抛 ERR_INVALID_IP_ADDRESS —— 所有公网域名直接抓不到。
   * 所以两种形态都要原样支持。
   */
  dns.lookup(hostname, opts, (err, address, family) => {
    if (err) return callback(err);
    if (Array.isArray(address)) {
      const safe = address.filter((x) => !isPrivateIp(x.address));
      if (!safe.length) return callback(blockErr(address.map((x) => x.address).join(',')));
      return callback(null, safe, safe[0]?.family);
    }
    if (isPrivateIp(address)) return callback(blockErr(address));
    return callback(null, address, family);
  });
};

/** 极简 GET：可控超时、只读前 N 字节、不发 Accept-Encoding 避免解压 */
export function rawGet(target, { timeout = CONFIG.probeTimeout, maxBytes = 16384, redirects = 2, guardPrivate = false } = {}) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(target);
    } catch {
      return resolve(null);
    }
    const mod = u.protocol === 'https:' ? https : http;
    // IP 字面量不走 DNS，lookup 拦不到，这里单独判一次
    if (guardPrivate) {
      const bare = u.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(bare) && isPrivateIp(bare)) return resolve(null);
    }
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        timeout,
        rejectUnauthorized: false,
        /*
         * 开了守卫就用自己的解析器，并且**禁用连接池**（agent: false）。
         *
         * 为什么必须禁用池：Node 19+ 的 globalAgent 默认 keepAlive。一旦之前
         * 有什么请求连过同一个 host:port（比如不带守卫的正常抓取），池里就留着
         * 一条现成的 socket，下次请求直接复用 —— **不再走 lookup，守卫形同虚设**。
         * 实测就是这么漏的：先裸跑连上 127-0-0-1.sslip.io，再开守卫请求，
         * 走的是复用连接，返回 200。
         * 抓图标是低频操作，每次新建连接完全可接受。
         */
        ...(guardPrivate ? { lookup: guardedLookup, agent: false } : {}),
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
          return resolve(
            rawGet(new URL(loc, u).toString(), { timeout, maxBytes, redirects: redirects - 1, guardPrivate }),
          );
        }
        const chunks = [];
        let size = 0;
        let truncated = false;
        let settled = false;
        /*
         * 超过 maxBytes 的处理：**先收下再停**，不是「这块太大就不收了」。
         * 老写法是 `size += c.length; if (size <= maxBytes) push`，遇到一次写出
         * 38KB 的页面（nginx 常这么干）时 size 直接越过上限，整块被丢掉，
         * body 变成 0 字节 → 探测方以为「这端口没内容」，服务就被漏掉了。
         */
        res.on('data', (c) => {
          if (size >= maxBytes) return;
          const remain = maxBytes - size;
          chunks.push(c.length <= remain ? c : c.subarray(0, remain));
          size += c.length;
          if (size >= maxBytes) {
            truncated = true;
            res.destroy();
          }
        });
        const done = () => {
          if (settled) return;
          settled = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks), url: u.toString(), truncated });
        };
        res.on('end', done);
        res.on('close', done);
        // 主动截断会让流以 error 结束；只要手里已经有数据，就当作成功返回
        res.on('error', () => {
          if (chunks.length || truncated) return done();
          if (settled) return;
          settled = true;
          resolve(null);
        });
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
const WEAK_TITLE_RE = /^(404|400|401|403|405|500|502|503|504|error|not found|bad gateway|unauthorized|forbidden|bad request|service unavailable|it works|index of|directory listing|autoindex|文件列表|apache2|welcome to nginx|test page|default page|coming soon|无权限|未找到)/i;

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

/**
 * 取标签属性值。三种写法都要认：
 *   rel="icon" / rel='icon' / rel=icon
 * 压缩过的 HTML（Vue/Go 模板产物）经常省掉引号，只认带引号会漏掉整批图标。
 */
const attrOf = (tag, name) => {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return (m && (m[1] ?? m[2] ?? m[3])) || '';
};

const findIconHref = (html) => {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  const found = [];
  for (const tag of links) {
    const rel = attrOf(tag, 'rel');
    if (!ICON_RELS.test(rel)) continue;
    const href = attrOf(tag, 'href');
    if (!href) continue;
    const sizes = attrOf(tag, 'sizes');
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

/**
 * 没有可靠 content-type 时，从文件头认图片。
 *
 * 为什么需要：不少服务端对 favicon 不发或发错类型（尤其老 NAS 上的自研服务）。
 * 但反过来，**不能因为「状态码 200、长度够」就当成图标存下来** ——
 * 那样任何返回 HTML 的地址都会变成一张"图标"，再通过 /icons/ 以同源身份吐出去。
 */
const sniffImageExt = (buf) => {
  if (!buf || buf.length < 8) return '';
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'webp'; // RIFF....WEBP
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'ico';
  // SVG 是文本，看开头是否有 <svg 或 <?xml
  const head = b.subarray(0, 400).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return '';
};

export const saveIconBuf = async (buf, ext) => {
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const file = `${hash}.${ext}`;
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.writeFile(path.join(ICON_DIR, file), buf);
  return `/icons/${file}`;
};

/** 抓一个站点的图标并存到本地 */
/**
 * 内网/环回地址判断。
 * 只在 blockPrivateFetch 打开时生效（设了 ACCESS_TOKEN 就自动开）——
 * 纯内网场景抓自己 NAS 上的图标是正常需求，不能一刀切禁掉；
 * 但一旦端口暴露到公网，这个接口就会变成"替你探测内网"的工具。
 */
const PRIVATE_HOST_RE =
  /^(localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i;

export function isPrivateUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return true;
    return PRIVATE_HOST_RE.test(x.hostname);
  } catch {
    return true;
  }
}

export async function fetchIcon(siteUrl, htmlHint, { allowPrivate = false } = {}) {
  try {
    /*
     * 防 SSRF 这条闸门只该管「用户随手给的地址」（/api/icon/fetch 那种）。
     * 自动扫描出来的服务是我们自己探测到的本机端口，本来就在内网——
     * 一刀切会变成「设了访问令牌之后，所有内网服务卡片全都没图标」，
     * 因为 blockPrivateFetch 默认跟着令牌开启。
     */
    /*
     * 两道闸门，缺一不可：
     *   1) 先按主机名快速拒掉一眼就是内网的地址（省一次 DNS）；
     *   2) 真正起作用的是 rawGet 里的 guardPrivate —— 按解析出来的 IP 判，
     *      并且每一跳跳转都重判。只做第 1 道的话，127-0-0-1.sslip.io 这种就穿过去了。
     */
    const guard = !allowPrivate && CONFIG.blockPrivateFetch;
    if (guard && isPrivateUrl(siteUrl)) return '';
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
      const res = await rawGet(c, { timeout: 2500, maxBytes: 256 * 1024, guardPrivate: guard });
      if (!res || res.status !== 200 || !res.body?.length || res.body.length < 70) continue;
      const ct = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      // 只认图片：content-type 对就用它，不对或缺失再从文件头认；两样都不是就丢弃
      const ext = ct.startsWith('image/') ? EXT_BY_TYPE[ct] || sniffImageExt(res.body) : sniffImageExt(res.body);
      if (!ext) continue;
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
  // 28KB 太小：MoviePilot 首页 37KB、很多 SPA 内联样式后都超，一旦超就整块丢弃。
  // 配合上面 rawGet 的「先收再停」，这里给到 96KB，标题（在 head）稳拿。
  const res = await rawGet(probeUrl, { timeout: CONFIG.probeTimeout, maxBytes: 96 * 1024 });
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
    // 扫描出来的服务都在这台机器上，允许抓内网图标（不受 blockPrivateFetch 限制）
    svc.icon = await fetchIcon(svc.probeUrl, svc.html, { allowPrivate: true });
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
