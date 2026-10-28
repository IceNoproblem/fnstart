/**
 * 自采系统指标 —— 不再依赖 fnMonitor。
 *
 * 数据来源只有两处：
 *   /host/proc  宿主机 procfs（compose 里已挂）
 *   /host/sys   宿主机 sysfs（compose 里挂 /sys:/host/sys:ro）
 *
 * 设计要点：
 * - 一个字节的第三方依赖都没有，全用 Node 内置 + 读文件
 * - CPU / 网络 / 功耗是「差分型」指标，必须两次采样才有值；这里缓存上一次的快照，
 *   调用方拿到的永远是「上次调用到现在」的平均值，不必等
 * - 输出结构与原来 fnMonitor 的 /api/overview 解析结果保持一致，前端不用改
 * - 传感器一律做有效性过滤：主板上没接的通道会返回 -55℃、风扇返回 0，照搬会很难看
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const PROC = process.env.HOST_PROC || '/host/proc';
const SYS = process.env.HOST_SYS || '/host/sys';
/** 存储空间：/data 是 /vol1 的 bind mount，其它卷按 /host/volN 探测（没挂就跳过） */
const DATA_DIR = process.env.DATA_DIR || '/data';

const readText = async (p) => {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return '';
  }
};
const readNum = async (p) => {
  const t = await readText(p);
  const n = Number(t.trim());
  return Number.isFinite(n) ? n : null;
};

/* ---------------- CPU ---------------- */

const cpuSnapshot = async () => {
  const stat = await readText(path.join(PROC, 'stat'));
  if (!stat) return null;
  const perCore = [];
  let total = 0;
  let idle = 0;
  for (const line of stat.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    const name = parts[0];
    const nums = parts.slice(1).map(Number);
    // user nice system idle iowait irq softirq steal
    const sum = nums.slice(0, 8).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const idleAll = (nums[3] || 0) + (nums[4] || 0);
    if (name === 'cpu') {
      total = sum;
      idle = idleAll;
    } else {
      perCore.push({ total: sum, idle: idleAll });
    }
  }
  return { total, idle, perCore, at: Date.now() };
};

let lastCpu = null;

/** 距离上次采样不足 400ms 时直接用上次的差值，避免每次请求都卡 400ms */
const cpuUsage = async () => {
  const now = await cpuSnapshot();
  if (!now) return { percent: 0, perCore: [] };
  const base = lastCpu;
  lastCpu = now;
  if (!base || now.total <= base.total) return { percent: 0, perCore: [] };
  const dTotal = now.total - base.total;
  const dIdle = now.idle - base.idle;
  const percent = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;
  const perCore = now.perCore.map((c, i) => {
    const b = base.perCore[i];
    if (!b || c.total <= b.total) return 0;
    const dt = c.total - b.total;
    const di = c.idle - b.idle;
    return dt > 0 ? ((dt - di) / dt) * 100 : 0;
  });
  return { percent, perCore };
};

/* ---------------- 内存 ---------------- */

const memInfo = async () => {
  const raw = await readText(path.join(PROC, 'meminfo'));
  const map = {};
  for (const line of raw.split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) map[m[1]] = Number(m[2]) * 1024; // kB → B
  }
  const total = map.MemTotal || 0;
  // MemAvailable 才是「应用真正能拿到的」，used 按 total-available 算，和 free/htop 口径一致
  const avail = map.MemAvailable ?? map.MemFree ?? 0;
  const used = Math.max(0, total - avail);
  const swapTotal = map.SwapTotal || 0;
  const swapUsed = Math.max(0, swapTotal - (map.SwapFree || 0));
  return {
    total,
    used,
    percent: total ? (used / total) * 100 : 0,
    swapPercent: swapTotal ? (swapUsed / swapTotal) * 100 : 0,
  };
};

/* ---------------- 传感器（hwmon） ---------------- */

const SENSOR_ROLE = {
  coretemp: 'cpu',
  k10temp: 'cpu',
  zenpower: 'cpu',
  acpitz: 'acpi',
  it8628: 'board',
  it8728: 'board',
  it8688: 'board',
  nct6775: 'board',
  nct6798: 'board',
  nvme: 'nvme',
  drivetemp: 'disk',
  i915: 'gpu',
  amdgpu: 'gpu',
};

/**
 * 扫一遍 /host/sys/class/hwmon。
 * 注意「无效通道」：主板上没接的温度通道会返回 -55℃，风扇没插返回 0。
 * 不做过滤会把面板搞得很难看，所以范围外的直接丢。
 */
