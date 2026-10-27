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

/**
 * 判重键。
 *
 * 本机服务用「端口」判重，而不是整条 URL：同一个服务用 192.168.x.x 打开、
 * 用 127.0.0.1 打开、换了域名打开，端口都是同一个，必须算同一个卡片，
 * 否则每换一种访问方式自动采集就会多出一整套重复卡片。
 * 外部书签没有本地端口概念，仍按规范化 URL 判重。
 */
const cardKey = (c) =>
  c.group === 'bookmark' || c.source === 'bookmark' || !c.port
    ? `url:${normalizeUrl(c.url)}`
    : `port:${c.port}`;

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
  const existing = new Set(s.cards.map((c) => cardKey(c)));
  const added = [];
  for (const raw of cards) {
    const card = normalizeCard(raw);
    if (!card.url) continue;
    const key = cardKey(card);
    const dup = s.cards.find((c) => cardKey(c) === key);
    if (dup) {
      // 已存在：仅在用户没自定义过的情况下补齐缺失字段
      if (!dup.icon && card.icon) dup.icon = card.icon;
      if (!dup.color && card.color) dup.color = card.color;
      if (!dup.container && card.container) dup.container = card.container;
      if (!dup.desc && card.desc) dup.desc = card.desc;
      if (!dup.port && card.port) dup.port = card.port;
      if ((!dup.name || dup.name === dup.container) && card.name && !dup.custom.name) dup.name = card.name;
      continue;
    }
    if (existing.has(key)) continue;
    existing.add(key);
    s.cards.push(card);
    added.push(card);
  }
  if (opts.moveToFront) {
    const ids = new Set(added.map((c) => c.id));
    s.cards = [...added, ...s.cards.filter((c) => !ids.has(c.id))];
  }
  await save();
  return added;
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
