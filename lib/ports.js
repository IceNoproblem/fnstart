import fs from 'node:fs/promises';
import net from 'node:net';

/**
 * 读宿主机所有 LISTEN 的 TCP 端口。
 * 容器以 host 网络模式运行时，/proc/net/tcp 就是宿主机的网络命名空间，
 * 因此不需要 docker 的端口映射也能发现「没映射端口」的容器和系统自带服务。
 */
export async function hostListenPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    try {
      const txt = await fs.readFile(file, 'utf8');
      for (const line of txt.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        if (cols[3] !== '0A') continue; // 0A = LISTEN
        const hexPort = cols[1].split(':').pop();
        const port = parseInt(hexPort, 16);
        if (port > 0) ports.add(port);
      }
    } catch {
      /* 非 Linux 或无权限，忽略 */
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** 明确不是 HTTP 的端口，节省探测时间 */
const NOT_HTTP = new Set([
  20, 21, 22, 23, 25, 53, 110, 111, 123, 137, 138, 139, 143, 161, 162, 179, 389, 445, 465, 514,
  587, 631, 636, 873, 993, 995, 1080, 1194, 1433, 1521, 1883, 1935, 2049, 2181, 2375, 2376,
  3306, 3389, 3478, 3493, 3702, 4369, 4500, 5060, 5432, 5555, 5672, 5683,
  5900, 6379, 6443, 6653, 6667, 8883, 9092, 9100, 11211, 15672, 25672, 27017, 51820,
]);

/** 常见 Web 端口，优先探测 */
const WEB_HINT = new Set([
  80, 443, 3000, 3001, 4000, 4533, 5000, 5050, 5666, 5667, 7000, 7878, 8000, 8001, 8002, 8005,
  8080, 8081, 8088, 8096, 8099, 8123, 8443, 8777, 8888, 8889, 8899, 8900, 9000, 9090, 9443,
  10500, 10501, 12345, 19035, 19998, 19999, 23456, 32400, 18080,
]);

/** 端口是否值得探测 */
export function isWebCandidate(port) {
  if (port < 80 || port > 49151) return false;
  if (NOT_HTTP.has(port)) return false;
  return true;
}

/** 候选端口排序：常见 Web 端口优先，其余按端口号，最多取 limit 个 */
export function rankPorts(ports, limit = 70) {
  const list = ports.filter(isWebCandidate);
  const hint = list.filter((p) => WEB_HINT.has(p));
  const rest = list.filter((p) => !WEB_HINT.has(p));
  return [...hint, ...rest].slice(0, limit);
}

/** 快速 TCP 探活，判断端口有没有人在听（比直接发 HTTP 快得多） */
export function tcpAlive(host, port, timeout = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeout);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, host);
  });
}
