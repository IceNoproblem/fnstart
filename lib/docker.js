import http from 'node:http';
import { CONFIG } from './config.js';

/**
 * 通过 unix socket 调 Docker Engine API（只读）
 *
 * 注意：不要写死 `/v1.xx` 版本前缀。不同 Docker 引擎的「最低支持版本」不同，
 * 飞牛 NAS 上的引擎最低只接受 1.44，写死 1.41 会直接返回 400（表现为“docker 不可用”，
 * 但其实是版本协商失败）。去掉前缀后由引擎自己用最新版本应答，兼容所有版本。
 */
/**
 * DOCKER_SOCK 两种写法都认：
 *   - `/var/run/docker.sock`           直接读 unix socket（简单，但等于把宿主机交给这个容器）
 *   - `http://127.0.0.1:2375`          走 docker-proxy：只放行 GET，写操作一律 403
 * 默认的 compose 用后者。想退回旧行为，把这条环境变量改回 unix 路径即可。
 */
const endpoint = (() => {
  const v = CONFIG.dockerSock || '/var/run/docker.sock';
  if (/^https?:\/\//i.test(v)) {
    const u = new URL(v);
    return { host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) };
  }
  return { socketPath: v };
})();

export function dockerApi(pathname, timeout = 8000) {
  const cleanPath = pathname.replace(/^\/v\d+(?:\.\d+)?(?=\/)/, '');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...endpoint,
        path: cleanPath,
        method: 'GET',
        timeout,
        headers: { Host: 'localhost', Accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) return reject(new Error(`docker api ${res.statusCode}: ${body.slice(0, 200)}`));
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('docker api 返回非 JSON'));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('docker api 超时')));
    req.end();
  });
}

export async function dockerAvailable() {
  try {
    await dockerApi('/version', 3000);
    return true;
  } catch {
    return false;
  }
}

/** 只看 HTTP 探测判定，先按端口排除一批明确非 Web 的 */
const NON_HTTP_PRIVATE_PORTS = new Set([
  22, 25, 53, 465, 587, 993, 6379, 3306, 5432, 27017, 1883, 8883, 9092, 5672, 11211, 6380, 8529,
]);

/**
 * 列出所有运行中容器的候选 Web 入口
 * @returns [{ container, image, url, ports, labels }]
 */
export async function listContainerEndpoints(host, { includeStopped = false, selfPort = 0 } = {}) {
  const list = await dockerApi(`/containers/json?all=${includeStopped ? 1 : 0}`);
  const out = [];
  for (const c of list) {
    const name = (c.Names?.[0] || '').replace(/^\//, '');
    const ports = (c.Ports || []).filter((p) => p.PublicPort && (!p.Type || p.Type === 'tcp'));
    const seen = new Set();
    for (const p of ports) {
      if (NON_HTTP_PRIVATE_PORTS.has(p.PrivatePort)) continue;
      if (selfPort && p.PublicPort === selfPort) continue;
      if (seen.has(p.PublicPort)) continue;
      seen.add(p.PublicPort);
      out.push({
        container: name,
        image: c.Image,
        state: c.State,
        hostPort: p.PublicPort,
        containerPort: p.PrivatePort,
        url: `http://${host}:${p.PublicPort}`,
        labels: c.Labels || {},
      });
    }
  }
  return out;
}

/** NAS 系统自带（非 Docker）的常见 Web 入口，飞牛自身服务在这里补 */
export function systemEndpointCandidates(host) {
  return [
    { container: 'fnOS', label: '飞牛 OS', url: `http://${host}:5666`, kind: 'system' },
    { container: 'fnMonitor', label: '飞牛监控', url: `http://${host}:${CONFIG.monitorPort}/#/overview`, kind: 'system' },
  ];
}
