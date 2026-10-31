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

    /*
     * 卡片上不再放编辑/删除按钮：鼠标悬停那两个小按钮挡图标、还容易误点，
     * 已经由右键菜单接管（桌面）和长按面板接管（手机）。
     */
  } else {
    node.addEventListener('click', (e) => e.preventDefault());
    node.style.cursor = 'default';
  }

  return node;
}

/* ---------------- 渲染分组 ---------------- */
/*
 * 分组是数据驱动的：内置「容器与服务」「收藏书签」，用户可以自建任意分组。
 * 定义存在 settings.groups，顺序就是显示顺序（也支持拖动调整）。
 */
const BUILTIN_GROUPS = [
  { key: 'service', label: '容器与服务' },
  { key: 'bookmark', label: '收藏书签' },
];
const groupsOf = () => {
  const g = state.settings?.groups;
  return Array.isArray(g) && g.length ? g.filter((x) => x && x.key) : BUILTIN_GROUPS;
};
const groupDef = (key) => groupsOf().find((g) => g.key === key) || groupsOf()[0];

/** 卡片属于哪个分组；分组被删掉后残留的 key 归到第一组，不至于凭空消失 */
const groupOf = (c) => {
  const g = c.group || (c.source === 'bookmark' ? 'bookmark' : 'service');
  return groupsOf().some((x) => x.key === g) ? g : groupsOf()[0].key;
};

function boardEl(key, list, indexStart) {
  const board = document.createElement('section');
  board.className = 'board';
  board.dataset.group = key;
  const def = groupDef(key);

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

  // 分组标题可以拖动排序；右键给重命名/删除
  sep.classList.add('sep-grab');
  sep.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.sep-add')) return;
    startBoardDrag(e, board);
  });
  sep.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCtx(e.clientX, e.clientY, groupMenuItems(key), { title: def.label });
  });

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
    // 带上组名，比干巴巴一句「添加卡片」更明确（手机上加号已经收起来了，这里要说清加到哪）
    ph.innerHTML = `<svg class="ic" style="width:14px;height:14px"><use href="#i-plus"/></svg><span>向「${def.label}」添加</span>`;
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
  for (const def of groupsOf()) {
    const list = visible.filter((c) => groupOf(c) === def.key);
    /*
     * 空分组照常显示 —— 用户刚建的组得能看见，才知道往哪儿放东西。
     * 原来的「书签组为空就跳过」在自建分组的场景下会让人以为没建成功。
     */
    el.boards.appendChild(boardEl(def.key, list, idx));
    idx += list.length;
  }
  el.empty.hidden = visible.length > 0;
  if (!visible.length) el.boards.style.display = 'none';
  else el.boards.style.display = '';
}

/* ---------------- 分组拖拽排序 ---------------- */
/*
 * 拖的是分组标题（.board-sep），移动的是整个 section。
 * 松手后把 DOM 顺序写回 settings.groups —— 卡片顺序不受影响。
 */
let boardDrag = null;

function startBoardDrag(e, board) {
  boardDrag = { board, startY: e.clientY, moved: false, key: board.dataset.group };
  board.classList.add('board-grab');
  document.addEventListener('pointermove', moveBoardDrag);
  document.addEventListener('pointerup', endBoardDrag, { once: true });
}

function moveBoardDrag(e) {
  const d = boardDrag;
  if (!d) return;
  if (!d.moved) {
    if (Math.abs(e.clientY - d.startY) < 8) return; // 没动够，当点击处理
    d.moved = true;
    d.board.classList.add('board-dragging');
    document.body.classList.add('dragging');
  }
  const others = [...el.boards.querySelectorAll('.board')].filter((b) => b !== d.board);
  const hit = others.find((b) => {
    const r = b.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom;
  });
  if (!hit) return;
  const r = hit.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  el.boards.insertBefore(d.board, after ? hit.nextSibling : hit);
}

async function endBoardDrag() {
  const d = boardDrag;
  boardDrag = null;
  document.removeEventListener('pointermove', moveBoardDrag);
  if (!d) return;
  d.board.classList.remove('board-grab', 'board-dragging');
  document.body.classList.remove('dragging');
  if (!d.moved) return;

  const order = [...el.boards.querySelectorAll('.board')].map((b) => b.dataset.group);
  const cur = groupsOf();
  const next = order.map((k) => cur.find((g) => g.key === k)).filter(Boolean);
  state.settings.groups = next;
  try {
    await api('/api/settings', { method: 'PATCH', body: { groups: next } });
    toast('分组顺序已保存');
  } catch {
    toast('顺序保存失败', true);
  }
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

  /*
   * 抓取点：鼠标按下时落在卡片内的哪个位置。
   * 必须按「按下的位置」算，不能按当前位置 —— 否则一动卡片就跳一下。
   * （之前这两个值从来没赋过，clientX - undefined 算出 NaN，
   *   left/top 被浏览器忽略，卡片其实一直没跟手，只有占位框在动。）
   */
  d.offsetX = d.startX - rect.left;
  d.offsetY = d.startY - rect.top;

  const ghost = document.createElement('div');
  ghost.className = 'card-ghost';
  ghost.style.minHeight = `${rect.height}px`;
  ghost.style.borderRadius = getComputedStyle(card).borderRadius;
  card.parentNode.insertBefore(ghost, card);
  d.ghost = ghost;

  card.classList.add('is-dragging');
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  /*
   * 位置用 left/top 而不是 transform 里的 translate3d(var(--dx)...)：
   * 实测那套在 Chrome 里算出来是单位矩阵（transform 函数内嵌 CSS 变量时重算有滞后），
   * 卡片直接定死在 0,0。left/top 虽然会触发重排，但只有一个元素在动，够用且绝对可靠。
   */
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

/* ---------------- 手机上长按卡片：操作面板 ----------------
 * 手机做不了「按住拖」——手指一滑页面就得滚，拖拽和滚动必然抢事件。
 * 所以触摸设备改成：按住不动 500ms 弹面板，用「上移 / 下移」完成排序。
 */
let sheetEl = null;

function closeCardSheet() {
  if (sheetEl) {
    sheetEl.remove();
    sheetEl = null;
  }
}

/** 同组内相邻的上/下一张，找不到返回 -1 */
function siblingIndex(card, dir) {
  const group = groupOf(card);
  const idx = state.cards.findIndex((c) => c.id === card.id);
  if (idx < 0) return -1;
  if (dir < 0) {
    for (let i = idx - 1; i >= 0; i--) if (groupOf(state.cards[i]) === group) return i;
  } else {
    for (let i = idx + 1; i < state.cards.length; i++) if (groupOf(state.cards[i]) === group) return i;
  }
  return -1;
}

async function moveCardBy(card, dir) {
  const idx = state.cards.findIndex((c) => c.id === card.id);
  const target = siblingIndex(card, dir);
  if (idx < 0 || target < 0) return;
  const arr = [...state.cards];
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  state.cards = arr;
  renderBoards();
  try {
    const r = await api('/api/cards/reorder', { method: 'POST', body: { items: arr.map((c) => c.id) } });
    if (r.cards) state.cards = r.cards;
    renderBoards();
    toast(dir < 0 ? '已上移' : '已下移');
  } catch {
    toast('排序保存失败', true);
  }
}

function openCardSheet(card) {
  closeCardSheet();
  const canUp = siblingIndex(card, -1) >= 0;
  const canDown = siblingIndex(card, 1) >= 0;

  const wrap = document.createElement('div');
  wrap.className = 'sheet';
  wrap.innerHTML = `
    <div class="sheet-card" role="dialog" aria-label="卡片操作">
      <div class="sheet-title">${escHtml(card.name)}</div>
      <button class="sheet-btn" data-act="up"${canUp ? '' : ' disabled'}>
        <svg class="ic" style="transform:rotate(180deg)"><use href="#i-chevron"/></svg>上移一位</button>
      <button class="sheet-btn" data-act="down"${canDown ? '' : ' disabled'}>
        <svg class="ic"><use href="#i-chevron"/></svg>下移一位</button>
      <div class="sheet-sep"></div>
      <button class="sheet-btn" data-act="edit"><svg class="ic"><use href="#i-edit"/></svg>编辑卡片</button>
      <button class="sheet-btn danger" data-act="del"><svg class="ic"><use href="#i-trash"/></svg>删除卡片</button>
      <div class="sheet-sep"></div>
      <button class="sheet-btn" data-act="cancel">取消</button>
    </div>`;
  document.body.appendChild(wrap);
  sheetEl = wrap;

  wrap.addEventListener('click', async (e) => {
    if (e.target.closest('.sheet') === wrap && !e.target.closest('.sheet-btn')) {
      closeCardSheet();
      return;
    }
    const btn = e.target.closest('.sheet-btn');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'cancel') return closeCardSheet();
    if (act === 'up' || act === 'down') {
      closeCardSheet();
      await moveCardBy(card, act === 'up' ? -1 : 1);
      return;
    }
    if (act === 'edit') {
      closeCardSheet();
      openCardModal(card);
      return;
    }
    if (act === 'del') {
      closeCardSheet();
      if (!confirm(`删除「${card.name}」？`)) return;
      await api(`/api/cards/${card.id}`, { method: 'DELETE' });
      state.cards = state.cards.filter((c) => c.id !== card.id);
      renderBoards();
      toast('已删除');
    }
  });
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

  // 触摸：长按出菜单，拖拽留给桌面（手指滑动必须留给页面滚动）
  if (e.pointerType === 'touch') {
    drag.hold = setTimeout(() => {
      drag = null;
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 700);
      try {
        navigator.vibrate?.(12);
      } catch {}
      openCardSheet(card);
    }, 500);
    return;
  }

  // 捕获指针，避免移出卡片后事件丢失（这是之前"有时能拖有时不能"的主要原因之一）
  try {
    card.setPointerCapture(e.pointerId);
  } catch {}
});

