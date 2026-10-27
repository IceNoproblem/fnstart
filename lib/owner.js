import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CONFIG } from './config.js';
import { dockerApi } from './docker.js';

/**
 * 端口 → 容器归属。
 *
 * bridge 模式的容器能从 Docker API 的端口映射直接读出来；
 * 但 host 网络模式的容器压根没有端口映射，只能从进程侧反查：
 *   监听端口 → socket inode → 持有该 inode 的进程 → 该进程属于哪个容器。
 *
 * 「持有 inode 的进程」需要看宿主机进程表，所以容器要把宿主机 /proc 挂进来
 * （-v /proc:/host/proc:ro）。没挂也能跑，只是 host 网络的容器认不出名字。
 */
export function procRoot() {
  if (CONFIG.procRoot) return CONFIG.procRoot;
  return existsSync('/host/proc/net/tcp') ? '/host/proc' : '/proc';
}

/** 读监听端口 → socket inode 映射 */
async function listenInodes(root) {
  const map = new Map(); // inode -> port
  for (const f of ['tcp', 'tcp6']) {
    try {
      const txt = await fs.readFile(`${root}/net/${f}`, 'utf8');
      for (const line of txt.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 10) continue;
        if (cols[3] !== '0A') continue; // LISTEN
        const port = parseInt(cols[1].split(':').pop(), 16);
        const inode = Number(cols[9]);
        if (port && inode) map.set(inode, port);
      }
    } catch {
      /* 没有该文件就跳过 */
    }
  }
  return map;
}

/** 某个进程持有的 socket inode 集合 */
async function pidInodes(root, pid) {
  const out = new Set();
  try {
    const fds = await fs.readdir(`${root}/${pid}/fd`);
    for (const fd of fds) {
      try {
        const link = await fs.readlink(`${root}/${pid}/fd/${fd}`);
        const m = /^socket:\[(\d+)\]$/.exec(link);
        if (m) out.add(Number(m[1]));
      } catch {
        /* fd 关掉了 */
      }
    }
  } catch {
    /* 进程已退出或无权限 */
  }
  return out;
}

/** 父进程表：ppid -> [pid...]，用来把容器的子进程一起算进去 */
async function childTree(root) {
  const kids = new Map();
  let pids = [];
  try {
    pids = (await fs.readdir(root)).filter((n) => /^\d+$/.test(n));
  } catch {
    return { kids, pids };
  }
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const st = await fs.readFile(`${root}/${pid}/status`, 'utf8');
        const m = /^PPid:\s*(\d+)/m.exec(st);
        if (!m) return;
        const ppid = Number(m[1]);
        if (!kids.has(ppid)) kids.set(ppid, []);
        kids.get(ppid).push(Number(pid));
      } catch {
        /* 进程消失 */
      }
    }),
  );
  return { kids, pids };
}

const descendants = (kids, pid) => {
  const out = [pid];
  const stack = [pid];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of kids.get(cur) || []) {
      out.push(k);
      stack.push(k);
    }
  }
  return out;
};

/**
 * 反查 host 网络容器的端口归属。
 * @param {Array} containers Docker API /containers/json 的结果
 * @returns {Map<number,string>} 端口 → 容器名
 */
export async function hostNetworkOwners(containers, concurrency = 6) {
  const owner = new Map();
  const root = procRoot();
  if (!root) return owner;

  const listening = await listenInodes(root);
  if (!listening.size) return owner;

  const { kids } = await childTree(root);
  const queue = [...containers];

  const worker = async () => {
    while (queue.length) {
      const c = queue.shift();
      const name = (c.Names?.[0] || '').replace(/^\//, '');
      let pid = 0;
      try {
        const info = await dockerApi(`/containers/${c.Id}/json`, 4000);
        pid = info?.State?.Pid || 0;
      } catch {
        continue;
      }
      if (!pid) continue;
      const inodes = new Set();
      for (const p of descendants(kids, pid)) {
        for (const i of await pidInodes(root, p)) inodes.add(i);
      }
      for (const i of inodes) {
        const port = listening.get(i);
        if (port && !owner.has(port)) owner.set(port, name);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return owner;
}
