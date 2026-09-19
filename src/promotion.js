import { getBrowser, getMmsPage, waitForMmsFetch } from './cdp.js';
import { collectPromotionPages } from './promotion-detail.js';
const PROMO_LIST_URL = 'https://yingxiao.pinduoduo.com/goods/promotion/list';

const val = (o) => (o && typeof o === 'object' && 'value' in o) ? o.value : o;

const METRIC_LABELS = {
  spend: '花费', orderSpend: '订单口径花费', orderMarketingSpend: '订单花费',
  gmv: '成交GMV', directPayGmv: '直接成交GMV', netGmv: '净GMV', settlementGmv: '结算GMV',
  orderNum: '订单数', orderSpendRoiUnified: 'ROI', orderSpendNetRoi: '净ROI', settlementRoi: '结算ROI',
  avgPayAmount: '客单价', cvr: '转化率', impressionCnt: '曝光量', clickCnt: '点击量',
  ctr: '点击率', cpc: '点击单价', cpm: '千次曝光成本',
  orderSpendNetCostPerOrder: '净成交单成本', settlementGmvRate: '结算率',
  refundGmv30d: '退款金额30天', exemptRefundGmvRate30d: '豁免退款GMV占比30天',
};

const SUMMARY_KEYS = [
  'spend', 'gmv', 'directPayGmv', 'netGmv', 'settlementGmv', 'orderNum',
  'orderSpendRoiUnified', 'orderSpendNetRoi', 'settlementRoi', 'avgPayAmount',
  'cvr', 'impressionCnt', 'clickCnt', 'cpc', 'orderSpendNetCostPerOrder', 'refundGmv30d',
];

function mapMetrics(report, keys) {
  const out = {};
  for (const k of keys) {
    if (!report || report[k] === undefined) continue;
    const v = val(report[k]);
    if (v !== null && v !== '') out[METRIC_LABELS[k] || k] = v;
  }
  return out;
}