window.addEventListener(
  'pointermove',
  (e) => {
    if (!drag) return;
    // 长按计时中：手指一移动就放弃长按，把这次手势交还给页面滚动
    if (drag.hold) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 10) {
        clearTimeout(drag.hold);
        drag = null;
      }
      return;
    }
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
  if (drag.hold) {
    clearTimeout(drag.hold);
    drag = null;
    return;
  }
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
window.addEventListener('pointercancel', () => {
  if (drag?.hold) {
    clearTimeout(drag.hold);
    drag = null;
    return;
  }
  endDrag();
});


/* 滚动时淡出悬浮按钮（手机上 + 和 fn 两个球会压住卡片） */
(() => {
  let t = 0;
  window.addEventListener(
    'scroll',
    () => {
      document.body.classList.add('scrolling');
      clearTimeout(t);
      t = setTimeout(() => document.body.classList.remove('scrolling'), 550);
    },
    { passive: true },
  );
})();

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

const TOUCH = () => window.matchMedia('(hover: none)').matches;

/** 搜索框下方的固定提示，切换引擎时也要跟着变（手机上不显示 ⌘K 这种键盘提示） */
function defaultHint() {
  const eng = ENGINES.find((e) => e.id === (state.settings?.searchEngine || 'bing')) || ENGINES[0];
  return TOUCH()
    ? `${eng.name} · 输入网址直接打开`
    : `${eng.name} · <kbd>⌘K</kbd> 聚焦 · 输入网址直接打开`;
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

// 窄屏上 placeholder 太长会被截成半句，换个短的
if (window.innerWidth < 420) el.q.placeholder = '搜索或输入网址…';

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
  const gsel = $('#fGroup');
  if (gsel) {
    // 下拉按当前分组列表动态生成 —— 写死两个选项的话，自定义分组的卡片一编辑就会被挤回内置组
    gsel.innerHTML = groupsOf()
      .map((g) => `<option value="${escHtml(g.key)}">${escHtml(g.label)}</option>`)
      .join('');
    gsel.value = groupOf(editing.draft);
  }
  $('#cardModal').hidden = false;
  // 手机上聚焦输入框会立刻唤起软键盘，误触后关掉还得多收一次键盘；
  // 聚焦容器只为了让键盘 / 读屏拿到上下文，还能顺手把弹窗滚到顶。
  setTimeout(() => $('#cardModal').querySelector('.modal-card')?.focus?.(), 60);
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
  // 以选择器为准：闭包里拿到的 group 可能是打开弹窗时的旧值
  const gsel = $('#fGroup');
  if (gsel && gsel.value) d.group = gsel.value;
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
    toast(`已保存到 ${groupDef(d.group).label}`);
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
  const fx = s.fx || {};
  $('#sFxGlass').checked = fx.glass !== false;
  $('#sFxCardAnim').checked = fx.cardAnim !== false;
  $('#sFxBgAnim').checked = fx.bgAnim !== false;
  $('#sMonitorStats').checked = s.monitor.showStats !== false;
  $('#sMonEnabled').checked = !!s.monitor.enabled;
  $('#sMonCollapsed').checked = monView() === 'collapsed';
  $('#sMonUrl').value = s.monitor.url || '';
  $('#sPowerTdp').value = s.power?.tdpW ?? 0;
  $('#sPowerBase').value = s.power?.baseW ?? 8;
  $('#sPowerDisk').value = s.power?.diskW ?? 8;
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
  segSet('#uiScaleSeg', String(s.ui?.scale ?? 1));
  renderTopOrder();
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
$('#sFxGlass').addEventListener('change', (e) => saveSettings({ fx: { glass: e.target.checked } }));
$('#sFxCardAnim').addEventListener('change', (e) => saveSettings({ fx: { cardAnim: e.target.checked } }));
$('#sFxBgAnim').addEventListener('change', (e) => saveSettings({ fx: { bgAnim: e.target.checked } }));
$('#sMonitorStats').addEventListener('change', (e) => saveSettings({ monitor: { showStats: e.target.checked } }));
$('#sMonEnabled').addEventListener('change', (e) => saveSettings({ monitor: { enabled: e.target.checked } }));
$('#sMonCollapsed').addEventListener('change', (e) =>
  saveSettings({
    monitor: { view: e.target.checked ? 'collapsed' : 'side', collapsed: e.target.checked },
  }),
);
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

  /*
   * 增量更新：位宽没变就只切圆点的 class，不重建整棵 SVG。
   *
   * 为什么值得改：一个字符是 7 行 × 3~5 列，三个字符就是一百多个 <circle>。
   * 抖动的末位每 760ms 变一次，一次刷 6 个指标，再加上时钟每秒两次 ——
   * 按老写法，每秒要创建销毁上千个节点，白烧 CPU 还容易闪。
   */
  const svg = host.firstElementChild;
  if (svg && svg.tagName.toLowerCase() === 'svg' && Number(svg.getAttribute('data-w')) === W) {
    const dots = svg.children;
    let i = 0;
    for (const g of gl) {
      const w = g[0].length;
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < w; c++) {
          const dot = dots[i++];
          if (!dot) return;
          if (g[r][c] === '#') dot.classList.add('on');
          else dot.classList.remove('on');
        }
      }
    }
    return;
  }

  let out = `<svg viewBox="0 0 ${W} 7" data-w="${W}" style="--u:${W}" aria-hidden="true">`;
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
      :host{
        background:transparent!important;padding:0!important;display:block;
        /* 跟随「界面字号」：这里千万不能声明 --ui-scale 本身，
           否则会在 shadow 里切断从 <html> 继承下来的值，设置就失效了 */
        font-size:calc(14px * var(--ui-scale, 1));
        --ink-3:#8a8a85; /* 原来 #64645f 在 #161616 上只有 3.0:1，小字看不清 */
      }
      .fn-wrap{background:transparent}
      /* 列宽走变量：全屏时外面会把它调大，卡片不至于被切成一小条一小条 */
      .grid.metrics{grid-template-columns:repeat(auto-fit,minmax(var(--metric-min,232px),1fr));grid-auto-rows:1fr;gap:10px}
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
      /* 温度条：整条就是一把蓝→红的标尺，60℃ 落在正中间（对应 20~100℃ 区间）。
         已填充部分只是「点亮」到当前温度，颜色由标尺本身决定，不再按阈值换色。 */
      .metric[data-m="temp"] .m-meter{
        background:linear-gradient(90deg,
          #2f6fd0 0%, #4a9eff 18%,
          #6f9a7a 42%, #d9a13a 58%,
          #e2711f 78%, #c0342b 100%);
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);
      }
      .metric[data-m="temp"] .m-meter>i{
        background:linear-gradient(90deg,rgba(255,255,255,.62),rgba(255,255,255,.42));
        box-shadow:0 0 6px rgba(255,255,255,.18);
      }
      .metric[data-m="pwr"] .m-meter>i{background:linear-gradient(90deg,#BEA4FF,#e2d4ff)}
      /* 网络卡：数字小一点，上下两行 */
      .metric[data-m="net"] .dm{--dm-h:30px}
      .metric[data-m="net"] .net-vals.net-stack{display:flex!important;flex-direction:column!important;gap:9px!important}
      .metric[data-m="net"] .net-vals .row{display:flex!important;align-items:baseline!important;gap:7px;line-height:0;height:28px;flex:0 0 auto}
      .metric[data-m="net"] .net-vals .dnum{line-height:0;align-items:flex-end;gap:3px}
      .metric[data-m="net"] .net-vals .unit{font-size:10.5px;color:var(--ink-3);align-self:flex-end;margin-bottom:2px}
      .metric[data-m="net"] .net-vals .arr{font-size:11px;color:var(--ink-3);width:10px;text-align:center}
      .metric[data-m="net"] .m-sub{margin-top:8px!important;padding-top:0!important}
      /* ---- 底部系统信息：每项配图标，两列 ---- */
      .fn-foot{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;
        margin-top:11px;padding:14px 16px;border-radius:16px;
        background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);
        font-size:calc(12px * var(--ui-scale,1));color:var(--ink-3)}
      .fn-foot .fi{display:flex;align-items:center;gap:8px;min-width:0}
      .fn-foot svg{width:14px;height:14px;flex:none;fill:none;stroke:var(--ink-3);
        stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
      .fn-foot .k{white-space:nowrap;color:var(--ink-3)}
      .fn-foot b{font-weight:500;color:var(--ink-2);font-variant-numeric:tabular-nums;
        margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
      /* ---- 存储：条加粗、字加大，一眼看清用了多少 ---- */
      .fn-disk{margin-top:10px;padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
      .fn-disk h5{margin:0 0 12px;font-size:calc(11px * var(--ui-scale,1));letter-spacing:1.1px;text-transform:uppercase;color:var(--ink-3);font-weight:500;display:flex;justify-content:space-between;align-items:baseline}
      .fn-disk h5 em{font-style:normal;letter-spacing:0;text-transform:none;font-size:calc(12px * var(--ui-scale,1));color:var(--ink-2);font-variant-numeric:tabular-nums}
      .fn-drow{display:flex;align-items:center;gap:10px;font-size:calc(12.5px * var(--ui-scale,1));padding:7px 0;color:var(--ink-2)}
      .fn-drow .dn{width:46px;color:var(--ink-2);font-weight:500}
      .fn-drow .db{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
      .fn-drow .db i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#2f8f7a,#4fc3a1);transition:width .9s var(--ease,cubic-bezier(.2,.85,.25,1))}
      /* 快满了换成暖色，不用红——红是「故障」的语义，这里只是提醒 */
      .fn-drow.hi .db i{background:linear-gradient(90deg,#c47a22,#f0b04a)}
      .fn-drow .dp{width:40px;text-align:right;color:var(--ink-1);font-weight:550;font-variant-numeric:tabular-nums;font-size:calc(13px * var(--ui-scale,1))}
      .fn-drow .dv{width:90px;text-align:right;color:var(--ink-3);font-variant-numeric:tabular-nums;font-size:calc(11px * var(--ui-scale,1));white-space:nowrap}
      .fn-drow .dt{width:30px;text-align:right;color:var(--ink-3);font-variant-numeric:tabular-nums}
      .fn-sec{margin-top:10px;padding:14px 16px;border-radius:16px;
        background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}
      .fn-sec h5{margin:0 0 10px;font-size:calc(11px * var(--ui-scale,1));letter-spacing:1.1px;text-transform:uppercase;
        color:var(--ink-3);font-weight:500;display:flex;justify-content:space-between;align-items:baseline}
      .fn-sec h5 em{font-style:normal;letter-spacing:0;text-transform:none;font-size:calc(12px * var(--ui-scale,1));color:var(--ink-2);font-variant-numeric:tabular-nums}
      /* ---- 容器：单列满宽，每行「状态 + 名字 + CPU + 内存」 ---- */
      /* 两列排：25 个容器单列要滚很久，两列一行两个，高度直接砍半 */
      .fn-cgrid{display:grid;grid-template-columns:1fr 1fr;gap:1px 14px}
      .fn-citem{
        display:grid;grid-template-columns:8px minmax(0,1fr) 34px 40px;
        align-items:center;gap:6px;
        font-size:calc(12px * var(--ui-scale,1));color:var(--ink-2);
        padding:3px 0;min-width:0;border-radius:6px;
      }
      .fn-citem:hover{background:rgba(255,255,255,.04)}
      /* 状态灯：比原来的小圆点大一倍，并带一圈柔光 —— 扫一眼就能看出谁没跑 */
      .fn-citem .dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--health-ok,#3BC47B);
        box-shadow:0 0 0 3px rgba(59,196,123,.16)}
      .fn-citem.off .dot{background:transparent;border:1.5px solid var(--ink-3);box-shadow:none}
      .fn-citem.bad .dot{background:var(--crit,#e54c4a);box-shadow:0 0 0 3px rgba(229,76,74,.2)}
      .fn-citem .cname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-1);font-weight:400}
      .fn-citem.off .cname{color:var(--ink-3)}
      .fn-citem .ccpu,.fn-citem .cmem{text-align:right;font-variant-numeric:tabular-nums;font-size:calc(11.5px * var(--ui-scale,1));color:var(--ink-2)}
      .fn-citem .ccpu.hot{color:#ff9d5c}
      .fn-citem .cmem{color:var(--ink-3)}
      .fn-citem .none{color:var(--ink-3)}
      /* 「还有 N 个」折叠按钮：低调，不抢戏 */
      .fn-more{
        display:block;width:100%;margin-top:8px;padding:5px 0;border-radius:8px;
        background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);
        color:var(--ink-3);font-size:calc(11.5px * var(--ui-scale,1));cursor:pointer;
        transition:background .2s var(--ease,cubic-bezier(.2,.85,.25,1)),color .2s
      }
      .fn-more:hover{background:rgba(255,255,255,.075);color:var(--ink-2)}
      .fn-pending{grid-column:1/-1;padding:10px 0;font-size:calc(11.5px * var(--ui-scale,1));color:var(--ink-3)}
    </style>
    <div class="fn-wrap">
      <div class="grid metrics" id="fnGrid"></div>
      <div class="fn-disk" id="fnDisk"></div>
      <div class="fn-sec" id="fnContainers"></div>
      <div class="fn-sec" id="fnMedia"></div>
      <div class="fn-foot" id="fnFoot"></div>
    </div>`;
  fnShadow = sh;
  return sh;
}

/*
 * 监控面板底部用的图标。
 * 必须内联 —— shadow DOM 里的 <use href="#i-x"> 指向不了 document 里的 symbol，
 * 会渲染成一片空白（这个坑踩过）。
 */
const MON_ICON = {
  sys: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  gpu: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  fan: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M12 10V4M12 14v6M10 12H4M14 12h6"/></svg>',
  up: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.4l3 1.8"/></svg>',
};

/*
 * 容器 CPU 显示：空闲的容器占 0.0x%，取整会全变成 0%，所以：
 *   <0.1% 直接写 <0.1%，<10% 保留一位小数，再往上取整。
 */
const fmtCpu = (v) => {
  if (v == null) return '—';
  if (v <= 0) return '0%';
  if (v < 0.1) return '<0.1%';
  if (v < 10) return `${v.toFixed(1)}%`;
  return `${Math.round(v)}%`;
};

function fnCardHtml(c) {
  const main =
    c.key === 'net'
      ? `<div class="m-main" style="grid-column:1/-1">
          <div class="net-vals net-stack">
            <div class="row"><span class="arr">↑</span><span class="dnum"><span class="dm" data-v="tx">—</span><span class="unit" data-u="tx"></span></span></div>
            <div class="row"><span class="arr">↓</span><span class="dnum"><span class="dm" data-v="rx">—</span><span class="unit" data-u="rx"></span></span></div>
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
/*
 * 每张卡右上角的状态词，按数值真的分档，而不是固定几个词。
 * 每个指标的量纲和「正常范围」都不一样，所以分开写，不硬套同一个百分比阈值。
 */
const STAT_TEXT = {
  cpu: (v) => (v < 12 ? '空闲' : v < 40 ? '平稳' : v < 70 ? '适中' : v < 90 ? '繁忙' : '满载'),
  mem: (v) => (v < 45 ? '宽裕' : v < 70 ? '正常' : v < 88 ? '偏紧' : '紧张'),
  disk: (v) => (v < 50 ? '充足' : v < 72 ? '正常' : v < 88 ? '偏满' : '告急'),
  temp: (v) => (v < 45 ? '凉爽' : v < 62 ? '正常' : v < 78 ? '偏热' : '过热'),
  pwr: (v) => (v < 35 ? '省电' : v < 75 ? '常规' : v < 130 ? '偏高' : '高功耗'),
  net: (v) => {
    // v 是上下行合计字节/秒
    if (v < 1024) return '空闲';
    if (v < 1024 * 1024) return '有流量';
    if (v < 20 * 1024 * 1024) return '传输中';
    return '高带宽';
  },
};
const statText = (kind, v) => {
  const fn = STAT_TEXT[kind];
  if (!fn) return '—';
  return Number.isFinite(Number(v)) ? fn(Number(v)) : '无数据';
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
    // 温度条自己就是一把蓝→红的标尺（见 CSS），不要在这里按阈值改配色
    if (key === 'temp') return;
    if (p >= 88) box.style.background = 'linear-gradient(90deg,#E54C4A,#ff8f9c)';
    else if (p >= 72) box.style.background = 'linear-gradient(90deg,#FF8F49,#ffc08a)';
  };

  /* 处理器 */
  const cpu = Number(st.cpu?.percent) || 0;
  setNum('cpu', cpu, 1);
  setBar('cpu', cpu);
  setSt('cpu', statText('cpu', cpu));
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
  setSt('mem', statText('mem', mem));
  setSub('mem', `${st.mem?.usedGB} / ${st.mem?.totalGB} GB · 交换区 ${st.mem?.swapPercent ?? 0}%`);
  setSpark(sh, 'mem', [mem, mem], { min: 0, max: 100 });

  /* 存储：卡片上用「所有卷的平均占用」，不是挑最满的那个 */
  const disks = st.disks || [];
  const diskPct = disks.length
    ? Math.round(disks.reduce((a, d) => a + (Number(d.percent) || 0), 0) / disks.length)
    : 0;
  setNum('disk', diskPct, 0);
  setBar('disk', diskPct);
  setSt('disk', statText('disk', diskPct));
  const usedTB = disks.reduce((a, d) => a + (d.usedTB || 0), 0);
  const totalTB = disks.reduce((a, d) => a + (d.totalTB || 0), 0);
  // 副标题给汇总容量 + 卷数，具体的每个卷看下面的明细区
  setSub(
    'disk',
    disks.length ? `${disks.length} 个卷 · ${usedTB.toFixed(1)} / ${totalTB.toFixed(1)} TB` : '—',
  );

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
  setSt('net', statText('net', rx + tx));

  /* 温度 */
  const t = st.temp?.cpu != null ? Number(st.temp.cpu) : NaN;
  setNum('temp', t, 1);
  // 温度条是一把 20~100℃ 的标尺：60℃ 正好落在正中间，和蓝→红渐变的中点对齐
  if (Number.isFinite(t)) setBar('temp', ((t - 20) / 80) * 100);
  setSt('temp', statText('temp', t));
  setSub('temp', st.temp?.system != null ? `系统 ${Math.round(st.temp.system)}℃ · 硬盘最高 ${diskTempMax(st)}℃` : '—');

  /* 功耗 */
  const pw = st.power?.total || NaN;
  setNum('pwr', pw, 1);
  if (Number.isFinite(pw)) setBar('pwr', Math.min(100, (pw / 150) * 100));
  setSt('pwr', statText('pwr', pw));
  const parts = st.power?.parts;
  setSub(
    'pwr',
    parts
      ? parts.mode === 'estimate'
        ? `CPU ${parts.cpu}W（${parts.cpuPercent}%×${parts.tdp}W）· ${parts.diskCount} 块盘 ${parts.disks}W`
        : `CPU ${parts.cpu}W · 内存 ${parts.dram}W · ${parts.diskCount} 块盘 ${parts.disks}W`
      : st.power?.source
        ? `来源 ${st.power.source}`
        : '—',
  );

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
            (d) => `<div class="fn-drow${d.percent >= 85 ? ' hi' : ''}" data-m="${d.mount}">
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

  /* 容器：单列，每行「状态灯 + 名字 + CPU + 内存」 */
  const cbox = sh.getElementById('fnContainers');
  if (cbox) {
    const cs = st.containers || {};
    const all = cs.list || [];
    // 两列排之后高度砍半，全显示也不长；保留折叠逻辑只是为了极多容器时兜底
    const LIMIT = 26;
    const expanded = containersExpanded;
    const list = expanded ? all : all.slice(0, LIMIT);
    const hiddenCount = all.length - list.length;

    const key = `${cs.total}/${cs.running}/${all.map((c) => c.name).join(',')}/${expanded}/${cs.pending || false}`;
    if (cbox.dataset.key !== key) {
      cbox.dataset.key = key;
      // 容器占用是后台采的，刚重启/刚刷新时可能还没拿到第一轮
      if (!all.length && (cs.pending || !cs.total)) {
        cbox.innerHTML =
          `<h5>容器<em>采集中…</em></h5>` +
          `<div class="fn-cgrid"><div class="fn-pending">正在读取每个容器的占用率，几秒后自动出现</div></div>`;
        return;
      }
      cbox.innerHTML =
        `<h5>容器<em>${cs.running ?? 0} / ${cs.total ?? 0} 运行中</em></h5>` +
        `<div class="fn-cgrid">` +
        list
          .map((c) => {
            const cls = c.state === 'unhealthy' ? 'bad' : c.state === 'running' ? '' : 'off';
            const cpu = fmtCpu(c.cpu);
            const mem =
              c.memMB == null ? '' : c.memMB >= 1024 ? `${(c.memMB / 1024).toFixed(1)}G` : `${c.memMB}M`;
            const hot = c.cpu != null && c.cpu >= 40 ? ' hot' : '';
            return `<div class="fn-citem ${cls}" title="${escHtml(c.name)} · ${escHtml(c.health || c.state)}">
              <span class="dot"></span>
              <span class="cname">${escHtml(c.name)}</span>
              <span class="ccpu${hot}">${cpu}</span>
              <span class="cmem">${mem}</span>
            </div>`;
          })
          .join('') +
        `</div>` +
        (hiddenCount > 0
          ? `<button class="fn-more" type="button">还有 ${hiddenCount} 个容器</button>`
          : all.length > LIMIT
            ? `<button class="fn-more" type="button">收起</button>`
            : '');
      const more = cbox.querySelector('.fn-more');
      if (more) {
        more.onclick = () => {
          containersExpanded = !expanded;
          cbox.dataset.key = ''; // 强制下一轮重建
          if (lastStats) updatePanel(lastStats);
        };
      }
    }
    // 数值每轮都更新（DOM 不重建，只改文本）。按顺序取，避免用名字拼选择器
    const items = cbox.querySelectorAll('.fn-citem');
    list.forEach((c, i) => {
      const row = items[i];
      if (!row) return;
      const cpuEl = row.querySelector('.ccpu');
      const memEl = row.querySelector('.cmem');
      if (cpuEl) {
        cpuEl.textContent = fmtCpu(c.cpu);
        cpuEl.classList.toggle('hot', c.cpu != null && c.cpu >= 40);
      }
      if (memEl) {
        memEl.textContent =
          c.memMB == null ? '' : c.memMB >= 1024 ? `${(c.memMB / 1024).toFixed(1)}G` : `${c.memMB}M`;
      }
    });
  }

  /* 底部系统信息：每项一个图标 */
  const fbox = sh.getElementById('fnFoot');
  if (fbox) {
    const rows = [
      [MON_ICON.sys, '系统', st.os ? `飞牛 ${st.os}` : st.kernel || '—'],
      [MON_ICON.box, '容器', st.containers ? `${st.containers.running} / ${st.containers.total}` : '—'],
      [MON_ICON.cpu, '处理器', (st.cpu?.model || '').replace(/\(R\)|\(TM\)|CPU|@.*/g, '').trim() || '—'],
      [MON_ICON.gpu, '显卡', st.gpu?.name || '—'],
      [MON_ICON.fan, '风扇', st.fans?.length ? `${Math.max(...st.fans)} RPM` : '无'],
      [MON_ICON.up, '运行', fmtUptime(st.uptime).replace('运行 ', '')],
    ];
    fbox.innerHTML = rows
      .map(([ico, k, v]) => `<div class="fi">${ico}<span class="k">${k}</span><b>${v}</b></div>`)
      .join('');
  }

  /* 曲线在布局完成后重画一次，保证宽度正确 */
  requestAnimationFrame(() => {
    setSpark(sh, 'cpu', cpuHist);
    setSpark(sh, 'mem', [mem, mem], { min: 0, max: 100 });
  });
}

/* ---------------- 媒体库（只在全屏监控里出现） ---------------- */
let mediaData = null;
let mediaTimer = 0;
let mediaLoading = false;

async function fetchMedia(force = false) {
  if (mediaLoading) return;
  mediaLoading = true;
  try {
    const r = await api(`/api/media${force ? '?force=1' : ''}`);
    if (r && !r.error) mediaData = r;
  } catch {
    /* 拉不到就保持上一次的结果 */
  } finally {
    mediaLoading = false;
    renderMedia();
  }
}

const fmtSize = (gb) => (gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${Math.round(gb)} GB`);

function renderMedia() {
  const sh = fnShadow;
  if (!sh) return;
  const box = sh.getElementById('fnMedia');
  if (!box) return;

  // 只有全屏才占版面；其它状态清空，省得卡片区旁边多一块
  if (!document.body.classList.contains('layout-focus')) {
    box.innerHTML = '';
    return;
  }

  if (!mediaData) {
    box.innerHTML =
      '<h5>媒体库<em>统计中</em></h5>' +
      '<div class="fn-pending">正在数媒体文件，第一次要几秒钟</div>';
    return;
  }

  const d = mediaData;
  const kind = d.byKind || {};
  const cats = (d.cats || []).filter((c) => c.count > 0);
  const recent = d.recent || [];

  box.innerHTML =
    `<h5>媒体库<em>${fmtSize(d.gb || 0)} · ${d.total} 个</em></h5>` +
    `<div class="fn-mstats">` +
    `<div class="fn-mstat"><b>${kind.video || 0}</b><i>视频</i></div>` +
    `<div class="fn-mstat"><b>${kind.image || 0}</b><i>图片</i></div>` +
    `<div class="fn-mstat"><b>${kind.audio || 0}</b><i>音频</i></div>` +
    `<div class="fn-mstat"><b>${cats.length}</b><i>分类</i></div>` +
    `</div>` +
    `<div class="fn-mcats">` +
    cats
      .map((c) => `<span><b>${escHtml(c.name)}</b>${c.count}</span>`)
      .join('') +
    `</div>` +
    `<h5 class="fn-mrecent-title">最近入库<em>按文件修改时间</em></h5>` +
    (recent.length
      ? `<div class="fn-mrecent">` +
        recent
          .map(
            (r) =>
              `<div class="fn-mrow"><span class="t">${escHtml(r.ago)}</span>` +
              `<span class="n" title="${escHtml(r.name)}">${escHtml(r.name)}</span>` +
              `<span class="c">${escHtml(r.cat || '')}</span></div>`,
          )
          .join('') +
        `</div>`
      : '<div class="fn-pending">还没有最近入库</div>');
}

function startMediaPoll() {
  stopMediaPoll();
  fetchMedia();
  mediaTimer = setInterval(() => fetchMedia(), 60000);
}
function stopMediaPoll() {
  clearInterval(mediaTimer);
  mediaTimer = 0;
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

let pendingRetry = false;

/*
 * 拿不到数据时不要清空面板。
 * 原来失败就把 .fn-wrap 整个换成「读不到监控数据」，容器一重启（哪怕是部署那 10 秒）
 * 面板就会白掉再长回来 —— 看着像面板自己消失。现在改成：有旧数据就保留 + 变暗标记，
 * 只有从来没成功过才显示错误。
 */
function markStatsStale(on) {
  const sh = fnShadow;
  if (!sh) return;
  const wrap = sh.querySelector('.fn-wrap');
  if (wrap) wrap.classList.toggle('is-stale', !!on);
}

async function fetchStats({ quiet = false } = {}) {
  try {
    const r = await api('/api/monitor/stats');
    if (!r.ok || !r.stats) {
      if (lastStats) {
        markStatsStale(true);
      } else if (!quiet) {
        showMonitorError('读不到监控数据', state.settings.monitor.url);
      }
      el.fnStats.innerHTML = '<span style="opacity:.45">—</span>';
      return null;
    }
    markStatsStale(false);
    lastStats = r.stats;
    if (document.body.classList.contains('layout-focus') && mediaData) renderMedia();
    // 容器占用是后台采的：第一次可能还没好，1.5 秒后补拉一次（只补一次，不循环）
    if (r.stats.containers?.pending && !pendingRetry) {
      pendingRetry = true;
      setTimeout(() => {
        pendingRetry = false;
        fetchStats({ quiet: true });
      }, 1500);
    }
    if (state.settings.monitor.mode === 'native' && monView() !== 'collapsed') updatePanel(r.stats);
    updateFnStats(r.stats);
    return r.stats;
  } catch (e) {
    if (lastStats) markStatsStale(true);
    else if (!quiet) showMonitorError('监控服务未响应', e.message);
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
  if (m.mode === 'native' || !m.enabled || monView() === 'collapsed') return;
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

/*
 * 监控三态：collapsed（折叠成右侧胶囊）/ side（右侧栏）/ full（覆盖全屏，卡片区让位）。
 * 老配置只有 boolean 的 collapsed，这里做一次兼容映射。
 */
/** 容器列表是否展开显示全部（超过 26 个才有意义） */
let containersExpanded = false;

const monView = () => {
  const m = state.settings.monitor || {};
  if (m.view === 'full' || m.view === 'side' || m.view === 'collapsed') return m.view;
  return m.collapsed ? 'collapsed' : 'side';
};

function desiredLayout() {
  const m = state.settings.monitor;
  if (!m.enabled) return 'off';
  const v = monView();
  if (v === 'full') return 'focus'; // 全屏复用 focus 布局：监控占满、卡片隐藏
  if (v === 'collapsed') return 'cards';
  // 「展开」在窄窗口放不下并排，退回覆盖式
  return window.innerWidth >= SIDE_MIN ? 'side' : 'focus';
}

function applyMonitor() {
  const m = state.settings.monitor;
  const layout = desiredLayout();
  const sig = [m.enabled, monView(), m.url, m.mode, m.showStats, layout].join('|');
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
  if (collapseBtn) collapseBtn.title = monView() === 'full' ? '折叠成胶囊' : '折叠';
  // 全屏按钮的图标跟着状态走：进全屏时变成「退出」
  const fullBtn = $('#mFull');
  if (fullBtn) {
    const isFull = monView() === 'full';
    fullBtn.innerHTML = `<svg class="ic"><use href="#${isFull ? 'i-full-exit' : 'i-full'}"/></svg>`;
    fullBtn.title = isFull ? '退出全屏，回到并排' : '全屏显示监控（隐藏卡片区）';
  }
  if (native) {
    if (changed || !monBuilt) fetchStats();
    startJitter();
    statsTimer = setInterval(() => fetchStats({ quiet: true }), 5000);
    // 媒体库统计只在全屏时跑（扫盘有成本，60 秒一次）
    if (layout === 'focus') startMediaPoll();
    else stopMediaPoll();
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
    // 布局是派生的（view + 窗口宽度），跨阈值时重算一次就行，不需要额外状态
    applyMonitor();
  }, 140);
});

/* ---------------- 天气 / 时钟（点阵） ---------------- */
const escHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let wxTimer = 0;
let wxLoadedAt = 0;
let wxData = null; // 最近一次成功的天气，展开面板时用
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
    wxData = r;
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
        <span class="ct-tag">${escHtml(groupDef(groupOf(c)).label)}</span>
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

/* 功耗估算的硬件参数：改完下一轮刷新就按新值算 */
for (const [id, key, max] of [
  ['#sPowerTdp', 'tdpW', 400],
  ['#sPowerBase', 'baseW', 200],
  ['#sPowerDisk', 'diskW', 60],
]) {
  $(id).addEventListener('change', (e) => {
    const v = Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0)));
    e.target.value = v;
    saveSettings({ power: { [key]: v } });
  });
}

/* ---------------- 顶部顺序 ---------------- */
/*
 * 天气 / 搜索栏 / 时间 / 日期 这一排，用 flex 的 order 重排。
 * 顺序存在 settings.layout.topOrder，缺项或改坏时自动回退默认，不把界面弄乱。
 */
const TOP_ITEMS = [
  { k: 'weather', sel: '.wx-chip', label: '天气' },
  { k: 'search', sel: '.search-zone', label: '搜索栏' },
  { k: 'clock', sel: '.clock-chip', label: '时间' },
  { k: 'date', sel: '.date-chip', label: '日期' },
];
const TOP_DEFAULT = ['weather', 'search', 'clock', 'date'];
const topOrderOf = (v) =>
  Array.isArray(v) && v.length === TOP_ITEMS.length && TOP_ITEMS.every((it) => v.includes(it.k))
    ? v
    : TOP_DEFAULT;

function applyTopOrder(order) {
  const row = document.querySelector('.search-row');
  if (!row) return;
  const list = topOrderOf(order);
  for (const it of TOP_ITEMS) {
    const node = row.querySelector(it.sel);
    if (node) node.style.order = String(list.indexOf(it.k));
  }
}

function renderTopOrder() {
  const box = $('#topOrderList');
  if (!box) return;
  const list = topOrderOf(state.settings?.layout?.topOrder);
  box.innerHTML = list
    .map((k, i) => {
      const label = TOP_ITEMS.find((x) => x.k === k)?.label || k;
      return `<div class="order-row">
        <span class="order-name">${label}</span>
        <button type="button" class="order-btn" data-k="${k}" data-d="-1"${i === 0 ? ' disabled' : ''} title="前移">↑</button>
        <button type="button" class="order-btn" data-k="${k}" data-d="1"${i === list.length - 1 ? ' disabled' : ''} title="后移">↓</button>
      </div>`;
    })
    .join('');

  for (const b of box.querySelectorAll('.order-btn')) {
    b.addEventListener('click', () => {
      const cur = [...list];
      const i = cur.indexOf(b.dataset.k);
      const j = i + Number(b.dataset.d);
      if (i < 0 || j < 0 || j >= cur.length) return;
      [cur[i], cur[j]] = [cur[j], cur[i]];
      state.settings.layout = { ...(state.settings.layout || {}), topOrder: cur };
      applyTopOrder(cur); // 先即时生效，别等接口回来
      renderTopOrder();
      saveSettings({ layout: { topOrder: cur } });
    });
  }
}

/* 界面字号：四档倍率，存在 settings.ui.scale，用 CSS 变量驱动 */
function applyUiScale(v) {
  const s = Math.min(1.6, Math.max(0.85, Number(v) || 1));
  document.documentElement.style.setProperty('--ui-scale', String(s));
  document.documentElement.dataset.uiScale = String(s);
}

$$('#uiScaleSeg button').forEach((b) =>
  b.addEventListener('click', () => {
    segSet('#uiScaleSeg', b.dataset.v);
    applyUiScale(b.dataset.v);
    saveSettings({ ui: { scale: Number(b.dataset.v) } });
  }),
);

$('#mCollapse').addEventListener('click', () => {
  saveSettings({ monitor: { view: 'collapsed', collapsed: true } });
});
$('#mFull').addEventListener('click', () => {
  const next = monView() === 'full' ? 'side' : 'full';
  saveSettings({ monitor: { view: next, collapsed: false } });
});
$('#mRefresh').addEventListener('click', () => {
  if (state.settings.monitor.mode === 'native') fetchStats();
  else reloadFrame();
});
$('#mOpen').addEventListener('click', () => window.open(state.settings.monitor.url, '_blank', 'noopener'));
$('#fnPill').addEventListener('click', () => {
  saveSettings({ monitor: { view: 'side', collapsed: false } });
});
el.sheetMask.addEventListener('click', () =>
  saveSettings({ monitor: { view: 'collapsed', collapsed: true } }),
);

/* ---------------- 背景 / 全局应用 ---------------- */
/**
 * 应用「视觉效果」开关。
 *
 * 这三项都是纯装饰，关掉只影响观感、不影响任何功能。做成可关的原因是：
 * 在个别 Chromium(macOS) 组合上，大面积的 backdrop-filter / 混合模式 / 持续动画
 * 会触发合成层面的闪烁，而那是浏览器的问题，页面这边唯一能做的是让用户能关掉。
 * class 挂在 <html> 上，和地址栏的 ?off= 开关共用同一套规则。
 */
function applyFx() {
  const f = state.settings.fx || {};
  const html = document.documentElement;
  html.classList.toggle('no-glass', f.glass === false);
  html.classList.toggle('no-cardanim', f.cardAnim === false);
  html.classList.toggle('no-bganim', f.bgAnim === false);
}

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
  applyUiScale(state.settings.ui?.scale);
  applyTopOrder(state.settings.layout?.topOrder);
  applyBackground();
  applyFx();
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

/* ---------------- 右键菜单 ---------------- */
/*
 * 接管页面右键：
 *   卡片上 → 编辑 / 打开 / 复制地址 / 删除
 *   空白处 → 新建卡片 / 扫描 / 导入 / 设置 / 刷新
 *
 * 两个例外要放行原生菜单，否则用户没法复制粘贴：
 *   输入框、文本域、contenteditable、以及带 data-native-menu 的元素。
 * 移动端不接这个（那里是长按弹面板，两者会打架）。
 */
let ctxNode = null;

const ctxIcon = (id) => `<svg class="ic"><use href="#${id}"/></svg>`;

/** 局域网 http 下 navigator.clipboard 不可用（非安全上下文），要留降级 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function closeCtx() {
  if (!ctxNode) return;
  ctxNode.remove();
  ctxNode = null;
  document.removeEventListener('pointerdown', onCtxOutside, true);
  window.removeEventListener('blur', closeCtx);
  window.removeEventListener('resize', closeCtx);
  document.removeEventListener('scroll', closeCtx, true);
  document.removeEventListener('keydown', onCtxKey, true);
}
const onCtxOutside = (e) => {
  if (ctxNode && !ctxNode.contains(e.target)) closeCtx();
};
const onCtxKey = (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCtx();
  }
};

/**
 * @param {number} x 视口坐标
 * @param {number} y
 * @param {Array} items { label, icon, run, danger } | { sep: true } | { label, head: true }
 * @param {{title?: string}} opts
 */
let ctxLastPos = { x: 0, y: 0 };

function openCtx(x, y, items, opts = {}) {
  closeCtx();
  ctxLastPos = { x, y };
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');

  if (opts.title) {
    const h = document.createElement('div');
    h.className = 'ctx-title';
    h.textContent = opts.title;
    menu.appendChild(h);
  }

  for (const it of items) {
    if (it.sep) {
      const d = document.createElement('div');
      d.className = 'ctx-sep';
      menu.appendChild(d);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    b.innerHTML = `${it.icon ? ctxIcon(it.icon) : ''}<span>${it.label}</span>`;
    b.addEventListener('click', async () => {
      closeCtx();
      try {
        await it.run?.();
      } catch (err) {
        toast(err.message || '操作失败', true);
      }
    });
    menu.appendChild(b);
  }

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  ctxNode = menu;

  // 贴边时翻到另一侧，别让菜单跑出屏幕
  const pad = 8;
  const r = menu.getBoundingClientRect();
  let left = x;
  let top = y;
  if (left + r.width > window.innerWidth - pad) left = Math.max(pad, x - r.width);
  if (top + r.height > window.innerHeight - pad) top = Math.max(pad, y - r.height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';

  document.addEventListener('pointerdown', onCtxOutside, true);
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);
  document.addEventListener('scroll', closeCtx, true);
  document.addEventListener('keydown', onCtxKey, true);
}

/** 右键卡片：找到当前卡片对象 */
function cardMenuItems(card) {
  return [
    { label: '编辑', icon: 'i-edit', run: () => openCardModal(card) },
    { label: '新标签页打开', icon: 'i-external', run: () => window.open(card.url, '_blank', 'noopener') },
    {
      label: '复制地址',
      icon: 'i-import',
      run: async () => toast((await copyText(card.url)) ? '地址已复制' : '复制失败', false),
    },
    { sep: true },
    { label: '移动到…', icon: 'i-move', run: () => pickGroup(card, 'move') },
    { label: '复制到…', icon: 'i-copy', run: () => pickGroup(card, 'copy') },
    { sep: true },
    {
      label: '删除',
      icon: 'i-trash',
      danger: true,
      run: async () => {
        if (!confirm(`删除「${card.name}」？`)) return;
        await api(`/api/cards/${card.id}`, { method: 'DELETE' });
        state.cards = state.cards.filter((c) => c.id !== card.id);
        renderBoards();
        toast('已删除');
      },
    },
  ];
}

/* ---- 分组操作 ---- */

async function saveGroups(next) {
  state.settings.groups = next;
  renderBoards();
  try {
    await api('/api/settings', { method: 'PATCH', body: { groups: next } });
  } catch {
    toast('分组没保存上', true);
  }
}

async function createGroup() {
  const name = prompt('新分组名称（最多 16 字）');
  const label = String(name || '').trim().slice(0, 16);
  if (!label) return;
  if (groupsOf().some((g) => g.label === label)) {
    toast('已经有同名分组了', true);
    return;
  }
  // key 用时间戳，和内置的 service/bookmark 不会撞
  const key = `g${Date.now().toString(36)}`;
  await saveGroups([...groupsOf(), { key, label }]);
  toast(`已新建「${label}」`);
}

async function renameGroup(key) {
  const g = groupDef(key);
  const name = prompt('重命名分组', g.label);
  const label = String(name || '').trim().slice(0, 16);
  if (!label || label === g.label) return;
  await saveGroups(groupsOf().map((x) => (x.key === key ? { ...x, label } : x)));
  toast('已重命名');
}

async function removeGroup(key) {
  const all = groupsOf();
  if (all.length <= 1) {
    toast('至少得留一个分组', true);
    return;
  }
  const g = groupDef(key);
  const inside = state.cards.filter((c) => groupOf(c) === key);
  const target = all.find((x) => x.key !== key);
  const msg = inside.length
    ? `删除「${g.label}」？里面的 ${inside.length} 张卡片会挪到「${target.label}」`
    : `删除空分组「${g.label}」？`;
  if (!confirm(msg)) return;

  // 先把卡片挪走，再删分组 —— 否则那些卡片的 group 会指向不存在的键
  for (const c of inside) {
    try {
      await api(`/api/cards/${c.id}`, { method: 'PATCH', body: { group: target.key } });
      c.group = target.key;
    } catch {
      /* 单张失败就跳过，别把整个流程卡死 */
    }
  }
  await saveGroups(all.filter((x) => x.key !== key));
  toast('分组已删除');
}

/** 右键卡片 → 选择目标分组（移动到 / 复制到共用） */
function pickGroup(card, mode) {
  const cur = groupOf(card);
  const others = groupsOf().filter((g) => g.key !== cur);
  if (!others.length) {
    toast('只有一个分组，先新建一个再移动', true);
    return;
  }
  const items = others.map((g) => ({
    label: g.label,
    run: () =>
      mode === 'move' ? moveCardTo(card, g) : copyCardTo(card, g),
  }));
  items.push({ sep: true }, { label: '新建分组…', icon: 'i-plus', run: () => createGroup() });
  openCtx(ctxLastPos.x, ctxLastPos.y, items, { title: mode === 'move' ? '移动到' : '复制到' });
}

async function moveCardTo(card, g) {
  await api(`/api/cards/${card.id}`, { method: 'PATCH', body: { group: g.key } });
  const c = state.cards.find((x) => x.id === card.id);
  if (c) c.group = g.key;
  renderBoards();
  toast(`已移到「${g.label}」`);
}

async function copyCardTo(card, g) {
  const r = await api(`/api/cards/${card.id}/duplicate`, { method: 'POST', body: { group: g.key } });
  if (r.card) state.cards.push(r.card);
  renderBoards();
  toast(`已复制到「${g.label}」`);
}

/** 分组标题上的右键菜单 */
const groupMenuItems = (key) => [
  { label: '重命名分组', icon: 'i-edit', run: () => renameGroup(key) },
  { label: '新建分组…', icon: 'i-plus', run: () => createGroup() },
  { sep: true },
  { label: '删除分组', icon: 'i-trash', danger: true, run: () => removeGroup(key) },
];

const blankMenuItems = () => [
  { label: '添加服务卡片', icon: 'i-plus', run: () => openCardModal(null, 'service') },
  { label: '添加书签', icon: 'i-plus', run: () => openCardModal(null, 'bookmark') },
  { label: '新建分组…', icon: 'i-plus', run: () => createGroup() },
  { sep: true },
  { label: '扫描服务', icon: 'i-scan', run: () => $('#scanBtn').click() },
  { label: '导入书签', icon: 'i-import', run: () => $('#importBtn').click() },
  { sep: true },
  { label: '设置', icon: 'i-settings', run: () => openSettings() },
  { label: '刷新页面', icon: 'i-refresh', run: () => location.reload() },
];

const nativeMenuAllowed = (t) => {
  if (!t || t.nodeType !== 1) return false;
  if (t.closest('input, textarea, select, [contenteditable="true"], [data-native-menu]')) return true;
  return false;
};

document.addEventListener('contextmenu', (e) => {
  // 输入框里保留浏览器原生菜单（复制/粘贴/拼写检查都在那儿）
  if (nativeMenuAllowed(e.target)) return;
  e.preventDefault();

  const cardNode = e.target.closest?.('.card[data-id]');
  if (cardNode) {
    const card = state.cards.find((c) => c.id === cardNode.dataset.id);
    if (card) {
      openCtx(e.clientX, e.clientY, cardMenuItems(card), { title: card.name });
      return;
    }
  }
  openCtx(e.clientX, e.clientY, blankMenuItems());
});

// 键盘用户：Shift+F10 或菜单键，效果等同在焦点处右键
document.addEventListener('keydown', (e) => {
  if (!(e.shiftKey && e.key === 'F10') && e.key !== 'ContextMenu') return;
  const focused = document.activeElement;
  const card = focused?.closest?.('.card[data-id]');
  const r = (card || focused || document.body).getBoundingClientRect?.() || { left: 40, top: 40, width: 0, height: 0 };
  e.preventDefault();
  if (card) {
    const obj = state.cards.find((c) => c.id === card.dataset.id);
    if (obj) return openCtx(r.left + 12, r.top + 12, cardMenuItems(obj), { title: obj.name });
  }
  openCtx(r.left + 12, r.top + 12, blankMenuItems());
});

/* ---------------- 顶部 chip 的弹出面板 ---------------- */
/*
 * 点天气看未来几天、点日期看日历、点时间开计时器。
 * 三块共用同一个 popover 容器，锚在各自 chip 下方（右侧对齐，贴边会翻到上方）。
 * 改城市/时区仍然走设置，面板底部留了入口。
 */
let popFor = null; // 当前弹出的是哪个 chip

function closePop() {
  const pop = $('#popover');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  popFor = null;
  document.removeEventListener('pointerdown', onPopOutside, true);
  document.removeEventListener('keydown', onPopKey, true);
  window.removeEventListener('resize', closePop);
}
const onPopOutside = (e) => {
  const pop = $('#popover');
  if (pop && !pop.contains(e.target) && !e.target.closest?.('.wx-chip, .clock-chip, .date-chip')) closePop();
};
const onPopKey = (e) => {
  if (e.key === 'Escape') closePop();
};

function openPop(anchor, kind, build) {
  const pop = $('#popover');
  const body = $('#popBody');
  if (!pop || !body) return;
  // 再点同一个 chip = 收起
  if (popFor === kind && !pop.hidden) {
    closePop();
    return;
  }
  body.innerHTML = '';
  build(body);
  pop.hidden = false;
  popFor = kind;

  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.right - pr.width; // 右对齐：chip 在右侧，往左展开更自然
  let top = r.bottom + 10;
  if (left < 8) left = 8;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 10);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  document.addEventListener('pointerdown', onPopOutside, true);
  document.addEventListener('keydown', onPopKey, true);
  window.addEventListener('resize', closePop);
}

/* ---- 天气详情 ---- */
function popWeather(anchor) {
  openPop(anchor, 'weather', (body) => {
    if (!wxData) {
      body.innerHTML = '<div class="pop-empty">天气还没取到，稍等一下再点</div>';
      return;
    }
    const d = wxData;
    const fc = Array.isArray(d.forecast) ? d.forecast : [];
    const weekOf = (iso, i) => {
      if (i === 0) return '今天';
      if (i === 1) return '明天';
      try {
        return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'Asia/Shanghai' }).format(
          new Date(`${iso}T12:00:00`),
        );
      } catch {
        return iso.slice(5);
      }
    };
    body.innerHTML = `
      <div class="pop-head">
        <span class="pop-title">${escHtml(d.city)}</span>
        <span class="pop-sub">${escHtml(d.region || '')}</span>
      </div>
      <div class="wx-now">
        <span class="wx-big">${d.temp}°</span>
        <span class="wx-ico">${d.icon || ''}</span>
        <span class="wx-desc">${escHtml(d.text || '')}</span>
      </div>
      <div class="wx-meta">体感 ${d.feels}° · 湿度 ${d.humidity}%${d.stale ? ' · 离线缓存' : ''}</div>
      ${
        fc.length
          ? `<div class="wx-list">${fc
              .map(
                (x, i) => `<div class="wx-row${i === 0 ? ' on' : ''}">
                  <span class="wx-day">${weekOf(x.date, i)}</span>
                  <span class="wx-t">${x.icon || ''}</span>
                  <span class="wx-txt">${escHtml(x.text)}</span>
                  <span class="wx-range"><b>${x.max}°</b> / ${x.min}°</span>
                </div>`,
              )
              .join('')}</div>`
          : ''
      }
      <button class="pop-link" type="button">换个城市</button>`;
    body.querySelector('.pop-link').addEventListener('click', () => {
      closePop();
      openSettings();
      $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === 'theme'));
      $$('.tab-panel').forEach((p) => (p.hidden = p.dataset.panel !== 'theme'));
      setTimeout(() => $('#sWxCity')?.focus(), 120);
    });
  });
}

