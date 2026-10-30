import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { URL } from 'node:url';
import { CONFIG, ICON_DIR, BG_DIR } from './lib/config.js';
import * as store from './lib/store.js';
import { discoverWithIcons, fetchIcon, rawGet } from './lib/discover.js';
import { parseAny } from './lib/bookmarks.js';
import { handleProxy, handleUpgrade, getMonitorStats } from './lib/proxy.js';
import { systemSnapshot, startMetricsWatcher, warmup } from './lib/metrics.js';
import { containerStats, startContainerWatcher } from './lib/containers.js';
import { getWeather } from './lib/weather.js';
import { mediaStats, resolveMediaRoot } from './lib/media.js';

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
const AUTH_MAX_AGE = 7 * 24 * 3600; // 令牌是唯一凭证，窗口不宜太长
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const AUTH_HASH = CONFIG.accessToken ? sha256(CONFIG.accessToken) : '';

/* ---------------- 登录限速：按来源 IP ---------------- */

/**
 * 连续失败到这个次数，就把这个 IP 关一段时间的小黑屋。
 *
 * 为什么必须按 IP：原来是一个模块级计数器，所有请求共用一个数。
 * 任何人从任意一台机器连错几次，接下来所有人登录都要被拖慢到 5 秒 ——
 * 既能把真正的主人锁在门外（自伤），又拦不住换 IP 继续试（无效）。
 * 而令牌就是这个面板唯一的防线。
 */
const AUTH_FAIL_MAX = 8;
/** 计数窗口与封禁时长 */
const AUTH_LOCK_MS = 5 * 60_000;

const authFails = new Map(); // ip -> { count, until, last }

/** ::ffff:1.2.3.4 这种映射写法统一成 IPv4，方便比较 */
const normIp = (ip) => String(ip || '').replace(/^::ffff:/i, '');

/** 本机所有地址：同机部署的反代会用其中任意一个连过来 */
const LOCAL_ADDRS = new Set(['127.0.0.1', '::1', 'unknown']);
for (const list of Object.values(os.networkInterfaces())) {
  for (const n of list || []) if (n?.address) LOCAL_ADDRS.add(normIp(n.address));
}

const ipv4ToInt = (ip) => {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};

const inCidr = (ip, cidr) => {
  if (!String(cidr).includes('/')) return ip === cidr;
  const [base, bitsStr] = String(cidr).split('/');
  const bits = Number(bitsStr);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
};

/** 直连方是不是排在前面、可以采信其转发头的那个反代 */
const isTrustedProxy = (ip) => {
  if (LOCAL_ADDRS.has(ip)) return true;
  return CONFIG.trustProxyCidrs.some((c) => inCidr(ip, c));
};

/**
 * 这次请求真正来自谁。
 *
 * 默认只认 socket 的对端地址 —— X-Forwarded-For 谁都能写，默认信任等于把限速作废。
 * 开了 TRUST_PROXY 且直连方确实是可信反代时，才看转发头：
 *   - X-Real-IP 优先（单值，最干净）
 *   - 否则取 XFF 的**最后一个**：那才是紧邻我们的反代看到的地址。
 *     前面的值可能是客户端自己塞进来的，取第一个就等于让攻击者随便指定 IP。
 */
const clientIp = (req) => {
  const direct = normIp(req.socket?.remoteAddress || 'unknown');
  if (!CONFIG.trustProxy || !isTrustedProxy(direct)) return direct;
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (net.isIP(real)) return normIp(real);
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const last = xff[xff.length - 1];
  return last && net.isIP(last) ? normIp(last) : direct;
};

const lockLeftMs = (ip) => {
  const r = authFails.get(ip);
  if (!r || !r.until) return 0;
  const left = r.until - Date.now();
  if (left <= 0) {
    authFails.delete(ip);
    return 0;
  }
  return left;
};

const noteAuthFail = (ip) => {
  const now = Date.now();
  let r = authFails.get(ip);
  if (!r || now - r.last > AUTH_LOCK_MS) r = { count: 0, until: 0, last: now };
  r.count += 1;
  r.last = now;
  if (r.count >= AUTH_FAIL_MAX) r.until = now + AUTH_LOCK_MS;
  authFails.set(ip, r);
  return r;
};