const readHwmon = async () => {
  const out = { cpu: [], board: [], acpi: [], nvme: [], disk: [], gpu: [], fans: [] };
  let names = [];
  try {
    names = await fs.readdir(path.join(SYS, 'class/hwmon'));
  } catch {
    return out;
  }
  for (const dir of names) {
    const base = path.join(SYS, 'class/hwmon', dir);
    const name = (await readText(path.join(base, 'name'))).trim();
    const role = SENSOR_ROLE[name] || '';
    let files = [];
    try {
      files = await fs.readdir(base);
    } catch {
      continue;
    }
    for (const f of files) {
      if (/^temp\d+_input$/.test(f)) {
        const v = await readNum(path.join(base, f));
        const c = v == null ? null : v / 1000;
        if (c == null || c < -20 || c > 150) continue;
        if (role && out[role]) out[role].push({ sensor: name, label: f, c });
      } else if (/^fan\d+_input$/.test(f)) {
        const v = await readNum(path.join(base, f));
        // 0 表示这个风扇接口没接，跳过
        if (v && v > 0 && v < 20000) out.fans.push(v);
      }
    }
  }
  return out;
};

const maxOf = (arr) => (arr.length ? Math.max(...arr.map((x) => x.c)) : null);
const avgOf = (arr) => (arr.length ? arr.reduce((a, x) => a + x.c, 0) / arr.length : null);

/* ---------------- 功耗（RAPL） ---------------- */

const raplEnergy = async () => {
  const v = await readNum(path.join(SYS, 'class/powercap/intel-rapl:0/energy_uj'));
  return v;
};

let lastRapl = null;

/** RAPL 是累计能量（微焦），两次差分除以时间就是瓦特 */
const raplPower = async () => {
  const now = await raplEnergy();
  const at = Date.now();
  if (now == null) return null;
  const base = lastRapl;
  lastRapl = { energy: now, at };
  if (!base) return null;
  const dJoule = (now - base.energy) / 1e6;
  const dSec = (at - base.at) / 1000;
  if (dSec <= 0 || dJoule < 0) return null;
  const w = dJoule / dSec;
  // 明显超出消费级上限的值当异常（RAPL 计数器回绕时会跳）
  return w > 0 && w < 600 ? w : null;
};

/* ---------------- 网络 ---------------- */

const netSnapshot = async () => {
  const raw = await readText(path.join(PROC, 'net/dev'));
  if (!raw) return null;
  const list = [];
  for (const line of raw.split('\n')) {
    const m = /^\s*([^:]+):\s*(.+)$/.exec(line);
    if (!m) continue;
    const iface = m[1].trim();
    if (/^(lo|docker|veth|br-|virbr|tap|tun|ovs|safeline|bonding)/i.test(iface)) continue;
    const nums = m[2].trim().split(/\s+/).map(Number);
    list.push({ iface, rx: nums[0] || 0, tx: nums[8] || 0 });
  }
  return { list, at: Date.now() };
};

let lastNet = null;

const netRates = async () => {
  const now = await netSnapshot();
  if (!now) return { iface: '', rx: 0, tx: 0, rxTotal: 0, txTotal: 0 };
  const base = lastNet;
  lastNet = now;
  // 取累计流量最大的那张当主网卡
  const main = now.list.slice().sort((a, b) => b.rx - a.rx)[0];
  if (!main) return { iface: '', rx: 0, tx: 0, rxTotal: 0, txTotal: 0 };
  let rx = 0;
  let tx = 0;
  const b = base?.list.find((x) => x.iface === main.iface);
  if (b && now.at > base.at) {
    const dt = (now.at - base.at) / 1000;
    rx = Math.max(0, (main.rx - b.rx) / dt);
    tx = Math.max(0, (main.tx - b.tx) / dt);
  }
  return { iface: main.iface, rx, tx, rxTotal: main.rx, txTotal: main.tx };
};

/* ---------------- 磁盘容量 ---------------- */

/**
 * 存储空间：/data 固定对应 /vol1（compose 里 bind 过来的）。
 * 其它卷（/vol2、/vol3…）只有显式挂到 /host/volN 才看得到 —— 没挂就静默跳过，
 * 不会因此少一条指标就报错。
 */