/* ---- 日历 ---- */
function popCalendar(anchor) {
  const tz = state.settings.clock?.timezone || 'Asia/Shanghai';
  // 以目标时区的「今天」为基准，不然跨时区会差一天
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).format(new Date());
  const [tYear, tMonth, tDay] = nowParts.split('-').map(Number);
  let viewY = tYear;
  let viewM = tMonth - 1; // 0-based

  openPop(anchor, 'calendar', (body) => {
    const draw = () => {
      // 当月 1 号是周几（0=周日），转成「周一为第一列」
      const first = new Date(viewY, viewM, 1);
      const lead = (first.getDay() + 6) % 7;
      const days = new Date(viewY, viewM + 1, 0).getDate();
      const isThisMonth = viewY === tYear && viewM === tMonth - 1;
      const cells = [];
      for (let i = 0; i < lead; i++) cells.push('<span class="cal-d pad"></span>');
      for (let d = 1; d <= days; d++) {
        const today = isThisMonth && d === tDay;
        const date = new Date(viewY, viewM, d);
        // 农历：下面那行小字；有节日就显示节日名，没有才显示初几
        const lu = window.LunarUtil?.lunarOf(date);
        const fest = window.LunarUtil?.festivalOf(date);
        const sub = fest ? fest.name : lu ? lu.text : '';
        const cls = `cal-d${today ? ' today' : ''}${fest ? (fest.legal ? ' legal' : ' fest') : ''}`;
        const tip = [fest?.name, lu ? `${lu.monthText}${lu.text}` : ''].filter(Boolean).join(' · ');
        cells.push(
          `<span class="${cls}"${tip ? ` title="${escHtml(tip)}"` : ''}><b>${d}</b><i>${escHtml(sub)}</i></span>`,
        );
      }
      body.innerHTML = `
        <div class="cal-head">
          <button class="cal-nav" data-m="-1" type="button" title="上个月">‹</button>
          <span class="cal-title">${viewY} 年 ${viewM + 1} 月</span>
          <button class="cal-nav" data-m="1" type="button" title="下个月">›</button>
        </div>
        <div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
        <div class="cal-grid">${cells.join('')}</div>
        <div class="cal-legend"><span class="lg-legal">法定假日</span><span class="lg-fest">节日</span></div>
        <button class="pop-link" type="button">今天</button>`;
      for (const b of body.querySelectorAll('.cal-nav')) {
        b.addEventListener('click', () => {
          viewM += Number(b.dataset.m);
          if (viewM < 0) {
            viewM = 11;
            viewY--;
          } else if (viewM > 11) {
            viewM = 0;
            viewY++;
          }
          draw();
        });
      }
      body.querySelector('.pop-link').addEventListener('click', () => {
        viewY = tYear;
        viewM = tMonth - 1;
        draw();
      });
    };
    draw();
  });
}

