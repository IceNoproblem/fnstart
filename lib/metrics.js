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
        // 带上看 label：coretemp 里 "Package id 0" 是整颗 CPU，其余是单核
        const label = (await readText(path.join(base, f.replace('_input', '_label')))).trim();
        if (role && out[role]) out[role].push({ sensor: name, label: label || f, c });
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

/** CPU 温度：有 Package 用 Package，否则各核取平均 */
const rawCpuTemp = (cores) => {
  if (!cores.length) return null;
  const pkg = cores.find((x) => /package/i.test(x.label || ''));
  if (pkg) return Math.round(pkg.c);
  const avg = cores.reduce((a, x) => a + x.c, 0) / cores.length;
  return Math.round(avg);
};

/*
 * 温度平滑（EMA）。
 *
 * 为什么需要：i7-7700K 这类桌面 U 的空闲温度很低（27℃），随便一个请求处理
 * 就会瞬时冲到 50℃，下一采样又掉回 27。12 次采样实测：27/27/27/27/27/32/27/35/27/49/27/28。
 * 数字本身没错，但面板上每 5 秒跳 20 度，看着像传感器坏了。
 *
 * 上升跟得快（0.45）、下降拖得慢（0.2）——峰值不会被藏掉，只是不会一闪而过。
 */
let tempEma = null;
const smoothTemp = (raw) => {
  if (raw == null) return tempEma;
  if (tempEma == null) {
    tempEma = raw;
    return raw;
  }
  const a = raw > tempEma ? 0.45 : 0.2;
  tempEma += (raw - tempEma) * a;
  return Math.round(tempEma);
};
const avgOf = (arr) => (arr.length ? arr.reduce((a, x) => a + x.c, 0) / arr.length : null);

/* ---------------- 功耗（RAPL + 估算） ---------------- */

/*
 * RAPL 只测得到 CPU 封装和内存（DRAM 是封装外的独立域），测不到主板、硬盘、风扇、网卡。
 * 所以「整机功耗」= RAPL(package + dram) + 主板基础功耗 + 硬盘数 × 单盘典型功耗。
 * 这套算法照 fnMonitor 的做法来（它也是 RAPL 打底 + 经验值补），
 * 好处是两边数字对得上；代价是**它终究是估算**，不是电表读数。
 */
const raplDomain = async (dir) => {
  const base = path.join(SYS, 'class/powercap', dir);
  const e = await readNum(path.join(base, 'energy_uj'));
  if (e == null) return null;
  return { e, max: await readNum(path.join(base, 'max_energy_range_uj')) };
};

let lastRapl = null;

const raplPower = async () => {
  const pkg = await raplDomain('intel-rapl:0');
  if (!pkg) return null;
  const dram = await raplDomain('intel-rapl:0:2'); // DRAM 域，没有就算了
  const now = { pkg, dram, at: Date.now() };
  const base = lastRapl;
  lastRapl = now;
  if (!base) return null;

  const dt = (now.at - base.at) / 1000;
  if (dt <= 0) return null;

  const joules = (cur, prev) => {
    if (!cur || !prev || cur.e == null || prev.e == null) return 0;
    let d = cur.e - prev.e;
    // energy_uj 单调递增，到 max_energy_range_uj 会回绕
    if (d < 0 && cur.max) d += cur.max;
    return d / 1e6;
  };

  const pkgW = joules(pkg, base.pkg) / dt;
  const dramW = joules(dram, base.dram) / dt;
  if (pkgW < 0 || pkgW > 500) return null; // 计数器刚回绕之类，丢掉
  return { package: pkgW, dram: dramW > 0 && dramW < 200 ? dramW : 0 };
};

/** 主板/网卡/风扇等 RAPL 测不到的部分，按经验值补（可用环境变量覆盖） */
const POWER_BASE_W = Number(process.env.POWER_BASE_W ?? 8);
/** 单块硬盘的典型功耗（机械盘约 8W，全闪可以调小） */
const POWER_DISK_W = Number(process.env.POWER_DISK_W ?? 8);

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

/* ---------------- 显卡型号 ---------------- */

/*
 * 容器里没有 lspci，但 sysfs 里有 PCI ID（vendor:device），查表就能还原型号。
 * 表只收常见的 Intel 核显；查不到就退回设备 ID，总比不显示强。
 */
