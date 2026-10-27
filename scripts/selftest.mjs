/**
 * fnstart 自检脚本
 *
 * 对着一台已经跑起来的 fnstart 跑一遍接口和静态资源，能写的地方写完自己清掉，
 * 不会打乱你现有的卡片顺序（reorder 之后会还原）。
 *
 * 用法：
 *   node scripts/selftest.mjs                      # 测 http://127.0.0.1:3721
 *   BASE=http://192.168.1.10:3721 node scripts/selftest.mjs
 *   node scripts/selftest.mjs --no-write           # 只读模式，不碰任何数据
 *   node scripts/selftest.mjs --skip-upload        # 跳过上传测试（会在数据目录留图标）
 */

import crypto from 'node:crypto';

const BASE = (process.env.BASE || 'http://127.0.0.1:3721').replace(/\/+$/, '');
/** 设了 ACCESS_TOKEN 的实例，自检也要带令牌（否则全是 401） */
const TOKEN = process.env.ACCESS_TOKEN || '';
const NO_WRITE = process.argv.includes('--no-write');
const SKIP_UPLOAD = process.argv.includes('--skip-upload') || NO_WRITE;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
let pass = 0;
const fails = [];
const skips = [];
const t0 = Date.now();

const ok = (name, extra = '') => {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? ` \x1b[2m${extra}\x1b[0m` : ''}`);
};
/** 条件不满足时明说跳过，不冒充通过 */
const skip = (name, why) => {
  skips.push(name);
  console.log(`  \x1b[33m—\x1b[0m ${name} \x1b[2m跳过：${why}\x1b[0m`);
};
const bad = (name, err) => {
  fails.push({ name, err: String(err && err.message ? err.message : err) });
  console.log(`  \x1b[31m✗\x1b[0m ${name} — ${err && err.message ? err.message : err}`);
};

async function test(name, fn) {
  const t = Date.now();
  try {
    const extra = await fn();
    ok(name, extra ? `(${Date.now() - t}ms · ${extra})` : `(${Date.now() - t}ms)`);
  } catch (e) {
    bad(name, e);
  }
}

async function req(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (raw) return { status: res.status, text, headers: res.headers };
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, data, text, headers: res.headers };
}

const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/* ---------- 1. 静态资源 ---------- */
async function staticTests() {
  console.log('\n静态资源');
  await test('首页返回 200 且是 HTML', async () => {
    const r = await fetch(`${BASE}/`, {
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    need(r.status === 200, `状态码 ${r.status}`);
    const html = await r.text();
    need(/<title>/.test(html), '没有 title');
    need(html.includes('/js/app.js'), '没有引用 app.js');
    return `${(html.length / 1024).toFixed(1)}KB`;
  });

  await test('关键 DOM 节点齐全', async () => {
    const html = await (await fetch(`${BASE}/`, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} })).text();
    const ids = ['q', 'searchForm', 'boards', 'monitor', 'monPanel', 'settingsBtn', 'fullBtn', 'dateChip', 'clockChip', 'wxChip'];
    const miss = ids.filter((id) => !html.includes(`id="${id}"`));
    need(!miss.length, `缺少 ${miss.join(',')}`);
    return `${ids.length} 个`;
  });

  for (const f of ['/css/style.css', '/css/fn-theme.css', '/js/app.js']) {
    await test(`静态文件 ${f}`, async () => {
      const r = await req(f, { raw: true });
      need(r.status === 200, `状态码 ${r.status}`);
      need(r.text.length > 500, '内容过短');
      return `${(r.text.length / 1024).toFixed(1)}KB`;
    });
  }

  await test('路径穿越被挡住', async () => {
    for (const p of ['/../etc/passwd', '/..%2f..%2fetc%2fpasswd', '/icons/../../etc/passwd']) {
      const r = await req(p, { raw: true });
      need(r.status >= 400, `${p} 返回了 ${r.status}`);
      need(!r.text.includes('root:'), `${p} 泄露了系统文件`);
    }
    return '3 个变体';
  });

  await test('未知接口返回 404', async () => {
    const r = await req('/api/definitely-not-here');
    need(r.status === 404, `状态码 ${r.status}`);
    need(r.data && r.data.ok === false, '返回体不是标准错误结构');
  });
}

/* ---------- 2. 状态与设置 ---------- */
let state = null;
let tmpId = null;

async function stateTests() {
  console.log('\n状态与设置');
  await test('读取 /api/state', async () => {
    const r = await req('/api/state');
    need(r.status === 200, `状态码 ${r.status}`);
    need(r.data && r.data.settings, '没有 settings');
    need(Array.isArray(r.data.cards), 'cards 不是数组');
    state = r.data;
    return `${r.data.cards.length} 张卡片`;
  });

  await test('设置字段完整', async () => {
    const s = state.settings;
    const need4 = ['siteTitle', 'searchEngine', 'background', 'monitor', 'weather', 'clock'];
    const miss = need4.filter((k) => s[k] === undefined);
    need(!miss.length, `缺少 ${miss.join(',')}`);
    need(typeof s.background.type === 'string', 'background.type 缺失');
    return s.background.type;
  });

  if (NO_WRITE) return;

  await test('PATCH /api/settings 生效并还原', async () => {
    const before = state.settings.subtitle || '';
    const probe = `自检 ${Date.now()}`;
    const r = await req('/api/settings', { method: 'PATCH', body: { subtitle: probe } });
    need(r.status === 200 && r.data.ok, '写入失败');
    need(r.data.settings.subtitle === probe, '返回体里的值不对');
    const back = await req('/api/state');
    need(back.data.settings.subtitle === probe, '状态没更新');
    const undo = await req('/api/settings', { method: 'PATCH', body: { subtitle: before } });
    need(undo.data.settings.subtitle === before, '还原失败');
    return '写入→读取→还原';
  });
}

/* ---------- 3. 卡片增删改查 ---------- */
async function cardTests() {
  if (NO_WRITE) {
    console.log('\n卡片增删改查（只读模式跳过）');
    return;
  }
  console.log('\n卡片增删改查');

  await test('新增卡片', async () => {
    const r = await req('/api/cards', {
      method: 'POST',
      body: { name: '__自检临时卡__', url: 'http://example.com/selftest', autoIcon: false, group: 'service' },
    });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    need(r.data.card && r.data.card.id, '没返回卡片');
    tmpId = r.data.card.id;
    const s = await req('/api/state');
    need(s.data.cards.some((c) => c.id === tmpId), '新卡片没进状态');
    return tmpId.slice(0, 6);
  });

  await test('修改卡片（名称/颜色）', async () => {
    need(tmpId, '没有临时卡片');
    const r = await req(`/api/cards/${tmpId}`, { method: 'PATCH', body: { name: '__自检改名__', color: '#123456' } });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    const s = await req('/api/state');
    const c = s.data.cards.find((x) => x.id === tmpId);
    need(c && c.name === '__自检改名__', '名称没改到');
    need(c.color === '#123456', '颜色没改到');
    need(c.custom && c.custom.name === true, '没有标记为用户自定义');
  });

  await test('隐藏 / 取消隐藏', async () => {
    need(tmpId, '没有临时卡片');
    await req(`/api/cards/${tmpId}`, { method: 'PATCH', body: { hidden: true } });
    let s = await req('/api/state');
    need(s.data.cards.find((x) => x.id === tmpId).hidden === true, '隐藏没生效');
    await req(`/api/cards/${tmpId}`, { method: 'PATCH', body: { hidden: false } });
    s = await req('/api/state');
    need(s.data.cards.find((x) => x.id === tmpId).hidden === false, '取消隐藏没生效');
  });

  await test('拖动排序（排到最前再还原）', async () => {
    need(tmpId, '没有临时卡片');
    const before = (await req('/api/state')).data.cards.map((c) => c.id);
    const order = [tmpId, ...before.filter((id) => id !== tmpId)];
    const r = await req('/api/cards/reorder', { method: 'POST', body: { items: order } });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    const after = (await req('/api/state')).data.cards.map((c) => c.id);
    need(after[0] === tmpId, '排序没生效');
    const rest = after.filter((id) => id !== tmpId);
    need(JSON.stringify(rest) === JSON.stringify(before.filter((id) => id !== tmpId)), '其它卡片顺序被打乱');
    return `${after.length} 张`;
  });

  await test('删除卡片', async () => {
    need(tmpId, '没有临时卡片');
    const r = await req(`/api/cards/${tmpId}`, { method: 'DELETE' });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    const s = await req('/api/state');
    need(!s.data.cards.some((c) => c.id === tmpId), '卡片还在');
    tmpId = null;
  });

  await test('导入书签并清理', async () => {
    const html = `<DL><p><DT><A HREF="https://example.org/selftest" ADD_DATE="1700000000">__自检书签__</A></DL>`;
    const r = await req('/api/import', { method: 'POST', body: { text: html } });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    need(r.data.parsed >= 1, '没解析到链接');
    const s = await req('/api/state');
    const added = s.data.cards.filter((c) => c.url.includes('example.org/selftest'));
    need(added.length >= 1, '导入的卡片没进状态');
    for (const c of added) await req(`/api/cards/${c.id}`, { method: 'DELETE' });
    return `解析 ${r.data.parsed} 条`;
  });

  await test('重复导入会去重', async () => {
    const html = `<DL><p><DT><A HREF="https://example.org/dup" >__自检去重__</A></DL>`;
    const a = await req('/api/import', { method: 'POST', body: { text: html } });
    const b = await req('/api/import', { method: 'POST', body: { text: html } });
    need(a.data.added === 1, `第一次新增 ${a.data.added}`);
    need(b.data.added === 0, `第二次又新增了 ${b.data.added}`);
    const s = await req('/api/state');
    for (const c of s.data.cards.filter((x) => x.url.includes('example.org/dup'))) {
      await req(`/api/cards/${c.id}`, { method: 'DELETE' });
    }
    return '第二次 0 新增';
  });
}

/* ---------- 4. 上传 ---------- */
async function uploadTests() {
  if (SKIP_UPLOAD) {
    console.log('\n上传（已跳过）');
    return;
  }
  console.log('\n上传');
  await test('上传图标并回读', async () => {
    // 1×1 透明 PNG
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const r = await req('/api/upload/icon', { method: 'POST', body: { data: `data:image/png;base64,${px}` } });
    need(r.status === 200 && r.data.ok, `状态码 ${r.status}`);
    need(r.data.icon && r.data.icon.startsWith('/icons/'), '返回的地址不对');
    const back = await req(r.data.icon, { raw: true });
    need(back.status === 200, `回读状态码 ${back.status}`);
    return r.data.icon;
  });
}

/* ---------- 5. 外部数据 ---------- */
async function dataTests() {
  console.log('\n外部数据');
  await test('天气接口', async () => {
    const r = await req('/api/weather');
    need(r.status === 200, `状态码 ${r.status}`);
    const d = r.data;
    if (d.ok) {
      need(typeof d.temp === 'number', '温度不是数字');
      return `${d.city} ${d.temp}° ${d.text}${d.stale ? '（缓存）' : ''}`;
    }
    need(d.error, '失败但没给原因');
    throw new Error(d.error);
  });

  await test('监控指标', async () => {
    const r = await req('/api/monitor/stats');
    need(r.status === 200, `状态码 ${r.status}`);
    const d = r.data;
    if (!d.ok) throw new Error('拿不到监控数据（fnMonitor 没跑或地址不对）');
    const s = d.stats || {};
    need(typeof s.cpu?.percent === 'number', 'CPU 数据缺失');
    need(Array.isArray(s.disks), '磁盘数据缺失');
    return `CPU ${s.cpu.percent.toFixed(1)}% · 内存 ${(s.mem?.percent ?? 0).toFixed(1)}%${d.stale ? '（缓存）' : ''}`;
  });

  await test('监控探活', async () => {
    const r = await req('/api/monitor/ping');
    need(r.status === 200, `状态码 ${r.status}`);
    need(r.data.ok, '监控地址不可达');
  });

  await test('监控页面代理 /fn/', async () => {
    const r = await req('/fn/', { raw: true });
    need(r.status < 400, `状态码 ${r.status}`);
    need(r.text.length > 200, '返回内容过少');
    return `${(r.text.length / 1024).toFixed(1)}KB`;
  });

  await test('服务扫描（只读）', async () => {
    const r = await req('/api/discover?apply=0&force=0');
    need(r.status === 200, `状态码 ${r.status}`);
    const d = r.data;
    need(d.ok, '扫描失败');
    need(Array.isArray(d.services), 'services 不是数组');
    return `模式 ${d.mode} · 容器 ${d.containers ?? 0} · 服务 ${d.count}`;
  });

  await test('导出备份', async () => {
    const r = await req('/api/export');
    need(r.status === 200, `状态码 ${r.status}`);
    need(Array.isArray(r.data.cards), '备份里没有 cards');
    need(r.data.settings, '备份里没有 settings');
    return `${r.data.cards.length} 张卡片`;
  });
}

/* ---------- 0. 访问控制 ---------- */
async function authTests() {
  console.log('\n访问控制');
  if (!TOKEN) {
    skip('未带令牌应被拒', '实例没设 ACCESS_TOKEN（--no-write 之外的写测试也按裸奔跑）');
    skip('cookie 登录与滑动续期', '没有令牌可算 cookie');
    skip('?token= 一次性链接', '没有令牌可拼链接');
    return;
  }

  await test('未带令牌应被拒', async () => {
    const r = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(10000) });
    need(r.status === 401, `状态码 ${r.status}，期望 401`);
    return '401';
  });

  await test('cookie 登录与滑动续期', async () => {
    // cookie 里存的是令牌的 sha256，服务端直接拿它和 AUTH_HASH 比
    const cookie = `fnstart_auth=${sha256(TOKEN)}`;
    const get = () =>
      fetch(`${BASE}/`, {
        headers: { cookie },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });

    const first = await get();
    need(first.status === 200, `首次带 cookie 访问返回 ${first.status}`);
    const sc = first.headers.get('set-cookie') || '';
    need(/fnstart_auth=/.test(sc), '打开页面没有重发 cookie，滑动续期没生效');
    need(/Max-Age=2592000/.test(sc), `Max-Age 不对：${sc}`);

    // 再来一次，确认是「每次打开页面都续」而不是只发一次
    await first.text();
    const second = await get();
    need(/fnstart_auth=/.test(second.headers.get('set-cookie') || ''), '第二次打开页面没有续期');
    await second.text();
    return '30 天顺延';
  });

  await test('?token= 一次性链接', async () => {
    const r = await fetch(`${BASE}/?token=${encodeURIComponent(TOKEN)}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    need(r.status === 303, `状态码 ${r.status}，期望 303`);
    need(/fnstart_auth=/.test(r.headers.get('set-cookie') || ''), '没有落下 cookie');
    const loc = r.headers.get('location') || '';
    need(!loc.includes('token='), `跳转地址还带着令牌：${loc}`);
    return `→ ${loc}`;
  });

  await test('错误令牌被拒', async () => {
    const r = await fetch(`${BASE}/?token=definitely-wrong`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    need(r.status === 401, `状态码 ${r.status}，期望 401`);
    return '401';
  });
}

/* ---------- 收尾 ---------- */
async function cleanup() {
  if (tmpId) {
    await req(`/api/cards/${tmpId}`, { method: 'DELETE' }).catch(() => {});
    console.log(`\n\x1b[33m注意\x1b[0m 临时卡片 ${tmpId} 未正常删除，已尝试补删`);
  }
  const s = await req('/api/state').catch(() => null);
  // 没带令牌时 /api/state 返回的是 { ok:false, error:'需要访问令牌' }，
  // 没有 cards 字段 —— 直接读 .cards.filter 会把自己崩掉，而这恰好是部署者最常犯的错。
  const cards = s?.data?.cards;
  if (Array.isArray(cards)) {
    const junk = cards.filter((c) => c.name?.startsWith('__自检') || c.url?.includes('selftest'));
    for (const c of junk) {
      await req(`/api/cards/${c.id}`, { method: 'DELETE' }).catch(() => {});
      console.log(`\x1b[33m注意\x1b[0m 清理残留卡片：${c.name}`);
    }
    console.log(`\n剩余卡片 ${cards.length} 张`);
  } else if (s && s.status === 401) {
    console.log('\n\x1b[33m提示\x1b[0m 这台实例要令牌，但环境变量 ACCESS_TOKEN 没给，自检读不到数据');
  }
}

/* ---------- 跑 ---------- */
console.log(`\x1b[1mfnstart 自检\x1b[0m  →  ${BASE}${NO_WRITE ? '  \x1b[2m(只读模式)\x1b[0m' : ''}`);

try {
  await authTests();
  await staticTests();
  await stateTests();
  await cardTests();
  await uploadTests();
  await dataTests();
} finally {
  await cleanup();
}

const dt = ((Date.now() - t0) / 1000).toFixed(1);
const skipped = skips.length ? ` · ${skips.length} 项跳过` : '';
console.log(`\n${'─'.repeat(46)}`);
if (fails.length) {
  console.log(`\x1b[31m${fails.length} 项失败\x1b[0m · ${pass} 项通过${skipped} · 用时 ${dt}s`);
  for (const f of fails) console.log(`  · ${f.name}: ${f.err}`);
  process.exit(1);
} else {
  console.log(`\x1b[32m全部通过\x1b[0m · ${pass} 项${skipped} · 用时 ${dt}s`);
}
