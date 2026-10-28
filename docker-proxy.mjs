/**
 * docker-proxy —— 把 Docker socket 收窄成一个「只读小窗口」。
 *
 * 为什么需要它：fnStart 要列容器才能把端口归属反查到容器名，这需要 Docker API。
 * 但直接把 /var/run/docker.sock 挂进主容器，`:ro` 挡不住写操作（实测
 * POST /containers/create 依旧能打到 API），等于「Node 进程被攻破 = 宿主机 root」。
 *
 * 这个代理单独跑一个容器：只有它挂 socket，只放行三个 GET 端点，
 * 其它一律 403。fnStart 通过 http://127.0.0.1:2375 访问它。
 * 于是「被攻破」的后果从「宿主机 root」降到「只能读容器列表」。
 *
 * 只监听回环，局域网和公网都碰不到。
 *
 *   node docker-proxy.mjs
 *   环境变量：PROXY_LISTEN=127.0.0.1:2375  DOCKER_SOCK_INNER=/var/run/docker.sock
 */
import http from 'node:http';

const LISTEN = process.env.PROXY_LISTEN || '127.0.0.1:2375';
const SOCKET = process.env.DOCKER_SOCK_INNER || '/var/run/docker.sock';
const MAX_BYTES = 16 * 1024 * 1024;

const [host, portRaw] = LISTEN.includes(':') ? [LISTEN.slice(0, LISTEN.lastIndexOf(':')), LISTEN.slice(LISTEN.lastIndexOf(':') + 1)] : ['127.0.0.1', LISTEN];
const port = Number(portRaw);

/** 去掉 /v1.44 这类版本前缀，只看真实路径 */
const stripVersion = (p) => p.replace(/^\/v\d+(?:\.\d+)?(?=\/)/, '');

/**
 * 白名单。只写正例，不写反例 —— 漏一个 403 无所谓，多放一个就是洞。
 * 这些正好覆盖 fnStart 的全部 Docker 调用：版本协商、列容器、查单个容器详情。
 */
const ALLOWED = [
  /^\/_ping$/,
  /^\/version$/,
  /^\/containers\/json$/,
  /^\/containers\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\/json$/,
];

const denyLog = { last: 0, count: 0 };

const server = http.createServer((req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const real = stripVersion((req.url || '/').split('?')[0]);
  const query = (req.url || '').includes('?') ? '?' + (req.url || '').split('?')[1] : '';

  if (method !== 'GET' && method !== 'HEAD') {
    return refuse(req, res, 405, `只允许 GET，收到 ${method}`);
  }
  if (!ALLOWED.some((re) => re.test(real))) {
    return refuse(req, res, 403, `这个端点不对外：${real}`);
  }

  const up = http.request(
    {
      socketPath: SOCKET,
      method: 'GET',
      path: real + query,
      timeout: 8000,
      headers: { Host: 'localhost', Accept: 'application/json' },
    },
    (r) => {
      const chunks = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          r.destroy();
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end('{"message":"上游响应过大"}');
          return;
        }
        chunks.push(c);
      });
      r.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks);
        res.writeHead(r.statusCode || 502, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
  );

  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '连不上 docker socket：' + e.message }));
  });
  up.on('timeout', () => up.destroy(new Error('超时')));
  up.end();
});

function refuse(req, res, code, why) {
  // 同一秒内的拒绝合并成一行，免得被扫的时候刷满日志
  const now = Date.now();
  if (now - denyLog.last > 1000) {
    console.warn(`[docker-proxy] 拒绝 ${req.method} ${req.url} —— ${why}`);
    denyLog.last = now;
  }
  denyLog.count++;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ message: why }));
}

server.listen(port, host, () => {
  console.log(`[docker-proxy] 监听 http://${host}:${port} → ${SOCKET}`);
  console.log('[docker-proxy] 只放行 GET /version、/containers/json、/containers/<id>/json');
  if (host !== '127.0.0.1' && host !== '::1') {
    console.warn('[docker-proxy] 警告：不在回环地址上，局域网可以访问这个代理');
  }
});
