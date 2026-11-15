import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { CONFIG } from './config.js';
import { resolveMediaRoot } from './media.js';

/**
 * 下载引擎：在服务端替用户把视频/音频抓回 NAS。
 *
 * 为什么不用 Downie 那套：Downie 是 macOS 原生闭源引擎，跑在 Linux 容器里没有等价物。
 * 这里用 yt-dlp（Python）+ ffmpeg 做引擎，站点覆盖、格式/字幕/播放列表/元数据都齐全。
 *
 * 头号风险是 SSRF：服务端替用户去抓任意 URL，等于开放了一个「内网探测器」。
 * 所以提交时先做 DNS 解析 + 私网/保留地址阻断（思路复用 CONFIG.blockPrivateFetch）。
 * 残余风险：yt-dlp 会跟随重定向，重定向到内网这一步没法在提交时拦，属于已知边界，页面有提示。
 */

const STATE_FILE = path.join(CONFIG.dataDir, 'downloads.json');
const MAX_CONCURRENT = CONFIG.downloadMaxConcurrent || 2;
const MAX_LOG = 4096;

let cache = null;
let writeChain = Promise.resolve();
const running = new Map(); // id -> child process
const tickTimers = new Map(); // id -> 进度采样定时器
let engineCache = null; // { ytdlp, ffmpeg, checkedAt }

const uid = (n = 12) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, '').slice(0, n);

/* ---------------- 私网 / 保留地址判断 ---------------- */

function isPrivateV4(ip) {
  if (!ip) return true;
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return true;
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  if (p[0] === 10) return true;
  if (p[0] === 127) return true;
  if (p[0] === 169 && p[1] === 254) return true; // 链路本地，含云元数据 169.254.169.254
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
  return false;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.toLowerCase();
  if (v === '::1') return true;
  if (v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return true; // 链路本地 / ULA
  if (v.startsWith('::ffff:')) return isPrivateV4(v.slice(7)); // IPv4-mapped
  if (v.includes(':')) return false; // 其它全局 IPv6 当公网处理（无法可靠分类）
  return isPrivateV4(v);
}

/**
 * SSRF 守卫：合法 http(s) + 域名能解析且没有任何解析结果落在私网/保留段。
 * @returns {Promise<{ok:boolean, error?:string, url?:URL}>}
 */
export async function ssrfSafe(urlStr) {
  let u;
  try {
    u = new URL(urlStr.trim());
  } catch {
    return { ok: false, error: 'URL 不合法' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: '只支持 http/https 链接' };
  }
  const host = u.hostname;
  // 字面量 IP 直接判
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) return { ok: false, error: '不能下载内网或保留地址' };
  }
  // 域名：解析后逐个地址判，只要有一个落私网就拦
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length) return { ok: false, error: '域名解析不到地址' };
    for (const a of addrs) {
      if (isPrivateIp(a.address)) return { ok: false, error: `解析到内网地址 ${a.address}` };
    }
  } catch (e) {
    return { ok: false, error: `域名解析失败：${e.code || e.message}` };
  }
  return { ok: true, url: u };
}

/* ---------------- 引擎检测 ---------------- */

function resolveYtDlpBin() {
  // 环境变量优先；默认 yt-dlp；再退回 python3 -m yt_dlp
  const p = CONFIG.ytdlpPath || 'yt-dlp';
  if (p && p !== 'yt-dlp' && p !== 'python3 -m yt_dlp') return { cmd: p, prefix: [] };
  return { cmd: 'yt-dlp', prefix: [] };
}

async function probe(bin, args) {
  return new Promise((resolve) => {
    const c = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('error', () => resolve(false));
    c.on('close', (code) => resolve(code === 0 && out.length > 0));
  });
}

export async function engineStatus() {
  if (engineCache && Date.now() - engineCache.checkedAt < 60_000) return engineCache;
  const ytdlp = await probe('yt-dlp', ['--version']);
  const ffmpeg = await probe('ffmpeg', ['-version']);
  engineCache = { ytdlp, ffmpeg, checkedAt: Date.now() };
  return engineCache;
}

/* ---------------- 下载目录 ---------------- */

let downloadDirCache = '';
export async function getDownloadDir() {
  if (downloadDirCache) return downloadDirCache;
  // 候选顺序：网页自定义目录 → 环境变量 DOWNLOAD_DIR → 数据目录下的「下载」→ 系统临时目录。
  // 媒体库在容器里是只读挂载（/host/vol1 :ro），不能往里写；
  // 所以默认是可读写的 /data/下载，保证在哪都能落盘，不会把任务卡在 running。
  const s = await load();
  const candidates = [];
  if (s.downloadDir) candidates.push(s.downloadDir);            // 网页自定义的优先
  if (CONFIG.downloadDir) candidates.push(CONFIG.downloadDir);  // 环境变量
  candidates.push(path.join(CONFIG.dataDir, '下载'));
  candidates.push(path.join(os.tmpdir(), 'fnstart-downloads'));
  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true });
      downloadDirCache = dir;
      return dir;
    } catch (e) {
      console.warn(`[downloads] 下载目录不可写，跳过 ${dir} (${e.code || e.message})`);
    }
  }
  // 理论上到不了这里（临时目录一定可写），兜底用内存外唯一的可靠路径
  downloadDirCache = path.join(CONFIG.dataDir, '下载');
  return downloadDirCache;
}

