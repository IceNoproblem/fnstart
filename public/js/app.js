/* fnstart 前端 · 无构建依赖 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- 搜索引擎 ---------------- */
const ENGINES = [
  { id: 'bing', name: '必应', mark: '必', c1: '#0a8ea8', c2: '#06728a', url: 'https://cn.bing.com/search?q=%s' },
  { id: 'baidu', name: '百度', mark: '百', c1: '#3355ff', c2: '#1e2fc4', url: 'https://www.baidu.com/s?wd=%s' },
  { id: 'google', name: '谷歌', mark: 'G', c1: '#4285f4', c2: '#1a73e8', url: 'https://www.google.com/search?q=%s' },
  { id: 'ddg', name: 'DuckDuckGo', mark: 'D', c1: '#de5833', c2: '#b8442a', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'bilibili', name: '哔哩哔哩', mark: '哔', c1: '#fb7299', c2: '#e05a82', url: 'https://search.bilibili.com/all?keyword=%s' },
  { id: 'zhihu', name: '知乎', mark: '知', c1: '#1772f6', c2: '#0b57c9', url: 'https://www.zhihu.com/search?type=content&q=%s' },
  { id: 'github', name: 'GitHub', mark: 'GH', c1: '#3b4351', c2: '#22272e', url: 'https://github.com/search?q=%s' },
  { id: 'youtube', name: 'YouTube', mark: '▶', c1: '#ff2d2d', c2: '#c81414', url: 'https://www.youtube.com/results?search_query=%s' },
];

const SWATCHES = [
  '#4f8cff', '#2f9fe0', '#22c3a6', '#33c46a', '#8ec63f', '#f2c744',
  '#ff9f43', '#f2683c', '#ef4b6c', '#e0559b', '#a05bff', '#6d6af5',
  '#4a5568', '#1f2937', '#0ea5e9', '#14b8a6', '#84cc16', '#eab308',
  '#f97316', '#f43f5e',
];

/* ---------------- 品牌色 ---------------- */
const BRAND = [
  [/qbittorrent|transmission|aria2|下载/i, '#2f78d8'],
  [/navidrome|music|音乐|subsonic/i, '#7c5ce6'],
  [/home\s?assistant|ha\b/i, '#3fb8ef'],
  [/moviepilot|nastool|jellyfin|emby|plex|影视|media/i, '#8b5cf6'],
  [/bilibili|bili|哔哩/i, '#fb7299'],
  [/chinesesub|字幕/i, '#f0a020'],
  [/mihomo|clash|proxy|代理/i, '#7c5cff'],
  [/lucky|穿透/i, '#f43f5e'],
  [/fnos|fnmonitor|飞牛/i, '#2dd4bf'],
  [/safeline|雷池|waf/i, '#0ea5e9'],
  [/mariadb|mysql|postgres|db\b|数据/i, '#0e7490'],
  [/ps5|playstation/i, '#0070d1'],
  [/github|gitlab|gitea/i, '#8b949e'],
  [/grafana|监控/i, '#f46800'],
  [/portainer|docker/i, '#13bef9'],
  [/alist|nextcloud|cloud|网盘/i, '#4f8cff'],
];

const hashHue = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
};

const brandColor = (card) => {
  const hay = `${card.url} ${card.name} ${card.container || ''}`;
  for (const [re, c] of BRAND) if (re.test(hay)) return c;
  const h = hashHue(card.name || card.url || 'x');
  // 避开脏黄绿，控制在好看的区段
  const hh = (h * 47) % 360;
  return hslToHex(hh, 62, 58);
};

/* ---------------- 颜色工具 ---------------- */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function hexToHsl(hex) {
  let h = String(hex).replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { h: 220, s: 60, l: 60 };
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** 把主色加工成一组卡片用色，保证深色底 + 白字始终可读 */
function cardVars(hex) {
  const { h, s, l } = hexToHsl(hex || '#4f8cff');
  const sat = Math.max(34, Math.min(78, s));
  const light = Math.max(44, Math.min(68, l));
  return {
    '--c': hex || '#4f8cff',
    '--c-bg1': `hsl(${h} ${Math.round(sat * 0.68)}% ${Math.round(16 + light * 0.15)}%)`,
    '--c-bg2': `hsl(${h} ${Math.round(sat * 0.6)}% ${Math.round(10 + light * 0.08)}%)`,
    '--c-spot': `hsla(${h}, ${Math.round(sat * 1.1)}%, ${Math.round(light * 0.95)}%, 0.26)`,
    '--c-line': `hsla(${h}, ${Math.round(sat * 0.95)}%, 74%, 0.2)`,
    '--c-line-hi': `hsla(${h}, ${Math.round(sat * 1.05)}%, 76%, 0.55)`,
    '--c-glow': `hsla(${h}, ${Math.round(sat)}%, ${Math.round(light * 0.7)}%, 0.6)`,
  };
}

/* 从图标里抽主色（同源图片，canvas 无跨域问题） */
const colorCache = new Map();
function iconDominantColor(src) {
  if (!src) return Promise.resolve('');
  if (colorCache.has(src)) return Promise.resolve(colorCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const S = 36;
        const cv = document.createElement('canvas');
        cv.width = S;
        cv.height = S;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const { data } = ctx.getImageData(0, 0, S, S);
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 170) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const lum = (mx + mn) / 2 / 255;
          const sat = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
          if (lum > 0.94 || lum < 0.07) continue;
          if (sat < 0.18) continue;
          const { h, s, l } = hexToHsl(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
          const key = Math.round(h / 24) % 15;
          const cur = buckets.get(key) || { w: 0, px: 0, s: 0, l: 0 };
          cur.w += 1 + sat * 2;
          cur.px += 1;
          cur.s += s;
          cur.l += l;
          buckets.set(key, cur);
        }
        let best = null;
        for (const b of buckets.values()) if (!best || b.w > best.w) best = b;
        if (!best || best.px < 3) return resolve('');
        const avgS = best.s / best.px;
        const avgL = best.l / best.px;
        // 色相取桶中心，避免 0°/360° 环绕问题
        const bucketHue = [...buckets.entries()].find(([, v]) => v === best)[0] * 24 + 12;
        const out = hslToHex(
          bucketHue % 360,
          Math.min(82, Math.max(48, avgS)),
          Math.min(62, Math.max(48, avgL)),
        );
        colorCache.set(src, out);
        resolve(out);
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = src;
  });
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data?.error || `请求失败 ${res.status}`);
  return data;
}

/* ---------------- 状态 ---------------- */
const state = { settings: null, cards: [], meta: {} };
window.__fnstart = state; // 便于排查
const el = {
  boards: $('#boards'),
  empty: $('#emptyState'),
  siteTitle: $('#siteTitle'),
  siteSub: $('#siteSub'),
  q: $('#q'),
  searchForm: $('#searchForm'),
  engineTrigger: $('#engineTrigger'),
  engineBadge: $('#engineBadge'),
  engineMenu: $('#engineMenu'),
  hint: $('#searchHint'),
  monitor: $('#monitor'),
  monitorFrame: $('#monitorFrame'),
  monPanel: $('#monPanel'),
  monHost: $('#monHost'),
  monUp: $('#monUp'),
  fnPill: $('#fnPill'),
  fnStats: $('#fnStats'),
  toast: $('#toast'),
  bgImage: $('#bgImage'),
  bgVeil: $('#bgVeil'),
  addBtn: $('#addBtn'),
  sheetMask: $('#sheetMask'),
};

let toastTimer = 0;
function toast(msg, isErr = false) {
  el.toast.textContent = msg;
  el.toast.className = `toast${isErr ? ' err' : ''}`;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2400);
}

const hostLabel = (url) => {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== '/' && !u.hash ? u.pathname.replace(/\/$/, '') : '';
    // 和当前页面同一台机器时，IP 是冗余的，只留端口更好读
    if (u.hostname === location.hostname) return u.port || path || '本机';
    return (u.host.replace(/^www\./, '') + path);
  } catch {
    return url;
  }
};

/* ---------------- 渲染卡片 ---------------- */
function iconNode(card) {
  const box = document.createElement('div');
  box.className = 'card-icon';
  if (card.icon) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.src = card.icon;
    img.onerror = () => {
      box.textContent = '';
      const s = document.createElement('span');
      s.className = 'letter';
      s.textContent = initial(card.name);
      box.appendChild(s);
    };
    box.appendChild(img);
  } else {
    const s = document.createElement('span');
    s.className = 'letter';
    s.textContent = initial(card.name);
    box.appendChild(s);
  }
  return box;
}
const initial = (name = '') => {
  const t = String(name).trim();
  if (!t) return '·';
  return /[\u4e00-\u9fa5]/.test(t[0]) ? t[0] : t[0].toUpperCase();
};

function applyCardColors(node, card) {
  const base = card.color || brandColor(card);
  const vars = cardVars(base);
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
  // 没手动设色时，用图标主色覆盖一次（更贴合服务本身）
  if (!card.color && card.icon) {
    iconDominantColor(card.icon).then((c) => {
      if (!c || card.color) return;
      for (const [k, v] of Object.entries(cardVars(c))) node.style.setProperty(k, v);
    });
  }
}

