import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const CONFIG = {
  port: num(process.env.PORT, 3721),
  /**
   * 监听地址。默认 0.0.0.0（纯内网直接用）。
   * 前面挂了反代之后建议改成 127.0.0.1 —— 这样只有反代能连进来，
   * 局域网里别人没法绕过反代的限速和 WAF 直连。
   */
  host: process.env.HOST || '0.0.0.0',
  /** 数据目录：data.json、icons/、backgrounds/ 都在这里 */
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  publicDir: path.join(ROOT, 'public'),
  /** Docker unix socket，用于自动发现容器 Web 界面 */
  dockerSock: process.env.DOCKER_SOCK || '/var/run/docker.sock',
  /**
   * 宿主机 procfs 挂载点。
   * host 网络模式的容器没有端口映射，要从进程持有的 socket 反查端口归属，
   * 就必须能看到宿主机进程表（-v /proc:/host/proc:ro）。留空则自动探测。
   */
  procRoot: process.env.PROC_ROOT || '',
  /** 未指定时用访问导航页的主机名去拼容器地址（浏览器怎么进来的就怎么出去） */
  publicHost: process.env.PUBLIC_HOST || '',
  /**
   * 飞牛监控服务地址。留空 = 自动跟随访问导航页的主机名 + monitorPort，
   * 换机器/换 IP 部署都不用改配置；用 https 或反代域名时再手动填。
   */
  monitorUrl: process.env.MONITOR_URL || '',
  monitorPort: num(process.env.MONITOR_PORT, 8777),
  /** 天气预报城市默认值（可在设置里改） */
  weatherCity: process.env.WEATHER_CITY || '北京',
  /** 探测超时：单个候选地址 */
  probeTimeout: num(process.env.PROBE_TIMEOUT, 2500),
  /** 探测并发 */
  probeConcurrency: num(process.env.PROBE_CONCURRENCY, 8),
  /** 额外扫描的端口（拿不到 /proc 时用于兜底，逗号分隔） */
  probePorts: String(process.env.PROBE_PORTS || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0),
  /**
   * 访问令牌。留空 = 不校验（纯内网用，行为和以前完全一样）。
   * 打算把端口映射到公网就必须设一个，否则任何人都能改卡片、读监控数据、导出整份备份。
   */
  // 媒体库根目录：留空则自动探测（容器内 /host/vol1，裸机 /vol1）
  mediaRoot: process.env.MEDIA_ROOT || '',
  accessToken: process.env.ACCESS_TOKEN || '',
  /**
   * 禁止服务端去抓内网地址的图标（防 SSRF）。
   * 默认跟随令牌：设了 ACCESS_TOKEN 就自动开启；纯内网保持关闭，不影响抓内网服务的 favicon。
   */
  blockPrivateFetch: process.env.BLOCK_PRIVATE_FETCH
    ? /^(1|true|yes)$/i.test(process.env.BLOCK_PRIVATE_FETCH)
    : !!process.env.ACCESS_TOKEN,

  /**
   * 是否采信 X-Forwarded-For / X-Real-IP。
   *
   * 默认关闭 —— 这两个头谁都能写，默认信任等于把「按 IP 限速」直接废掉。
   * 只有确认「前面挂了反代、且应用端口只有反代能连到」时才开到 1。
   * 开启后仍会校验直连方是不是可信反代（见 TRUST_PROXY_CIDRS），
   * 不是可信来源时照样只认 socket 的对端地址。
   */
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || ''),

  /** 反代所在网段：逗号分隔的 CIDR 或单个 IP。留空只认环回 + 本机地址 */
  trustProxyCidrs: String(process.env.TRUST_PROXY_CIDRS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
};

export const DATA_FILE = path.join(CONFIG.dataDir, 'data.json');
export const ICON_DIR = path.join(CONFIG.dataDir, 'icons');
export const BG_DIR = path.join(CONFIG.dataDir, 'backgrounds');