// 定期清掉过期记录，免得被海量来源 IP 把 Map 撑大
setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of authFails) {
    if (r.until ? r.until < now : now - r.last > AUTH_LOCK_MS * 2) authFails.delete(ip);
  }
}, 60_000).unref();

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
  <div class="tip">登录一次记 7 天；只要期间打开过主页，有效期会自动往后顺延。忘了令牌见 README「忘了令牌怎么办」。</div>
</form></body></html>`;

/* ---------- 静态资源：压缩 / ETag / 内容哈希 ---------- */

/*
 * 只有文本类值得压。png / jpg / woff2 本身就是压缩格式，
 * 再过一遍 zlib 只烧 CPU，体积基本不动，运气不好还变大。
 */
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
/** gzip 头部就 18 字节，比这还小的文件压完通常更大，直接原样发 */
const MIN_COMPRESS_BYTES = 1024;
/** 超过这个尺寸不进内存：背景图动辄十几 MB，全塞进来就是让进程慢慢吃满内存 */
const MAX_BUFFER_BYTES = 256 * 1024;
/**
 * 两个缓存都设上限。这是个一跑就是几个月的常驻进程，
 * 缓存只为了省一次读盘，绝不能变成「用得越久内存越大」。
 * 首页真正需要的就 4 个文件，96 条够放下一整屏图标还有富余。
 */
const MAX_ASSET_ENTRIES = 96;
const MAX_PACKED_ENTRIES = 32;
/** 带内容哈希的地址才配得上这个，没带哈希的地址给一年等于把用户锁在旧版本上 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/*
 * 读盘结果缓存。键里带 mtime + size：文件一改键自然就换掉，
 * 不需要谁记得来清缓存，也不怕部署时漏了清。
 * 有了它，静态资源每个请求只剩一次 stat，压缩也只在第一次发生。
 */
const assetCache = new Map();
/** 压缩结果，键是「内容哈希 + 编码」。内容变了哈希就变，旧的自然淘汰 */
const packedCache = new Map();

const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 16);

async function loadAsset(filePath) {
  const st = await fs.stat(filePath);
  if (!st.isFile() || st.size > MAX_BUFFER_BYTES) return null;
  const hit = assetCache.get(filePath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit;
  const buf = await fs.readFile(filePath);
  const entry = { mtimeMs: st.mtimeMs, size: st.size, buf, hash: hashOf(buf) };
  assetCache.set(filePath, entry);
  if (assetCache.size > MAX_ASSET_ENTRIES) assetCache.delete(assetCache.keys().next().value);
  return entry;
}

/**
 * Accept-Encoding 协商。只认 br / gzip，但 q=0 得当回事 ——
 * 那是客户端在说「这个我解不开」。不认识的编码一律不压：
 * 少压一次没有任何损失，发个解不开的东西过去就是白屏。
 */
function negotiateEncoding(header) {
  const h = String(header || '').toLowerCase();
  if (!h) return null;
  const q = new Map();
  for (const part of h.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const key = (name || '').trim();
    if (!key) continue;
    let weight = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) weight = Number(m[1]);
    }
    q.set(key, Number.isFinite(weight) ? weight : 1);
  }
  const weigh = (name) => (q.has(name) ? q.get(name) : q.get('*') ?? 0);
  for (const enc of ['br', 'gzip']) if (weigh(enc) > 0) return enc;
  return null;
}

/**
 * 真正压一次，结果挂在「哈希 + 编码」上复用。
 *
 * brotli 用 quality 9 而不是 11（实测 app.js：q11 35.1KB / 136ms，q9 37.2KB / 10ms）。
 * 那 136ms 恰好落在「某个人的第一次访问」那条请求上，事件循环被占着，
 * 人是能感觉到的；多花的 126ms 只换回 2KB 压缩率，这笔账不划算。
 */
function packBuffer(buf, hash, enc) {
  const key = `${hash}:${enc}`;
  const hit = packedCache.get(key);
  if (hit) return hit;
  const out =
    enc === 'br'
      ? zlib.brotliCompressSync(buf, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
          },
        })
      : zlib.gzipSync(buf, { level: 9 });
  packedCache.set(key, out);
  if (packedCache.size > MAX_PACKED_ENTRIES) packedCache.delete(packedCache.keys().next().value);
  return out;
}

/** If-None-Match 比对。浏览器回传的就是我们上次发的那个字符串，直接比即可 */
function notModified(req, etag) {
  const inm = req.headers['if-none-match'];
  if (!inm) return false;
  return inm
    .split(',')
    .some((t) => {
      const v = t.trim();
      return v === etag || v === '*' || v.replace(/^W\//, '') === etag;
    });
}

/**
 * 发一段文本资源：协商压缩、带 ETag、命中条件请求就回 304。
 *
 * 304 的收益全在重复访问上 —— 打开主页是个高频动作，每次省掉整个响应体，
 * 只留一个来回。ETag 后面挂编码后缀，是因为 gzip 版和原版是两个不同的表示，
 * 共用同一个标签会让中间缓存把压缩版发给解不开的客户端。
 *
 * allow304=false 只给 no-store 的响应用：no-store 的语义是「别存」，
 * 再回一个「你手上那份还能用」的 304 就自相矛盾了。
 */
function sendText(req, res, buf, hash, { type, cache, headers = {}, allow304 = true }) {
  let enc = buf.length >= MIN_COMPRESS_BYTES ? negotiateEncoding(req.headers['accept-encoding']) : null;
  let body = buf;
  if (enc) {
    const packed = packBuffer(buf, hash, enc);
    // 压完反而更大就别发（小文件常见），ETag 也跟着回到不带后缀的那一种
    if (packed.length < buf.length) body = packed;
    else enc = null;
  }
  const etag = `"${hash}${enc ? `-${enc}` : ''}"`;
  const out = {
    ...headers,
    'Content-Type': type,
    'Cache-Control': cache,
    // 少了 Vary，中间的缓存/反代可能把压缩版发给不支持压缩的客户端
    Vary: 'Accept-Encoding',
    ETag: etag,
  };
  if (enc) out['Content-Encoding'] = enc;
  if (allow304 && notModified(req, etag)) {
    /*
     * 304 只保留「描述缓存策略」的头，把「描述这次没发的响应体」的头去掉：
     * Content-Type / Content-Length 删掉，Content-Encoding 也一起 ——
     * 一个没有 body 的响应标着 br，某些代理会据此去改写缓存里的那份。
     */
    delete out['Content-Type'];
    delete out['Content-Encoding'];
    res.writeHead(304, out);
    return res.end();
  }
  out['Content-Length'] = body.length;
  res.writeHead(200, out);
  res.end(body);
}

const INDEX_FILE = path.join(CONFIG.publicDir, 'index.html');
/** 首页里所有本地 CSS/JS 引用，用来挂内容哈希 */
const ASSET_REF = /(\b(?:href|src)=")(\/(?:css|js)\/[^"?#]+)(")/g;

/**
 * 把 index.html 里的 /css /js 引用改写成带内容哈希的地址（?v=xxx）。
 *
 * 这是「长缓存」和「改了要生效」这对矛盾的正解：文件一变哈希就变、URL 跟着变，
 * 浏览器不去取新的都不行。反过来，只凭 app.js 这个固定文件名给一年缓存，
 * 用户会一直看到旧版本，而且除了手动清缓存没有任何办法。
 *
 * 渲染结果按依赖哈希缓存，只有依赖真的变了才重新拼一遍。
 */
async function versionedIndex(entry) {
  if (!entry.refs) entry.refs = [...new Set([...entry.buf.toString('utf8').matchAll(ASSET_REF)].map((m) => m[2]))];
  const metas = await Promise.all(
    entry.refs.map((u) => {
      const abs = safeJoin(CONFIG.publicDir, u);
      return abs ? loadAsset(abs).catch(() => null) : null;
    }),
  );
  const ver = new Map(entry.refs.map((u, i) => [u, metas[i]?.hash || '']));
  const key = entry.refs.map((u) => `${u}@${ver.get(u)}`).join('|');
  if (entry.verKey === key) return { buf: entry.verBuf, hash: entry.verHash };
  const buf = Buffer.from(
    entry.buf
      .toString('utf8')
      .replace(ASSET_REF, (all, pre, url, post) => (ver.get(url) ? `${pre}${url}?v=${ver.get(url)}${post}` : all)),
    'utf8',
  );
  entry.verKey = key;
  entry.verBuf = buf;
  entry.verHash = hashOf(buf);
  return { buf, hash: entry.verHash };
}

async function serveIndex(req, res) {
  const entry = await loadAsset(INDEX_FILE).catch(() => null);
  if (!entry) return serveFile(req, res, INDEX_FILE, { cache: 'no-store' });
  const { buf, hash } = await versionedIndex(entry);
  /*
   * 首页的 Cache-Control 保持 no-store，也不回 304。
   *
   * 改成 no-cache + ETag 能省掉重复访问的整个 HTML 响应体，但也就 18KB、
   * 局域网上 0.2ms 的事；而这页上有内网服务地址，是一份私人页面，
   * no-store 是「连磁盘都别写」的那一档，attack-test 里也把它当安全项在守。
   * 为了 0.2ms 把这条防线降级，不划算。压缩带来的 18KB→5KB 才是这里的大头。
   *
   * allow304:false 是配套的：no-store 说自己「别存」，却又回一个
   * 「你手上那份还能用」的 304，语义自相矛盾。万一某个代理/扩展硬存了一份，
   * 就会一直拿到旧页面。这里就永远 200 全量 —— 剩下的 5KB 是压缩后的，
   * 比让人看旧页面便宜得多。ETag 留着无害，只是不响应条件请求。
   */
  return sendText(req, res, buf, hash, {
    type: MIME['.html'],
    cache: 'no-store',
    headers: { 'X-Frame-Options': 'SAMEORIGIN' },
    allow304: false,
  });
}

/**
 * @param version 请求地址上的 ?v=xxx。只有和当前内容哈希一致才给一年强缓存：
 *   对不上（没带，或者部署后被改过）就退回 no-cache，宁可多一次条件请求，
 *   也不能让浏览器把旧版本锁一年。
 */
async function serveFile(req, res, filePath, { cache = 'no-cache', download = false, version = '' } = {}) {
  let st;
  try {
    st = await fs.stat(filePath);
  } catch {
    return text(res, 404, 'Not found');
  }
  if (!st.isFile()) return text(res, 404, 'Not found');

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (download) headers['Content-Disposition'] = 'attachment';
  // 上传的 SVG 是同源文档，直接打开会执行里面的事件脚本。
  // 这里用 CSP 把所有脚本能力按住，矢量图标照常显示。
  if (ext === '.html') headers['X-Frame-Options'] = 'SAMEORIGIN';
  if (ext === '.svg') {
    headers['Content-Security-Policy'] =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";
  }

  if (COMPRESSIBLE.has(ext)) {
    const entry = await loadAsset(filePath).catch(() => null);
    if (entry) {
      return sendText(req, res, entry.buf, entry.hash, {
        type,
        cache: version && version === entry.hash ? IMMUTABLE_CACHE : cache,
        headers,
      });
    }
    // 读不出来（权限、刚好被删）就走下面的流式发送，别把文件卡死在这
  }

  res.writeHead(200, {
    ...headers,
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': cache,
  });
  fss.createReadStream(filePath).pipe(res);
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

/**
 * 功耗常数来自用户设置，会改变快照里 power 那一块的数字。
 * 后台预热、/api/monitor/stats、/api/monitor/ping 三处必须传同一份 ——
 * 传不一样的话，同一份缓存会被两套参数来回覆盖，每次都判定「参数变了」重新采。
 */
const powerOptsOf = (s) => ({
  powerTdpW: s.settings.power?.tdpW,
  powerBaseW: s.settings.power?.baseW,
  powerDiskW: s.settings.power?.diskW,
});

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

  if (/^\/api\/cards\/[^/]+\/duplicate$/.test(p) && method === 'POST') {
    const id = p.split('/')[3];
    const body = await readJson(req);
    const card = await store.duplicateCard(id, body.group);
    if (!card) return json(res, 404, { ok: false, error: '卡片不存在' });
    return json(res, 200, { ok: true, card });
  }

  // 媒体库统计（全屏监控用，结果缓存 5 分钟）
  if (p === '/api/media' && method === 'GET') {
    const root = await resolveMediaRoot(CONFIG.mediaRoot);
    const data = await mediaStats(root, {
      recentCount: 6,
      force: url.searchParams.get('force') === '1',
    });
    return json(res, 200, data);
  }

  if (p === '/api/cards/reorder' && method === 'POST') {
    const body = await readJson(req);
    const items = body.items || body.ids;
    if (!Array.isArray(items)) return json(res, 400, { ok: false, error: 'items 必须是数组' });
    const cards = await store.reorder(items);
    return json(res, 200, { ok: true, cards });
  }

  // 扫描容器
  /*
   * 只接受 POST：这个接口会把扫到的卡片写进库。
   * 允许 GET 的话，浏览器预取、爬虫、<img src> 都可能顺手触发一次写操作。
   */
  if (p === '/api/discover' && method === 'POST') {
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
     * 后台预热已经把这个缓存刷好了，这里正常只是一次内存读取。
     */
    try {
      const snap = await systemSnapshot(powerOptsOf(s));
      // 容器占用走缓存，不等采集（首次会返回 pending，前端显示「采集中」）
      snap.containers = await containerStats({ wait: false });
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
      // 参数必须和 stats 一致，否则会把缓存键顶掉，让下一次 stats 白重采一轮
      const snap = await systemSnapshot(powerOptsOf(await store.load()));
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

  /*
   * 安全头统一在这里挂，不靠每个分支自己记得加。
   * 用 setHeader 而不是塞进各处的 writeHead：writeHead 会覆盖同名头，
   * 但没提到的会保留，所以各响应函数照旧只写自己关心的那几项。
   */
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()',
  );
  /*
   * HSTS 只在确认走的是 HTTPS 时才发。
   * 内网直连走的是明文 HTTP，如果这里无脑下发，浏览器会把这个域名
   * 强制升级到 https，而内网那个端口根本没有 TLS —— 页面直接打不开。
   */
  if (isHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  // /fn/ 是代理的第三方监控页面，别把它的跨窗口行为改掉
  if (!p.startsWith('/fn/')) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }

  try {
    // 登录提交，这一条不需要令牌（否则没法登录）
    if (p === '/__login' && req.method === 'POST') {
      const ip = clientIp(req);
      const left = lockLeftMs(ip);

      const raw = await readBody(req, 8192);
      const form = new URLSearchParams(raw.toString('utf8'));
      const input = form.get('token') || '';

      /*
       * 先验证令牌，再判锁定。
       * 锁是为了挡住「猜」—— 猜对了就说明已经拿到凭证，没有拦的理由；
       * 而且真要拦的话，被误锁的本人得干等 5 分钟才能进，纯粹添堵。
       * 反过来，锁定期间猜错一律 429、不再回 401、也不再加延迟，攻击方得不到额外信息。
       */
      if (AUTH_HASH && hashEq(sha256(input), AUTH_HASH)) {
        authFails.delete(ip); // 答对了，之前的失败记录一笔勾销
        res.writeHead(303, {
          'Set-Cookie': authCookie(req),
          Location: '/',
          'Cache-Control': 'no-store',
        });
        return res.end();
      }

      // 已经被关小黑屋：直接回 429，别让这个连接陪着等
      if (left > 0) {
        const secs = Math.ceil(left / 1000);
        res.writeHead(429, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': String(secs),
        });
        return res.end(loginPage(`尝试次数过多，请 ${Math.ceil(secs / 60)} 分钟后再试`));
      }

      /*
       * 记一次失败。只影响这一个 IP：
       *   - 阈值以内给它逐渐变慢（300ms → 1.2s），真人只会错一两次，感知不到
       *   - 到阈值就回 429 + Retry-After，明明白白告诉它等待多久
       * 上限压到 1.2 秒而不是 5 秒 —— 拖太久会白占着连接，而且真正挡住爆破的是 429。
       */
      const rec = noteAuthFail(ip);
      if (rec.until) {
        res.writeHead(429, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Retry-After': String(Math.ceil(AUTH_LOCK_MS / 1000)),
        });
        return res.end(loginPage(`尝试次数过多，请 ${Math.ceil(AUTH_LOCK_MS / 60000)} 分钟后再试`));
      }
      const wait = Math.min(300 * 2 ** Math.min(rec.count - 1, 3), 1200);
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
      // 滑动续期：只在「打开页面」时重发一次 cookie，把有效期重新算起。
      // 不这么做的话 Max-Age 是硬过期 —— 到期那天不管你昨天刚用过，照样被踢回登录页。
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
      return serveFile(req, res, f, { cache: 'public, max-age=604800' });
    }
    if (p.startsWith('/backgrounds/')) {
      const f = safeJoin(BG_DIR, p.slice(13));
      if (!f) return text(res, 400, 'bad path');
      return serveFile(req, res, f, { cache: 'public, max-age=604800' });
    }

    if (p === '/' || p === '/index.html') {
      // 打开首页时若还没卡片，后台补一次采集（不阻塞响应）
      bootstrapIfEmpty(hostOf(req)).catch(() => {});
      return serveIndex(req, res);
    }

    const f = safeJoin(CONFIG.publicDir, p);
    if (!f) return text(res, 400, 'bad path');
    return serveFile(req, res, f, {
      cache: p.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
      version: url.searchParams.get('v') || '',
    });
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
/*
 * 预热：CPU / 网络 / 功耗都是差分型指标，先采一次底，第一次打开面板就有值。
 * 预热完之后再挂后台采样 —— 顺序反了的话，第一轮会和预热抢着写差分基线。
 */
warmup()
  .catch(() => {})
  .then(() => startMetricsWatcher(async () => powerOptsOf(await store.load())));
// 容器资源占用放后台常驻采，别堵在请求路径里（单个 stats 要 1 秒，25 个等不起）
startContainerWatcher();

/**
 * 预热静态资源：首页和它的 CSS/JS 提前读进内存、两种编码都先压好。
 * 不这么做的话，第一次访问要现场压 app.js（brotli 约 10ms），
 * 那 10ms 正好压在有人在等的那条请求上。
 */
async function warmupAssets() {
  const files = ['js/app.js', 'js/lunar.js', 'css/style.css', 'css/fn-theme.css'];
  for (const rel of files) {
    const e = await loadAsset(path.join(CONFIG.publicDir, rel)).catch(() => null);
    if (!e || e.buf.length < MIN_COMPRESS_BYTES) continue;
    // 两种都压：第一个访客走 br 还是 gzip 全看它的浏览器
    packBuffer(e.buf, e.hash, 'br');
    packBuffer(e.buf, e.hash, 'gzip');
  }
  // 首页得等依赖哈希就位才能拼出来，所以放最后
  const idx = await loadAsset(INDEX_FILE).catch(() => null);
  if (!idx) return;
  const { buf, hash } = await versionedIndex(idx);
  packBuffer(buf, hash, 'br');
  packBuffer(buf, hash, 'gzip');
}

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`[fnstart] 已启动 → http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`[fnstart] 数据目录 ${CONFIG.dataDir}`);
  console.log(`[fnstart] Docker socket ${CONFIG.dockerSock}`);
  /*
   * 启动时把访问保护的状态说清楚，但**永远不打印令牌本身** ——
   * docker logs 是很多人会随手分享出去的东西，令牌进了日志等于半公开。
   * 只报长度，够判断「有没有设」「是不是太短」。
   */
  if (AUTH_HASH) {
    const n = String(CONFIG.accessToken).length;
    console.log(
      `[fnstart] 访问保护：已开启（令牌 ${n} 位，cookie ${Math.round(AUTH_MAX_AGE / 86400)} 天滑动续期）`,
    );
    if (n < 16) {
      console.warn('[fnstart] 令牌偏短，建议至少 16 位：openssl rand -hex 16');
    }
  } else {
    console.warn('[fnstart] 访问保护：未开启 —— 任何能访问到端口的人都能改卡片、读监控、导出备份');
    console.warn('[fnstart] 只要端口能被本机以外访问，就该设 ACCESS_TOKEN，见 README「访问令牌的一生」');
  }
  probeMonitor();
  // 预热放在 listen 回调里、且不 await：服务已经能接请求了，别让启动流程等它
  warmupAssets().catch(() => {});
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