function cardEl(card, index, { preview = false } = {}) {
  const node = document.createElement('a');
  node.className = 'card';
  node.href = card.url;
  node.target = '_blank';
  node.rel = 'noopener';
  node.draggable = false; // 关键：<a> 默认可拖拽，会抢走 pointer 事件导致拖拽时灵时不灵
  node.dataset.id = card.id;
  node.title = `${card.name}\n${card.url}`;
  node.style.setProperty('--i', String(Math.min(index, 22)));
  applyCardColors(node, card);

  // 悬停时沿边框跑的一圈流光（纯装饰，不接事件）
  const glow = document.createElement('span');
  glow.className = 'card-glow';
  glow.setAttribute('aria-hidden', 'true');
  node.appendChild(glow);

  node.appendChild(iconNode(card));

  const body = document.createElement('div');
  body.className = 'card-body';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = card.name;
  const desc = document.createElement('div');
  desc.className = 'card-desc';
  desc.textContent = card.desc || hostLabel(card.url);
  body.append(name, desc);
  node.appendChild(body);

  if (!preview) {
    // 点击打开走这里，避免 <a> 原生跳转和拖拽后的误触
    node.addEventListener('click', (e) => {
      if (suppressClick) {
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 交给浏览器
      e.preventDefault();
      window.open(card.url, '_blank', 'noopener');
    });

    const acts = document.createElement('div');
    acts.className = 'card-actions';

    const edit = document.createElement('button');
    edit.className = 'act';
    edit.title = '编辑';
    edit.innerHTML = '<svg class="ic"><use href="#i-edit"/></svg>';
    edit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCardModal(card);
    });

    const del = document.createElement('button');
    del.className = 'act danger';
    del.title = '删除';
    del.innerHTML = '<svg class="ic"><use href="#i-trash"/></svg>';
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm(`删除「${card.name}」？`)) return;
      await api(`/api/cards/${card.id}`, { method: 'DELETE' });
      state.cards = state.cards.filter((c) => c.id !== card.id);
      renderBoards();
      toast('已删除');
    });

    acts.append(edit, del);
    node.appendChild(acts);
  } else {
    node.addEventListener('click', (e) => e.preventDefault());
    node.style.cursor = 'default';
  }

  return node;
}

/* ---------------- 渲染分组 ---------------- */
const BOARDS = [
  { key: 'service', label: '容器与服务' },
  { key: 'bookmark', label: '收藏书签' },
];
const groupOf = (c) => c.group || (c.source === 'bookmark' ? 'bookmark' : 'service');

function boardEl(key, list, indexStart) {
  const board = document.createElement('section');
  board.className = 'board';
  board.dataset.group = key;
  const def = BOARDS.find((b) => b.key === key) || BOARDS[0];

  const sep = document.createElement('div');
  sep.className = 'board-sep';
  const name = document.createElement('span');
  name.textContent = def.label;
  sep.appendChild(name);
  const count = document.createElement('em');
  count.textContent = list.length ? String(list.length) : '';
  sep.appendChild(count);
  const addBtn = document.createElement('button');
  addBtn.className = 'sep-add';
  addBtn.type = 'button';
  addBtn.title = `往「${def.label}」加一张卡片`;
  addBtn.innerHTML = '<svg class="ic"><use href="#i-plus"/></svg>';
  addBtn.addEventListener('click', () => openCardModal(null, key));
  sep.appendChild(addBtn);
  board.appendChild(sep);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.dataset.group = key;
  const cols = state.settings?.layout?.columns ?? 0;
  if (cols) grid.dataset.cols = String(cols);

  if (!list.length) {
    const ph = document.createElement('button');
    ph.className = 'board-empty';
    ph.type = 'button';
    ph.innerHTML = '<svg class="ic" style="width:14px;height:14px"><use href="#i-plus"/></svg><span>添加卡片</span>';
    ph.addEventListener('click', () => openCardModal(null, key));
    grid.appendChild(ph);
  } else {
    list.forEach((c, i) => grid.appendChild(cardEl(c, indexStart + i)));
  }

  board.appendChild(grid);
  return board;
}

function renderBoards() {
  const visible = state.cards.filter((c) => !c.hidden);
  el.boards.innerHTML = '';
  let idx = 0;
  for (const def of BOARDS) {
    const list = visible.filter((c) => groupOf(c) === def.key);
    // 书签组为空时先不占版面，导入后再出现
    if (!list.length && def.key === 'bookmark') continue;
    el.boards.appendChild(boardEl(def.key, list, idx));
    idx += list.length;
  }
  el.empty.hidden = visible.length > 0;
  if (!visible.length) el.boards.style.display = 'none';
  else el.boards.style.display = '';
}

/* ---------------- 拖拽排序（组内 + 跨组） ---------------- */
let drag = null;
let suppressClick = false;

// <a> 默认参与原生拖拽，会和自定义拖拽抢事件，直接掐掉
document.addEventListener('dragstart', (e) => {
  if (e.target?.closest?.('.card')) e.preventDefault();
});

const allCards = () => [...el.boards.querySelectorAll('.card[data-id]')];
const allGrids = () => [...el.boards.querySelectorAll('.grid')];

function startDrag(e) {
  const d = drag;
  const card = d.card;
  const rect = card.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.className = 'card-ghost';
  ghost.style.minHeight = `${rect.height}px`;
  card.parentNode.insertBefore(ghost, card);
  d.ghost = ghost;

  card.classList.add('is-dragging');
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  document.body.classList.add('dragging');
  d.active = true;
  try {
    navigator.vibrate?.(6);
  } catch {}
}

/** 找到指针位置应该插到哪张卡片前面（文档顺序法，适配多列网格） */
function refFromPoint(x, y, skip) {
  for (const n of allCards()) {
    if (n === skip) continue;
    const r = n.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    if (y < cy - 6) return n;
    if (y <= cy + 6 && x < r.left + r.width / 2) return n;
  }
  return null;
}

function moveDrag(e) {
  const d = drag;
  if (!d?.active) return;
  d.card.style.left = `${e.clientX - d.offsetX}px`;
  d.card.style.top = `${e.clientY - d.offsetY}px`;

  const edge = 80;
  if (e.clientY < edge) window.scrollBy(0, -14);
  else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);

  // 落在空分组的占位框上 → 直接进那个组
  const empty = [...el.boards.querySelectorAll('.board-empty')].find((n) => {
    const r = n.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (empty) {
    const grid = empty.parentElement;
    if (d.ghost.parentElement !== grid) flipInsert(d.ghost, null, grid);
    return;
  }

  const ref = refFromPoint(e.clientX, e.clientY, d.card);
  if (ref) {
    const targetGrid = ref.parentElement;
    if (d.ghost.parentElement !== targetGrid || d.ghost.nextElementSibling !== ref) {
      flipInsert(d.ghost, ref);
    }
    return;
  }
  const lastGrid = allGrids().pop();
  if (lastGrid && (d.ghost.parentElement !== lastGrid || d.ghost.nextElementSibling)) {
    flipInsert(d.ghost, null);
  }
}

function flipInsert(node, ref, forceParent) {
  const parent = forceParent || ref?.parentElement || allGrids().pop();
  if (!parent) return;
  const all = [...el.boards.querySelectorAll('.card-ghost, .card[data-id]')];
  const first = new Map(all.map((n) => [n, n.getBoundingClientRect()]));

  if (ref) parent.insertBefore(node, ref);
  else parent.appendChild(node);

  for (const n of all) {
    if (n === node) continue;
    const a = first.get(n);
    const b = n.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    n.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], {
      duration: 220,
      easing: 'cubic-bezier(.2,.85,.25,1)',
    });
  }
}

async function endDrag() {
  const d = drag;
  if (!d) return;
  const wasActive = d.active;
  drag = null;
  if (!wasActive) return;

  const card = d.card;
  card.classList.remove('is-dragging');
  ['position', 'left', 'top', 'width', 'height', 'transform'].forEach((p) => card.style.removeProperty(p));
  d.ghost.parentNode.insertBefore(card, d.ghost);
  d.ghost.remove();
  document.body.classList.remove('dragging');

  suppressClick = true;
  setTimeout(() => (suppressClick = false), 320);

  const items = allCards().map((n) => ({
    id: n.dataset.id,
    group: n.closest('.grid')?.dataset.group || 'service',
  }));
  const after = items.find((i) => i.id === card.dataset.id)?.group || 'service';
  for (const it of items) {
    const c = state.cards.find((x) => x.id === it.id);
    if (c) c.group = it.group;
  }
  // 顺序也同步到本地，避免重绘时错位
  state.cards.sort((a, b) => items.findIndex((i) => i.id === a.id) - items.findIndex((i) => i.id === b.id));

  try {
    const r = await api('/api/cards/reorder', { method: 'POST', body: { items } });
    if (r.cards) state.cards = r.cards;
  } catch {
    toast('排序保存失败', true);
  }
  // 跨组了要重绘，好让原分组在变空时显示占位
  if (after !== d.group) renderBoards();
}

el.boards.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const card = e.target.closest('.card');
  if (!card || card.classList.contains('is-dragging')) return;
  if (e.target.closest('.act') || e.target.closest('.board-empty')) return;
  drag = {
    card,
    startX: e.clientX,
    startY: e.clientY,
    active: false,
    group: card.closest('.grid')?.dataset.group || 'service',
  };
  // 捕获指针，避免移出卡片后事件丢失（这是之前"有时能拖有时不能"的主要原因之一）
  try {
    card.setPointerCapture(e.pointerId);
  } catch {}
});

window.addEventListener(
  'pointermove',
  (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
      startDrag(e);
    }
    e.preventDefault();
    moveDrag(e);
  },
  { passive: false },
);

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  try {
    drag.card.releasePointerCapture?.(e.pointerId);
  } catch {}
  if (drag.active) {
    e.preventDefault();
    endDrag();
  } else {
    drag = null; // 没拖动 → 交给卡片自身的 click
  }
});
window.addEventListener('pointercancel', () => endDrag());

/* ---------------- 搜索 ---------------- */
function applyEngine() {
  const id = state.settings?.searchEngine || 'bing';
  const eng = ENGINES.find((e) => e.id === id) || ENGINES[0];
  el.engineBadge.textContent = eng.mark;
  el.engineBadge.style.fontSize = eng.mark.length > 1 ? '11px' : '14px';
  el.engineBadge.style.background = `linear-gradient(150deg,${eng.c1},${eng.c2})`;
  el.hint.innerHTML = defaultHint();
  renderEngineMenu();
}

/** 搜索框下方的固定提示，切换引擎时也要跟着变 */
function defaultHint() {
  const eng = ENGINES.find((e) => e.id === (state.settings?.searchEngine || 'bing')) || ENGINES[0];
  return `${eng.name} · <kbd>⌘K</kbd> 聚焦 · 输入网址直接打开`;
}

