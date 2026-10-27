/**
 * fnStart 攻击面自测 —— 只看「打得进去吗」，不改动任何长期数据。
 *
 *   BASE=http://127.0.0.1:3721 ACCESS_TOKEN=你的令牌 node scripts/attack-test.mjs
 *
 * 和 selftest.mjs 的分工：那个测「功能对不对」，这个测「防不防得住」。
 * 会临时改一次监控地址、传一个恶意 SVG，结束时都还原。
 */
import crypto from 'node:crypto';

const BASE = (process.env.BASE || 'http://127.0.0.1:3721').replace(/\/+$/, '');
const TOKEN = process.env.ACCESS_TOKEN || '';
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

let pass = 0;
const fails = [];
const notes = [];

const ok = (n, extra = '') => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}${extra ? ` \x1b[2m${extra}\x1b[0m` : ''}`); };
const bad = (n, why) => { fails.push(`${n} → ${why}`); console.log(`  \x1b[31m✗\x1b[0m ${n} \x1b[31m${why}\x1b[0m`); };
const note = (n, t) => { notes.push(`${n}: ${t}`); console.log(`  \x1b[33m·\x1b[0m ${n} \x1b[2m${t}\x1b[0m`); };

async function get(path, opt = {}) {
  const headers = { ...(opt.headers || {}) };
  if (opt.token) headers.Authorization = `Bearer ${opt.token}`;
  const r = await fetch(BASE + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const body = await r.text();
  return { status: r.status, body, headers: r.headers };
}
const noAuth = () => get('/api/state');

/* ---------- 1. 鉴权变形 ---------- */
console.log('\n\x1b[1m鉴权能否绕过\x1b[0m');
{
  const cases = [
    ['裸请求 /api/state', '/api/state', {}],
    ['双斜杠 //api/state', '//api/state', {}],
    ['中间双斜杠 /api//state', '/api//state', {}],
    ['大写 /API/state', '/API/state', {}],
    ['百分号编码 /%61pi/state', '/%61pi/state', {}],
    ['点点 /./api/state', '/./api/state', {}],
    ['空 token /api/state?token=', '/api/state?token=', {}],
    ['错误 Bearer', '/api/state', { authorization: 'Bearer wrong-token' }],
    ['Bear 少个 e', '/api/state', { authorization: 'Bear wrong-token' }],
    ['Basic 伪装', '/api/state', { authorization: 'Basic ' + Buffer.from('a:b').toString('base64') }],
    ['伪造 cookie', '/api/state', { cookie: 'fnstart_auth=' + '0'.repeat(64) }],
    ['空 cookie', '/api/state', { cookie: 'fnstart_auth=' }],
  ];
  const leaked = [];
  for (const [name, path, headers] of cases) {
    const r = await get(path, { headers });
    if (r.status !== 401) leaked.push(`${name} 返回 ${r.status}`);
    if (/"cards"\s*:/.test(r.body)) leaked.push(`${name} 漏出了 cards`);
  }
  leaked.length ? bad('12 种变形全部被挡', leaked.join('；')) : ok('12 种变形全部 401，无数据泄漏', '12 个');
}

/* ---------- 2. 登录爆破限速 ---------- */
console.log('\n\x1b[1m登录限速\x1b[0m');
{
  const t = [];
  for (let i = 0; i < 4; i++) {
    const s = Date.now();
    const r = await fetch(`${BASE}/__login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'token=wrong-' + i,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    await r.text();
    t.push(Date.now() - s);
    if (r.status !== 401) bad('登录失败返回 401', `第 ${i + 1} 次返回 ${r.status}`);
  }
  const rising = t[2] > t[0] && t[3] > t[1];
  rising ? ok('连续失败递增延时', t.map((x) => x + 'ms').join(' → ')) : bad('递增延时', t.join('/'));
  // 正确令牌在限速后仍能立刻登录
  const s = Date.now();
  const r = await fetch(`${BASE}/__login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=' + encodeURIComponent(TOKEN),
    redirect: 'manual',
    signal: AbortSignal.timeout(60000),
  });
  const cookie = r.headers.get('set-cookie') || '';
  r.status === 303 && /fnstart_auth=/.test(cookie)
    ? ok('正确令牌仍能登录', `${Date.now() - s}ms`)
    : bad('正确令牌登录', `状态 ${r.status}`);
  if (cookie && !/HttpOnly/i.test(cookie)) bad('cookie 缺 HttpOnly', cookie);
  else if (!/SameSite=Lax/i.test(cookie)) bad('cookie 缺 SameSite', cookie);
  else ok('cookie 属性 HttpOnly + SameSite', '');
}

/* ---------- 3. 目录穿越 ---------- */
console.log('\n\x1b[1m目录穿越\x1b[0m');
{
  const paths = [
    '/icons/../../etc/passwd',
    '/icons/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/icons/..%2f..%2fetc%2fpasswd',
    '/backgrounds/../../etc/passwd',
    '/backgrounds/..%2f..%2f..%2f..%2fetc%2fpasswd',
    '/css/../../../../etc/passwd',
  ];
  const bads = [];
  for (const p of paths) {
    const r = await get(p, { token: TOKEN });
    if (r.status === 200 || /root:.*:0:0/.test(r.body)) bads.push(`${p} → ${r.status}`);
  }
  bads.length ? bad('穿越被挡', bads.join('；')) : ok('6 种编码变体全被挡', '');
}

/* ---------- 4. 代理是否还能当跳板 ---------- */
console.log('\n\x1b[1m/fn/ 代理\x1b[0m');
{
  // 先把设置里的监控地址改成 SSH 端口，看 /fn/ 会不会真的去访问它
  const st = JSON.parse((await get('/api/state', { token: TOKEN })).body);
  const oldUrl = st.settings.monitor?.url || '';
  await fetch(`${BASE}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ monitor: { ...st.settings.monitor, url: 'http://127.0.0.1:22/' } }),
  });
  const r = await get('/fn/', { token: TOKEN });
  // 应该仍然是 fnMonitor 的页面，而不是 SSH 的 banner
  const isSsh = /^SSH-2\.0/.test(r.body.trim());
  !isSsh ? ok('改设置无法把代理指向任意服务', `仍返回 ${r.status} · ${r.body.length}B`) : bad('代理可被劫持', '返回了 SSH banner');
  // 还原
  await fetch(`${BASE}/api/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ monitor: { ...st.settings.monitor, url: oldUrl } }),
  });
  const r2 = await get('/fn/');
  r2.status === 401 ? ok('/fn/ 需要令牌', '') : bad('/fn/ 未鉴权', r2.status);
}

/* ---------- 5. 上传 ---------- */
console.log('\n\x1b[1m上传\x1b[0m');
{
  const evil = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script><rect width="10" height="10"/></svg>';
  const r = await fetch(`${BASE}/api/upload/icon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ data: 'data:image/svg+xml;base64,' + Buffer.from(evil).toString('base64') }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.icon) bad('SVG 上传', '没返回地址：' + JSON.stringify(j).slice(0, 80));
  else {
    const got = await get(j.icon, { token: TOKEN });
    const hasScript = /<script/i.test(got.body) || /onload\s*=/i.test(got.body);
    const csp = got.headers.get('content-security-policy') || '';
    !hasScript ? ok('恶意 SVG 被清洗', 'script/onload 已移除') : bad('SVG 未清洗', '仍然带 script/onload');
    /default-src 'none'/.test(csp) ? ok('SVG 响应带 CSP', csp.slice(0, 40)) : bad('SVG 缺 CSP', csp || '（空）');
  }
  // 超大文件
  const big = Buffer.alloc(3 * 1024 * 1024, 0x41).toString('base64');
  const r2 = await fetch(`${BASE}/api/upload/icon`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ data: 'data:image/png;base64,' + big }),
  });
  r2.status === 413 ? ok('超过 2MB 返回 413', `HTTP ${r2.status}`) : bad('大文件状态码', `期望 413，实际 ${r2.status}`);
}

