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

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('JSON 解析失败');
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
const AUTH_MAX_AGE = 30 * 24 * 3600;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const AUTH_HASH = CONFIG.accessToken ? sha256(CONFIG.accessToken) : '';

const hashEq = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

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
</style></head>
<body><form method="POST" action="/__login">
  <h1>需要访问令牌</h1>
  <p>这台 fnStart 开了访问保护。输入部署时设置的 ACCESS_TOKEN。</p>
  <input name="token" type="password" placeholder="访问令牌" autocomplete="current-password" autofocus>
  <button type="submit">进入</button>
  ${msg ? `<div class="err">${msg}</div>` : ''}
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
    };
    if (download) headers['Content-Disposition'] = 'attachment';
    // 上传的 SVG 是同源文档，直接打开会执行里面的事件脚本。
    // 这里用 CSP 把所有脚本能力按住，矢量图标照常显示。
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
  return p.startsWith(base) ? p : null;
};

const saveUpload = async (dir, dataUri, prefix = 'up', urlBase = '/backgrounds') => {
  const m = /^data:(image\/([\w.+-]+));base64,(.+)$/is.exec(String(dataUri || '').replace(/\s+/g, ''));
  if (!m) throw new Error('图片格式不支持（需要 base64 data URI）');
  const extMap = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', svg: 'svg', gif: 'gif', 'svg+xml': 'svg', avif: 'avif', 'x-icon': 'ico', 'vnd.microsoft.icon': 'ico' };
  const ext = extMap[m[2].toLowerCase()] || 'png';
  let buf = Buffer.from(m[3], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw new Error('图片超过 2MB');
  if (ext === 'svg') buf = sanitizeSvg(buf);
  await fs.mkdir(dir, { recursive: true });
  if ((await dirBytes(dir)) + buf.length > 200 * 1024 * 1024) {
    throw new Error('图片目录已满（200MB），先清理一些不再用的图标');
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
      const st = store.getState();
      st.meta.lastDiscovery = Date.now();
      st.meta.lastDiscoveryCount = result.services.length;
      await store.save();
    }
    return json(res, 200, { ...result, added: addedCount });
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

  // 监控实时指标（拿不到时回退到上次成功快照，避免面板整块空白）
  if (p === '/api/monitor/stats' && method === 'GET') {
    const s = await store.load();
    let stats = await getMonitorStats(proxyTarget());
    let stale = false;
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
    return json(res, 200, { ok: !!stats, stale, stats });
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

  // 代理探活：检查监控地址本身是否可访问
  if (p === '/api/monitor/ping' && method === 'GET') {
    const s = await store.load();
    const target = new URL(proxyTarget());
    const res2 = await rawGet(`${target.protocol}//${target.host}/`, { timeout: 3000, maxBytes: 4096 });
    return json(res, 200, { ok: !!res2 && res2.status < 500, status: res2?.status || 0 });
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
          'Set-Cookie': `${AUTH_COOKIE}=${AUTH_HASH}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_MAX_AGE}`,
          Location: '/',
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
      // 慢一点，别让人拿这个接口当爆破入口
      await new Promise((r) => setTimeout(r, 400));
      return html(res, 401, loginPage('令牌不对，再试一次'));
    }

    if (AUTH_HASH) {
      const how = tokenFromReq(req, url);
      if (!how) {
        if (p.startsWith('/api/')) return json(res, 401, { ok: false, error: '需要访问令牌' });
        return html(res, 401, loginPage());
      }
      // 用 ?token= 进来的一次性链接：换成 cookie，别把令牌留在地址栏和访问记录里
      if (how === 'query') {
        const clean = new URL(url);
        clean.searchParams.delete('token');
        res.writeHead(303, {
          'Set-Cookie': `${AUTH_COOKIE}=${AUTH_HASH}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${AUTH_MAX_AGE}`,
          Location: clean.pathname + (clean.search || ''),
          'Cache-Control': 'no-store',
        });
        return res.end();
      }
    }

    if (p.startsWith('/api/')) return await handleApi(req, res, url);

    if (p.startsWith('/fn/')) {
      handleProxy(req, res, { targetUrl: proxyTarget() });
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
    console.error('[fnstart]', req.method, p, e?.message);
    if (!res.headersSent) json(res, 500, { ok: false, error: e?.message || '服务内部错误' });
  }
});

server.on('upgrade', async (req, socket, head) => {
  const wsUrl = new URL(req.url || '/', 'http://x');
  if (AUTH_HASH && !tokenFromReq(req, wsUrl)) {
    socket.destroy();
    return;
  }
  if (String(req.url || '').startsWith('/fn/')) {
    return handleUpgrade(req, socket, head, { targetUrl: proxyTarget() });
  }
  socket.destroy();
});

await store.load();
server.listen(CONFIG.port, '0.0.0.0', () => {
  console.log(`[fnstart] 已启动 → http://0.0.0.0:${CONFIG.port}`);
  console.log(`[fnstart] 数据目录 ${CONFIG.dataDir}`);
  console.log(`[fnstart] Docker socket ${CONFIG.dockerSock}`);
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