const INTEL_IGPU = {
  '0x5912': 'HD Graphics 630',
  '0x5916': 'HD Graphics 620',
  '0x5917': 'UHD Graphics 620',
  '0x3e92': 'UHD Graphics 630',
  '0x3e91': 'UHD Graphics 630',
  '0x3e98': 'UHD Graphics 630',
  '0x9bc5': 'UHD Graphics 630',
  '0x9b41': 'UHD Graphics 620',
  '0x4680': 'UHD Graphics 770',
  '0x4690': 'UHD Graphics 770',
  '0xa780': 'UHD Graphics 770',
  '0x4692': 'Iris Xe Graphics',
  '0xa7a0': 'Iris Xe Graphics',
  '0x1606': 'HD Graphics 530',
  '0x1912': 'HD Graphics 530',
  '0x0412': 'HD Graphics 4600',
  '0x0a16': 'HD Graphics 4400',
  '0x1a02': 'HD Graphics 610',
};

const gpuModel = async () => {
  const base = path.join(SYS, 'class/drm/card0/device');
  const vendor = (await readText(path.join(base, 'vendor'))).trim().toLowerCase();
  const device = (await readText(path.join(base, 'device'))).trim().toLowerCase();
  if (!vendor || !device) return '';
  if (vendor === '0x8086' && INTEL_IGPU[device]) return INTEL_IGPU[device];
  return device.toUpperCase().replace('0X', '0x');
};

/* ---------------- 汇总 ---------------- */

let cached = null;
let cachedAt = 0;
/** 缓存对应的功耗参数。参数变了就是另一份数据，不能拿旧缓存糊过去 */
let cachedKey = '';
/** 正在跑的那一轮采集。同一时刻只允许一轮，缓存刚过期时别让十个请求各扫一遍 */
let inflight = null;
/** 后台预热是否在跑。在跑的话，请求路径永远不等采集 */
let watcher = null;
const CACHE_MS = 2000;
const WATCH_MS = 5000;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * 功耗常数来自用户设置，会改变快照里 power 那一块的数字，所以要进缓存键。
 * 三个调用点（后台预热 / monitor/stats / monitor/ping）必须传同一份，
 * 否则同一份缓存被两套参数来回覆盖，每次请求都得重采一遍。
 */
const optsKey = (o = {}) =>
  `${num(o.powerTdpW, 0)}|${num(o.powerBaseW, POWER_BASE_W)}|${num(o.powerDiskW, POWER_DISK_W)}`;

/**
 * 采集一轮并写进缓存。
 *
 * inflight 就是惊群保护：缓存过期那一瞬间同时进来十个请求，
 * 它们要的是同一份数据，扫十遍传感器纯属白烧 —— 后来的一律等同一次的结果。
 * 不区分 key 是有意的：参数刚改的那一下，复用上一轮（差一个功耗常数）
 * 总好过并发跑两轮把 CPU/网络/功耗的差分基线互相踩坏，下一轮就自动更正了。
 */