/* ---- 计时器 ---- */
const timer = { endAt: 0, iv: 0, mins: 0 };

/** 用 Web Audio 合成三声提示音，不依赖任何音频文件 */
function playAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    ctx.resume?.();
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      const at = t0 + i * 0.42;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.36);
    }
    setTimeout(() => ctx.close?.(), 2000);
    return true;
  } catch {
    return false;
  }
}

const fmtLeft = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

function stopTimer() {
  if (timer.iv) clearInterval(timer.iv);
  timer.iv = 0;
  timer.endAt = 0;
  timer.mins = 0;
}

function startTimer(mins) {
  stopTimer();
  timer.mins = mins;
  timer.endAt = Date.now() + mins * 60000;
  timer.iv = setInterval(() => {
    const left = timer.endAt - Date.now();
    if (left <= 0) {
      stopTimer();
      playAlarm();
      toast(`${mins} 分钟到了`);
      const disp = document.querySelector('#popBody .tm-display');
      if (disp && !$('#popover')?.hidden) {
        disp.textContent = '时间到';
        disp.classList.add('done');
      } else {
        closePop();
      }
      return;
    }
    const disp = document.querySelector('#popBody .tm-display');
    if (disp && !$('#popover')?.hidden) disp.textContent = fmtLeft(left);
  }, 250);
}