function renderEngineMenu() {
  const cur = state.settings?.searchEngine || 'bing';
  el.engineMenu.innerHTML = '';
  for (const eng of ENGINES) {
    const b = document.createElement('button');
    b.className = `engine-item${eng.id === cur ? ' active' : ''}`;
    b.type = 'button';
    const badge = document.createElement('span');
    badge.className = 'engine-badge';
    badge.textContent = eng.mark;
    badge.style.fontSize = eng.mark.length > 1 ? '10px' : '12px';
    badge.style.background = `linear-gradient(150deg,${eng.c1},${eng.c2})`;
    b.append(badge, document.createTextNode(eng.name));
    b.addEventListener('click', async () => {
      state.settings.searchEngine = eng.id;
      el.engineMenu.hidden = true;
      el.engineTrigger.classList.remove('open');
      applyEngine();
      el.q.focus();
      try {
        await api('/api/settings', { method: 'PATCH', body: { searchEngine: eng.id } });
      } catch {}
    });
    el.engineMenu.appendChild(b);
  }
}

el.engineTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = el.engineMenu.hidden;
  el.engineMenu.hidden = !open;
  el.engineTrigger.classList.toggle('open', open);
});
document.addEventListener('click', (e) => {
  if (!el.engineMenu.hidden && !el.engineMenu.contains(e.target) && !el.engineTrigger.contains(e.target)) {
    el.engineMenu.hidden = true;
    el.engineTrigger.classList.remove('open');
  }
});

const looksLikeUrl = (s) => {
  const t = s.trim();
  if (/^(https?:\/\/|localhost[:/])/i.test(t)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) && !/\s/.test(t) && /\.(com|cn|net|org|io|dev|top|me|xyz|cc|tv|info|app|co|local|lan|internal)(:\d+)?(\/|$)/i.test(t);
};

/* ---------------- 输入时高亮命中的卡片 ---------------- */
const MATCH_CLS = 'is-active';

/**
 * 卡片是否命中关键词。
 * 单个字只看名字和描述（不然一个字母能命中半屏的网址）；
 * 两个字以上才连容器名和地址一起找。
 */
function cardHit(card, q) {
  const name = `${card.name} ${card.desc || ''}`.toLowerCase();
  if (name.includes(q)) return true;
  if (q.length < 2) return false;
  return `${card.container || ''} ${card.url}`.toLowerCase().includes(q);
}

/** 按当前输入同步高亮，返回命中数量 */
function syncHighlight(raw) {
  const q = String(raw || '').trim().toLowerCase();
  const cards = new Map(state.cards.map((c) => [c.id, c]));
  let hit = 0;
  for (const node of el.boards.querySelectorAll('.card[data-id]')) {
    const card = cards.get(node.dataset.id);
    const ok = !!q && !!card && cardHit(card, q);
    node.classList.toggle(MATCH_CLS, ok);
    if (ok) hit++;
  }
  if (el.hint) {
    if (!q) el.hint.innerHTML = defaultHint();
    else if (hit) el.hint.innerHTML = `卡片命中 <b>${hit}</b> 张 · 回车搜索`;
    else el.hint.innerHTML = `没有匹配的卡片 · 回车搜索`;
  }
  return hit;
}

function clearHighlight() {
  for (const node of el.boards.querySelectorAll(`.card.${MATCH_CLS}`)) node.classList.remove(MATCH_CLS);
  if (el.hint) el.hint.innerHTML = defaultHint();
}

el.q.addEventListener('input', () => syncHighlight(el.q.value));
el.q.addEventListener('keydown', (e) => {
  // ESC 清空输入，高亮跟着消失
  if (e.key === 'Escape' && el.q.value) {
    e.preventDefault();
    el.q.value = '';
    clearHighlight();
  }
});

el.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // 回车就是去搜索了，先把卡片上的高亮解除
  clearHighlight();
  let v = el.q.value.trim();
  if (!v) return;

  // 前缀强制引擎，例如 "g 关键词"
  const m = /^([a-z]{1,6})\s+(.+)$/i.exec(v);
  if (m) {
    const eng = ENGINES.find((x) => x.id === m[1].toLowerCase() || x.name === m[1]);
    if (eng) {
      window.location.href = eng.url.replace('%s', encodeURIComponent(m[2]));
      return;
    }
  }

  if (looksLikeUrl(v)) {
    if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
    window.location.href = v;
    return;
  }
  const eng = ENGINES.find((x) => x.id === (state.settings?.searchEngine || 'bing')) || ENGINES[0];
  window.location.href = eng.url.replace('%s', encodeURIComponent(v));
});

/* ---------------- 卡片编辑 ---------------- */
let editing = null; // { card|null, draft }
let colorPickedFromIcon = false;

function openCardModal(card, group = 'service') {
  editing = card
    ? { id: card.id, draft: { ...card } }
    : {
        id: null,
        draft: {
          name: '',
          url: '',
          desc: '',
          icon: '',
          color: '',
          source: group === 'bookmark' ? 'bookmark' : 'manual',
          group,
          custom: {},
        },
      };
  colorPickedFromIcon = false;
  $('#cardModalTitle').textContent = card ? '编辑卡片' : '新增卡片';
  $('#fName').value = editing.draft.name || '';
  $('#fUrl').value = editing.draft.url || '';
  $('#fDesc').value = editing.draft.desc || '';
  $('#fColor').value = editing.draft.color || brandColor(editing.draft);
  $('#fColorHex').value = editing.draft.color || '';
  $('#fDelete').style.display = card ? '' : 'none';
  renderSwatches();
  renderIconBox();
  renderPreview();
  $('#cardModal').hidden = false;
  setTimeout(() => $('#fName').focus(), 60);
}

function renderIconBox() {
  const box = $('#fIconBox');
  box.innerHTML = '';
  const icon = editing.draft.icon;
  if (icon) {
    const img = document.createElement('img');
    img.src = icon;
    img.onerror = () => {
      box.textContent = initial(editing.draft.name);
    };
    box.appendChild(img);
  } else {
    box.innerHTML = `<span style="font-weight:700;font-size:17px;color:#fff">${initial(editing.draft.name || '·')}</span>`;
  }
}

function renderSwatches() {
  const wrap = $('#fSwatches');
  wrap.innerHTML = '';
  const cur = (editing.draft.color || '').toLowerCase();
  for (const c of SWATCHES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `swatch${c.toLowerCase() === cur ? ' active' : ''}`;
    b.style.background = `linear-gradient(150deg,${c},${c}bb)`;
    b.title = c;
    b.addEventListener('click', () => {
      setDraftColor(c);
    });
    wrap.appendChild(b);
  }
}

function setDraftColor(c) {
  editing.draft.color = c;
  $('#fColor').value = c;
  $('#fColorHex').value = c;
  renderSwatches();
  renderPreview();
}

function renderPreview() {
  const wrap = $('#cardPreview');
  wrap.innerHTML = '';
  const d = editing.draft;
  const fake = {
    id: 'preview',
    name: d.name || '卡片名称',
    url: d.url || 'http://example.com',
    desc: d.desc || '',
    icon: d.icon || '',
    color: d.color || '',
    source: 'manual',
  };
  wrap.appendChild(cardEl(fake, 0, { preview: true }));
}

['#fName', '#fUrl', '#fDesc'].forEach((sel) => {
  $(sel).addEventListener('input', () => {
    const key = { '#fName': 'name', '#fUrl': 'url', '#fDesc': 'desc' }[sel];
    editing.draft[key] = $(sel).value;
    if (key === 'name') renderIconBox();
    renderPreview();
  });
});

