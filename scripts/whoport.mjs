/**
 * 排障小工具：查某个端口到底被哪个进程（哪个容器）占着。
 *
 * 典型场景：扫描出来的某张卡片没有容器名，想确认这个端口是谁在听。
 *
 * 用法（在容器里跑，宿主机 /proc 要挂在 /host/proc）：
 *   docker cp scripts/whoport.mjs fnstart:/tmp/w.mjs
 *   docker exec fnstart node /tmp/w.mjs 8123
 *
 * 输出「命中 pid=… comm=…」就是持有这个监听 socket 的进程；
 * 如果一个都命中不了，通常说明目标进程在别的 user namespace 里，
 * 读它的 fd 需要更多权限（不影响 fnstart 正常使用）。
 */
import fs from 'node:fs/promises';

const port = Number(process.argv[2] || 0);
if (!port) {
  console.error('用法：node whoport.mjs <端口号>');
  process.exit(1);
}
const root = process.env.PROC_ROOT || '/host/proc';

const hex = port.toString(16).toUpperCase().padStart(4, '0');
const inodes = new Set();
for (const f of ['tcp', 'tcp6']) {
  const txt = await fs.readFile(`${root}/net/${f}`, 'utf8').catch(() => '');
  for (const line of txt.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 10 || c[3] !== '0A' || !c[1].endsWith(hex)) continue;
    inodes.add(Number(c[9]));
  }
}
console.log('端口', port, '监听 inode', [...inodes]);

const pids = (await fs.readdir(root)).filter((n) => /^\d+$/.test(n));
let hit = 0;
let denied = 0;
let linkErr = 0;
const errSample = [];
for (const pid of pids) {
  let fds;
  try {
    fds = await fs.readdir(`${root}/${pid}/fd`);
  } catch (e) {
    denied++;
    continue;
  }
  for (const fd of fds) {
    let link = '';
    try {
      link = await fs.readlink(`${root}/${pid}/fd/${fd}`);
    } catch (e) {
      linkErr++;
      if (errSample.length < 3) errSample.push(`${pid}/${fd} ${e.code}`);
      continue;
    }
    const m = /^socket:\[(\d+)\]$/.exec(link);
    if (m && inodes.has(Number(m[1]))) {
      const comm = await fs.readFile(`${root}/${pid}/comm`, 'utf8').catch(() => '?');
      console.log(`命中 pid=${pid} comm=${comm.trim()} fd=${fd}`);
      hit++;
    }
  }
}
console.log(`扫描 ${pids.length} 进程，命中 ${hit}，fd 目录无权 ${denied}，链接读取失败 ${linkErr}`, errSample);
