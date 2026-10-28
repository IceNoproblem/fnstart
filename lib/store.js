import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG, DATA_FILE, ICON_DIR, BG_DIR } from './config.js';

export const uid = (n = 10) =>
  crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);

const DEFAULT_SETTINGS = () => ({
  siteTitle: '控制台',
  subtitle: '',
  searchEngine: 'bing',
  theme: 'dark',
  background: {
    type: 'aurora', // aurora | color | image
    color: '#0a0d18',
    image: '',
    blur: 0,
    dim: 0.15,
    grain: true,
  },
  layout: {
    columns: 0, // 0 = 自动
    gap: 14,
  },
  // 界面字号倍率：1 标准 / 1.12 大 / 1.25 更大 / 1.4 特大
  ui: {
    scale: 1,
  },
  // 功耗估算用的硬件参数：RAPL 只测得到 CPU 和内存，其余按这两个值折算
  power: {
    // 填了 TDP 就按「TDP × CPU 占用率」估算 CPU 功耗；
    // 留 0 则用 RAPL 的实测值（更准，但只有 Intel/AMD zen2+ 才有）。
    tdpW: 0,
    baseW: 8, // 主板 + 网卡 + 风扇等固定开销
    diskW: 8, // 单块硬盘的典型功耗（机械盘约 8W，全闪可调到 4~5）
  },
  monitor: {
    enabled: true,
    collapsed: false,
    url: CONFIG.monitorUrl, // 留空 = 自动跟随访问主机名
    mode: 'native', // native | direct | proxy
    showStats: true,
  },
  weather: { enabled: true, city: CONFIG.weatherCity },
  clock: { enabled: true, timezone: 'Asia/Shanghai', seconds: false },
});

const emptyState = () => ({
  version: 1,
  settings: DEFAULT_SETTINGS(),
  cards: [],
  meta: { createdAt: Date.now(), lastDiscovery: 0, lastDiscoveryCount: 0 },
});

let cache = null;
let writeChain = Promise.resolve();

const deepMerge = (base, patch) => {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch)) return patch;
  if (typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v;
  }
  return out;
};

export async function ensureDirs() {
  await fs.mkdir(CONFIG.dataDir, { recursive: true });
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.mkdir(BG_DIR, { recursive: true });
}

/** 分组：容器/服务 与 收藏书签，页面上用虚线分开 */
export const groupOf = (card) => card.group || (card.source === 'bookmark' ? 'bookmark' : 'service');

const normalizeCard = (c) => ({
  id: c.id || uid(),
  name: String(c.name || '未命名').slice(0, 60),
  url: String(c.url || '').trim(),
  icon: c.icon || '',
  color: c.color || '',
  desc: c.desc || '',
  source: c.source || 'manual',
  container: c.container || '',
  group: c.group || (c.source === 'bookmark' ? 'bookmark' : 'service'),
  port: Number(c.port) || 0,
  custom: c.custom || {},
  hidden: !!c.hidden,
  createdAt: c.createdAt || Date.now(),
});

/*
 * 判重的规矩（写在 addCards 里实现，这里留说明）：
 *
 * 本机服务优先用「端口」判重，而不是整条 URL —— 同一个服务用 192.168.x.x 打开、
 * 用 127.0.0.1 打开、换了域名打开，端口都是同一个，必须算同一张卡片。
 * 再用「规范化 URL」兜底：万一某条采集路径把 port 弄丢了，也不会重新长出一张。
 * 外部书签没有本地端口概念，只按 URL 判重。
 *
 * 旧实现是单键（有 port 用 port，没有用 url），这正是「同一个服务两张卡」的成因：
 * port=0 的卡键是 url:...，带端口的卡键是 port:8002，两者互不认账。
 */

export async function load() {
  if (cache) return cache;
  await ensureDirs();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const base = emptyState();
    cache = {
      ...base,
      ...parsed,
      settings: deepMerge(base.settings, parsed.settings || {}),
      cards: Array.isArray(parsed.cards) ? parsed.cards.map(normalizeCard) : [],
      meta: { ...base.meta, ...(parsed.meta || {}) },
    };
  } catch {
    cache = emptyState();
    await save();
  }
  return cache;
}

export function getState() {
  return cache;
}

export async function save() {
  writeChain = writeChain.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await ensureDirs();
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmp, DATA_FILE);
  });
  return writeChain;
}

export async function patchSettings(patch) {
  const s = await load();
  s.settings = deepMerge(s.settings, patch);
  await save();
  return s.settings;
}