$('#fColor').addEventListener('input', (e) => {
  editing.draft.color = e.target.value;
  $('#fColorHex').value = e.target.value;
  renderSwatches();
  renderPreview();
});
$('#fColorHex').addEventListener('change', (e) => {
  let v = e.target.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (!/^#[0-9a-f]{6}$/i.test(v) && !/^#[0-9a-f]{3}$/i.test(v)) return toast('颜色格式不对', true);
  setDraftColor(v);
});

$('#fIconAuto').addEventListener('click', async (e) => {
  const url = $('#fUrl').value.trim();
  if (!url) return toast('先填地址', true);
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '抓取中…';
  try {
    const r = await api('/api/icon/fetch', { method: 'POST', body: { url } });
    if (r.icon) {
      editing.draft.icon = r.icon;
      renderIconBox();
      renderPreview();
      const c = await iconDominantColor(r.icon);
      if (c && !colorPickedFromIcon) {
        colorPickedFromIcon = true;
        setDraftColor(c);
      }
      toast('图标已抓取');
    } else {
      toast('没抓到图标，可手动上传', true);
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '自动抓取';
  }
});

$('#fIconClear').addEventListener('click', () => {
  editing.draft.icon = '';
  renderIconBox();
  renderPreview();
});

$('#fIconFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 1.5 * 1024 * 1024) return toast('图标请小于 1.5MB', true);
  const data = await fileToDataUri(f);
  const r = await api('/api/upload/icon', { method: 'POST', body: { data } });
  editing.draft.icon = r.icon;
  renderIconBox();
  renderPreview();
  const c = await iconDominantColor(r.icon);
  if (c && !colorPickedFromIcon) {
    colorPickedFromIcon = true;
    setDraftColor(c);
  }
  e.target.value = '';
});

$('#fColorAuto').addEventListener('click', async () => {
  const icon = editing.draft.icon;
  if (!icon) return toast('先设置图标', true);
  const c = await iconDominantColor(icon);
  if (!c) return toast('这张图里没提取到明显颜色', true);
  colorPickedFromIcon = true;
  setDraftColor(c);
});

$('#fSave').addEventListener('click', async () => {
  const d = editing.draft;
  const url = $('#fUrl').value.trim();
  const name = $('#fName').value.trim();
  if (!name) return toast('名称不能为空', true);
  if (!url) return toast('地址不能为空', true);
  if (!/^https?:\/\//i.test(url) && !/^\//.test(url)) d.url = `http://${url}`;
  // 默认端口去掉，地址更干净
  d.url = d.url
    .replace(/^http:\/\/([^/:]+):80(\/|$)/i, 'http://$1$2')
    .replace(/^https:\/\/([^/:]+):443(\/|$)/i, 'https://$1$2');
  d.name = name;
  d.desc = $('#fDesc').value.trim();
  try {
    if (editing.id) {
      const r = await api(`/api/cards/${editing.id}`, { method: 'PATCH', body: d });
      const i = state.cards.findIndex((c) => c.id === editing.id);
      if (i >= 0) state.cards[i] = r.card;
    } else {
      const r = await api('/api/cards', { method: 'POST', body: d });
      if (r.card) state.cards.unshift(r.card);
    }
    $('#cardModal').hidden = true;
    renderBoards();
    toast('已保存');
  } catch (err) {
    toast(err.message, true);
  }
});

$('#fDelete').addEventListener('click', async () => {
  if (!editing?.id) return;
  if (!confirm(`删除「${editing.draft.name}」？`)) return;
  await api(`/api/cards/${editing.id}`, { method: 'DELETE' });
  state.cards = state.cards.filter((c) => c.id !== editing.id);
  $('#cardModal').hidden = true;
  renderBoards();
  toast('已删除');
});

const fileToDataUri = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

/* ---------------- 扫描 / 导入 ---------------- */
$('#scanBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.classList.add('busy');
  const label = btn.querySelector('span');
  const old = label.textContent;
  label.textContent = '扫描中…';
  try {
    const r = await api('/api/discover?force=1&apply=1', { method: 'POST' });
    if (!r.dockerReady) toast('没连上 Docker socket，只能扫描系统服务', true);
    const st = await api('/api/state');
    state.cards = st.cards;
    renderBoards();
    toast(`发现 ${r.count} 个服务，新增 ${r.added} 张卡片`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.classList.remove('busy');
    label.textContent = old;
  }
});

$('#emptyScan').addEventListener('click', () => $('#scanBtn').click());

$('#importBtn').addEventListener('click', () => {
  $('#bmText').value = '';
  $('#bmFileName').textContent = '';
  $('#importModal').hidden = false;
});

let bmPayload = '';
$('#bmFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 12 * 1024 * 1024) return toast('文件太大', true);
  bmPayload = await f.text();
  $('#bmFileName').textContent = `已读取 ${f.name}（${Math.round(f.size / 1024)} KB）`;
});

$('#bmImport').addEventListener('click', async (e) => {
  const text = ($('#bmText').value || '').trim() || bmPayload;
  if (!text) return toast('先选择文件或粘贴内容', true);
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = '导入中…';
  try {
    const r = await api('/api/import', { method: 'POST', body: { text, moveToFront: true } });
    const st = await api('/api/state');
    state.cards = st.cards;
    renderBoards();
    $('#importModal').hidden = true;
    bmPayload = '';
    toast(`解析 ${r.parsed} 条，新增 ${r.added} 张卡片`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '导入';
  }
});

/* ---------------- 设置 ---------------- */
const TZ_LIST = [
  ['Asia/Shanghai', '中国标准时间 UTC+8'],
  ['Asia/Hong_Kong', '中国香港 UTC+8'],
  ['Asia/Taipei', '中国台北 UTC+8'],
  ['Asia/Tokyo', '东京 UTC+9'],
  ['Asia/Seoul', '首尔 UTC+9'],
  ['Asia/Singapore', '新加坡 UTC+8'],
  ['Europe/London', '伦敦 UTC+0'],
  ['Europe/Berlin', '柏林 UTC+1'],
  ['America/New_York', '纽约 UTC-5'],
  ['America/Los_Angeles', '洛杉矶 UTC-8'],
  ['UTC', 'UTC'],
];

function renderTzSelect(cur) {
  const sel = $('#sTz');
  if (!sel) return;
  const tz = cur || 'Asia/Shanghai';
  const list = TZ_LIST.some(([v]) => v === tz) ? TZ_LIST : [[tz, tz], ...TZ_LIST];
  sel.innerHTML = list.map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  sel.value = tz;
}

function openSettings() {
  const s = state.settings;
  $('#sTitle').value = s.siteTitle || '';
  $('#sSubtitle').value = s.subtitle || '';
  $('#sBgColor').value = s.background.color || '#0a0d18';
  $('#sBgColorHex').value = s.background.color || '#0a0d18';
  $('#sBgUrl').value = /^https?:/.test(s.background.image || '') ? s.background.image : '';
  $('#sBlur').value = s.background.blur || 0;
  $('#sDim').value = Math.round((s.background.dim ?? 0.15) * 100);
  $('#sGrain').checked = s.background.grain !== false;
  $('#sMonitorStats').checked = s.monitor.showStats !== false;
  $('#sMonEnabled').checked = !!s.monitor.enabled;
  $('#sMonCollapsed').checked = !!s.monitor.collapsed;
  $('#sMonUrl').value = s.monitor.url || '';
  $('#statsLine').textContent = `共 ${state.cards.length} 张卡片，其中 ${state.cards.filter((c) => c.source === 'docker' || c.source === 'system').length} 张来自扫描`;
  const w = s.weather || {};
  $('#sWxOn').checked = w.enabled !== false;
  $('#sWxCity').value = w.city || '北京';
  const ck = s.clock || {};
  $('#sClockOn').checked = ck.enabled !== false;
  $('#sClockSec').checked = !!ck.seconds;
  renderTzSelect(ck.timezone);
  renderCardToggles();
  segSet('#bgTypeSeg', s.background.type || 'aurora');
  segSet('#colSeg', String(s.layout?.columns ?? 0));
  segSet('#monModeSeg', s.monitor.mode || 'direct');
  syncBgFields();
  $('#settingsModal').hidden = false;
}

const segSet = (sel, v) => {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('active', b.dataset.v === String(v)));
};
const segGet = (sel) => $(`${sel} button.active`)?.dataset.v;

function syncBgFields() {
  const t = segGet('#bgTypeSeg');
  $('#bgColorField').hidden = t === 'image' ? false : t === 'aurora' ? false : false;
  $('#bgImageField').hidden = t !== 'image';
}

async function saveSettings(patch, { silent = true } = {}) {
  try {
    const r = await api('/api/settings', { method: 'PATCH', body: patch });
    state.settings = r.settings;
    applyAll();
    if (!silent) toast('已保存');
  } catch (e) {
    toast(e.message, true);
  }
}

$('#sTitle').addEventListener('input', (e) => saveSettings({ siteTitle: e.target.value }));
$('#sSubtitle').addEventListener('input', (e) => saveSettings({ subtitle: e.target.value }));

$('#bgTypeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  segSet('#bgTypeSeg', b.dataset.v);
  syncBgFields();
  saveSettings({ background: { type: b.dataset.v } });
});
$('#colSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  segSet('#colSeg', b.dataset.v);
  saveSettings({ layout: { columns: Number(b.dataset.v) } });
});
$('#monModeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  segSet('#monModeSeg', b.dataset.v);
  saveSettings({ monitor: { mode: b.dataset.v } }).then(() => reloadFrame());
});

$('#sBgColor').addEventListener('input', (e) => {
  $('#sBgColorHex').value = e.target.value;
  saveSettings({ background: { color: e.target.value, type: segGet('#bgTypeSeg') } });
});
$('#sBgColorHex').addEventListener('change', (e) => {
  let v = e.target.value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (!/^#[0-9a-f]{6}$/i.test(v)) return;
  $('#sBgColor').value = v;
  saveSettings({ background: { color: v, type: segGet('#bgTypeSeg') } });
});
$('#sBgUrl').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (!v) return;
  const url = /^https?:\/\//i.test(v) ? v : `http://${v}`;
  saveSettings({ background: { image: url, type: 'image' } }).then(() => segSet('#bgTypeSeg', 'image'));
});
$('#sBlur').addEventListener('input', (e) => {
  $('#blurOut').textContent = `${e.target.value}px`;
  saveSettings({ background: { blur: Number(e.target.value) } });
});
$('#sDim').addEventListener('input', (e) => {
  $('#dimOut').textContent = `${e.target.value}%`;
  saveSettings({ background: { dim: Number(e.target.value) / 100 } });
});
$('#sGrain').addEventListener('change', (e) => saveSettings({ background: { grain: e.target.checked } }));
$('#sMonitorStats').addEventListener('change', (e) => saveSettings({ monitor: { showStats: e.target.checked } }));
$('#sMonEnabled').addEventListener('change', (e) => saveSettings({ monitor: { enabled: e.target.checked } }));
$('#sMonCollapsed').addEventListener('change', (e) => saveSettings({ monitor: { collapsed: e.target.checked } }));
$('#sMonUrl').addEventListener('change', (e) => saveSettings({ monitor: { url: e.target.value.trim() } }).then(() => reloadFrame()));

$('#sWxOn').addEventListener('change', (e) =>
  saveSettings({ weather: { enabled: e.target.checked } }).then(() => loadWeather(true)),
);
$('#sWxApply').addEventListener('click', async () => {
  const city = $('#sWxCity').value.trim() || '北京';
  await saveSettings({ weather: { city } });
  wxLoadedAt = 0;
  await loadWeather(true);
  const chip = $('#wxChip');
  toast(chip && !chip.hidden ? `天气已切到 ${city}` : '天气未启用');
});
$('#sWxCity').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#sWxApply').click();
});
$('#sClockOn').addEventListener('change', (e) =>
  saveSettings({ clock: { enabled: e.target.checked } }).then(() => tickClock()),
);
$('#sClockSec').addEventListener('change', (e) =>
  saveSettings({ clock: { seconds: e.target.checked } }).then(() => {
    clockTimer = 0;
    clearInterval(clockTimer);
    tickClock();
  }),
);
$('#sTz').addEventListener('change', (e) =>
  saveSettings({ clock: { timezone: e.target.value } }).then(() => {
    clockTimer = 0;
    clearInterval(clockTimer);
    tickClock();
  }),
);

$('#sBgFile').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 18 * 1024 * 1024) return toast('图片请小于 18MB', true);
  toast('上传中…');
  const data = await fileToDataUri(f);
  const r = await api('/api/upload/background', { method: 'POST', body: { data } });
  await saveSettings({ background: { image: r.url, type: 'image' } });
  segSet('#bgTypeSeg', 'image');
  syncBgFields();
  toast('背景已更换');
  e.target.value = '';
});

$('#sRescan').addEventListener('click', () => {
  $('#settingsModal').hidden = true;
  $('#scanBtn').click();
});

/* ---------------- 监控面板 ---------------- */
let statsTimer = 0;
let frameWatchdog = 0;
let monitorSig = '';
let lastStats = null;
let cpuHist = [];
let monBuilt = false;

const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(1)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
};

const fmtRate = (bps) => {
  const n = Math.abs(Number(bps) || 0);
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB/s`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(n / 1024 ** 3).toFixed(2)} GB/s`;
};

