/*
 * 农历 / 节日工具
 *
 * 农历不自己算 —— 浏览器内置的 ICU 就有中国历法（`zh-CN-u-ca-chinese`），
 * 连闰月都认得（2025-07-25 → 闰六月）。比自己维护一份 1900-2100 的
 * 六十甲子数据表可靠得多，也省掉十几 KB。
 *
 * 节日和法定假日是硬编码规则。**不含调休**：哪天补班、假期怎么挪，
 * 每年由国务院单独公布，写死进前端必然会过期，这里只标「这天是法定假日」。
 */
(function () {
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

  /** 农历日：1→初一、15→十五、20→二十、27→廿七、30→三十 */
  function cnDay(n) {
    if (!n) return '';
    if (n <= 10) return n === 10 ? '初十' : `初${CN[n - 1]}`;
    if (n < 20) return `十${CN[n - 11]}`;
    if (n === 20) return '二十';
    if (n < 30) return `廿${CN[n - 21]}`;
    return '三十';
  }

  let fmt = null;
  let fmtOk = true;
  try {
    fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
  } catch {
    fmtOk = false;
  }

  /**
   * 取某天的农历。
   * @returns {{month:number, day:number, isLeap:boolean, monthText:string, text:string} | null}
   */
  function lunarOf(date) {
    if (!fmtOk || !fmt) return null;
    try {
      const parts = fmt.formatToParts(date);
      const get = (t) => parts.find((p) => p.type === t)?.value || '';
      const monthText = get('month'); // 九月 / 闰六月 / 十一月
      const dayNum = Number(get('day'));
      if (!monthText || !dayNum) return null;
      const isLeap = monthText.startsWith('闰');
      // 月份数字：从中文月名反查，「十一月」「十二月」要特殊处理
      const bare = monthText.replace('闰', '').replace('月', '');
      let month;
      if (bare === '十一') month = 11;
      else if (bare === '十二' || bare === '腊') month = 12;
      else if (bare === '正' || bare === '一') month = 1;
      else month = CN.indexOf(bare) + 1;
      if (!month) return null;
      return { month, day: dayNum, isLeap, monthText, text: cnDay(dayNum) };
    } catch {
      return null;
    }
  }

  /* ---------------- 节日 ---------------- */
  // [名称, 是否法定假日]
  const SOLAR = {
    '1-1': ['元旦', true],
    '2-14': ['情人节', false],
    '3-8': ['妇女节', false],
    '3-12': ['植树节', false],
    '4-1': ['愚人节', false],
    '5-1': ['劳动节', true],
    '5-4': ['青年节', false],
    '6-1': ['儿童节', false],
    '7-1': ['建党节', false],
    '8-1': ['建军节', false],
    '9-10': ['教师节', false],
    '10-1': ['国庆节', true],
    '10-2': ['国庆假期', true],
    '10-3': ['国庆假期', true],
    '12-24': ['平安夜', false],
    '12-25': ['圣诞节', false],
  };

  const LUNAR = {
    '1-1': ['春节', true],
    '1-2': ['春节', true],
    '1-3': ['春节', true],
    '1-15': ['元宵节', false],
    '2-2': ['龙抬头', false],
    '5-5': ['端午节', true],
    '7-7': ['七夕', false],
    '8-15': ['中秋节', true],
    '9-9': ['重阳节', false],
    '12-8': ['腊八节', false],
    '12-23': ['小年', false],
  };

  /**
   * 清明是节气不是固定日期，用通行的日序公式（21 世纪）：
   *   day = floor(YY × 0.2422 + 4.81) − floor(YY / 4)
   * 2026 → 4 月 5 日。
   */
  function qingmingDay(year) {
    const yy = year % 100;
    return Math.floor(yy * 0.2422 + 4.81) - Math.floor(yy / 4);
  }

  /**
   * 某天的节日。
   * @returns {{name:string, legal:boolean} | null}
   */
  function festivalOf(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();

    if (m === 4 && d === qingmingDay(y)) return { name: '清明', legal: true };

    const s = SOLAR[`${m}-${d}`];
    const lu = lunarOf(date);
    if (lu) {
      // 除夕：腊月最后一天（廿九或三十），得先确认下一天是不是正月初一
      if (lu.month === 12 && !lu.isLeap) {
        const next = new Date(date);
        next.setDate(next.getDate() + 1);
        const nl = lunarOf(next);
        if (nl && nl.month === 1 && nl.day === 1) return { name: '除夕', legal: true };
      }
      if (!lu.isLeap) {
        const lf = LUNAR[`${lu.month}-${lu.day}`];
        // 阳历节日优先（元旦、国庆这些不可能和农历撞）
        if (lf && !s) return { name: lf[0], legal: lf[1] };
      }
    }
    if (s) return { name: s[0], legal: s[1] };
    return null;
  }

  window.LunarUtil = { lunarOf, festivalOf, cnDay, qingmingDay };
})();
