import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { rawGet } from './discover.js';

/**
 * 反向代理飞牛监控服务到 /fn/* 前缀。
 * 用途：当引导页走 HTTPS（反代 / 证书）时，直接 iframe http 页面会被浏览器按混合内容拦截，
 * 这时切成"代理模式"即可同源加载。直连模式在纯 http 内网下更省事。
 */
const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
]);

const PREFIX = '/fn/';

export function proxyOrigin(targetUrl) {
  try {
    const u = new URL(targetUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function rewriteHtml(buf, origin) {
  let s = buf.toString('utf8');
  // 绝对路径资源 → 加代理前缀
  s = s.replace(/(\s(?:href|src|action)=["'])\/(?!\/|fn\/)/gi, `$1${PREFIX}`);
  s = s.replace(/(["'(])\/(assets|api|static|favicon|fonts)\//g, `$1${PREFIX}$2/`);
  // 兜底：把站点自身绝对地址改成相对前缀
  s = s.replaceAll(origin + '/', PREFIX);
  return Buffer.from(s, 'utf8');
}

/**
 * 转发前把「我们自己的凭证」摘掉。
 *
 * 之前是把 req.headers 原样透传，于是 fnStart 的访问令牌（Bearer）和 cookie
 * 会跟着请求落到上游服务的日志里 —— 实测在假上游上能完整看到 `Bearer testtoken123`。
 * 只摘我们发的那一条，其它 cookie / Authorization（比如上游自己的登录态）保持不动，
 * 否则内网给 fnMonitor 设了口令的场景会连带失效。
 */
function stripOwnAuth(headers, auth) {
  if (!auth) return headers;
  if (headers.cookie) {
    const kept = String(headers.cookie)
      .split(';')
      .filter((c) => !c.trim().startsWith(`${auth.cookieName}=`));
    if (kept.length) headers.cookie = kept.join(';');
    else delete headers.cookie;
  }
  const m = /^Bearer\s+(.+)$/i.exec(String(headers.authorization || ''));
  if (m && auth.sha256(m[1].trim()) === auth.tokenHash) delete headers.authorization;
  return headers;
}

export function handleProxy(req, res, { targetUrl, auth }) {
  const origin = proxyOrigin(targetUrl);
  if (!origin) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('监控地址无效');
  }
  const o = new URL(origin);
  const subPath = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length - 1) : req.url;
  const isWs = String(req.headers.upgrade || '').toLowerCase() === 'websocket';

  const headers = stripOwnAuth({ ...req.headers, host: o.host }, auth);
  if (isWs) {
    headers.origin = origin;
  }

  const mod = o.protocol === 'https:' ? https : http;
  const upstream = mod.request(
    {
      protocol: o.protocol,
      hostname: o.hostname,
      port: o.port || (o.protocol === 'https:' ? 443 : 80),
      path: subPath,
      method: req.method,
      headers,
      rejectUnauthorized: false,
    },
    (up) => {
      const outHeaders = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (HOP.has(k.toLowerCase())) continue;
        if (k.toLowerCase() === 'x-frame-options') continue;
        if (k.toLowerCase() === 'content-security-policy') {
          outHeaders[k] = String(v).replace(/frame-ancestors[^;]*/i, 'frame-ancestors *');
          continue;
        }
        if (k.toLowerCase() === 'location' && typeof v === 'string') {
          outHeaders[k] = v.startsWith(origin) ? PREFIX + v.slice(origin.length + 1) : v;
          continue;
        }
        outHeaders[k] = v;
      }
      const ct = String(up.headers['content-type'] || '');
      if (ct.includes('text/html')) {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          const body = rewriteHtml(Buffer.concat(chunks), origin);
          delete outHeaders['content-length'];
          res.writeHead(up.statusCode || 200, outHeaders);
          res.end(body);
        });
        return;
      }
      res.writeHead(up.statusCode || 200, outHeaders);
      up.pipe(res);
    },
  );

  upstream.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`监控服务不可达：${e.message}`);
  });
  if (isWs) return upstream; // 交给 server 的 upgrade 处理
  req.pipe(upstream);
  return upstream;
}

/** 代理 WebSocket 升级（fnMonitor 的实时曲线走 ws） */
export function handleUpgrade(req, socket, head, { targetUrl, auth }) {
  const origin = proxyOrigin(targetUrl);
  const o = new URL(origin);
  const subPath = req.url.startsWith(PREFIX) ? req.url.slice(PREFIX.length - 1) : req.url;
  const mod = o.protocol === 'https:' ? https : http;
  const upstream = mod.request({
    protocol: o.protocol,
    hostname: o.hostname,
    port: o.port,
    path: subPath,
    method: 'GET',
    headers: stripOwnAuth({ ...req.headers, host: o.host, origin }, auth),
    rejectUnauthorized: false,
  });
  upstream.on('upgrade', (up, upSocket, upHead) => {
    const headers = ['HTTP/1.1 101 Switching Protocols'];
    for (let i = 0; i < up.rawHeaders.length; i += 2) {
      headers.push(`${up.rawHeaders[i]}: ${up.rawHeaders[i + 1]}`);
    }
    socket.write(headers.join('\r\n') + '\r\n\r\n');
    if (upHead?.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    socket.on('error', () => upSocket.destroy());
    upSocket.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}

/** 把飞牛 /api/overview 的原始返回整理成面板要用的精简结构 */
export function parseOverview(d) {
  const gb = (n) => Math.round((Number(n) / 1024 ** 3) * 10) / 10;
  const tb = (n) => Math.round((Number(n) / 1024 ** 4) * 100) / 100;

  // 主网卡：排除回环 / 虚拟桥，取累计流量最大的那张
  const ifaces = (d.net || []).filter((n) => n.iface && !/^(lo|docker|veth|br-|virbr|tap|tun)/i.test(n.iface));
  ifaces.sort((a, b) => (b.rx_bytes || 0) - (a.rx_bytes || 0));
  const main = ifaces[0] || {};

  // 同一个挂载点可能对应多块盘（RAID），按挂载点去重
  const byMount = new Map();
  for (const dk of d.disks_detail || []) {
    const mounts = (dk.mounts || []).filter((m) => m && /^\/vol/.test(m));
    const mount = mounts[0] || (dk.mounts || [])[0];
    if (!mount || byMount.has(mount)) continue;
    byMount.set(mount, {
      mount,
      name: dk.name,
      percent: Math.round(dk.percent ?? 0),
      usedTB: tb(dk.used),
      totalTB: tb(dk.total || dk.size),
      temp: dk.temp ?? null,
      health: dk.health || '',
    });
  }

  const containers = d.docker?.containers || [];
  return {
    online: true,
    host: d.system?.hostname || 'NAS',
    os: d.system?.fnos_version || '',
    kernel: d.system?.kernel || '',
    uptime: Number(d.system?.uptime ?? d.uptime ?? 0),
    cpu: {
      percent: Math.round(Number(d.cpu?.percent ?? 0) * 10) / 10,
      perCore: (d.cpu?.per_core || []).map((n) => Math.round(n)),
      load: (d.cpu?.load || []).map((n) => Math.round(n * 100) / 100),
      cores: d.cpu?.cores || 0,
      threads: d.cpu?.threads || 0,
      model: d.cpu?.model || '',
      freq: d.cpu?.frequency_mhz || 0,
    },
    mem: {
      percent: Math.round(Number(d.mem?.percent ?? 0) * 10) / 10,
      usedGB: gb(d.mem?.used),
      totalGB: gb(d.mem?.total),
      swapPercent: Math.round(Number(d.mem?.swap_percent ?? 0)),
    },
    temp: { cpu: d.temp?.cpu ?? null, system: d.temp?.system ?? null },
    power: { total: d.power?.total ? Math.round(d.power.total) : null, package: d.power?.package ?? null },
    disks: [...byMount.values()],
    net: {
      iface: main.iface || '',
      rx: Math.round(main.rx_rate || 0),
      tx: Math.round(main.tx_rate || 0),
      rxTotal: main.rx_bytes || 0,
      txTotal: main.tx_bytes || 0,
    },
    diskTemps: (d.disks_detail || []).map((dk) => ({
      name: dk.name || '',
      temp: dk.temp ?? null,
      health: dk.health || '',
    })),
    gpu: d.gpu?.[0]
      ? {
          name: (d.gpu[0].name || '').replace(/.*Intel Corporation\s*/, '').replace(/\s*\(rev.*/, ''),
          util: d.gpu[0].util ?? null,
          temp: d.gpu[0].temp ?? null,
        }
      : null,
    containers: {
      total: containers.length,
      running: containers.filter((c) => c.state === 'running').length,
      list: containers.slice(0, 40).map((c) => ({
        name: c.name || '',
        state: c.state || '',
        health: c.health || '',
      })),
    },
    fans: (d.fans || []).filter((f) => Number(f.rpm) > 0).map((f) => Number(f.rpm)),
    ts: Date.now(),
  };
}

/** 取监控指标，供页面内原生的监控面板使用（不再靠 iframe 嵌一整页） */
export async function getMonitorStats(targetUrl) {
  const origin = proxyOrigin(targetUrl);
  if (!origin) return null;
  const res = await rawGet(`${origin}/api/overview`, { timeout: 3500, maxBytes: 1024 * 1024 });
  if (!res || res.status !== 200) return null;
  try {
    return parseOverview(JSON.parse(res.body.toString('utf8')));
  } catch {
    return null;
  }
}
