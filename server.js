import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { CONFIG, ICON_DIR, BG_DIR } from './lib/config.js';
import * as store from './lib/store.js';
import { discoverWithIcons, fetchIcon, rawGet } from './lib/discover.js';
import { parseAny } from './lib/bookmarks.js';
import { handleProxy, handleUpgrade, getMonitorStats } from './lib/proxy.js';
import { systemSnapshot, warmup } from './lib/metrics.js';
import { containerStats } from './lib/containers.js';
import { getWeather } from './lib/weather.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const json = (res, code, data, extra = {}) => {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(body);
};

const text = (res, code, msg) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(msg);
};

function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 带状态码的业务错误：上传超限该回 413，不该一律 500 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON 解析失败');
  }
}

/** 本机第一个非回环 IPv4，用于「用户从本机 127.0.0.1 打开」时仍生成可被其它设备访问的地址 */
const lanAddress = () => {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
};

const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i;

const hostOf = (req) => {
  if (CONFIG.publicHost) return CONFIG.publicHost;
  const h = String(req.headers.host || '').replace(/:\d+$/, '');
  // 从 NAS 本机用 127.0.0.1 打开时，卡片地址不能跟着写成 127.0.0.1，
  // 否则手机/其它电脑点开全部打不开。这种情况换成局域网地址。
  if (!h || LOOPBACK_RE.test(h)) return lanAddress();
  return h;
};

/** 监控地址：设置里填了就用填的，没填则跟着访问主机名走 */
/**
 * 服务端自己去请求监控时用的地址。
 *
 * 刻意只认启动配置，不认设置里的 monitor.url —— 那个字段可以被任何人 PATCH，
 * 一旦公网可达，攻击者改掉它再用 /fn/ 代理，这里就成了能读内网任意 HTTP 服务的跳板。
 */
const proxyTarget = () => CONFIG.monitorUrl || `http://127.0.0.1:${CONFIG.monitorPort}/`;

/* ---------------- 访问控制 ----------------
 * 默认关闭：ACCESS_TOKEN 没设时一切照旧，内网照常用。
 * 设了之后，除登录页本身外的所有请求都要带令牌：
 *   - 浏览器：登录页写 httpOnly cookie（cookie 里存的是令牌的 sha256，不是令牌本身）
 *   - 脚本：Authorization: Bearer <token>
 *   - 一次性链接：?token=<token>，验证后 302 去掉参数并落 cookie
 */
const AUTH_COOKIE = 'fnstart_auth';
/** HTTPS 进来就给 cookie 加 Secure，免得它被明文请求带出去；内网 HTTP 直连不加，否则每次都要重登 */
const authCookie = (req) =>
  `${AUTH_COOKIE}=${AUTH_HASH}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_MAX_AGE}${isHttps(req) ? '; Secure' : ''}`;
const AUTH_MAX_AGE = 30 * 24 * 3600;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const AUTH_HASH = CONFIG.accessToken ? sha256(CONFIG.accessToken) : '';
let authFail = 0; // 登录失败次数，用于递增延时

/** 交给代理的「我方凭证」描述：只摘自己那一条，别动上游自己的登录态 */
const PROXY_AUTH = AUTH_HASH
  ? { cookieName: AUTH_COOKIE, tokenHash: AUTH_HASH, sha256 }
  : null;

const hashEq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

/** 这次请求是不是 HTTPS（反代通常用 X-Forwarded-Proto 告诉后端） */
const isHttps = (req) =>
  String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ||
  !!(req.socket && req.socket.encrypted);

const parseCookies = (req) => {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};

/** 返回 'cookie' | 'bearer' | 'query' | ''，只用来区分放行方式，不做授权决策 */
const tokenFromReq = (req, url) => {
  if (!AUTH_HASH) return 'off';
  if (hashEq(parseCookies(req)[AUTH_COOKIE], AUTH_HASH)) return 'cookie';
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ') && hashEq(sha256(h.slice(7).trim()), AUTH_HASH)) return 'bearer';
  const q = url.searchParams.get('token');
  if (q && hashEq(sha256(q), AUTH_HASH)) return 'query';
  return '';
};