const fmtUptime = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `运行 ${d} 天 ${h} 小时`;
  if (h > 0) return `运行 ${h} 小时 ${m} 分`;
  return `运行 ${m} 分`;
};

const barLevel = (p) => (p >= 88 ? 'hot' : p >= 72 ? 'warm' : '');

function sparkSvg(hist) {
  const H = 46;
  // 数据点还不够时先画一条基线，别让这块空着塌下去
  if (hist.length < 2) {
    return `<svg class="mp-spark" viewBox="0 0 100 ${H}" preserveAspectRatio="none">
      <line x1="0" y1="${H - 2}" x2="100" y2="${H - 2}" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }
  const step = 100 / (hist.length - 1);
  const pts = hist.map((v, i) => `${(i * step).toFixed(2)},${(H - (Math.min(100, v) / 100) * H).toFixed(2)}`).join(' ');
  return `<svg class="mp-spark" viewBox="0 0 100 ${H}" preserveAspectRatio="none">
    <line x1="0" y1="${H / 2}" x2="100" y2="${H / 2}" vector-effect="non-scaling-stroke"/>
    <polygon points="0,${H} ${pts} 100,${H}"/>
    <polyline points="${pts}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ---------- fnMonitor 的 5×7 点阵数字 ---------- */
const GLYPH = {"0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."], "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."], "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"], "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."], "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."], "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."], "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."], "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."], "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."], "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."], ".": [".", ".", ".", ".", ".", ".", "#"], ",": ["..", "..", "..", "..", "..", ".#", "#."], ":": [".", "#", ".", ".", ".", "#", "."], ";": [".", ".", ".", ".", ".", ".", "."], "-": ["....", "....", "....", "####", "....", "....", "...."], " ": ["..", "..", "..", "..", "..", "..", ".."], "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"], "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."], "°": [".#.", "#.#", ".#.", "...", "...", "...", "..."], "℃": [".#.", "#.#", ".#.", "...", "...", "...", "..."], "¥": ["#...#", ".#.#.", "..#..", "#####", "..#..", "#####", "..#.."], "↓": ["..#..", "..#..", "..#..", "#.#.#", ".###.", "..#..", "....."], "↑": [".....", "..#..", ".###.", "#.#.#", "..#..", "..#..", "..#.."], "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."], "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."], "D": ["###..", "#..#.", "#...#", "#...#", "#...#", "#..#.", "###.."], "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"], "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."], "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"], "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"], "I": ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"], "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"], "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"], "N": ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"], "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."], "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"], "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."], "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."], "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."], "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."], "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"], "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"], "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."], "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"], "h": ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"], "k": ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."], "s": [".....", ".....", ".####", "#....", ".###.", "....#", "####."], "z": [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"], "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."]};

function glyphOf(ch) {
  return GLYPH[ch] || GLYPH[ch.toUpperCase()] || GLYPH['?'];
}

/** 把文字画成点阵（对齐 fnMonitor 的 Dot 实现：5×7、r=0.39、字符间空一列） */
function dotMatrix(host, text) {
  if (!host) return;
  const raw = String(text ?? '');
  if (host.dataset.dot === raw) return;
  host.dataset.dot = raw;
  const gl = [...raw].map(glyphOf);
  if (!gl.length) {
    host.innerHTML = '';
    return;
  }
  const W = gl.reduce((a, g) => a + g[0].length, 0) + Math.max(0, gl.length - 1);
  let out = `<svg viewBox="0 0 ${W} 7" style="--u:${W}" aria-hidden="true">`;
  let x = 0;
  for (const g of gl) {
    const w = g[0].length;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < w; c++) {
        out += g[r][c] === '#'
          ? `<circle class="on" cx="${x + c + 0.5}" cy="${r + 0.5}" r="0.39"/>`
          : `<circle cx="${x + c + 0.5}" cy="${r + 0.5}" r="0.39"/>`;
      }
    }
    x += w + 1;
  }
  host.innerHTML = out + '</svg>';
}

/* ---------- 点阵监控面板（Shadow DOM 隔离，样式见 css/fn-theme.css） ---------- */
const FN_R = 40;
const FN_C = 2 * Math.PI * FN_R;          // 整圆周长
const FN_A = FN_C * 0.75;                  // 它用的是 270° 弧
let fnShadow = null;

const FN_CARDS = [
  { key: 'cpu', label: '处理器', unit: '%', gauge: true },
  { key: 'mem', label: '内存', unit: '%', gauge: true },
  { key: 'disk', label: '存储', unit: '%', gauge: true },
  { key: 'net', label: '网络', unit: '', gauge: false },
  { key: 'temp', label: '温度', unit: '℃', gauge: true },
  { key: 'pwr', label: '功耗', unit: 'W', gauge: true },
];

function ensureFnShadow() {
  if (fnShadow) return fnShadow;
  const host = el.monPanel;
  host.setAttribute('data-theme', 'dark');
  host.setAttribute('data-accent', 'black');
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `
    <link rel="stylesheet" href="/css/fn-theme.css">
    <style>
      /* 只做「落位」相关覆盖，视觉全部沿用 fnMonitor 自己的规则 */
      :host{background:transparent!important;padding:0!important;display:block;font-size:14px}
      .fn-wrap{background:transparent}
      .grid.metrics{grid-template-columns:repeat(auto-fit,minmax(232px,1fr));grid-auto-rows:1fr;gap:10px}
      /* 卡片不再用实心黑底，改成半透明，浮在页面背景上 */
      .metric{
        min-height:148px;padding:17px 18px 16px;border-radius:20px;
        background:rgba(255,255,255,.045)!important;
        border:1px solid rgba(255,255,255,.07);
        box-shadow:none!important;
        backdrop-filter:blur(12px);
        display:flex!important;flex-direction:column!important;
        grid-template-columns:none!important;grid-template-rows:none!important;
      }
      .metric .m-top{margin-bottom:8px}
      .metric .m-val{font-size:46px}
      .metric .dm{--dm-h:46px}
      .metric .m-main{flex:1 1 auto;display:block;min-width:0;align-self:stretch}
      .metric .m-sub{
        display:block;white-space:normal;line-height:1.5;font-size:11px;
        margin-top:auto;padding-top:6px;overflow:visible;color:var(--ink-3);
      }
      /* 计量表：卡片底部一条横向长条 */
      .metric .m-foot{
        grid-column:auto!important;height:auto!important;margin-top:12px!important;
        width:100%;
      }
      .m-meter{
        position:relative;height:5px;border-radius:3px;overflow:hidden;
        background:rgba(255,255,255,.09);
      }
      .m-meter>i{
        display:block;height:100%;border-radius:3px;width:0;
        transition:width .9s cubic-bezier(.22,.8,.24,1),background .3s;
        background:linear-gradient(90deg,#5585E8,#8ab8ff);
      }
      .m-meter.flat{height:1px;background:rgba(255,255,255,.07)}
      .m-meter.flat>i{background:rgba(255,255,255,.18)}
      /* 各卡片配色 */
      .metric[data-m="mem"] .m-meter>i{background:linear-gradient(90deg,#B761B1,#e6a3e0)}
      .metric[data-m="disk"] .m-meter>i{background:linear-gradient(90deg,#1F9C86,#68e0c4)}
      .metric[data-m="temp"] .m-meter>i{background:linear-gradient(90deg,#FF8F49,#ffc08a)}
      .metric[data-m="pwr"] .m-meter>i{background:linear-gradient(90deg,#BEA4FF,#e2d4ff)}
      /* 网络卡：数字小一点，上下两行 */
      .metric[data-m="net"] .dm{--dm-h:30px}
      .metric[data-m="net"] .net-vals.net-stack{display:flex!important;flex-direction:column!important;gap:9px!important}
      .metric[data-m="net"] .net-vals .row{display:flex!important;align-items:baseline!important;gap:7px;line-height:0;height:28px;flex:0 0 auto}
      .metric[data-m="net"] .net-vals .dnum{line-height:0;align-items:flex-end;gap:3px}
      .metric[data-m="net"] .net-vals .unit{font-size:10.5px;color:var(--ink-3);align-self:flex-end;margin-bottom:2px}
      .metric[data-m="net"] .net-vals .arr{font-size:11px;color:var(--ink-3);width:10px;text-align:center}
      .metric[data-m="net"] .m-sub{margin-top:8px!important;padding-top:0!important}
      .fn-foot{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:9px 18px;
        margin-top:11px;padding:12px 16px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);font-size:10px;color:var(--ink-3)}
      .fn-foot div{display:flex;justify-content:space-between;gap:10px;min-width:0}
      .fn-foot b{font-weight:500;color:var(--ink-2);font-variant-numeric:tabular-nums;
        max-width:64%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fn-disk{margin-top:10px;padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
      .fn-disk h5{margin:0 0 10px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--ink-3);font-weight:500;display:flex;justify-content:space-between}
      .fn-disk h5 em{font-style:normal;letter-spacing:0;text-transform:none}
      .fn-drow{display:flex;align-items:center;gap:9px;font-size:11px;padding:4px 0;color:var(--ink-2)}
      .fn-drow .dn{width:42px}
      .fn-drow .db{flex:1;height:5px;border-radius:3px;background:var(--fill-1);overflow:hidden}
      .fn-drow .db i{display:block;height:100%;border-radius:3px;background:var(--d-p,#8ab4ff)}
      .fn-drow .dp{width:32px;text-align:right}
      .fn-drow .dv{width:76px;text-align:right;color:var(--ink-3)}
      .fn-drow .dt{width:26px;text-align:right;color:var(--ink-3)}
      .fn-sec{margin-top:10px;padding:14px 16px;border-radius:16px;
        background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
      .fn-sec h5{margin:0 0 10px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;
        color:var(--ink-3);font-weight:500;display:flex;justify-content:space-between;align-items:baseline}
      .fn-sec h5 em{font-style:normal;letter-spacing:0;text-transform:none}
      .fn-cgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:7px 14px}
      .fn-citem{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-2);min-width:0}
      .fn-citem i{width:5px;height:5px;border-radius:50%;flex:none;background:var(--health-ok,#3BC47B)}
      .fn-citem.off i{background:var(--ink-3)}
      .fn-citem b{font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    </style>
    <div class="fn-wrap">
      <div class="grid metrics" id="fnGrid"></div>
      <div class="fn-disk" id="fnDisk"></div>
      <div class="fn-sec" id="fnContainers"></div>
      <div class="fn-foot" id="fnFoot"></div>
    </div>`;
  fnShadow = sh;
  return sh;
}