/* ---------- 6. 响应头与信息泄漏 ---------- */
console.log('\n\x1b[1m响应头与信息暴露\x1b[0m');
{
  const page = await get('/', { token: TOKEN });
  const need = {
    'x-content-type-options': /nosniff/,
    'x-frame-options': /SAMEORIGIN/,
    'cache-control': /no-store/,
    'referrer-policy': /no-referrer/,
  };
  const miss = [];
  for (const [k, re] of Object.entries(need)) {
    const v = page.headers.get(k) || '';
    if (!re.test(v)) miss.push(`${k}=${v || '（空）'}`);
  }
  miss.length ? bad('页面安全响应头', miss.join('；')) : ok('页面安全响应头齐全', 'nosniff / SAMEORIGIN / no-store / no-referrer');

  const health = await get('/api/health');
  health.status === 200 && health.body.trim() === '{"ok":true}'
    ? ok('/api/health 免鉴权但只回 ok', health.body.trim())
    : bad('/api/health', `${health.status} ${health.body.slice(0, 60)}`);

  // 未登录页面里不该出现卡片地址
  const wall = await get('/');
  const leak = /https?:\/\/192\.168|\/api\/state|bookmark/i.test(wall.body);
  !leak ? ok('未登录页面不含任何数据', `${wall.body.length}B`) : bad('登录页泄漏', '出现内网地址或接口名');

  const nf = await get('/api/does-not-exist', { token: TOKEN });
  nf.status === 404 ? ok('未知接口 404', '') : bad('未知接口', `返回 ${nf.status}`);
}

/* ---------- 结果 ---------- */
console.log('\n' + '─'.repeat(50));
if (notes.length) notes.forEach((n) => console.log('  · ' + n));
if (fails.length) {
  console.log(`\x1b[31m${fails.length} 项有问题\x1b[0m · ${pass} 项通过`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`\x1b[32m全部通过\x1b[0m · ${pass} 项`);