export async function addCards(cards, opts = {}) {
  const s = await load();
  const portIndex = new Map(); // port → 卡片
  const urlIndex = new Map(); // 规范化 URL → 卡片
  for (const c of s.cards) {
    if (c.port) portIndex.set(c.port, c);
    const uk = normalizeUrl(c.url);
    if (!urlIndex.has(uk)) urlIndex.set(uk, c);
  }

  const added = [];
  for (const raw of cards) {
    const card = normalizeCard(raw);
    if (!card.url) continue;
    const uk = normalizeUrl(card.url);
    const isBookmark = card.group === 'bookmark' || card.source === 'bookmark';
    /*
     * 双键匹配：书签只看 URL；服务卡片「端口优先、URL 兜底」。
     *
     * 单键判重会漏：历史上首屏自动采集漏传了 port，写出的卡键是 `url:...`，
     * 而手动扫描写出的卡键是 `port:8002`，两者互不认账 —— 同一个服务出现两张卡。
     * 现在即便某条路径又把 port 弄丢，URL 兜底也能认出来，并把端口补回去。
     */
    const dup = isBookmark
      ? urlIndex.get(uk)
      : (card.port ? portIndex.get(card.port) : null) || urlIndex.get(uk);

    if (dup) {
      // 已存在：仅在用户没自定义过的情况下补齐缺失字段
      if (!dup.icon && card.icon) dup.icon = card.icon;
      if (!dup.color && card.color) dup.color = card.color;
      if (!dup.container && card.container) dup.container = card.container;
      if (!dup.desc && card.desc) dup.desc = card.desc;
      if (!dup.port && card.port) {
        dup.port = card.port;
        portIndex.set(card.port, dup); // 补上端口后就归 port 键管，后续扫描不再新增
      }
      if ((!dup.name || dup.name === dup.container) && card.name && !dup.custom.name) dup.name = card.name;
      continue;
    }

    s.cards.push(card);
    added.push(card);
    if (card.port) portIndex.set(card.port, card);
    if (!urlIndex.has(uk)) urlIndex.set(uk, card);
  }
  if (opts.moveToFront) {
    const ids = new Set(added.map((c) => c.id));
    s.cards = [...added, ...s.cards.filter((c) => !ids.has(c.id))];
  }
  await save();
  return added;
}

/** 信息完整度打分：有端口 > 有容器名 > 有图标 */
const cardScore = (c) => (c.port ? 4 : 0) + (c.container ? 2 : 0) + (c.icon ? 1 : 0);

/**
 * 清理历史脏数据：同一 URL 的服务卡片只留一张。
 *
 * 不删用户动过的卡（custom 非空就跳过），只收拾自动采集产生的重复。
 * 返回删掉的张数。
 */
export async function dedupeServiceCards() {
  const s = await load();
  const keep = new Map(); // 规范化 URL → 保留的那张
  const drop = [];
  for (const c of s.cards) {
    if (c.group === 'bookmark' || c.source === 'bookmark') continue;
    const uk = normalizeUrl(c.url);
    const prev = keep.get(uk);
    if (!prev) {
      keep.set(uk, c);
      continue;
    }
    const loser = cardScore(c) > cardScore(prev) ? prev : c;
    const winner = loser === prev ? c : prev;
    // 用户手动改过的那张不动
    if (Object.keys(loser.custom || {}).length || loser.custom?.name) {
      keep.set(uk, winner);
      continue;
    }
    drop.push(loser);
    keep.set(uk, winner);
  }
  if (!drop.length) return 0;
  const ids = new Set(drop.map((c) => c.id));
  s.cards = s.cards.filter((c) => !ids.has(c.id));
  await save();
  return drop.length;
}

export async function updateCard(id, patch) {
  const s = await load();
  const card = s.cards.find((c) => c.id === id);
  if (!card) return null;
  const touch = ['name', 'url', 'icon', 'color', 'desc'];
  for (const [k, v] of Object.entries(patch)) {
    if (touch.includes(k)) {
      if (card[k] !== v) card.custom = { ...card.custom, [k]: true };
      card[k] = v;
    } else if (k === 'group') {
      card.group = v === 'bookmark' ? 'bookmark' : 'service';
    } else if (k === 'hidden') {
      card.hidden = !!v;
    }
  }
  await save();
  return card;
}

export async function removeCard(id) {
  const s = await load();
  const i = s.cards.findIndex((c) => c.id === id);
  if (i < 0) return false;
  s.cards.splice(i, 1);
  await save();
  return true;
}

/**
 * 重排卡片，同时可调整分组（拖到另一个分组就换组）
 * @param items ['id', ...] 或 [{ id, group }, ...]
 */
export async function reorder(items) {
  const s = await load();
  const map = new Map(s.cards.map((c) => [c.id, c]));
  const next = [];
  for (const it of items) {
    const id = typeof it === 'string' ? it : it.id;
    const c = map.get(id);
    if (!c) continue;
    if (it && typeof it === 'object' && it.group) {
      c.group = it.group === 'bookmark' ? 'bookmark' : 'service';
    }
    next.push(c);
    map.delete(id);
  }
  for (const c of map.values()) next.push(c);
  s.cards = next;
  await save();
  return s.cards;
}

export function normalizeUrl(u = '') {
  return String(u)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/^www\./, '');
}

export async function findCardByUrl(url) {
  const s = await load();
  const key = normalizeUrl(url);
  return s.cards.find((c) => normalizeUrl(c.url) === key) || null;
}

export { DEFAULT_SETTINGS };