function fnCardHtml(c) {
  const main =
    c.key === 'net'
      ? `<div class="m-main" style="grid-column:1/-1">
          <div class="net-vals net-stack">
            <div class="row"><span class="arr">↓</span><span class="dnum"><span class="dm" data-v="rx">—</span><span class="unit" data-u="rx"></span></span></div>
            <div class="row"><span class="arr">↑</span><span class="dnum"><span class="dm" data-v="tx">—</span><span class="unit" data-u="tx"></span></span></div>
          </div>
          <div class="m-sub" data-sub="${c.key}"></div>
        </div>`
      : `<div class="m-main">
          <div class="m-val dnum"><span class="dm" data-v="${c.key}">—</span><span class="unit">${c.unit}</span></div>
          <div class="m-sub" data-sub="${c.key}"></div>
        </div>`;
  // 计量表统一放卡片底部的横向长条
  const foot = c.gauge
    ? `<div class="m-foot"><div class="m-meter" data-bar="${c.key}"><i style="width:0%"></i></div></div>`
    : `<div class="m-foot"><div class="m-meter flat"><i style="width:0%"></i></div></div>`;
  return `<article class="card metric" data-m="${c.key}">
    <div class="m-top">
      <span class="label">${c.label}</span>
      <span class="m-state"><span data-st="${c.key}"></span></span>
    </div>
    ${main}
    ${foot}
  </article>`;
}

function buildPanel() {
  const sh = ensureFnShadow();
  const grid = sh.getElementById('fnGrid');
  if (grid) grid.innerHTML = FN_CARDS.map(fnCardHtml).join('');
  monBuilt = true;
}

/* fnMonitor 的 spark 是 path.line + path.area */
function sparkPaths(values, w, h, { min = 0, max = 100 } = {}) {
  const n = values.length;
  if (n < 2) return '';
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = (i / (n - 1)) * w;
    const y = pad + (1 - Math.min(max, Math.max(min, v)) / span) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return `<path class="area" d="${d}L${w.toFixed(1)},${h}L0,${h}Z"/><path class="line" d="${d}"/>`;
}

function setSpark(sh, key, values, opt) {
  const svg = sh.querySelector(`[data-spark="${key}"] g`);
  const box = sh.querySelector(`[data-spark="${key}"]`);
  if (!svg || !box) return;
  const w = box.clientWidth || 220;
  const h = box.clientHeight || 38;
  svg.innerHTML = sparkPaths(values, w, h, opt);
}

const levelOf = (p) => (p >= 88 ? 'crit' : p >= 72 ? 'warn' : '');
const levelText = (p, kind) => {
  if (p >= 88) return kind === 'cpu' ? '高负载' : '偏高';
  if (p >= 72) return kind === 'cpu' ? '繁忙' : '较满';
  if (kind === 'cpu') return p < 35 ? '平稳' : '适中';
  return '正常';
};

function updatePanel(st) {
  if (!monBuilt) buildPanel();
  const sh = fnShadow;
  if (!sh) return;

  el.monHost.textContent = st.host || 'NAS';
  el.monUp.textContent = fmtUptime(st.uptime);

  const setNum = (key, v, digits = 0) => {
    const box = sh.querySelector(`[data-v="${key}"]`);
    if (box) dotMatrix(box, Number.isFinite(v) ? v.toFixed(digits) : '--');
  };
  const setSub = (key, txt) => {
    const box = sh.querySelector(`[data-sub="${key}"]`);
    if (box) box.textContent = txt || '';
  };
  const setSt = (key, txt) => {
    const box = sh.querySelector(`[data-st="${key}"]`);
    if (box) box.textContent = txt || '';
  };
  /* 底部横向计量条 */
  const setBar = (key, pct) => {
    const box = sh.querySelector(`[data-bar="${key}"] > i`);
    if (!box) return;
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    box.style.width = `${p}%`;
    if (p >= 88) box.style.background = 'linear-gradient(90deg,#E54C4A,#ff8f9c)';
    else if (p >= 72) box.style.background = 'linear-gradient(90deg,#FF8F49,#ffc08a)';
  };

  /* 处理器 */
  const cpu = Number(st.cpu?.percent) || 0;
  setNum('cpu', cpu, 1);
  setBar('cpu', cpu);
  setSt('cpu', levelText(cpu, 'cpu'));
  const cores = st.cpu?.threads || st.cpu?.cores;
  setSub(
    'cpu',
    [cores ? `${cores} 线程` : '', st.cpu?.freq ? `${(st.cpu.freq / 1000).toFixed(1)} GHz` : '', (st.cpu?.load || []).length ? `负载 ${Number(st.cpu.load[0]).toFixed(2)}` : '']
      .filter(Boolean)
      .join(' · '),
  );
  cpuHist.push(cpu);
  if (cpuHist.length > 46) cpuHist.shift();
  setSpark(sh, 'cpu', cpuHist);

  /* 内存 */
  const mem = Number(st.mem?.percent) || 0;
  setNum('mem', mem, 1);
  setBar('mem', mem);
  setSt('mem', levelText(mem, 'mem'));
  setSub('mem', `${st.mem?.usedGB} / ${st.mem?.totalGB} GB · 交换区 ${st.mem?.swapPercent ?? 0}%`);
  setSpark(sh, 'mem', [mem, mem], { min: 0, max: 100 });

  /* 存储 */
  const disks = st.disks || [];
  const maxDisk = disks.reduce((a, d) => (d.percent > (a?.percent ?? -1) ? d : a), null);
  const diskPct = maxDisk?.percent ?? 0;
  setNum('disk', diskPct, 0);
  setBar('disk', diskPct);
  setSt('disk', levelText(diskPct, 'disk'));
  const usedTB = disks.reduce((a, d) => a + (d.usedTB || 0), 0);
  const totalTB = disks.reduce((a, d) => a + (d.totalTB || 0), 0);
  setSub('disk', maxDisk ? `${maxDisk.mount} · ${maxDisk.usedTB}/${maxDisk.totalTB} TB` : '—');

  /* 网络 */
  const rx = Number(st.net?.rx) || 0;
  const tx = Number(st.net?.tx) || 0;
  const [rxV, rxU] = fmtRateSplit(rx);
  const [txV, txU] = fmtRateSplit(tx);
  const rv = sh.querySelector('[data-v="rx"]');
  const ru = sh.querySelector('[data-u="rx"]');
  const tv = sh.querySelector('[data-v="tx"]');
  const tu = sh.querySelector('[data-u="tx"]');
  dotMatrix(rv, rxV);
  if (ru) ru.textContent = rxU;
  dotMatrix(tv, txV);
  if (tu) tu.textContent = txU;
  setSub('net', st.net?.rxTotal ? `累计 ↓ ${fmtBytes(st.net.rxTotal)} · ↑ ${fmtBytes(st.net.txTotal || 0)}` : '');
  setSt('net', rx + tx > 0 ? '有流量' : '空闲');

  /* 温度 */
  const t = st.temp?.cpu != null ? Number(st.temp.cpu) : NaN;
  setNum('temp', t, 1);
  if (Number.isFinite(t)) setBar('temp', Math.min(100, t));
  setSt('temp', !Number.isFinite(t) ? '无数据' : t >= 80 ? '过热' : t >= 65 ? '偏高' : '正常');
  setSub('temp', st.temp?.system != null ? `系统 ${Math.round(st.temp.system)}℃ · 硬盘最高 ${diskTempMax(st)}℃` : '—');

  /* 功耗 */
  const pw = st.power?.total || NaN;
  setNum('pwr', pw, 1);
  if (Number.isFinite(pw)) setBar('pwr', Math.min(100, (pw / 150) * 100));
  setSt('pwr', Number.isFinite(pw) ? '实时' : '无数据');
  setSub('pwr', st.power?.source ? `来源 ${st.power.source}` : '—');

  /* 存储明细 */
  const dbox = sh.getElementById('fnDisk');
  if (dbox) {
    const key = disks.map((d) => d.mount).join(',');
    if (dbox.dataset.key !== key) {
      dbox.dataset.key = key;
      dbox.innerHTML =
        `<h5>存储<em>${usedTB.toFixed(1)} / ${totalTB.toFixed(1)} TB</em></h5>` +
        disks
          .map(
            (d) => `<div class="fn-drow" data-m="${d.mount}">
              <span class="dn">${d.mount}</span>
              <span class="db"><i style="width:0%"></i></span>
              <span class="dp">${d.percent}%</span>
              <span class="dv">${d.usedTB} / ${d.totalTB} TB</span>
              <span class="dt">${d.temp != null ? Math.round(d.temp) + '°' : ''}</span>
            </div>`,
          )
          .join('');
    }
    for (const d of disks) {
      const row = dbox.querySelector(`[data-m="${d.mount}"]`);
      if (row) row.querySelector('.db i').style.width = `${d.percent}%`;
    }
  }

  /* 容器 */
  const cbox = sh.getElementById('fnContainers');
  if (cbox) {
    const cs = st.containers || {};
    const list = cs.list || [];
    const key = `${cs.total}/${cs.running}/${list.map((c) => c.name).join(',')}`;
    if (cbox.dataset.key !== key) {
      cbox.dataset.key = key;
      cbox.innerHTML =
        `<h5>容器<em>${cs.running ?? 0} / ${cs.total ?? 0} 运行中</em></h5>` +
        `<div class="fn-cgrid">` +
        list
          .map(
            (c) =>
              `<div class="fn-citem${c.state === 'running' ? '' : ' off'}" title="${c.name}${c.health ? ' · ' + c.health : ''}"><i></i><b>${c.name}</b></div>`,
          )
          .join('') +
        `</div>`;
    }
  }

  /* 底部系统信息 */
  const fbox = sh.getElementById('fnFoot');
  if (fbox) {
    const rows = [
      ['系统', st.os ? `飞牛 ${st.os}` : st.kernel || '—'],
      ['容器', st.containers ? `${st.containers.running} / ${st.containers.total} 运行中` : '—'],
      ['处理器', (st.cpu?.model || '').replace(/\(R\)|\(TM\)|CPU|@.*/g, '').trim() || '—'],
      ['核显', st.gpu?.name || '—'],
      ['风扇', st.fans?.length ? `${Math.max(...st.fans)} RPM` : '—'],
      ['运行', fmtUptime(st.uptime).replace('运行 ', '')],
    ];
    fbox.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  }

  /* 曲线在布局完成后重画一次，保证宽度正确 */
  requestAnimationFrame(() => {
    setSpark(sh, 'cpu', cpuHist);
    setSpark(sh, 'mem', [mem, mem], { min: 0, max: 100 });
  });
}