const dateStr = (offsetDays = 0) => {
  const d = new Date(Date.now() - offsetDays * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * 每日推广花费（账户级，mms 页 __mms.fetch 直调，支持任意历史日期范围）
 * 返回 Map(YYYY-MM-DD -> 花费字符串)
 */
export async function getPromotionDailySpend(page, mallId, startDate, endDate) {
  const body = {
    clientType: 1, entityId: Number(mallId), queryDimensionType: 0, endDayHour: 23,
    endDate: `${endDate} 00:00:00`, startDate: `${startDate} 00:00:00`,
    reportPromotionType: 9, blockTypes: [5],
  };
  const r = await page.evaluate(async (bd) => {
    try { return { ok: true, res: await window.__mms.fetch.post('/mms-gateway/poseidon/api/report/queryHourlyRangeReport', bd) }; }
    catch (e) { return { ok: false, err: (e && (e.errorMsg || e.error_msg)) || String(e) }; }
  }, body);
  if (!r.ok) throw new Error(`推广日报失败: ${r.err}`);
  const map = new Map();
  for (const d of (r.res.dailyReportList || [])) {
    const date = (d.date || '').slice(0, 10);
    if (d.spend && d.spend.value !== undefined && d.spend.value !== null) map.set(date, String(d.spend.value));
  }
  return map;
}

/**
 * 每日推广花费（账户级）：打开推广页 → 驱动日期快捷项“近 30 日” → 捕获 getAdvertiserDailyCosts
 * 返回 Map(YYYY-MM-DD -> 花费字符串)。近30日窗口覆盖历史日期。
 */
export async function getPromotionDailyCosts(shop) {
  const browser = await getBrowser({ shop });
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  const maps = new Map(); // 响应序号 -> 日期花费Map
  let respSeq = 0;
  const onResp = (resp) => {
    if (!resp.url().includes('getAdvertiserDailyCosts')) return;
    const id = ++respSeq;
    resp.json().then((j) => {
      const list = j && j.result;
      if (!Array.isArray(list)) return;
      const m = new Map();
      for (const c of list) {
        const d = (c.date || '').slice(0, 10);
        const v = c.dailyCostForHttp && c.dailyCostForHttp.value;
        if (d) m.set(d, v);
      }
      maps.set(id, m);
    }).catch(() => {});
  };
  page.on('response', onResp);
  try {
    await page.goto(PROMO_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);
    const baseSeq = respSeq; // 初始加载的响应数
    // 展开日期控件
    await page.evaluate(() => {
      const wrap = [...document.querySelectorAll('div')].find((e) =>
        /DateAreaV2/.test(String(e.className)) && (e.textContent || '').includes('昨日'));
      if (wrap) wrap.click();
    });
    await page.waitForTimeout(1200);
    // 点快捷项“近 30 日”（会以近30日范围重发请求）
    const clicked = await page.evaluate(() => {
      const item = [...document.querySelectorAll('[class*="DateAreaV2_item"]')]
        .find((e) => (e.textContent || '').replace(/\s/g, '') === '近30日');
      if (item) { item.click(); return true; }
      return false;
    });
    if (!clicked) throw new Error('未找到“近 30 日”快捷项');
    // 等待点击后的新响应
    const deadline = Date.now() + 15000;
    let latest = null;
    while (Date.now() < deadline) {
      if (respSeq > baseSeq && maps.has(respSeq)) { latest = maps.get(respSeq); break; }
      await page.waitForTimeout(400);
    }
    if (!latest) throw new Error('未捕获到“近 30 日”范围的每日花费响应');
    return latest;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 推广数据（营销中心 yingxiao.pinduoduo.com）。
 * 默认拉取【昨日】：打开推广列表页后驱动日期快捷项“昨日”，按请求体 beginDate 匹配收获对应响应。
 * date: 'yesterday'（默认）| 'today'
 */
export async function getPromotionData(page, { date = 'yesterday', shop = null } = {}) {
  const targetDate = date === 'today' ? dateStr(0) : dateStr(1);

  const lists = []; // { beginDate, endDate, pending, json }
  let costsJson = null;
  const onResp = (resp) => {
    const u = resp.url();
    if (u.includes('goods/promotion/v3/list')) {
      let beginDate = null;
      try { beginDate = JSON.parse(resp.request().postData()).beginDate || null; } catch { /* ignore */ }
      const entry = { beginDate, endDate: null, pending: true };
      lists.push(entry);
      resp.json().then((j) => {
        let body = null;
        try { body = JSON.parse(resp.request().postData()); } catch { /* ignore */ }
        entry.body = body;
        if (entry.body) { delete entry.body.crawlerInfo; delete entry.body.anti_content; }
        entry.endDate = body ? body.endDate : null;
        entry.json = j;
        entry.pending = false;
      }).catch(() => { entry.pending = false; entry.json = null; });
    }
    if (u.includes('getAdvertiserDailyCosts') && !costsJson) {
      resp.json().then((j) => { costsJson = j; }).catch(() => {});
    }
  };

  const created = !page;
  const target = page || await (async () => {
    const browser = await getBrowser({ shop });
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('浏览器没有可用上下文');
    return ctx.newPage();
  })();

  target.on('response', onResp);
  try {
    await target.goto(PROMO_LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await target.waitForTimeout(6000); // 等页面与日期控件渲染

    if (date === 'yesterday') {
      // 点击日期快捷项“昨日”，页面会以 beginDate=昨日 重发 v3/list
      await target.evaluate(() => {
        const els = [...document.querySelectorAll('div,span')]
          .filter((el) => el.children.length === 0 && (el.textContent || '').trim() === '昨日');
        if (els.length) { els[0].click(); return true; }
        return false;
      });
    }

    // 等待目标日期的响应就绪
    const deadline = Date.now() + 18000;
    const isReady = () => lists.some((l) => l.beginDate === targetDate && !l.pending && l.json);
    while (Date.now() < deadline && !isReady()) await target.waitForTimeout(500);
    if (!isReady()) {
      // 兜底：若页面当天只有一份响应且其日期即目标（如“今日”模式），也算成功
      if (!(date === 'today' && lists.some((l) => !l.pending && l.json && l.beginDate === targetDate))) {
        throw new Error(`未捕获到 ${targetDate} 的推广列表响应（页面未加载或未登录营销中心）`);
      }
    }
  } finally {
    target.removeListener('response', onResp);
    if (created) await target.close().catch(() => {});
  }

  const entry = [...lists].reverse().find((l) => l.beginDate === targetDate && l.json) || null;
  if (!entry) throw new Error(`未找到 ${targetDate} 的推广列表数据`);
  if (entry.endDate !== targetDate || !entry.body) throw new Error('推广列表日期/请求模板不匹配');
  const mmsPage = await getMmsPage({shop});
  if (!await waitForMmsFetch(mmsPage)) throw new Error('推广分页需要登录商家后台');
  const r = await collectPromotionPages(entry.body, async body => {
    const result = await mmsPage.evaluate(async body => {
      try { return {ok:true,value:await window.__mms.fetch.post('/mms-gateway/venus/api/goods/promotion/v3/list',body)}; }
      catch { return {ok:false}; }
    },body);
    if (!result.ok) throw new Error('推广分页读取失败，请检查登录/权限');
    return result.value;
  });
  const report = r.sumReportInfo || {};

  const units = (r.adInfos || []).map((a) => ({
    adId: a.adId,
    goodsId: a.goodsId,
    推广名: a.adName,
    状态码: a.adStatus,
    分组: a.adGroupInfo && a.adGroupInfo.groupName,
    花费: val(a.dailyCost),
    目标投产比: val(a.targetRoi),
    日限额: val(a.maxCost),
    出价类型: a.bidType === 1 ? '目标投产' : (a.bidType === 2 ? '成交出价' : a.bidType),
    托管状态: a.adAssistInfo && a.adAssistInfo.assistStatus,
    指标: mapMetrics(a.reportInfo, SUMMARY_KEYS),
  }));

  const dailyCosts = costsJson && Array.isArray(costsJson.result)
    ? costsJson.result.map((c) => ({ 日期: (c.date || '').slice(0, 10), 花费: val(c.dailyCostForHttp) }))
    : null;

  return {
    数据日期: targetDate,
    推广单元数: r.totalAdNum,
    已获取单元数: units.length,
    完整: r.complete,
    分页数: r.pagesFetched,
    汇总: mapMetrics(report, SUMMARY_KEYS),
    单元: units,
    每日花费: dailyCosts,
    报告更新时间: r.reportLastUpdateTime || null,
    说明: '数据来自营销中心推广列表页旁路捕获，均为明文。默认昨日；状态码 2=投放中（其余对照后台）',
  };
}
