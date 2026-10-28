import fs from 'node:fs/promises';
import path from 'node:path';

/*
 * 媒体库统计
 *
 * 不调飞牛影视的接口 —— 那套要登录态，还会因为索引没刷新而数字滞后。
 * 直接走文件系统：数得准、不依赖任何服务、断了也能算。
 * 代价是要遍历目录，所以结果缓存 5 分钟，且限制最多扫 5 万个文件兜底。
 */

const VIDEO = new Set(['.mp4', '.mkv', '.avi', '.ts', '.mov', '.wmv', '.flv', '.m4v', '.rmvb', '.webm', '.mpg']);
const AUDIO = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.ape', '.wma']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.tif', '.tiff']);

/**
 * 媒体库根目录自动探测。
 *
 * 优先级：MEDIA_ROOT 环境变量 > 下面这些候选路径（按顺序试第一个存在的）。
 * 容器里 /vol1 挂载在 /host/vol1，裸机直接是 /vol1 —— 两种都试。
 * 目录名覆盖几种常见叫法，其余情况请用 MEDIA_ROOT 显式指定。
 */
const CANDIDATES = [
  '/host/vol1/1000/NAS/媒体库',
  '/vol1/1000/NAS/媒体库',
  '/host/vol1/1000/NAS/Media',
  '/vol1/1000/NAS/Media',
  '/host/vol1/1000/NAS/media',
  '/vol1/1000/NAS/media',
];

export async function resolveMediaRoot(explicit) {
  const list = explicit ? [explicit, ...CANDIDATES] : CANDIDATES;
  for (const p of list) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) return p;
    } catch {
      /* 试下一个 */
    }
  }
  return explicit || CANDIDATES[0];
}

const MAX_FILES = 50000; // 兜底：真遇到几十万文件的库也不至于把机器拖死

/*
 * 统计时跳过的目录（按目录名，任意层级匹配）。
 * 学习资料不算「媒体库」的片子；下载池里是还没整理完的原始文件，
 * 混进来会让「最近入库」变成一堆临时文件，也容易暴露不该露的片名。
 * 要改的话用环境变量 MEDIA_EXCLUDE="/学习,/常规下载" 覆盖。
 */
const DEFAULT_EXCLUDE = ['学习', '常规下载', '刷流下载'];
const EXCLUDE = new Set(
  (process.env.MEDIA_EXCLUDE || DEFAULT_EXCLUDE.join(','))
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
);
const TTL = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;
let running = null;

const kindOf = (ext) => (VIDEO.has(ext) ? 'video' : AUDIO.has(ext) ? 'audio' : IMAGE.has(ext) ? 'image' : null);

/** 递归收集，遇到上限就停 */
async function walk(dir, acc, budget) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.length >= budget) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // 跳过隐藏目录、回收站，以及「学习 / 下载池」这类不该算进来的目录
      if (
        e.name.startsWith('.') ||
        e.name === '@eaDir' ||
        e.name === '#recycle' ||
        EXCLUDE.has(e.name)
      ) {
        continue;
      }
      await walk(full, acc, budget);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    const kind = kindOf(ext);
    if (!kind) continue;
    try {
      const st = await fs.stat(full);
      acc.push({ path: full, name: e.name, kind, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* 单个文件读不到就跳过 */
    }
  }
}

const fmtAgo = (ms) => {
  const d = Date.now() - ms;
  const min = Math.floor(d / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} 天前`;
  return `${Math.floor(day / 30)} 个月前`;
};

async function scan(root, recentCount) {
  const files = [];
  await walk(root, files, MAX_FILES);

  const byKind = { video: 0, audio: 0, image: 0 };
  const byDir = new Map();
  let bytes = 0;

  for (const f of files) {
    byKind[f.kind]++;
    bytes += f.size;
    // 顶层子目录当分类：电影 / 电视剧 / 学习 …
    const rel = path.relative(root, f.path);
    const cat = rel.includes(path.sep) ? rel.split(path.sep)[0] : '根目录';
    const cur = byDir.get(cat) || { name: cat, count: 0, bytes: 0, video: 0 };
    cur.count++;
    cur.bytes += f.size;
    if (f.kind === 'video') cur.video++;
    byDir.set(cat, cur);
  }

  // 最近入库：只挑视频和音频，图片一天几十张没意义
  const recent = files
    .filter((f) => f.kind !== 'image')
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, recentCount)
    .map((f) => ({
      name: f.name,
      kind: f.kind,
      sizeMB: Math.round(f.size / 1048576),
      at: f.mtime,
      ago: fmtAgo(f.mtime),
      cat: path.relative(root, f.path).split(path.sep)[0] || '',
    }));

  const cats = [...byDir.values()].sort((a, b) => b.count - a.count);

  return {
    root,
    total: files.length,
    truncated: files.length >= MAX_FILES,
    byKind,
    bytes,
    gb: Math.round((bytes / 1073741824) * 10) / 10,
    cats,
    recent,
    at: Date.now(),
  };
}

/**
 * 取媒体库统计。缓存 5 分钟；同一时间只跑一次扫描（并发请求共享）。
 */
export async function mediaStats(root, { recentCount = 6, force = false } = {}) {
  if (!root) return { ok: false, error: '未配置媒体库路径' };
  if (!force && cache && cache.root === root && Date.now() - cachedAt < TTL) return cache;
  if (running) return running;

  running = (async () => {
    try {
      await fs.access(root);
    } catch {
      running = null;
      return { ok: false, error: `读不到 ${root}` };
    }
    try {
      const data = await scan(root, recentCount);
      cache = data;
      cachedAt = Date.now();
      running = null;
      return data;
    } catch (e) {
      running = null;
      return { ok: false, error: e.message || '统计失败' };
    }
  })();

  return running;
}

export function clearMediaCache() {
  cache = null;
  cachedAt = 0;
}