function diskTempMax(st) {
  const list = (st.diskTemps || []).filter((d) => d.temp != null);
  return list.length ? Math.round(Math.max(...list.map((d) => d.temp))) : 0;
}

function fmtRateSplit(bps) {
  const n = Math.abs(Number(bps) || 0);
  if (n < 1024) return [String(Math.round(n)), 'B/s'];
  if (n < 1024 ** 2) return [(n / 1024).toFixed(1), 'KB/s'];
  if (n < 1024 ** 3) return [(n / 1024 ** 2).toFixed(1), 'MB/s'];
  return [(n / 1024 ** 3).toFixed(2), 'GB/s'];
}

function showMonitorError(msg, detail) {
  monBuilt = false;
  const sh = fnShadow || ensureFnShadow();
  const wrap = sh.querySelector('.fn-wrap');
  if (wrap) {
    wrap.innerHTML = `<div style="font-size:12px;color:#92928F;line-height:1.8;padding:8px 0">${msg}
      <code style="display:block;margin-top:6px;font-size:10.5px;color:#64645F;word-break:break-all">${detail || ''}</code></div>`;
  }
}

async function fetchStats({ quiet = false } = {}) {
  try {
    const r = await api('/api/monitor/stats');
    if (!r.ok || !r.stats) {
      if (!quiet) showMonitorError('读不到监控数据', state.settings.monitor.url);
      el.fnStats.innerHTML = '<span style="opacity:.45">—</span>';
      return null;
    }
    lastStats = r.stats;
    if (state.settings.monitor.mode === 'native' && !state.settings.monitor.collapsed) updatePanel(r.stats);
    updateFnStats(r.stats);
    return r.stats;
  } catch (e) {
    if (!quiet) showMonitorError('监控服务未响应', e.message);
    return null;
  }
}

function updateFnStats(st) {
  const s = st || lastStats;
  if (!s) {
    el.fnStats.innerHTML = '<span style="opacity:.45">—</span>';
    return;
  }
  el.fnStats.innerHTML = `<span>${Math.round(s.cpu?.percent ?? 0)}%</span>
    <span style="color:#7fb2ff">${Math.round(s.mem?.percent ?? 0)}%</span>
    ${s.temp?.cpu != null ? `<span style="color:#ffb86b">${Math.round(s.temp.cpu)}°</span>` : ''}`;
}

function monitorSrc() {
  const m = state.settings.monitor;
  if (m.mode === 'proxy') {
    let hash = '';
    try {
      hash = new URL(m.url).hash;
    } catch {}
    return `/fn/${hash}`;
  }
  return m.url;
}

function reloadFrame() {
  const m = state.settings.monitor;
  if (m.mode === 'native' || !m.enabled || m.collapsed) return;
  const iframe = el.monitorFrame;
  clearTimeout(frameWatchdog);
  const src = monitorSrc();
  iframe.dataset.loaded = '';
  frameWatchdog = setTimeout(() => {
    if (!iframe.dataset.loaded) toast('监控页加载较慢，检查 8777 是否在跑', true);
  }, 12000);
  iframe.onload = () => {
    iframe.dataset.loaded = '1';
    clearTimeout(frameWatchdog);
  };
  iframe.src = 'about:blank';
  requestAnimationFrame(() => {
    iframe.src = src;
  });
}

/* 能并排显示卡片与监控的最小窗口宽度 */
const SIDE_MIN = 1200;
/** 窄窗口下用户手动点开的监控视图（不写进配置，窗口变宽自动失效） */
const view = { focusMonitor: false };

function desiredLayout() {
  const m = state.settings.monitor;
  if (!m.enabled) return 'off';
  if (window.innerWidth >= SIDE_MIN) return m.collapsed ? 'cards' : 'side';
  return view.focusMonitor ? 'focus' : 'cards';
}

function applyMonitor() {
  const m = state.settings.monitor;
  const layout = desiredLayout();
  const sig = [m.enabled, m.collapsed, m.url, m.mode, m.showStats, layout].join('|');
  const changed = sig !== monitorSig;
  monitorSig = sig;

  document.body.classList.remove('layout-side', 'layout-cards', 'layout-focus');
  document.body.classList.add(`layout-${layout === 'off' ? 'cards' : layout}`);
  el.fnPill.hidden = true;
  el.monitor.hidden = true;
  el.sheetMask.hidden = true;
  document.body.classList.remove('has-monitor', 'has-fn');
  clearInterval(statsTimer);
  stopJitter();

  if (layout === 'off') return;

  /* 折叠态：只留右侧 fn 胶囊，顺带显示实时数字 */
  if (layout === 'cards') {
    el.fnPill.hidden = false;
    document.body.classList.add('has-fn');
    if (m.showStats !== false) {
      if (lastStats) updateFnStats();
      else fetchStats({ quiet: true });
      statsTimer = setInterval(() => fetchStats({ quiet: true }), 12000);
    } else {
      el.fnStats.innerHTML = '';
    }
    return;
  }

  /* 并排 / 聚焦：都渲染面板 */
  el.monitor.hidden = false;
  document.body.classList.add('has-monitor');
  const native = m.mode === 'native';
  el.monPanel.hidden = !native;
  el.monitorFrame.hidden = native;
  const collapseBtn = $('#mCollapse');
  if (collapseBtn) collapseBtn.title = layout === 'focus' ? '收起监控，回到卡片' : '折叠';
  if (native) {
    if (changed || !monBuilt) fetchStats();
    startJitter();
    statsTimer = setInterval(() => fetchStats({ quiet: true }), 5000);
  } else if (changed) {
    reloadFrame();
  }
}

/* 窗口宽度跨过阈值时才重排，避免拖动过程中抖动 */
let lastWide = window.innerWidth >= SIDE_MIN;
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const wide = window.innerWidth >= SIDE_MIN;
    if (wide === lastWide) return;
    lastWide = wide;
    view.focusMonitor = false; // 变宽了就把临时展开状态收掉
    applyMonitor();
  }, 140);
});

/* ---------------- 天气 / 时钟（点阵） ---------------- */
const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let wxTimer = 0;
let wxLoadedAt = 0;
async function loadWeather(force = false) {
  const w = state.settings.weather || {};
  const chip = $('#wxChip');
  if (!chip) return;
  if (!w.enabled) {
    chip.hidden = true;
    clearInterval(wxTimer);
    return;
  }
  chip.hidden = false;
  if (!force && Date.now() - wxLoadedAt < 60000) return;
  wxLoadedAt = Date.now();
  try {
    const r = await api(`/api/weather?city=${encodeURIComponent(w.city || '北京')}`);
    if (!r.ok) {
      $('#wxIcon').textContent = '—';
      dotMatrix($('#wxTemp'), '--');
      chip.title = r.error || '天气获取失败';
      return;
    }
    $('#wxIcon').textContent = r.icon || '☀';
    dotMatrix($('#wxTemp'), String(r.temp));
    chip.title = `${r.city} · ${r.text} ${r.temp}°C（体感 ${r.feels}°，湿度 ${r.humidity}%）${r.stale ? ' · 离线缓存' : ''}`;
    clearInterval(wxTimer);
    wxTimer = setInterval(loadWeather, 15 * 60 * 1000);
  } catch {
    $('#wxIcon').textContent = '—';
  }
}

let clockTimer = 0;
function tickClock() {
  const c = state.settings.clock || {};
  const chip = $('#clockChip');
  if (!chip) return;
  if (!c.enabled) {
    chip.hidden = true;
    clearInterval(clockTimer);
    clockTimer = 0;
    return;
  }
  chip.hidden = false;
  const tz = c.timezone || 'Asia/Shanghai';
  let text = '--:--';
  try {
    text = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      ...(c.seconds ? { second: '2-digit' } : {}),
      hour12: false,
      timeZone: tz,
    }).format(new Date());
  } catch {
    /* 时区非法就显示占位 */
  }
  const box = $('#clockDm');
  if (box) {
    dotMatrix(box, text);
    box.parentElement.title = `${tz} · 点击设置时区`;
  }
  tickDate(tz);
  if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
}

/** 时间右侧的日期：点阵年月日 + 中文星期，跟时间用同一套字模 */
function tickDate(tz) {
  const box = $('#dateDm');
  const chip = $('#dateChip');
  if (!box || !chip) return;
  const now = new Date();
  let iso = '';
  let week = '';
  try {
    // en-CA 的日期就是 2026-10-27 这种纯数字格式，正好能喂给点阵字模
    iso = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: tz,
    }).format(now);
    week = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: tz }).format(now);
  } catch {
    return;
  }
  dotMatrix(box, iso);
  const wk = $('#dateWeek');
  if (wk) wk.textContent = week;
  chip.title = `${iso} ${week} · 点击设置时区`;
}

/* ---------------- 刷新间隙的轻微浮动（让数字不呆板） ---------------- */
let jitterTimer = 0;
/*
 * 刷新是 5 秒一次，两次之间只让数字「动一下末位」，看起来才不呆板。
 * 每个指标抖的幅度按它的量级给：百分比给 ±0.18，温度 ±0.35，功耗 ±0.6，
 * 网络按比例抖 ±1.5%（速率为 0 时保持 0，别凭空冒出流量）。
 */