const html = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    // 不外传 Referer：?token= 链接里带令牌，别让它跟着外链跑到别人服务器上
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
};

const loginPage = (msg = '') => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>需要访问令牌</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;
    background:#0a0d18;color:#f2f2f0;
    font:400 14px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",sans-serif}
  body::before{content:'';position:fixed;inset:-20%;z-index:0;pointer-events:none;
    background:
      radial-gradient(circle at 30% 30%,rgba(43,107,255,.35),transparent 45%),
      radial-gradient(circle at 75% 70%,rgba(139,61,255,.28),transparent 45%)}
  form{position:relative;z-index:1;width:100%;max-width:340px;padding:28px 24px 24px;
    border-radius:22px;border:1px solid rgba(255,255,255,.1);
    background:rgba(255,255,255,.045);backdrop-filter:blur(18px)}
  h1{margin:0 0 6px;font-size:17px;font-weight:650;letter-spacing:.2px}
  p{margin:0 0 18px;font-size:12.5px;color:#92928f}
  input{width:100%;height:44px;padding:0 14px;border-radius:12px;
    border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
    color:#f2f2f0;font-size:16px;outline:none}
  input:focus{border-color:rgba(120,170,255,.55)}
  button{width:100%;height:44px;margin-top:12px;border-radius:12px;border:0;
    background:linear-gradient(150deg,#4a7dff,#7a4dff);color:#fff;
    font-size:14px;font-weight:600;cursor:pointer}
  button:active{transform:scale(.99)}
  .err{margin:14px 0 0;font-size:12.5px;color:#ff8b87}
  .tip{margin:16px 0 0;font-size:11.5px;line-height:1.7;color:#6e6e6c}
</style></head>
<body><form method="POST" action="/__login">
  <h1>需要访问令牌</h1>
  <p>这是私人主页，仅部署者本人可用。输入部署时设的 ACCESS_TOKEN。</p>
  <input name="token" type="password" placeholder="访问令牌" autocomplete="current-password" autofocus>
  <button type="submit">进入</button>
  ${msg ? `<div class="err">${msg}</div>` : ''}
  <div class="tip">登录一次记 30 天；只要期间打开过主页，有效期会自动往后顺延。忘了令牌见 README「忘了令牌怎么办」。</div>
</form></body></html>`;

async function serveFile(res, filePath, { cache = 'no-cache', download = false } = {}) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) return text(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (download) headers['Content-Disposition'] = 'attachment';
    // 上传的 SVG 是同源文档，直接打开会执行里面的事件脚本。
    // 这里用 CSP 把所有脚本能力按住，矢量图标照常显示。
    if (ext === '.html') headers['X-Frame-Options'] = 'SAMEORIGIN';
    if (ext === '.svg') {
      headers['Content-Security-Policy'] =
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
    }
    res.writeHead(200, headers);
    fss.createReadStream(filePath).pipe(res);
  } catch {
    text(res, 404, 'Not found');
  }
}

const safeJoin = (base, rel) => {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  // 只判 startsWith(base) 是不够的：/data/icons-evil 也能通过 /data/icons 的前缀匹配。
  // 必须要求正好等于 base，或者以 base + 分隔符开头。
  if (p === base) return p;
  return p.startsWith(base + path.sep) ? p : null;
};

const saveUpload = async (dir, dataUri, prefix = 'up', urlBase = '/backgrounds') => {
  const m = /^data:(image\/([\w.+-]+));base64,(.+)$/is.exec(String(dataUri || '').replace(/\s+/g, ''));
  if (!m) throw new HttpError(400, '图片格式不支持（需要 base64 data URI）');
  const extMap = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', svg: 'svg', gif: 'gif', 'svg+xml': 'svg', avif: 'avif', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico' };
  const ext = extMap[m[2].toLowerCase()] || 'png';
  let buf = Buffer.from(m[3], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, '图片超过 2MB');
  if (ext === 'svg') buf = sanitizeSvg(buf);
  await fs.mkdir(dir, { recursive: true });
  if ((await dirBytes(dir)) + buf.length > 200 * 1024 * 1024) {
    throw new HttpError(507, '图片目录已满（200MB），先清理一些不再用的图标');
  }
  const file = `${prefix}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, file), buf);
  return `${urlBase}/${file}`;
};

/** 目录已占用字节数，用来给上传加总量上限（防止被拿来塞满磁盘） */
const dirBytes = async (dir) => {
  let total = 0;
  try {
    for (const f of await fs.readdir(dir)) {
      try {
        total += (await fs.stat(path.join(dir, f))).size;
      } catch {
        /* 文件刚好被删 */
      }
    }
  } catch {
    /* 目录还不存在 */
  }
  return total;
};

/**
 * SVG 是同源文档，里面可以塞 <script> 或 onload=。
 * 响应头已经用 CSP 按住脚本，这里再做一遍内容清洗（双保险，也防有人直接把文件拖进数据目录后分享）。
 */
const sanitizeSvg = (buf) =>
  Buffer.from(
    buf
      .toString('utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|xlink:href)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '')
      .replace(/javascript:/gi, ''),
    'utf8',
  );

// ---------- 首次启动自动采集 ----------
let bootstrapPromise = null;
async function bootstrapIfEmpty(host) {
  const state = await store.load();
  if (state.cards.length > 0) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    try {
      const result = await discoverWithIcons(host, { force: true, selfPort: CONFIG.port, extraPorts: CONFIG.probePorts });
      if (result.services.length) {
        await store.addCards(
          result.services.map((s) => ({
            name: s.name,
            url: s.url,
            icon: s.icon,
            desc: s.container,
            source: s.source,
            container: s.container,
            // 必须带 port：判重键在「有端口」时用 port:xxxx，没有时退回 url:xxx。
            // 这里漏过一次，导致首屏自动采集写一批 port=0 的卡，
            // 之后手动扫描写一批带端口的，两批判重键不同 → 同一服务两张卡。
            port: s.port,
          })),
        );
        const st = store.getState();
        st.meta.lastDiscovery = Date.now();
        st.meta.lastDiscoveryCount = result.services.length;
        await store.save();
        console.log(`[fnstart] 首次启动自动采集到 ${result.services.length} 个服务`);
      }
    } catch (e) {
      console.warn('[fnstart] 自动采集失败：', e.message);
    } finally {
      bootstrapPromise = null;
    }
  })();
  return bootstrapPromise;
}

// ---------- 路由 ----------
async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  if (p === '/api/state' && method === 'GET') {
    const s = await store.load();
    return json(res, 200, { settings: s.settings, cards: s.cards, meta: s.meta });
  }

  if (p === '/api/settings' && method === 'PATCH') {
    const body = await readJson(req);
    const settings = await store.patchSettings(body);
    return json(res, 200, { ok: true, settings });
  }

  if (p === '/api/cards' && method === 'POST') {
    const body = await readJson(req);
    if (!body.url) return json(res, 400, { ok: false, error: '缺少地址' });
    let icon = body.icon || '';
    if (!icon && body.autoIcon !== false) icon = await fetchIcon(body.url);
    const added = await store.addCards([{ ...body, icon }]);
    return json(res, 200, { ok: true, card: added[0] || null });
  }

  if (p.startsWith('/api/cards/') && method === 'PATCH') {
    const id = p.split('/')[3];
    const body = await readJson(req);
    const card = await store.updateCard(id, body);
    if (!card) return json(res, 404, { ok: false, error: '卡片不存在' });
    return json(res, 200, { ok: true, card });
  }

  if (p.startsWith('/api/cards/') && method === 'DELETE') {
    const id = p.split('/')[3];
    const ok = await store.removeCard(id);
    return json(res, ok ? 200 : 404, { ok });
  }

  if (p === '/api/cards/reorder' && method === 'POST') {
    const body = await readJson(req);
    const items = body.items || body.ids;
    if (!Array.isArray(items)) return json(res, 400, { ok: false, error: 'items 必须是数组' });
    const cards = await store.reorder(items);
    return json(res, 200, { ok: true, cards });
  }

  // 扫描容器
  if (p === '/api/discover' && (method === 'POST' || method === 'GET')) {
    const force = url.searchParams.get('force') !== '0';
    const apply = url.searchParams.get('apply') !== '0';
    const host = hostOf(req);
    const result = await discoverWithIcons(host, { force, selfPort: CONFIG.port, extraPorts: CONFIG.probePorts });
    let addedCount = 0;
    if (apply && result.services.length) {
      const added = await store.addCards(
        result.services.map((s) => ({
          name: s.name,
          url: s.url,
          icon: s.icon,
          desc: s.container,
          source: s.source,
          container: s.container,
          port: s.port,
        })),
      );
      addedCount = added.length;
      // 顺手收拾历史脏数据：同 URL 的服务卡只留一张（旧版本漏传 port 留下的）
      const deduped = await store.dedupeServiceCards();
      const st = store.getState();
      st.meta.lastDiscovery = Date.now();
      st.meta.lastDiscoveryCount = result.services.length;
      await store.save();
      return json(res, 200, { ...result, added: addedCount, deduped });
    }
    // 即便这次一个服务都没发现，也把已有的重复清一遍
    const deduped = apply ? await store.dedupeServiceCards() : 0;
    return json(res, 200, { ...result, added: addedCount, deduped });
  }

  // 书签导入
  if (p === '/api/import' && method === 'POST') {
    const body = await readJson(req);
    const items = await parseAny(body.text || body.html || '');
    if (!items.length) return json(res, 400, { ok: false, error: '没解析到有效链接' });
    const limited = items.slice(0, 400);
    const added = await store.addCards(limited, { moveToFront: !!body.moveToFront });
    return json(res, 200, { ok: true, parsed: items.length, added: added.length, cards: added });
  }

  // 单独抓图标
  if (p === '/api/icon/fetch' && method === 'POST') {
    const body = await readJson(req);
    if (!body.url) return json(res, 400, { ok: false, error: '缺少 url' });
    const icon = await fetchIcon(body.url);
    return json(res, 200, { ok: !!icon, icon });
  }

  // 上传图标 / 背景（base64）
  if (p === '/api/upload/icon' && method === 'POST') {
    const body = await readJson(req);
    const url = await saveUpload(ICON_DIR, body.data, 'ci', '/icons');
    return json(res, 200, { ok: true, icon: url });
  }
  if (p === '/api/upload/background' && method === 'POST') {
    const body = await readJson(req);
    const url = await saveUpload(BG_DIR, body.data, 'bg');
    return json(res, 200, { ok: true, url });
  }

  // 监控实时指标（自采优先；拿不到才退回 fnMonitor；再不行用上次快照）
  if (p === '/api/monitor/stats' && method === 'GET') {
    const s = await store.load();
    let stats = null;
    let stale = false;

    /*
     * 主路径：自己采。读 /host/proc 与 /host/sys，不依赖任何外部应用。
     * 任何异常都吞掉并回落到 fnMonitor —— 少个传感器不该让整块面板空着。
     */
    try {
      const snap = await systemSnapshot();
      snap.containers = await containerStats();
      // 面板的「来源」标记：自采时不显示外部依赖
      snap.source = 'native';
      stats = snap;
    } catch (e) {
      console.warn('[fnstart] 自采指标失败，回落到 fnMonitor：', e?.message || e);
      stats = null;
    }

    if (!stats) {
      stats = await getMonitorStats(proxyTarget());
      if (stats) stats.source = 'fnmonitor';
    }

    const cachePath = path.join(CONFIG.dataDir, 'last-monitor.json');
    if (stats) {
      fs.writeFile(cachePath, JSON.stringify(stats)).catch(() => {});
    } else {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        if (Date.now() - (cached.ts || 0) < 30 * 60 * 1000) {
          stats = cached;
          stale = true;
        }
      } catch {
        /* 没有快照就算了 */
      }
    }
    return json(res, 200, { ok: !!stats, stale, source: stats?.source || '', stats });
  }

  // 天气（取不到就回退上次成功的结果，最长 6 小时）
  if (p === '/api/weather' && method === 'GET') {
    const s = await store.load();
    const city = url.searchParams.get('city') || s.settings.weather?.city || '北京';
    const data = await getWeather(city);
    const cachePath = path.join(CONFIG.dataDir, 'last-weather.json');
    if (data.ok) {
      fs.writeFile(cachePath, JSON.stringify(data)).catch(() => {});
    } else {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        if (Date.now() - (cached.at || 0) < 6 * 3600 * 1000) {
          return json(res, 200, { ...cached, stale: true });
        }
      } catch {
        /* 没有快照 */
      }
    }
    return json(res, 200, data);
  }

  // 探活：自采模式下看宿主机 procfs 能不能读到；否则检查 fnMonitor 地址
  if (p === '/api/monitor/ping' && method === 'GET') {
    try {
      const snap = await systemSnapshot();
      if (snap?.online) return json(res, 200, { ok: true, status: 200, source: 'native' });
    } catch {
      /* 自采不通，落到下面探外部地址 */
    }
    const target = new URL(proxyTarget());
    const res2 = await rawGet(`${target.protocol}//${target.host}/`, { timeout: 3000, maxBytes: 4096 });
    return json(res, 200, { ok: !!res2 && res2.status < 500, status: res2?.status || 0, source: 'fnmonitor' });
  }

  if (p === '/api/export' && method === 'GET') {
    const s = await store.load();
    return json(res, 200, s, { 'Content-Disposition': 'attachment; filename="fnstart-backup.json"' });
  }

  return json(res, 404, { ok: false, error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    // 登录提交，这一条不需要令牌（否则没法登录）
    if (p === '/__login' && req.method === 'POST') {
      const raw = await readBody(req, 8192);
      const form = new URLSearchParams(raw.toString('utf8'));
      const input = form.get('token') || '';
      if (AUTH_HASH && hashEq(sha256(input), AUTH_HASH)) {
        res.writeHead(303, {
          'Set-Cookie': authCookie(req),
          Location: '/',
          'Cache-Control': 'no-store',
        });
        authFail = 0;
        return res.end();
      }
      // 连续输错就逐步变慢（400ms → 5s），别让人拿这个接口当爆破入口。
      // 正常人只会错一两次，感知不到；脚本爆破则被拖到没有意义。
      authFail += 1;
      const wait = Math.min(400 * 2 ** Math.min(authFail - 1, 4), 5000);
      await new Promise((r) => setTimeout(r, wait));
      return html(res, 401, loginPage('令牌不对，再试一次'));
    }

    /*
     * 容器健康检查专用，必须放在鉴权之前。
     * Docker 的 HEALTHCHECK 拿不到访问令牌，探 /api/state 永远 401，
     * 容器就会一直标 unhealthy —— 1.3.0 之前一直有这个问题，只是之前用
     * node:22-alpine 直接跑、没走本项目的 Dockerfile，所以没暴露。
     * 只回一个 ok，不带任何数据，被扫到也只能知道「这服务活着」。
     */
    if (p === '/api/health') return json(res, 200, { ok: true });

    if (AUTH_HASH) {
      const how = tokenFromReq(req, url);
      if (!how) {
        if (p.startsWith('/api/')) return json(res, 401, { ok: false, error: '需要访问令牌' });
        return html(res, 401, loginPage());
      }
      // 滑动续期：只在「打开页面」时重发一次 cookie，把 30 天重新算起。
      // 不这么做的话 Max-Age 是硬过期 —— 第 31 天不管你昨天刚用过，照样被踢回登录页。
      // 静态资源和 /api/ 不续，免得每个图标响应都多背一个 Set-Cookie。
      if (how === 'cookie' && (p === '/' || p === '/index.html')) {
        res.setHeader('Set-Cookie', authCookie(req));
      }
      // 用 ?token= 进来的一次性链接：换成 cookie，别把令牌留在地址栏和访问记录里
      if (how === 'query') {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        res.writeHead(303, {
          'Set-Cookie': authCookie(req),
          Location: clean.pathname + (clean.search || ''),
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
    }

    if (p.startsWith('/api/')) return await handleApi(req, res, url);

    if (p.startsWith('/fn/')) {
      handleProxy(req, res, { targetUrl: proxyTarget(), auth: PROXY_AUTH });
      return;
    }

    if (p.startsWith('/icons/')) {
      const f = safeJoin(ICON_DIR, p.slice(7));
      if (!f) return text(res, 400, 'bad path');
      return serveFile(res, f, { cache: 'public, max-age=604800' });
    }
    if (p.startsWith('/backgrounds/')) {
      const f = safeJoin(BG_DIR, p.slice(13));
      if (!f) return text(res, 400, 'bad path');
      return serveFile(res, f, { cache: 'public, max-age=604800' });
    }

    if (p === '/' || p === '/index.html') {
      // 打开首页时若还没卡片，后台补一次采集（不阻塞响应）
      bootstrapIfEmpty(hostOf(req)).catch(() => {});
      return serveFile(res, path.join(CONFIG.publicDir, 'index.html'), { cache: 'no-store' });
    }

    const f = safeJoin(CONFIG.publicDir, p);
    if (!f) return text(res, 400, 'bad path');
    return serveFile(res, f, { cache: p.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache' });
  } catch (e) {
    // 业务错误（上传超限之类）带自己的状态码；其它一律 500，且不把内部信息回给客户端
    const code = e instanceof HttpError ? e.status : 500;
    if (code === 500) console.error('[fnstart]', req.method, p, e?.message || e);
    if (!res.headersSent) {
      json(res, code, { ok: false, error: code === 500 ? '服务内部错误' : e.message });
    }
  }
});

server.on('upgrade', async (req, socket, head) => {
  const wsUrl = new URL(req.url || '/', 'http://x');
  if (AUTH_HASH && !tokenFromReq(req, wsUrl)) {
    socket.destroy();
    return;
  }
  if (String(req.url || '').startsWith('/fn/')) {
    return handleUpgrade(req, socket, head, { targetUrl: proxyTarget(), auth: PROXY_AUTH });
  }
  socket.destroy();
});

await store.load();
// 预热：CPU / 网络 / 功耗都是差分型指标，先采一次底，第一次打开面板就有值
warmup().catch(() => {});
server.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`[fnstart] 已启动 → http://0.0.0.0:${CONFIG.port}`);
  console.log(`[fnstart] 数据目录 ${CONFIG.dataDir}`);
  console.log(`[fnstart] Docker socket ${CONFIG.dockerSock}`);
  /*
   * 启动时把访问保护的状态说清楚，但**永远不打印令牌本身** ——
   * docker logs 是很多人会随手分享出去的东西，令牌进了日志等于半公开。
   * 只报长度，够判断「有没有设」「是不是太短」。
   */
  if (AUTH_HASH) {
    const n = String(CONFIG.accessToken).length;
    console.log(`[fnstart] 访问保护：已开启（令牌 ${n} 位，cookie 30 天滑动续期）`);
    if (n < 16) {
      console.warn('[fnstart] 令牌偏短，建议至少 16 位：openssl rand -hex 16');
    }
  } else {
    console.warn('[fnstart] 访问保护：未开启 —— 任何能访问到端口的人都能改卡片、读监控、导出备份');
    console.warn('[fnstart] 只要端口能被本机以外访问，就该设 ACCESS_TOKEN，见 README「访问令牌的一生」');
  }
  probeMonitor();
});

/**
 * 启动时探一下飞牛监控。
 * fnMonitor 是第三方的 FPK 应用（github.com/MisiteQ/fnmonitor），不是 Docker 镜像，
 * 没法跟我们一起 compose 起来，
 * 所以这里主动打一声招呼：连上了报一声，没连上也把「该去装什么」直接说清楚。
 */
async function probeMonitor() {
  const target = CONFIG.monitorUrl || `http://127.0.0.1:${CONFIG.monitorPort}/api/overview`;
  try {
    const r = await fetch(target, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      console.log(`[fnstart] 飞牛监控已连接 → ${target}`);
    } else {
      console.warn(`[fnstart] 飞牛监控返回 ${r.status}（${target}）`);
      console.warn('[fnstart] 监控面板会显示离线，检查 fnMonitor 是否在运行');
    }
  } catch {
    console.warn(`[fnstart] 没连上飞牛监控（${target}）`);
    console.warn('[fnstart] 想让监控面板有数据，请先安装并启动「飞牛监控 fnMonitor」');
    console.warn('[fnstart] 它是第三方开源应用（MIT）：https://github.com/MisiteQ/fnmonitor');
    console.warn('[fnstart] 没有它也能用，只是右侧面板会提示离线');
  }
}
