// 天气：open-meteo 免密钥，先用地理编码把城市名换成坐标
const WMO = {
  0: ['晴', '☀'],
  1: ['晴间多云', '🌤'],
  2: ['多云', '⛅'],
  3: ['阴', '☁'],
  45: ['雾', '🌫'],
  48: ['雾凇', '🌫'],
  51: ['毛毛雨', '🌦'],
  53: ['毛毛雨', '🌦'],
  55: ['浓毛毛雨', '🌦'],
  56: ['冻毛毛雨', '🌧'],
  57: ['冻毛毛雨', '🌧'],
  61: ['小雨', '🌧'],
  63: ['中雨', '🌧'],
  65: ['大雨', '🌧'],
  66: ['冻雨', '🌧'],
  67: ['冻雨', '🌧'],
  71: ['小雪', '🌨'],
  73: ['中雪', '🌨'],
  75: ['大雪', '❄'],
  77: ['米雪', '🌨'],
  80: ['阵雨', '🌦'],
  81: ['强阵雨', '🌧'],
  82: ['暴雨', '⛈'],
  85: ['阵雪', '🌨'],
  86: ['强阵雪', '❄'],
  95: ['雷阵雨', '⛈'],
  96: ['雷雨伴冰雹', '⛈'],
  99: ['强雷暴', '⛈'],
};

const cache = new Map();
const TTL = 15 * 60 * 1000;

async function getJson(url, timeout = 7000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': 'fnstart/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 内置城市坐标表。
 * 不依赖 open-meteo 的地理编码接口，因为那个域名在部分网络下解析/连通性很差
 * （实测直接 ETIMEDOUT），而真正取天气的 api.open-meteo.com 是通的。
 * 表里没有的城市才走在线地理编码。
 */
const CITIES = {
  北京: [39.9042, 116.4074], 上海: [31.2304, 121.4737], 广州: [23.1291, 113.2644],
  深圳: [22.5431, 114.0579], 天津: [39.3434, 117.3616], 重庆: [29.563, 106.5516],
  杭州: [30.2741, 120.1551], 南京: [32.0603, 118.7969], 苏州: [31.2989, 120.5853],
  无锡: [31.4912, 120.3119], 常州: [31.8107, 119.9741], 南通: [31.9802, 120.8943],
  徐州: [34.2058, 117.2848], 宁波: [29.8683, 121.544], 温州: [27.9939, 120.6994],
  嘉兴: [30.7522, 120.75], 绍兴: [30.0023, 120.581], 台州: [28.6564, 121.4208],
  金华: [29.0784, 119.6474], 合肥: [31.8206, 117.2272], 福州: [26.0745, 119.2965],
  厦门: [24.4798, 118.0894], 泉州: [24.8741, 118.6757], 南昌: [28.682, 115.8579],
  济南: [36.6512, 117.1201], 青岛: [36.0671, 120.3826], 烟台: [37.4638, 121.4479],
  潍坊: [36.7069, 119.1618], 郑州: [34.7466, 113.6254], 洛阳: [34.6197, 112.454],
  武汉: [30.5928, 114.3055], 长沙: [28.2282, 112.9388], 成都: [30.5728, 104.0668],
  西安: [34.3416, 108.9398], 昆明: [25.0389, 102.7183], 贵阳: [26.647, 106.6302],
  南宁: [22.817, 108.3665], 海口: [20.0442, 110.1999], 三亚: [18.2528, 109.5119],
  太原: [37.8706, 112.5489], 石家庄: [38.0428, 114.5149], 唐山: [39.6305, 118.1804],
  呼和浩特: [40.8424, 111.749], 兰州: [36.0611, 103.8343], 西宁: [36.6171, 101.7782],
  银川: [38.4872, 106.2309], 乌鲁木齐: [43.8256, 87.6168], 拉萨: [29.652, 91.1721],
  沈阳: [41.8057, 123.4315], 大连: [38.914, 121.6147], 哈尔滨: [45.8038, 126.5349],
  长春: [43.8171, 125.3235], 东莞: [23.0207, 113.7518], 佛山: [23.0219, 113.1214],
  珠海: [22.2707, 113.5767], 中山: [22.5176, 113.3926], 惠州: [23.1115, 114.4152],
  香港: [22.3193, 114.1694], 澳门: [22.1987, 113.5439], 台北: [25.033, 121.5654],
  东京: [35.6762, 139.6503], 首尔: [37.5665, 126.978], 新加坡: [1.3521, 103.8198],
  纽约: [40.7128, -74.006], 伦敦: [51.5074, -0.1278], 洛杉矶: [34.0522, -118.2437],
};

const lookupCity = (name) => {
  const raw = String(name || '').trim();
  const bare = raw.replace(/[\s市省区县]/g, '');
  return CITIES[raw] || CITIES[bare] || null;
};

export async function getWeather(city) {
  const key = String(city || '北京').trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    let lat;
    let lon;
    let label = key;
    let region = '';
    const builtin = lookupCity(key);
    if (builtin) {
      [lat, lon] = builtin;
    } else {
      // 表里没有才在线解析；超时给短一点，失败不要拖慢整页
      try {
        const geo = await getJson(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(key)}&count=1&language=zh&format=json`,
          4000,
        );
        const loc = geo?.results?.[0];
        if (!loc) {
          return { ok: false, error: `不认识城市「${key}」，试试「北京」这种常见叫法` };
        }
        lat = loc.latitude;
        lon = loc.longitude;
        label = loc.name;
        region = [loc.admin1, loc.country].filter(Boolean).join(' · ');
      } catch {
        return { ok: false, error: `在线查不到「${key}」的坐标，网络可能不通` };
      }
    }

    const w = await getJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,is_day&timezone=auto`,
    );
    const cur = w?.current;
    if (!cur) return { ok: false, error: '天气服务无响应' };

    const code = cur.weather_code;
    const info = WMO[code] || ['—', '·'];
    const data = {
      ok: true,
      city: label,
      region,
      temp: Math.round(cur.temperature_2m),
      feels: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m,
      code,
      text: info[0],
      icon: cur.is_day === 0 && code <= 3 ? (['晴', '晴间多云', '多云'].includes(info[0]) ? '🌙' : info[1]) : info[1],
      at: Date.now(),
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    // 拿不到就退回上次成功的值
    if (hit) return { ...hit.data, stale: true };
    return { ok: false, error: e.message || '天气获取失败' };
  }
}