function startJitter() {
  stopJitter();
  jitterTimer = setInterval(() => {
    if (!lastStats || !monBuilt || !fnShadow) return;
    const s = lastStats;
    const wob = (amp) => (Math.random() - 0.5) * amp;
    const put = (key, v, digits = 1) => {
      if (!Number.isFinite(v)) return;
      const cell = fnShadow.querySelector(`[data-v="${key}"]`);
      if (cell) dotMatrix(cell, Math.max(0, v).toFixed(digits));
    };
    const putText = (key, text) => {
      const cell = fnShadow.querySelector(`[data-v="${key}"]`);
      if (cell) dotMatrix(cell, text);
    };

    put('cpu', (Number(s.cpu?.percent) || 0) + wob(0.36));
    put('mem', (Number(s.mem?.percent) || 0) + wob(0.36));

    const temp = Number(s.temp?.cpu);
    if (Number.isFinite(temp)) put('temp', temp + wob(0.7));

    const pwr = Number(s.power?.total);
    if (Number.isFinite(pwr)) put('pwr', Math.max(0, pwr + wob(1.2)));

    const jitRate = (v) => (v > 0 ? v * (1 + wob(0.03)) : 0);
    const rx = jitRate(Number(s.net?.rx) || 0);
    const tx = jitRate(Number(s.net?.tx) || 0);
    if (rx > 0) putText('rx', fmtRateSplit(rx)[0]);
    if (tx > 0) putText('tx', fmtRateSplit(tx)[0]);
  }, 760);
}
function stopJitter() {
  clearInterval(jitterTimer);
  jitterTimer = 0;
}

/* ---------------- 设置里的卡片开关 ---------------- */
function renderCardToggles() {
  const box = $('#cardToggles');
  if (!box) return;
  if (!state.cards.length) {
    box.innerHTML = '<p class="tip">还没有卡片</p>';
    return;
  }
  box.innerHTML = state.cards
    .map(
      (c) => `<div class="ct-row${c.hidden ? ' off' : ''}" data-id="${escHtml(c.id)}">
        <span class="ct-ico">${c.icon ? `<img src="${escHtml(c.icon)}" alt="">` : `<span>${escHtml(initial(c.name))}</span>`}</span>
        <span class="ct-name">${escHtml(c.name)}</span>
        <span class="ct-tag">${groupOf(c) === 'bookmark' ? '书签' : '服务'}</span>
        <label class="switch"><input type="checkbox" data-cid="${escHtml(c.id)}"${c.hidden ? '' : ' checked'}><span></span></label>
      </div>`,
    )
    .join('');
  box.onchange = async (e) => {
    const cb = e.target.closest('input[data-cid]');
    if (!cb) return;
    const id = cb.dataset.cid;
    const hidden = !cb.checked;
    try {
      await api(`/api/cards/${id}`, { method: 'PATCH', body: { hidden } });
      const card = state.cards.find((x) => x.id === id);
      if (card) card.hidden = hidden;
      const row = box.querySelector(`[data- id="${id}"], [data-id="${id}"]`);
      if (row) row.classList.toggle('off', hidden);
      renderBoards();
    } catch (err) {
      toast(err.message, true);
      cb.checked = !cb.checked;
    }
  };
}

$('#mCollapse').addEventListener('click', () => {
  if (desiredLayout() === 'focus') {
    view.focusMonitor = false;
    applyMonitor();
    return;
  }
  saveSettings({ monitor: { collapsed: true } });
});
$('#mRefresh').addEventListener('click', () => {
  if (state.settings.monitor.mode === 'native') fetchStats();
  else reloadFrame();
});
$('#mOpen').addEventListener('click', () => window.open(state.settings.monitor.url, '_blank', 'noopener'));
$('#fnPill').addEventListener('click', () => {
  if (window.innerWidth >= SIDE_MIN) {
    saveSettings({ monitor: { collapsed: false } });
  } else {
    view.focusMonitor = true;
    applyMonitor();
  }
});
el.sheetMask.addEventListener('click', () => saveSettings({ monitor: { collapsed: true } }));

/* ---------------- 背景 / 全局应用 ---------------- */
function applyBackground() {
  const b = state.settings.background;
  const body = document.body;
  body.classList.toggle('theme-aurora', b.type === 'aurora');
  const hasImg = b.type === 'image' && !!b.image;
  body.classList.toggle('has-bg-image', hasImg);
  body.classList.toggle('no-grain', b.grain === false);
  document.documentElement.style.setProperty('--sheet', b.color || '#0a0d18');
  document.body.style.background = b.type === 'color' ? b.color || '#0a0d18' : b.color || '#0a0d18';
  el.bgImage.style.backgroundImage = hasImg ? `url("${b.image}")` : '';
  el.bgImage.style.filter = `blur(${b.blur || 0}px) saturate(1.05)`;
  el.bgImage.style.transform = `scale(${1.02 + (b.blur || 0) / 160})`;
  const dim = Math.min(0.85, b.dim ?? 0.15);
  el.bgVeil.style.background = hasImg
    ? `linear-gradient(180deg, rgba(6,9,16,${dim * 0.85}), rgba(6,9,16,${Math.min(0.92, dim + 0.28)}))`
    : `radial-gradient(120% 110% at 50% 0%, transparent 26%, rgba(0,0,0,${0.28 + dim}) 100%)`;
}

function applyAll() {
  if (el.siteTitle.getAttribute('contenteditable') !== 'true') {
    el.siteTitle.textContent = state.settings.siteTitle || '控制台';
  }
  el.siteSub.textContent = state.settings.subtitle || '';
  document.title = state.settings.siteTitle || '控制台';
  applyBackground();
  applyEngine();
  applyMonitor();
  loadWeather();
  tickClock();
  const cols = state.settings.layout?.columns ?? 0;
  for (const g of el.boards.querySelectorAll('.grid')) {
    if (cols) g.dataset.cols = String(cols);
    else delete g.dataset.cols;
  }
}

/* ---------------- 模态通用 ---------------- */
$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('.modal').setAttribute('hidden', '')),
);
$$('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) m.setAttribute('hidden', '');
  }),
);
$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    if (t.dataset.tab === 'cards') renderCardToggles();
  }),
);
/* ---------------- 全屏（隐藏浏览器标题栏/菜单栏） ---------------- */
(() => {
  const btn = $('#fullBtn');
  if (!btn) return;
  const icon = btn.querySelector('use');
  const fsEl = () =>
    document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
  const sync = () => {
    const on = !!fsEl();
    btn.classList.toggle('on', on);
    btn.title = on ? '退出全屏' : '全屏显示（隐藏浏览器界面）';
    if (icon) icon.setAttribute('href', on ? '#i-full-exit' : '#i-full');
  };
  btn.addEventListener('click', async () => {
    const root = document.documentElement;
    try {
      if (!fsEl()) {
        const req = root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
        if (!req) throw new Error('unsupported');
        // navigationUI:'hide' 是给 Chrome/Edge 的提示，Safari 会忽略
        await req.call(root, { navigationUI: 'hide' });
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        await exit.call(document);
      }
    } catch {
      toast('这个浏览器不允许网页全屏，可以按 F11（Windows）或 ⌃⌘F（macOS）', true);
    }
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  sync();
})();

$('#settingsBtn').addEventListener('click', openSettings);
$('#wxChip')?.addEventListener('click', () => {
  openSettings();
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'theme'));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== 'theme'));
  setTimeout(() => $('#sWxCity')?.focus(), 120);
});
$('#clockChip')?.addEventListener('click', () => {
  openSettings();
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'theme'));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== 'theme'));
  setTimeout(() => $('#sTz')?.focus(), 120);
});
// 日期跟时间同一套设置（时区），点它直接进时区那一栏
$('#dateChip')?.addEventListener('click', () => {
  openSettings();
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'theme'));
  $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== 'theme'));
  setTimeout(() => $('#sTz')?.focus(), 120);
});
el.addBtn.addEventListener('click', () => openCardModal(null));

/* ---------------- 标题就地编辑 ---------------- */
(() => {
  const t = el.siteTitle;
  t.setAttribute('contenteditable', 'false');
  const enterEdit = () => {
    t.setAttribute('contenteditable', 'true');
    t.focus();
    const range = document.createRange();
    range.selectNodeContents(t);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const commit = () => {
    if (t.getAttribute('contenteditable') !== 'true') return;
    t.setAttribute('contenteditable', 'false');
    const v = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    t.textContent = v || '控制台';
    if (v !== state.settings.siteTitle) {
      saveSettings({ siteTitle: v || '控制台' }).then(() => document.title = v || '控制台');
    }
  };
  t.addEventListener('click', (e) => {
    if (t.getAttribute('contenteditable') === 'true') return;
    e.preventDefault();
    enterEdit();
  });
  t.addEventListener('blur', commit);
  t.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      t.blur();
    }
    if (e.key === 'Escape') {
      t.textContent = state.settings.siteTitle || '控制台';
      t.blur();
    }
  });
  t.addEventListener('paste', (e) => {
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    document.execCommand('insertText', false, txt.replace(/\s+/g, ' ').slice(0, 40));
  });
})();

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    el.q.focus();
    el.q.select();
    return;
  }
  if (e.key === 'Escape') {
    $$('.modal').forEach((m) => m.setAttribute('hidden', ''));
    el.engineMenu.hidden = true;
  }
});

/* ---------------- 启动 ---------------- */
function skeleton(n = 9) {
  el.boards.innerHTML = '';
  el.empty.hidden = true;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'sk';
    grid.appendChild(d);
  }
  el.boards.appendChild(grid);
}

async function boot() {
  skeleton();
  try {
    const st = await api('/api/state');
    state.settings = st.settings;
    state.cards = st.cards;
    state.meta = st.meta || {};
    applyAll();
    renderBoards();

    if (!state.cards.length) {
      // 首次启动：后端在后台采集，等它出结果
      el.boards.innerHTML = '';
      skeleton(9);
      let tries = 0;
      const poll = setInterval(async () => {
        tries++;
        try {
          const r = await api('/api/state');
          if (r.cards.length || tries > 12) {
            clearInterval(poll);
            state.cards = r.cards;
            renderBoards();
            if (!r.cards.length) {
              el.boards.style.display = 'none';
              el.empty.hidden = false;
            }
          }
        } catch {
          clearInterval(poll);
        }
      }, 2500);
    }
  } catch (e) {
    el.boards.innerHTML = '';
    el.empty.hidden = false;
    toast(`加载失败：${e.message}`, true);
  }
}

boot();


