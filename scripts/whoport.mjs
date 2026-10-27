/** 调试：找某个端口对应的容器与进程。用法：node /tmp/whoport.mjs 8123 */
import fs from 'node:fs/promises';

const port = Number(process.argv[2] || 8123);
const root = '/host/proc';

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
