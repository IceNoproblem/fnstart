// 天气：wttr.in 免密钥，容器网络下 open-meteo 必超时，改用 wttr.in
// wttr.in 用的是 WWO 天气编码，和 open-meteo 的 WMO 编码不同，单独映射
const WWO = {
  113: ['晴', '☀'],
  116: ['多云', '⛅'],
  119: ['阴', '☁'],
  122: ['阴', '☁'],
  143: ['雾', '🌫'],
  176: ['阵雨', '🌦'],
  179: ['阵雪', '🌨'],
  182: ['雨夹雪', '🌨'],
  185: ['冻毛毛雨', '🌧'],
  200: ['雷阵雨', '⛈'],
  227: ['风吹雪', '🌨'],
  230: ['暴风雪', '❄'],
  248: ['雾', '🌫'],
  260: ['冻雾', '🌫'],
  263: ['小毛毛雨', '🌦'],
  266: ['毛毛雨', '🌦'],
  281: ['冻毛毛雨', '🌧'],
  284: ['强冻毛毛雨', '🌧'],
  293: ['小阵雨', '🌦'],
  296: ['小雨', '🌧'],
  299: ['中雨', '🌧'],
  302: ['中雨', '🌧'],
  305: ['强降雨', '🌧'],
  308: ['大雨', '🌧'],
  311: ['冻雨', '🌧'],
  314: ['冻雨', '🌧'],
  317: ['雨夹雪', '🌨'],
  320: ['雨夹雪', '🌨'],
  323: ['小阵雪', '🌨'],
  326: ['小雪', '🌨'],
  329: ['中阵雪', '🌨'],
  332: ['中雪', '❄'],
  335: ['强阵雪', '❄'],
  338: ['大雪', '❄'],
  350: ['冰粒', '🌨'],
  353: ['小阵雨', '🌦'],
  356: ['强阵雨', '🌧'],
  359: ['暴雨', '⛈'],
  362: ['阵雨夹雪', '🌨'],
  365: ['阵雨夹雪', '🌨'],
  368: ['小阵雪', '🌨'],
  371: ['中阵雪', '❄'],
  374: ['冰粒阵雨', '🌨'],
  377: ['冰粒阵雨', '❄'],
  386: ['雷阵雨', '⛈'],
  389: ['雷雨', '⛈'],
  392: ['雷阵雪', '⛈'],
  395: ['雷暴雪', '⛈'],
};

const cache = new Map();
const TTL = 15 * 60 * 1000;

async function getJson(url, timeout = 10000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { 'User-Agent': 'fnstart/1.0', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 内置城市坐标表。
 * wttr.in 用「纬度,经度」查询最稳，中文名查询偶尔会被限速。
 * 表里的城市直接走坐标，表里没有的才用城市名查询。
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

// 中国本地小时，用来决定晴天白天用太阳还是晚上用月亮
const chinaHour = () => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === 'hour');
    return h ? parseInt(h.value, 10) : 12;
  } catch {
    return 12;
  }
};

export async function getWeather(city) {
  const key = String(city || '北京').trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  try {
    const label = key;
    let region = '';
    const builtin = lookupCity(key);
    // 命中坐标表用「纬度,经度」，否则把城市名直接交给 wttr.in 解析
    const query = builtin ? `${builtin[0]},${builtin[1]}` : encodeURIComponent(key);
    const j = await getJson(`https://wttr.in/${query}?format=j1`);
    const cur = j?.current_condition?.[0];
    if (!cur) return { ok: false, error: '天气服务无响应' };

    const area = j?.nearest_area?.[0];
    if (area) {
      region = [area.region?.[0]?.value, area.country?.[0]?.value]
        .filter(Boolean).join(' · ');
    }

    const code = Number(cur.weatherCode);
    const info = WWO[code] || ['—', '·'];
    const isDay = chinaHour() >= 6 && chinaHour() < 18;
    const data = {
      ok: true,
      city: label,
      region,
      temp: Math.round(Number(cur.temp_C)),
      feels: Math.round(Number(cur.FeelsLikeC)),
      humidity: Number(cur.humidity),
      code,
      text: info[0],
      icon: !isDay && code <= 122 ? '🌙' : info[1],
      at: Date.now(),
      // 未来几天：wttr.in 给 3 天，卡片只显示当前，展开面板才用得上
      forecast: (() => {
        const days = j?.weather;
        if (!Array.isArray(days) || !days.length) return [];
        return days.map((d) => {
          const hours = Array.isArray(d.hourly) ? d.hourly : [];
          const noon = hours.find((h) => h.time === '1200') || hours[0] || {};
          const c = Number(noon.weatherCode);
          const ci = WWO[c] || ['—', '·'];
          const rains = hours
            .map((h) => Number(h.chanceofrain))
            .filter((n) => Number.isFinite(n));
          return {
            date: d.date,
            code: c,
            text: ci[0],
            icon: ci[1],
            max: Math.round(Number(d.maxtempC)),
            min: Math.round(Number(d.mintempC)),
            rain: rains.length ? Math.max(...rains) : null,
          };
        });
      })(),
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    // 拿不到就退回上次成功的值
    if (hit) return { ...hit.data, stale: true };
    return { ok: false, error: e.message || '天气获取失败' };
  }
}