function collect(key, opts) {
  if (inflight) return inflight;
  inflight = buildSnapshot(opts)
    .then((snap) => {
      cached = snap;
      cachedAt = Date.now();
      cachedKey = key;
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

async function buildSnapshot(opts) {
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
  const gpuName = await gpuModel();

  // 整机功耗 = RAPL(封装+内存) + 主板基础 + 每块盘按典型值折算
  const diskCount = hw.disk.length + hw.nvme.length;
  // 硬件参数允许用户在图层面板里改（不同主板/硬盘差得挺多）
  const baseW = Number(opts.powerBaseW ?? POWER_BASE_W);
  const diskW = Number(opts.powerDiskW ?? POWER_DISK_W);
  const tdpW = Number(opts.powerTdpW) || 0;
  let powerTotal = null;
  let powerParts = null;

  /*
   * CPU 功耗两条路：
   *   填了 TDP → 按 TDP × CPU 占用率 估算（可解释、可对账，谁都能自己算一遍）
   *   没填 TDP → 用 RAPL 实测（更准，但只有 Intel / AMD zen2+ 才有）
   */
  if (tdpW > 0) {
    const cpuW = (tdpW * Math.min(100, Math.max(0, usage.percent))) / 100;
    powerTotal = Math.round((cpuW + baseW + diskCount * diskW) * 10) / 10;
    powerParts = {
      cpu: Math.round(cpuW * 10) / 10,
      tdp: tdpW,
      cpuPercent: Math.round(usage.percent),
      base: baseW,
      disks: diskCount * diskW,
      diskCount,
      mode: 'estimate',
    };
  } else if (power) {
    const raplSum = power.package + power.dram;
    powerTotal = Math.round((raplSum + baseW + diskCount * diskW) * 10) / 10;
    powerParts = {
      cpu: Math.round(power.package * 10) / 10,
      dram: Math.round(power.dram * 10) / 10,
      base: baseW,
      disks: diskCount * diskW,
      diskCount,
      mode: 'rapl',
    };
  }

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
      /*
       * CPU 温度取「封装温度」，没有封装值就取各核平均。
       * 不用最热核：coretemp 里各核能差 10℃ 以上，取 max 会比飞牛监控、
       * htop 这些常见工具高出一大截，看起来像传感器不准。
       */
      cpu: smoothTemp(rawCpuTemp(hw.cpu)),
      cpuRaw: rawCpuTemp(hw.cpu), // 未平滑的原始值，排查传感器时用
      system: maxOf(hw.board) ?? maxOf(hw.acpi),
    },
    power: {
      total: powerTotal,
      package: power?.package != null ? Math.round(power.package * 10) / 10 : null,
      parts: powerParts,
      // 说清楚这是估算：RAPL 只测得到 CPU 和内存，其余按经验值补
      source: powerParts ? (powerParts.mode === 'rapl' ? 'RAPL+估算' : '按 TDP 估算') : '',
    },
    disks,
    net,
    diskTemps: hw.disk.map((d, i) => ({
      name: disks[i]?.mount || `磁盘 ${i + 1}`,
      temp: Math.round(d.c),
      health: '',
    })),
    fans: hw.fans,
    gpu: hw.gpu.length
      ? { name: gpuName || '核显', util: null, temp: Math.round(maxOf(hw.gpu)) }
      : null,
    containers: { total: 0, running: 0, list: [] }, // 由 server.js 填，走 docker 代理
  };

  return snap;
}

/**
 * 取一份系统快照。
 *
 * 有后台预热（startMetricsWatcher）在跑时，请求路径里既不等采集、也不触发采集：
 * 手上这份最多旧 5 秒，而指标本来就是「每 5 秒轮询看一次」的东西，旧 5 秒看不出来；
 * 反过来，让人等一次 30~160ms 的传感器扫描才是真的卡 —— 那一段时间里
 * 所有别的请求（静态文件、/api/state、图标）都排在它后面。
 *
 * 没有后台预热时（单独引用这个模块）就退回原来的 TTL 行为，语义不变。
 */
export async function systemSnapshot(opts = {}) {
  const key = optsKey(opts);
  if (cached && cachedKey === key && (watcher || Date.now() - cachedAt < CACHE_MS)) return cached;
  // 还没采过（冷启动），或者功耗参数刚改过：这一轮只能等，每档参数一辈子等这一次
  return collect(key, opts);
}

/**
 * 后台常驻采样。
 *
 * 为什么需要：一轮完整采集要扫 /host/proc 和 /host/sys 上几十个文件，
 * 冷的跑一次 30~160ms。原来「缓存过期就由下一个请求去采」，结果就是
 * 面板每 5 秒轮询一次、每 5 秒卡一下。改成后台自己刷，接口永远只读内存。
 *
 * getOpts 是回调而不是让这里直接读设置：功耗常数存在用户设置里，
 * 而 metrics 这层不该知道 store 的存在。
 */
export function startMetricsWatcher(getOpts, intervalMs = WATCH_MS) {
  if (watcher) return;
  const tick = async () => {
    try {
      const opts = (await getOpts()) || {};
      await collect(optsKey(opts), opts);
    } catch {
      /* 单轮失败等下一轮，指标偶尔缺一格不影响看 */
    }
  };
  // 第一轮等一秒：CPU/网络/功耗都是差分型指标，紧接着 warmup 采只会得到 0
  setTimeout(tick, 1000).unref?.();
  watcher = setInterval(tick, intervalMs);
  watcher.unref?.(); // 别因为这个定时器把容器钉住不让退出
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