/** 当前下载目录设置：用户自定义值（可能为空）+ 实际生效目录 + 剩余空间 */
export async function getDownloadDirSetting() {
  const s = await load();
  let free = 0;
  try {
    if (fss.statfsSync) {
      const st = fss.statfsSync(await getDownloadDir());
      free = st.bavail * st.bsize;
    }
  } catch { /* ignore */ }
  return { dir: s.downloadDir || '', effective: await getDownloadDir(), free };
}

/**
 * 网页自定义下载目录。校验绝对路径 + 真实可写（写个临时文件再删），持久化到 downloads.json。
 * 拒绝根目录 / /proc / /sys 这类危险或挂载点，避免把下载写进系统目录。
 */
export async function setDownloadDir(dir) {
  const raw = (dir || '').trim();
  if (!raw) return { ok: false, error: '请填写目录路径' };
  const resolved = path.resolve(raw);
  if (resolved === '/' || resolved.startsWith('/proc') || resolved.startsWith('/sys')) {
    return { ok: false, error: '该路径不允许用作下载目录' };
  }
  try {
    await fs.mkdir(resolved, { recursive: true });
    const probe = path.join(resolved, `.fnstart-write-test-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
  } catch (e) {
    return { ok: false, error: `目录不可写：${e.code || e.message}` };
  }
  const s = await load();
  s.downloadDir = resolved;
  await save();
  downloadDirCache = resolved;
  return { ok: true, dir: resolved };
}

/* ---------------- 持久化 ---------------- */

function emptyState() {
  return { version: 1, jobs: [] };
}

export async function load() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...emptyState(), ...parsed, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    cache = emptyState();
  }
  return cache;
}

function save() {
  writeChain = writeChain.then(async () => {
    const tmp = `${STATE_FILE}.tmp`;
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmp, STATE_FILE);
  });
  return writeChain;
}

/* ---------------- 剩余空间粗检 ---------------- */

async function freeSpaceOk(dir) {
  // 不足 500MB 就别下了，免得把 NAS 撑爆
  try {
    if (fss.statfsSync) {
      const s = fss.statfsSync(dir);
      const free = s.bavail * s.bsize;
      return free > 500 * 1024 * 1024;
    }
  } catch {
    /* 拿不到就放行 */
  }
  return true;
}

/* ---------------- 任务调度 ---------------- */

const MAX_LOGS = 60;
/** 追加一条阶段日志；kind 相同的「progress」类只更新最后一条，避免刷屏 */
function pushLog(job, kind, text) {
  if (!Array.isArray(job.logs)) job.logs = [];
  if (kind === 'progress' && job.logs.length && job.logs[job.logs.length - 1].kind === 'progress') {
    job.logs[job.logs.length - 1] = { kind, text, t: Date.now() };
  } else {
    job.logs.push({ kind, text, t: Date.now() });
  }
  if (job.logs.length > MAX_LOGS) job.logs.splice(0, job.logs.length - MAX_LOGS);
}

function sanitize(job) {
  const { _proc, ...rest } = job;
  return rest;
}

export function list() {
  const s = cache || emptyState();
  const jobs = [...s.jobs]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((j) => ({
      id: j.id,
      url: j.url,
      title: j.title || '',
      status: j.status,
      progress: j.progress || 0,
      speed: j.speed || '',
      eta: j.eta || '',
      size: j.size || '',
      format: j.format || 'best',
      audioOnly: !!j.audioOnly,
      subtitles: !!j.subtitles,
      playlist: !!j.playlist,
      error: j.error || '',
      file: j.status === 'done' ? j.file || '' : '',
      stage: j.stage || '',
      frag: j.frag || 0,
      fragTotal: j.fragTotal || 0,
      duration: j.duration || 0,
      logs: Array.isArray(j.logs) ? j.logs.slice(-50) : [],
      createdAt: j.createdAt,
      finishedAt: j.finishedAt || 0,
    }));
  return { jobs };
}

function schedule() {
  const s = cache;
  if (!s) return;
  const runningCount = [...running.keys()].length;
  if (runningCount >= MAX_CONCURRENT) return;
  const next = s.jobs.find((j) => j.status === 'queued');
  if (next) {
    // startJob 里任何意外（目录不可写、引擎崩）都不能让任务永远卡在 running
    startJob(next).catch(async (e) => {
      next.status = 'error';
      next.error = `启动失败：${e.message}`;
      next.finishedAt = Date.now();
      await save();
      schedule();
    });
  }
}

/* ---------------- 提交 ---------------- */

export async function submit({ url, format = 'best', audioOnly = false, subtitles = false, playlist = false }) {
  const s = await load();
  const check = await ssrfSafe(url);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const eng = await engineStatus();
  if (!eng.ytdlp) return { ok: false, error: '下载引擎未就绪：镜像里缺少 yt-dlp' };
  if (!eng.ffmpeg) return { ok: false, error: '下载引擎未就绪：镜像里缺少 ffmpeg' };

  const job = {
    id: uid(),
    url: check.url.href,
    title: '',
    status: 'queued',
    progress: 0,
    speed: '',
    eta: '',
    size: '',
    format: audioOnly ? 'audio' : format || 'best',
    audioOnly: !!audioOnly,
    subtitles: !!subtitles,
    playlist: !!playlist,
    error: '',
    file: '',
    log: '',
    createdAt: Date.now(),
    startedAt: 0,
    finishedAt: 0,
  };
  s.jobs.unshift(job);
  if (s.jobs.length > 200) s.jobs.length = 200; // 历史最多留 200 条
  await save();
  schedule();
  return { ok: true, job: sanitize(job) };
}

/* ---------------- 网页播放页解析 ---------------- */

// 有些影视站的播放页 yt-dlp 不认识，但页面里内嵌了 m3u8 直链。
// 这里在 yt-dlp 明确报「Unsupported URL」时才介入，抓页面提取直链再重试。
// B站等 yt-dlp 原生支持的站点不会走到这里，零额外开销。

/**
 * 把各种 JS/HTML 转义还原成正常字符串。
 * 播放页常把直链写成 \" \/ \u002F &#x2F; &amp; 等形式，必须先解码再匹配。
 */
function decodeHtmlEscapes(s) {
  return String(s || '')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\u0026/gi, '&')
    .replace(/&#x2f;/gi, '/')
    .replace(/&#47;/gi, '/')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\\\//g, '/');
}

/** 判断一个字符串是不是可下载的媒体直链（只认 m3u8/mp4，含查询串） */
function isMediaUrl(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  return /\.m3u8(\?|$)/i.test(url) || /\.mp4(\?|$)/i.test(url);
}

/**
 * 规范化一个候选直链：解码转义 → 处理协议相对/相对路径 → 校验媒体扩展名。
 * @param {string} raw 原始候选
 * @param {string} baseUrl 页面 URL，用于把 /path/x.m3u8 补全成绝对地址
 */
function normalizeMediaUrl(raw, baseUrl) {
  if (!raw) return '';
  let url = decodeHtmlEscapes(raw).trim();
  // 去掉 JS 字符串拼接残留，例如 'https://x.com/' + 'a.m3u8'
  url = url.replace(/^['"]\s*\+\s*/, '').replace(/\s*\+\s*['"]$/, '');
  if (/^\/\//.test(url)) url = 'https:' + url;
  else if (/^\//.test(url) && baseUrl) {
    try { url = new URL(url, baseUrl).href; } catch { /* 保留原值 */ }
  } else if (!/^https?:\/\//i.test(url) && baseUrl) {
    // 相对路径，如 uploads/2025/x.m3u8
    try { url = new URL(url, baseUrl).href; } catch { /* 保留原值 */ }
  }
  // 末尾若粘了引号/括号等噪声，裁到扩展名查询串结束
  url = url.replace(/["')\],;]+$/, '');
  return isMediaUrl(url) ? url : '';
}

/**
 * 从播放页 HTML 里提取可下载的 m3u8/mp4 直链和标题（纯函数，便于样本单测）。
 *
 * 覆盖市面主流播放页形态，按「越具体越优先」排列，命中即停：
 *  1. 西瓜 xgplayer：window.xg_video_player_doc.aa = JSON.parse('...')
 *  2. DPlayer：data-config='{"video":{"url":"..."}}'
 *  3. 任意 JSON.parse('...') 配置块（很多站把播放器配置整体 JSON.parse）
 *  4. DPlayer / video.js / 阿里云 AliPlayer / 腾讯云 TcPlayer / CKPlayer / jwplayer
 *     的内联对象配置：video.url / source / sources[].src / file / quality[].url 等
 *  5. <video src> / <source src> 原生标签
 *  6. JS 变量赋值：var/let/const/window.xxx = "...m3u8"
 *  7. <link rel=preload href="...m3u8">
 *  8. 页面里任意 m3u8/mp4 直链（含转义）
 *
 * @param {string} html 页面源码
 * @param {string} baseUrl 页面 URL，用于补全相对路径
 * @returns {{media: object|null, title: string}}
 */
export function extractMediaFromHtml(html, baseUrl = '') {
  const found = [];
  const seen = new Set();
  const push = (raw, t, src, lineTitle) => {
    const url = normalizeMediaUrl(raw, baseUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    found.push({
      url,
      title: t ? decodeHtmlEscapes(t).trim() : '',
      lineTitle: lineTitle ? decodeHtmlEscapes(lineTitle).trim() : '',
      source: src || '',
    });
  };
  const src = String(html || '');

  // 1) 西瓜 xgplayer：window.xg_video_player_doc = { aa: JSON.parse('{"url":"...","title":"..."}') }
  const aaBlock = src.match(/xg_video_player_doc[\s\S]{0,4000}?aa\s*:\s*JSON\.parse\((['"])([\s\S]*?)\1\)/i);
  if (aaBlock) {
    try {
      const obj = JSON.parse(decodeHtmlEscapes(aaBlock[2]));
      push(obj.url, obj.title, 'xg_video_player_doc.aa', obj.title);
    } catch { /* 结构不符就往下兜底 */ }
  }
  if (!found.length) {
    const seg = src.match(/xg_video_player_doc[\s\S]{0,4000}/i);
    if (seg) {
      const u = seg[0].match(/url["']?\s*:\s*["']([^"']+\.m3u8[^"']*)/i);
      push(u?.[1], '', 'xg_video_player_doc.url');
    }
  }

  // 2) DPlayer：data-config='{"video":{"url":"...m3u8","type":"hls"}}'
  if (!found.length) {
    for (const m of src.matchAll(/data-config\s*=\s*(['"])([\s\S]*?)\1/gi)) {
      try {
        const cfg = JSON.parse(decodeHtmlEscapes(m[2]));
        if (cfg && cfg.video && cfg.video.url) {
          const vids = Array.isArray(cfg.video.url) ? cfg.video.url : [cfg.video.url];
          for (const v of vids) {
            if (typeof v === 'string') push(v, '', 'dplayer.data-config', cfg.video.title);
            else if (v && v.url) push(v.url, '', 'dplayer.data-config', v.name || cfg.video.title);
          }
        }
        // DPlayer 多画质 quality:[{name,url}]
        if (cfg && cfg.video && Array.isArray(cfg.video.quality)) {
          for (const q of cfg.video.quality) if (q && q.url) push(q.url, '', 'dplayer.quality', q.name);
        }
      } catch { /* 不是合法 JSON 就跳过 */ }
    }
  }

  // 3) 任意 JSON.parse('...') 配置块：递归找里面所有像视频地址的字段
  if (!found.length) {
    for (const m of src.matchAll(/JSON\.parse\((['"])([\s\S]*?)\1\)/gi)) {
      try {
        const obj = JSON.parse(decodeHtmlEscapes(m[2]));
        collectFromObject(obj, 'json.parse', push);
      } catch { /* 跳过解析失败的块 */ }
    }
  }

  // 4) 内联播放器对象配置：各种 key: "url" 形式
  //    键名按「长者优先」排列，\b 保证 video_url 里的 url 不会被短键抢先匹配
  if (!found.length) {
    const kvRe = /['"]?\b(m3u8_url|video_url|play_url|playurl|videoUrl|playUrl|m3u8|url|src|source|file)['"]?\s*[:=]\s*(['"])([^'"]+\.(?:m3u8|mp4)[^'"]*)\2/gi;
    for (const m of src.matchAll(kvRe)) push(m[3], '', 'inline-config');
  }

  // 5) <video src> / <source src> 原生标签
  if (!found.length) {
    for (const m of src.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1[^>]*>/gi)) {
      push(m[2], '', 'video-tag');
    }
  }

  // 6) JS 变量赋值：var/let/const/window.xxx = "...m3u8"
  if (!found.length) {
    const varRe = /(?:\b(?:var|let|const)\s+[\w.$]+|\bwindow\.[\w.$]+)\s*=\s*(['"])([^'"]+\.(?:m3u8|mp4)[^'"]*)\1/gi;
    for (const m of src.matchAll(varRe)) push(m[2], '', 'js-var');
  }

  // 7) <link rel=preload href="...m3u8">
  if (!found.length) {
    for (const m of src.matchAll(/<link[^>]+href=(['"])([^'"]+\.m3u8[^'"]*)\1[^>]*>/gi)) push(m[2], '', 'preload');
  }

  // 8) 兜底：页面里任意 m3u8/mp4 直链（含 \/ 转义）
  if (!found.length) {
    const anyRe = /https?:\\?\/\\?\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi;
    for (const m of src.matchAll(anyRe)) { push(m[0], '', 'regex'); if (found.length) break; }
  }

  let title = '';
  const og = src.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || src.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const t = src.match(/<title>([^<]+)<\/title>/i);
  title = decodeHtmlEscapes(og?.[1] || t?.[1] || '').trim();
  return { media: found[0] || null, candidates: found, title };
}

/**
 * 递归遍历一个配置对象，收集所有看起来是视频直链的字段值。
 * 覆盖 {video:{url}}, {source}, {sources:[{src}]}, {playurl}, {file} 等常见结构。
 */
function collectFromObject(obj, source, push, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  if (Array.isArray(obj)) {
    for (const v of obj) collectFromObject(v, source, push, depth + 1);
    return;
  }
  const keys = ['url', 'src', 'source', 'file', 'playurl', 'm3u8', 'video_url'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && normalizeMediaUrl(v, '')) push(v, '', source, obj.title || obj.name);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !keys.includes(k)) collectFromObject(v, source, push, depth + 1);
  }
}

/** 抓一个页面并解析；直链必须在页面自身或有限层 iframe 内找到，且都过 SSRF 校验。depth 防 iframe 死循环 */
async function resolvePageMedia(pageUrl, depth = 0) {
  if (depth > 2) return null;
  const res = await fetch(pageUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`页面 HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!/html/i.test(ct)) return null; // 不是网页就别解析
  const html = await res.text();
  if (html.length > 2 * 1024 * 1024) return null; // 太大不处理
  const r = extractMediaFromHtml(html, pageUrl);
  if (r.media) {
    // 解析出的直链同样要过 SSRF
    const check = await ssrfSafe(r.media.url);
    if (!check.ok) throw new Error(`解析出的媒体地址被安全策略拦截：${check.error}`);
    return { url: check.url.href, title: r.title, lineTitle: r.media.title || r.media.lineTitle, source: r.media.source };
  }
  // 页面自身没有直链：可能是播放壳页，真正在 iframe 子页面里。递归抓 iframe（最多 2 层）。
  const frames = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*(['"])([^'"]+)\1[^>]*>/gi)];
  for (const f of frames) {
    let child = decodeHtmlEscapes(f[2]).trim();
    if (/^\/\//.test(child)) child = 'https:' + child;
    else if (!/^https?:\/\//i.test(child)) {
      try { child = new URL(child, pageUrl).href; } catch { continue; }
    }
    // iframe 目标也要过 SSRF，防止借播放页探测内网
    const check = await ssrfSafe(child);
    if (!check.ok) continue;
    try {
      const got = await resolvePageMedia(check.url.href, depth + 1);
      if (got) return { ...got, title: got.title || r.title };
    } catch { /* 单个 iframe 失败不影响其它分支 */ }
  }
  return null;
}

/** 秒数转 m:ss / h:mm:ss，仅用于日志和展示 */
function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** 从 m3u8 文本累加 EXTINF 得到总时长（秒）；master playlist 会跟随第一个子流 */
function durationFromM3u8(txt) {
  let total = 0;
  for (const line of String(txt || '').split(/\r?\n/)) {
    const m = line.match(/#EXTINF:\s*([\d.]+)/i);
    if (m) total += parseFloat(m[1]);
  }
  return Math.round(total);
}

/**
 * 尽力探测 HLS 总时长（秒）。
 * AES-128 HLS 走 ffmpeg 原生下载，stderr 只有 frame/size/time，没有百分比；
 * 提前拿到总时长才能用 time/duration 算出真实进度。
 * 纯展示用途，失败一律返回 0，绝不影响主下载。
 */
async function probeHlsDuration(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' },
    });
    if (!res.ok) return 0;
    const txt = await res.text();
    // master playlist 没有 EXTINF，跟着第一个子流再抓一次
    if (!/#EXTINF:/i.test(txt) && /#EXT-X-STREAM-INF/i.test(txt)) {
      const lines = txt.split(/\r?\n/).map((s) => s.trim());
      const idx = lines.findIndex((l) => /#EXT-X-STREAM-INF/i.test(l));
      const child = lines.slice(idx + 1).find((l) => l && !l.startsWith('#'));
      if (child) {
        const childUrl = new URL(child, url).href;
        const r2 = await fetch(childUrl, { signal: AbortSignal.timeout(10000), redirect: 'follow' });
        if (r2.ok) return durationFromM3u8(await r2.text());
      }
      return 0;
    }
    return durationFromM3u8(txt);
  } catch {
    return 0;
  }
}

/** yt-dlp 是否明确表示不支持这个 URL */
function isUnsupportedUrl(stderr) {
  return /Unsupported URL|no suitable extractor|Unable to extract|not a valid URL|Unsupported scheme/i.test(stderr);
}

/* ---------------- 启动单个任务 ---------------- */

function buildArgs(job, outDir) {
  const out = [];
  // --print 会把 yt-dlp 切到静默元数据模式，进度行和阶段行全被吞掉；必须显式 --progress 才恢复
  out.push('--no-warnings', '--no-colors', '--newline', '--ignore-config', '--restrict-filenames', '--progress');
  // 注意：这类带 auth_key 签名的 CDN 对 Referer/自定义 UA 敏感，加了反而 Connection reset，
  // 所以保持裸请求（实测裸请求能正常下载）。需要请求头的情况极少，暂不加。
  // 文件名带 [job.id] 作唯一锚点：完成后靠它定位成品，不再依赖 --print 回读。
  // --print 会让 yt-dlp 对这类带签名的 CDN 触发 Connection reset（实测），必须彻底去掉。
  const base = job.downloadName || '%(title)s';
  out.push('-o', path.join(outDir, `${base} [${job.id}].%(ext)s`));
  if (job.audioOnly) {
    out.push('-x', '--audio-format', 'mp3');
  } else if (job.format && job.format !== 'best') {
    out.push('-f', job.format);
  }
  if (job.subtitles) {
    out.push('--write-subs', '--sub-langs', 'all', '--embed-subs');
  }
  if (!job.playlist) out.push('--no-playlist');
  out.push(job.downloadUrl || job.url);
  return out;
}

/** 把页面标题清成安全文件名（yt-dlp 的 --restrict-filenames 只作用于模板变量，字面量要自己清） */
function safeName(title) {
  return String(title || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** 在下载目录里找本任务生成的成品：文件名含 [job.id]，取最新一个媒体文件 */
async function findOutputByJobId(outDir, jobId) {
  const ents = await fs.readdir(outDir, { withFileTypes: true });
  const marker = `[${jobId}]`;
  const mediaExt = /\.(mp4|mkv|webm|mov|avi|flv|ts|mp3|m4a|aac|flac|opus|wav)$/i;
  let best = null;
  let bestMtime = 0;
  for (const e of ents) {
    if (!e.isFile()) continue;
    if (!e.name.includes(marker)) continue;
    if (!mediaExt.test(e.name)) continue;
    try {
      const st = await fs.stat(path.join(outDir, e.name));
      if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = path.join(outDir, e.name); }
    } catch { /* 文件可能被并发改动，跳过 */ }
  }
  return best;
}

async function startJob(job) {
  const { cmd } = resolveYtDlpBin();
  const outDir = await getDownloadDir();
  if (!(await freeSpaceOk(outDir))) {
    job.status = 'error';
    job.error = '剩余空间不足 500MB，已拒绝';
    await save();
    return;
  }
  job.status = 'running';
  job.startedAt = Date.now();
  job.progress = 0;
  // 先给一条起点日志，用户提交后立刻能看到「解析中」
  job.stage = '解析视频信息';
  pushLog(job, 'parse', '正在解析视频地址和元数据');
  await save();

  runChild(job, outDir, cmd, 0);
}

/**
 * 真正拉起一次 yt-dlp 子进程。
 * @param {number} retryCount 已经重试过几次，防止无限重试
 */
async function runChild(job, outDir, cmd, retryCount = 0) {
  const args = buildArgs(job, outDir);
  // AES-128 HLS 走 ffmpeg，进度行没有百分比；提前探测总时长，好把 time= 换算成真实进度。
  // 纯展示用途，探测失败（返回 0）就退回「已写入大小 + 速度」展示，不影响下载本身。
  if (job.downloadUrl && /\.m3u8(\?|$)/i.test(job.downloadUrl) && !job.duration) {
    job.duration = await probeHlsDuration(job.downloadUrl);
    if (job.duration > 0) {
      pushLog(job, 'parse', `识别到视频总时长 ${fmtDur(job.duration)}`);
      await save();
    }
  }
  let child;
  try {
    // detached：让 yt-dlp 及其 spawn 的 ffmpeg 处于同一进程组，cancel 时能整组杀掉，不留孤儿进程继续写文件
    child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  } catch (e) {
    job.status = 'error';
    job.error = `启动失败：${e.message}`;
    await save();
    schedule();
    return;
  }
  running.set(job.id, child);

  let stdout = '';
  let stderr = '';

  // onLine 只做两件事：累积输出（给失败诊断用）+ 识别「阶段」这类离散信号。
  // 进度不再在这里逐行算——ffmpeg 会把多条 frame 进度行和 Opening 日志挤在同一个无换行的
  // data chunk 里，逐行 match 只会取到最旧的值。改由下面的采样定时器从累积文本里取「最后一个」匹配。
  const onLine = (buf, isErr) => {
    const text = buf.toString('utf8');
    if (isErr) stderr = (stderr + text).slice(-MAX_LOG * 4);
    else stdout = (stdout + text).slice(-MAX_LOG * 4);
    for (const line of text.split(/\r\n|\r|\n/)) {
      const s = line.trim();
      if (!s) continue;
      if (/Extracting URL|Downloading webpage|Downloading API JSON/i.test(s)) {
        job.stage = '解析视频信息';
        pushLog(job, 'parse', '正在解析视频地址和元数据');
      } else if (/Checking m3u8|Downloading m3u8 manifest|Downloading playlist|Total fragments/i.test(s)) {
        job.stage = '识别分片';
        const tf = s.match(/Total fragments:\s*(\d+)/);
        if (tf) job.fragTotal = parseInt(tf[1], 10);
        pushLog(job, 'parse', tf ? `识别到 ${tf[1]} 个视频分片` : '正在识别视频分片');
      } else if (/Downloading \d+ format/i.test(s)) {
        const fmm = s.match(/Downloading\s+(\d+)\s+format/);
        pushLog(job, 'parse', fmm ? `识别到 ${fmm[1]} 种可用格式，选择最佳` : '正在识别可用格式');
      } else if (/Merging|Post-processing/i.test(s)) {
        job.stage = '合并封装';
        pushLog(job, 'merge', '正在合并音视频并封装成文件');
      } else if (/Destination:/i.test(s)) {
        if (job.stage !== '合并封装') job.stage = '下载中';
        pushLog(job, 'progress', '已确定输出文件，开始写入视频流');
      }
    }
  };

  child.stdout.on('data', (d) => onLine(d, false));
  child.stderr.on('data', (d) => onLine(d, true));

  /**
   * 进度采样：每秒从累积输出里取「最后一次」进度快照，与日志分行方式彻底解耦。
   * 三类来源：
   *  a) yt-dlp 分片 HLS： (frag 78/638)
   *  b) yt-dlp 普通：     [download] 45.0% of ...
   *  c) ffmpeg 原生 HLS： size= 46848KiB time=00:02:20.44 speed= 14x（AES-128 走这条）
   */
  let lastProgressSave = 0;
  const sampleProgress = () => {
    if (job.status !== 'running') return false;
    let changed = false;

    const fragAll = [...stderr.matchAll(/frag\s+(\d+)\s*\/\s*(\d+)/gi)];
    const pctAll = [...stderr.matchAll(/\[download\]\s+([\d.]+)%\s+of/gi)];
    const timeAll = [...stderr.matchAll(/time=\s*(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)/gi)];
    const sizeAll = [...stderr.matchAll(/size=\s*([\d.]+)\s*(KiB|MiB|GiB|B)\b/gi)];
    const speedAll = [...stderr.matchAll(/speed=\s*([\d.]+)x/gi)];
    const bpsAll = [...stderr.matchAll(/at\s+([\d.]+\s*\w+\/s)/gi)];

    const frag = fragAll[fragAll.length - 1];
    const pct = pctAll[pctAll.length - 1];
    const tm = timeAll[timeAll.length - 1];
    const sz = sizeAll[sizeAll.length - 1];
    const spd = speedAll[speedAll.length - 1];
    const bps = bpsAll[bpsAll.length - 1];

    if (frag) {
      const cur = parseInt(frag[1], 10);
      const total = parseInt(frag[2], 10);
      if (job.frag !== cur) { job.frag = cur; changed = true; }
      if (total > 0) {
        if (job.fragTotal !== total) { job.fragTotal = total; changed = true; }
        const p = Math.min(99, Math.round((cur / total) * 100));
        if (p > job.progress) { job.progress = p; changed = true; }
      }
      if (job.stage !== '合并封装' && job.stage !== '完成') { job.stage = '下载中'; changed = true; }
      pushLog(job, 'progress', `下载分片 ${cur}/${job.fragTotal || total}${bps ? ` · ${bps[1]}` : ''}`);
    } else if (tm) {
      // ffmpeg 原生进度：用已处理时长 / 探测到的总时长算百分比
      const sec = parseInt(tm[1], 10) * 3600 + parseInt(tm[2], 10) * 60 + parseFloat(tm[3]);
      if (job.duration > 0) {
        const p = Math.min(99, Math.round((sec / job.duration) * 100));
        if (p > job.progress) { job.progress = p; changed = true; }
      }
      if (sz) { const t = `${sz[1]} ${sz[2]}`; if (job.size !== t) { job.size = t; changed = true; } }
      if (spd) { const t = `${spd[1]}x`; if (job.speed !== t) { job.speed = t; changed = true; } }
      if (job.stage !== '合并封装' && job.stage !== '完成') { job.stage = '下载中'; changed = true; }
      pushLog(job, 'progress', `下载中 ${job.progress}% · ${fmtDur(sec)}/${fmtDur(job.duration)}${sz ? ` · 已写入 ${sz[1]} ${sz[2]}` : ''}${spd ? ` · ${spd[1]}x` : ''}`);
    } else if (pct) {
      const p = parseFloat(pct[1]);
      if (!Number.isNaN(p) && p > job.progress) { job.progress = p; changed = true; }
      if (bps) { if (job.speed !== bps[1]) { job.speed = bps[1]; changed = true; } }
      if (job.stage !== '合并封装' && job.stage !== '完成') { job.stage = '下载中'; changed = true; }
      pushLog(job, 'progress', `下载中 ${job.progress}%${bps ? ` · ${bps[1]}` : ''}`);
    } else if (sz) {
      const t = `${sz[1]} ${sz[2]}`;
      if (job.size !== t) { job.size = t; changed = true; }
      if (spd) { const v = `${spd[1]}x`; if (job.speed !== v) { job.speed = v; changed = true; } }
      if (job.stage !== '合并封装' && job.stage !== '完成') { job.stage = '下载中'; changed = true; }
      pushLog(job, 'progress', `下载中 · 已写入 ${t}${spd ? ` · ${spd[1]}x` : ''}`);
    }
    // 节流写盘：进度每 3 秒落一次，避免高频磁盘写；内存对象则每秒都是最新的
    if (changed && Date.now() - lastProgressSave > 3000) {
      lastProgressSave = Date.now();
      save().catch(() => {});
    }
    return changed;
  };
  const tickTimer = setInterval(sampleProgress, 1000);
  tickTimers.set(job.id, tickTimer);

  child.on('close', async (code) => {
    running.delete(job.id);
    const tk = tickTimers.get(job.id);
    if (tk) { clearInterval(tk); tickTimers.delete(job.id); }
    // 收尾再采一次，确保最后一帧进度落到对象上
    try { sampleProgress(); } catch { /* ignore */ }
    // 成品路径靠文件名里的 [job.id] 锚点定位，不用 --print 回读（--print 会触发签名 CDN reset）
    if (code === 0) {
      try {
        const found = await findOutputByJobId(outDir, job.id);
        if (found) job.file = found;
      } catch { /* 扫目录失败不致命，下面按 code 判断 */ }
    }

    if (code === 0 && job.file) {
      job.status = 'done';
      job.progress = 100;
      job.frag = job.fragTotal || job.frag;
      job.stage = '完成';
      pushLog(job, 'done', '下载完成，文件已保存');
      job.finishedAt = Date.now();
      await save();
      schedule();
      return;
    }

    if (job.status !== 'running') return; // 被取消/删除了，别再动

    // 判断这次失败是否值得回退到「抓播放页解析直链」。三类触发：
    //  a) unsupported  → yt-dlp 明确不认识这个站（B站等原生站点不会走到这）
    //  b) signedUrlFail → 已在用直链且签名类错误：必须「有直链 + 非零退出 + 几乎没进度 + 明确硬连接错误」
    //  c) engineFailNoProgress → yt-dlp 直接失败且完全没下出任何进度（HTTP 403/能解析但取不到流等），
    //     此时不妨抓播放页自己解析直链，扩大对野生站的兼容面。
    //  madeProgress 是统一护栏：只要下出过内容，就绝不再重置进度重复解析。
    const unsupported = isUnsupportedUrl(stderr);
    // 注意：不要把 404/Forbidden 加进来。HLS 探测阶段的分片 404 是常态，
    // 一旦纳入就会在刚拿到直链、进度还没起来时误判「签名过期」多解析一次（实测回归过）。
    const hardConnErr = /(Errno 104|Connection reset by peer|ECONNRESET|Unable to download webpage|HTTP Error 403|Unauthorized)/i.test(stderr);
    const madeProgress = (job.progress || 0) > 3 || (job.frag || 0) > 0 || (job.duration && /time=\s*\d+:\d+:\d+/i.test(stderr));
    const signedUrlFail = !!job.downloadUrl && code !== 0 && hardConnErr && !madeProgress;
    const engineFailNoProgress = code !== 0 && !madeProgress && !job.downloadUrl && !unsupported;
    const MAX_RETRY = 3;

    if (code !== 0 && (unsupported || signedUrlFail || engineFailNoProgress) && retryCount < MAX_RETRY) {
      // 实测：这类带 auth_key 的 CDN 对「首次连接」常直接 reset，重试同一个 key 就成功，
      // 并非签名过期（两次解析拿到的 auth_key 完全相同）。文案要如实反映，避免用户以为出错了。
      const reason = unsupported ? '该站点需特殊解析' : (signedUrlFail ? '直链连接波动' : '引擎取流失败，尝试解析播放页');
      console.log(`[downloads] ${reason}，重新解析播放页：${job.id} retry=${retryCount + 1}`);
      job.stage = '解析播放页';
      pushLog(job, 'parse', unsupported ? '该站点需特殊解析，正在读取播放页' : (signedUrlFail ? '连接波动，正在重试获取视频地址' : '正在读取播放页，尝试直接解析视频地址'));
      try {
        // 每次都重新抓页面：带签名的直链有时效，缓存的旧地址会 Connection reset
        const media = await resolvePageMedia(job.url);
        if (media && media.url) {
          // 直链变了才记一条，避免刷屏
          if (media.url !== job.downloadUrl) {
            job.downloadUrl = media.url;
            pushLog(job, 'parse', `已获取最新视频直链${media.lineTitle ? `（${media.lineTitle}）` : ''}`);
          }
          const nm = safeName(media.title || media.lineTitle || '');
          if (nm) job.downloadName = nm;
          if (!job.title) job.title = (media.title || '').slice(0, 200);
          job.progress = 0;
          job.frag = 0;
          job.fragTotal = 0;
          job.speed = '';
          job.eta = '';
          job.error = '';
          await save();
          console.log(`[downloads] 解析成功 ${job.id}：${media.source} -> ${media.url}${nm ? ` 文件名=${nm}` : ''}`);
          return await runChild(job, outDir, cmd, retryCount + 1);
        }
      } catch (e) {
        console.warn(`[downloads] 播放页解析失败 ${job.id}：${e.message}`);
      }
    }

    if (job.status === 'running') {
      // 没被取消逻辑改过才标错误
      job.status = 'error';
      job.error = (stderr.split(/\r\n|\r|\n/).filter((l) => /ERROR|error|Unable to|Failed/i.test(l)).pop() || '下载失败').slice(-MAX_LOG);
      job.stage = '失败';
      pushLog(job, 'error', `下载失败：${job.error.slice(0, 160)}`);
      job.finishedAt = Date.now();
    }
    await save();
    schedule();
  });

  child.on('error', async (e) => {
    running.delete(job.id);
    const tk = tickTimers.get(job.id);
    if (tk) { clearInterval(tk); tickTimers.delete(job.id); }
    job.status = 'error';
    job.error = `进程错误：${e.message}`;
    await save();
    schedule();
  });
}

/* ---------------- 控制 ---------------- */

export function cancel(id) {
  const s = cache;
  if (!s) return false;
  const job = s.jobs.find((j) => j.id === id);
  if (!job) return false;
  const child = running.get(id);
  if (child) {
    // detached 进程组：负号表示杀整组，把 yt-dlp spawn 的 ffmpeg 一起带走，避免孤儿继续写 .part
    try { process.kill(-child.pid, 'SIGTERM'); } catch {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    running.delete(id);
  }
  const tk = tickTimers.get(id);
  if (tk) { clearInterval(tk); tickTimers.delete(id); }
  if (job.status === 'running' || job.status === 'queued') {
    job.status = 'canceled';
    job.finishedAt = Date.now();
  }
  schedule();
  return true;
}

export function retry(id) {
  const s = cache;
  if (!s) return false;
  const job = s.jobs.find((j) => j.id === id);
  if (!job) return false;
  if (job.status === 'running') return false;
  job.status = 'queued';
  job.progress = 0;
  job.error = '';
  job.file = '';
  job.finishedAt = 0;
  save();
  schedule();
  return true;
}

export function remove(id) {
  const s = cache;
  if (!s) return false;
  if (running.has(id)) return false; // 跑着的别删，先取消
  const i = s.jobs.findIndex((j) => j.id === id);
  if (i < 0) return false;
  s.jobs.splice(i, 1);
  save();
  return true;
}

/* ---------------- 安全读取成品文件 ---------------- */

/** 确保目标路径落在下载目录内，防路径穿越 */
function safeInside(base, target) {
  try {
    const b = path.resolve(base);
    const t = path.resolve(base, target);
    if (t === b || t.startsWith(b + path.sep)) return t;
  } catch {
    /* ignore */
  }
  return null;
}

export async function getFile(id) {
  const s = cache;
  if (!s) return null;
  const job = s.jobs.find((j) => j.id === id);
  if (!job || job.status !== 'done' || !job.file) return null;
  const dir = await getDownloadDir();
  const fp = safeInside(dir, job.file);
  if (!fp) return null;
  try {
    const st = await fs.stat(fp);
    if (!st.isFile()) return null;
    return { path: fp, size: st.size, name: path.basename(fp) };
  } catch {
    return null;
  }
}
