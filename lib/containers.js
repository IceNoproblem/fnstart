/**
 * 每个容器的资源占用（CPU% / 内存）。
 *
 * Docker 的 /containers/json 只有状态，没有资源；要拿占用必须逐个请求
 * /containers/<id>/stats?stream=false。23 个容器就是 23 次请求，所以：
 *   - 并发压到 4，避免把 docker.sock 打满
 *   - 结果缓存 5 秒（面板 5 秒一轮询，正好复用）
 *   - 单个容器失败不影响其它，那一项就留空
 *
 * 口径说明：CPU% 是**占整机**的百分比（4 核里吃满 1 核 = 25%），
 * 和面板里「处理器」那张卡同一个口径，用户看着不打架。
 * `docker stats` 命令行显示的是多核累加值（会超过 100%），换算关系是 × 核数，
 * 这里不采用 —— 面板上出现 400% 会让人以为出错。
 */
import { dockerApi } from './docker.js';

const CACHE_MS = 5000;
let cache = null;
let cacheAt = 0;
let inflight = null;

const pool = async (items, limit, fn) => {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          out[idx] = await fn(items[idx], idx);
        } catch {
          out[idx] = null;
        }
      }
    }),
  );
  return out;
};

/** 容器状态：running / exited / unhealthy …，面板按这个上色 */
const stateOf = (c) => {
  const s = (c.State || '').toLowerCase();
  const status = (c.Status || '').toLowerCase();
  if (s === 'running' && status.includes('unhealthy')) return 'unhealthy';
  return s || 'unknown';
};

const oneStats = async (c) => {
  const name = (c.Names?.[0] || '').replace(/^\//, '');
  const state = stateOf(c);
  const item = { name, state, health: c.Status || '', cpu: null, mem: null, memMB: null };
  if (state !== 'running' && state !== 'unhealthy') return item;

  const st = await dockerApi(`/containers/${c.Id}/stats?stream=false`, 4000);
  if (!st) return item;

  // CPU：两次采样差 / 系统时间差，得到占整机的百分比
  const cpuDelta = (st.cpu_stats?.cpu_usage?.total_usage || 0) - (st.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysDelta = (st.cpu_stats?.system_cpu_usage || 0) - (st.precpu_stats?.system_cpu_usage || 0);
  if (sysDelta > 0 && cpuDelta >= 0) {
    // 不乘 online_cpus：乘了就是 docker stats 的多核累加口径
    item.cpu = Math.round((cpuDelta / sysDelta) * 1000) / 10;
  }

  // 内存：usage 里含 page cache，减掉才接近 docker stats 的数字
  const m = st.memory_stats || {};
  const usage = Math.max(0, (m.usage || 0) - (m.stats?.inactive_file ?? m.stats?.cache ?? 0));
  const limit = m.limit || 0;
  if (usage) item.memMB = Math.round(usage / 1024 / 1024);
  if (limit && limit < 2 ** 62) item.mem = Math.round((usage / limit) * 1000) / 10;
  return item;
};

/**
 * 返回 { total, running, list: [{name,state,health,cpu,mem,memMB}] }
 * 按 CPU 降序，方便面板一眼看出谁在吃资源。
 */
export async function containerStats({ wait = true } = {}) {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;

  /*
   * 请求路径（wait=false）：有旧数据就先给旧数据，让后台继续刷；
   * 连一轮都还没采完就直接返回 pending 空壳，别让用户盯着转圈。
   * 后台定时器（wait=true）才真的等结果。
   */
  if (!wait) {
    if (!inflight) containerStats().catch(() => {}); // 顺手催一轮，不等待
    return cache || { total: 0, running: 0, list: [], pending: true };
  }

  if (inflight) return inflight;

  inflight = (async () => {
    let raw = [];
    try {
      raw = await dockerApi('/containers/json?all=1');
    } catch {
      raw = [];
    }
    const running = raw.filter((c) => ['running', 'unhealthy'].includes(stateOf(c)));
    // 只对运行中的拉 stats；已停止的直接显示状态就够了
    const details = await pool(raw, 8, oneStats);
    const list = details
      .filter(Boolean)
      // 按资源占用从高到低：CPU 优先，相同再比内存，最后用名字兜底保证顺序稳定
      .sort(
        (a, b) =>
          (b.cpu || 0) - (a.cpu || 0) ||
          (b.memMB || 0) - (a.memMB || 0) ||
          a.name.localeCompare(b.name),
      );
    const out = { total: raw.length, running: running.length, list };
    cache = out;
    cacheAt = Date.now();
    return out;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}


/**
 * 后台常驻采集。
 *
 * 为什么需要：Docker 的 stats?stream=false 每次要等约 1 秒（它内部要采两个时间点才给差值），
 * 25 个容器就算并发 8 也要 4 秒上下。放在请求路径里等，用户刷新页面就要盯着空白看好几秒。
 * 改成后台每 5 秒自己刷一遍，接口永远只读缓存 —— 首屏 0.1 秒就能出系统指标，
 * 容器区晚一两秒补上，不影响使用。
 */
let timer = null;

export function startContainerWatcher(intervalMs = 5000) {
  if (timer) return;
  const tick = () => {
    containerStats().catch(() => {});
  };
  tick(); // 立刻先跑一轮，别等第一个 5 秒
  timer = setInterval(tick, intervalMs);
  timer.unref?.(); // 别因为这个定时器把进程钉住
}

/** 当前缓存是否已有一轮结果（前端用来决定要不要显示「采集中」） */
export function containerCacheReady() {
  return !!cache;
}