const diskUsage = async (temps) => {
  const candidates = [{ mount: '/vol1', probe: DATA_DIR }];
  try {
    const dirs = await fs.readdir('/host');
    for (const d of dirs) {
      if (/^vol\d+$/.test(d)) candidates.push({ mount: `/${d}`, probe: `/host/${d}` });
    }
  } catch {
    /* 没挂 /host/volN 就算了 */
  }

  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (seen.has(c.mount)) continue;
    try {
      const s = await fs.statfs(c.probe);
      // 注意字段名：statfs 返回 blocks / bfree / bavail，没有 free。写成 s.free 会得到 NaN
      const total = s.blocks * s.bsize;
      const used = (s.blocks - s.bfree) * s.bsize; // 与 df 的 Used 口径一致
      if (!total) continue;
      seen.add(c.mount);
      out.push({
        mount: c.mount,
        name: c.mount,
        percent: Math.round((used / total) * 100),
        usedTB: Math.round((used / 1024 ** 4) * 100) / 100,
        totalTB: Math.round((total / 1024 ** 4) * 100) / 100,
        temp: null,
        health: '',
      });
    } catch {
      /* 这个卷不存在 */
    }
  }
  // 盘温按「温度降序」贴到各卷（drivetemp 不提供挂载点对应关系，只能尽力而为）
  const ds = temps.slice().sort((a, b) => b.c - a.c);
  out.forEach((d, i) => {
    if (ds[i]) d.temp = Math.round(ds[i].c);
  });
  return out;
};

/* ---------------- 汇总 ---------------- */

let cached = null;
let cachedAt = 0;
const CACHE_MS = 2000;

/**
 * 采一份完整的系统快照。
 * 2 秒内重复调用直接给缓存 —— 前端 5 秒一轮询，没必要每次都重算。
 */
export async function systemSnapshot() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;

  const [usage, mem, hw, power, net, uptimeRaw, loadavg, hostname, kernel, model] = await Promise.all([
    cpuUsage(),
    memInfo(),
    readHwmon(),
    raplPower(),
    netRates(),
    readText(path.join(PROC, 'uptime')),
    readText(path.join(PROC, 'loadavg')),
    readText(path.join(PROC, 'sys/kernel/hostname')),
    readText(path.join(PROC, 'sys/kernel/osrelease')),
    readText(path.join(PROC, 'cpuinfo')),
  ]);

  // 频率：优先 cpufreq，其次 cpuinfo 的 MHz
  let freqMhz = 0;
  const f = await readNum(path.join(SYS, 'devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'));
  if (f) freqMhz = Math.round(f / 1000);
  else {
    const m = /cpu MHz\s*:\s*([\d.]+)/.exec(model);
    if (m) freqMhz = Math.round(Number(m[1]));
  }
  const modelName = (/model name\s*:\s*(.+)/.exec(model) || [])[1] || '';
  const threads = (model.match(/^processor\s*:/gm) || []).length;

  const upSec = Number((uptimeRaw.split(/\s+/)[0] || 0));
  const load = (loadavg.trim().split(/\s+/).slice(0, 3).map(Number) || []).filter(Number.isFinite);

  const disks = await diskUsage(hw.disk);

  const snap = {
    online: true,
    source: 'native',
    host: hostname.trim() || 'NAS',
    os: '', // 飞牛版本号在宿主 /etc 里，容器看不到；前端会退回显示内核
    kernel: kernel.trim(),
    uptime: upSec,
    cpu: {
      percent: Math.round(usage.percent * 10) / 10,
      perCore: usage.perCore.map((n) => Math.round(n)),
      load,
      cores: hw.cpu.length ? Math.max(1, Math.round(threads / 2)) : threads,
      threads,
      model: modelName.trim(),
      freq: freqMhz,
    },
    mem: {
      percent: Math.round(mem.percent * 10) / 10,
      usedGB: Math.round((mem.used / 1024 ** 3) * 10) / 10,
      totalGB: Math.round((mem.total / 1024 ** 3) * 10) / 10,
      swapPercent: Math.round(mem.swapPercent),
    },
    temp: {
      cpu: maxOf(hw.cpu) != null ? Math.round(maxOf(hw.cpu)) : null,
      system: maxOf(hw.board) ?? maxOf(hw.acpi),
    },
    power: { total: power, source: power ? 'RAPL' : '' },
    disks,
    net,
    diskTemps: hw.disk.map((d, i) => ({
      name: disks[i]?.mount || `磁盘 ${i + 1}`,
      temp: Math.round(d.c),
      health: '',
    })),
    fans: hw.fans,
    gpu: hw.gpu.length ? { name: 'Intel 核显', util: null, temp: Math.round(maxOf(hw.gpu)) } : null,
    containers: { total: 0, running: 0, list: [] }, // 由 server.js 填，走 docker 代理
  };

  cached = snap;
  cachedAt = Date.now();
  return snap;
}

/** 冷启动预热：让第一次请求就能拿到 CPU/网络/功耗的差值 */
export async function warmup() {
  await cpuSnapshot().then((s) => {
    if (s) lastCpu = s;
  });
  await netSnapshot().then((s) => {
    if (s) lastNet = s;
  });
  await raplPower();
}
