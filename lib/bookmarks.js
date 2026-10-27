import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { ICON_DIR } from './config.js';

const unescapeHtml = (s = '') =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

const stripTags = (s = '') => unescapeHtml(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const saveDataIcon = async (dataUri) => {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/is.exec(dataUri.replace(/\s+/g, ''));
  if (!m) return '';
  const extMap = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/x-icon': 'ico', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
  const ext = extMap[m[1].toLowerCase()] || 'png';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 70 || buf.length > 512 * 1024) return '';
  const file = `bm-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.${ext}`;
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.writeFile(path.join(ICON_DIR, file), buf);
  return `/icons/${file}`;
};

/**
 * 解析浏览器导出的书签 HTML（Netscape Bookmark File）
 * 兼容 Chrome / Edge / Firefox / Safari 导出格式
 */
export async function parseBookmarkHtml(html) {
  const out = [];
  const skipProto = /^(javascript|data|chrome|edge|about|file|place|mailto):/i;
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  const dirs = [];
  let lastDirPos = 0;

  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const text = stripTags(m[2]);
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    if (!href || skipProto.test(href)) continue;
    if (!/^https?:\/\//i.test(href)) continue;

    // 取链接之前最近的一个 H3 作为所属文件夹
    const before = html.slice(lastDirPos, m.index);
    const h3s = [...before.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    if (h3s.length) {
      const folder = stripTags(h3s[h3s.length - 1][1]);
      if (folder) {
        dirs.length = 0;
        dirs.push(folder);
      }
    }
    lastDirPos = m.index;

    const iconAttr = /icon\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] || '';
    let icon = '';
    if (iconAttr.startsWith('data:image')) {
      try {
        icon = await saveDataIcon(iconAttr);
      } catch {
        icon = '';
      }
    }

    out.push({
      name: (text || new URL(href).hostname).slice(0, 60),
      url: href,
      icon,
      desc: dirs[dirs.length - 1] || '',
      source: 'bookmark',
    });
  }
  return dedupe(out);
}

/** 支持直接粘贴一堆网址（每行一个，可带备注） */
export function parseUrlList(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /(https?:\/\/[^\s"'<>）)]+)/i.exec(t) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(t) ? [t, `http://${t}`] : null);
    if (!m) continue;
    const url = m[1];
    const name = t.replace(url, '').replace(/[-–—:|,]/g, ' ').trim().slice(0, 40);
    out.push({ name: name || new URL(url).hostname.replace(/^www\./, ''), url, icon: '', desc: '', source: 'bookmark' });
  }
  return dedupe(out);
}

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((it) => {
    const k = it.url.toLowerCase().replace(/\/+$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export async function parseAny(input) {
  const text = String(input || '').trim();
  if (!text) return [];
  if (/<a\b/i.test(text) || /<!DOCTYPE NETSCAPE/i.test(text)) return parseBookmarkHtml(text);
  return parseUrlList(text);
}