function popTimer(anchor) {
  openPop(anchor, 'timer', (body) => {
    const running = timer.iv > 0;
    body.innerHTML = `
      <div class="tm-display${running ? '' : ' idle'}">${running ? fmtLeft(timer.endAt - Date.now()) : '计时器'}</div>
      <div class="tm-presets">
        ${[5, 10, 15, 30, 60].map((m) => `<button type="button" data-min="${m}">${m} 分</button>`).join('')}
      </div>
      <div class="tm-custom">
        <input type="number" min="1" max="600" placeholder="分钟" inputmode="numeric">
        <button type="button" class="tm-go">开始</button>
      </div>
      <button type="button" class="tm-try">试听提示音</button>
      ${running ? '<button type="button" class="pop-link danger tm-stop">取消计时</button>' : ''}`;

    const begin = (m) => {
      if (!Number.isFinite(m) || m <= 0) return toast('先填个分钟数', true);
      startTimer(Math.min(600, Math.round(m)));
      closePop();
      toast(`已开始 ${Math.min(600, Math.round(m))} 分钟计时`);
    };
    for (const b of body.querySelectorAll('.tm-presets button')) {
      b.addEventListener('click', () => begin(Number(b.dataset.min)));
    }
    body.querySelector('.tm-go').addEventListener('click', () => {
      begin(Number(body.querySelector('.tm-custom input').value));
    });
    body.querySelector('.tm-custom input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') begin(Number(e.target.value));
    });
    body.querySelector('.tm-try').addEventListener('click', () => {
      if (!playAlarm()) toast('这个浏览器不支持播放提示音', true);
    });
    body.querySelector('.tm-stop')?.addEventListener('click', () => {
      stopTimer();
      closePop();
      toast('计时已取消');
    });
  });
}

$('#wxChip')?.addEventListener('click', () => popWeather($('#wxChip')));
$('#dateChip')?.addEventListener('click', () => popCalendar($('#dateChip')));
$('#clockChip')?.addEventListener('click', () => popTimer($('#clockChip')));
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
  /*
   * 首页 head 里那段内联脚本已经把 /api/state 提前发出去了，
   * 这里复用同一个 promise —— 请求和「解析 HTML + 下载 app.js」并行跑，
   * 不用等模块执行完才发第一个请求。
   * 拿不到（401、断网、被扩展拦掉）就老老实实按老路子重发一次，行为和以前一致。
   */
  const prewarmed = window.__fnstate;
  window.__fnstate = null;
  try {
    const st = (prewarmed && (await prewarmed)) || (await api('/api/state'));
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













