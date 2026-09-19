import { mmsRequest } from './bridge.js';
import { deepDecode } from './font-decrypt.js';
import { getFontMap } from './overview.js';

const GOODS_RT = '/sydney/api/goodsDataShow/queryGoodsPageRT';
const GOODS_OV_FOR_MMS = '/sydney/api/goodsDataShow/queryGoodsPageOverviewForMms';
const GOODS_PAGE = 'https://mms.pinduoduo.com/sycm/goods_effect';
const GOODS_LIST_PAGE = 'https://mms.pinduoduo.com/goods/goods_list';

/**
 * 商品编码（out_goods_sn，商家自填的型号编码）：
 * 从商品列表页旁路捕获列表接口（含 crawlerInfo 签名，不可重放），驱动翻页合并全部商品。
 * 返回 { codes: Map(goodsId -> 编码), total }
 */
export async function getGoodsCodes(page, { waitMs = 12000 } = {}) {
  const pages = new Map(); // pageNum -> rows
  let totalNum = null;
  let pageSize = 10;
  const onResp = (resp) => {
    if (pages.size >= 10) return;
    const u = resp.url();
    if (!u.includes('mms.pinduoduo.com')) return;
    if (/\.(js|css|png|jpe?g|webp|woff2?|svg|gif|ico|ttf)(\?|$)/.test(u)) return;
    if (pages.has('done')) return;
    const entry = { pending: true };
    const parse = resp.json().then((j) => {
      const res = j && (j.result || j);
      if (!res || !Array.isArray(res.goods_list) || !res.goods_list.length) { entry.pending = false; return; }
      let pn = 1;
      try { pn = JSON.parse(resp.request().postData()).pageNumber || 1; } catch { /* ignore */ }
      pages.set(pn, res.goods_list);
      totalNum = Number(res.total ?? res.total_num) || totalNum || res.goods_list.length;
      const b = resp.request().postData();
      if (b) { try { pageSize = JSON.parse(b).pageSize || pageSize; } catch { /* ignore */ } }
      entry.pending = false;
    }).catch(() => { entry.pending = false; });
    entry.parse = parse;
  };
  page.on('response', onResp);
  try {
    await page.goto(GOODS_LIST_PAGE, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const t0 = Date.now();
    while (Date.now() < t0 + waitMs && !(pages.has(1) && Array.isArray(pages.get(1)))) await page.waitForTimeout(500);
    const t1 = Date.now();
    while (Date.now() < t1 + 8000) {
      const ok = await page.evaluate(() => Boolean(document.querySelector('[class*="PGT_totalText"]'))).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(400);
    }
    let totalPages = totalNum ? Math.ceil(totalNum / pageSize) : 1;
    if (totalPages > 10) totalPages = 10;
    for (let p = 2; p <= totalPages; p++) {
      let ok = false;
      const tStart = Date.now();
      while (Date.now() < tStart + 10000 && !ok) {
        const clicked = await page.evaluate((pn) => {
          const items = [...document.querySelectorAll('li[class*="PGT_pagerItem"]')];
          const btn = items.find((el) => (el.textContent || '').trim() === String(pn));
          if (btn) { btn.click(); return true; }
          return false;
        }, p);
        if (clicked) {
          const t2 = Date.now();
          while (Date.now() < t2 + 8000 && !pages.has(p)) await page.waitForTimeout(300);
          if (pages.has(p)) { ok = true; break; }
        }
        await page.waitForTimeout(600);
      }
      if (!ok) break;
    }
  } finally {
    page.removeListener('response', onResp);
  }

  const codes = new Map();
  let count = 0;
  for (const [, rows] of [...pages.entries()].sort((a, b) => a - b)) {
    if (!Array.isArray(rows)) continue;
    for (const g of rows) {
      count++;
      if (g.out_goods_sn || g.goods_sn) codes.set(String(g.id ?? g.goods_id ?? g.goodsId), g.out_goods_sn || g.goods_sn);
    }
  }
  return { codes, total: totalNum ?? count };
}

/** 店铺级：今日实时 + 今日/昨日汇总（明文，无需签名） */
async function storeLevel(page) {
  const [rt, ov] = await Promise.all([
    mmsRequest(page, 'post', GOODS_RT, {}),
    mmsRequest(page, 'post', GOODS_OV_FOR_MMS, {}),
  ]);
  const map0 = (o) => o ? {
    支付金额: o.payOrdrAmt, 支付订单: o.payOrdrCnt, 支付买家数: o.payOrdrUsrCnt, 转化率: o.payUvRto,
    浏览量: o.gpv, 访客数: o.guv, 有访客商品数: o.vstGoodsCnt,
  } : null;
  let hourly = null;
  if (ov.ok && ov.data && Array.isArray(ov.data.todayList)) {
    hourly = ov.data.todayList
      .filter((h) => h.statHr !== '')
      .map((h) => ({ 小时: h.statHr, 支付金额: h.payOrdrAmt, 支付订单: h.payOrdrCnt, 浏览量: h.gpv, 访客数: h.guv }));
  }
  return {
    今日实时: map0(rt.ok ? rt.data : null),
    今日汇总: map0(ov.ok && ov.data ? ov.data.todayData : null),
    昨日汇总: map0(ov.ok && ov.data ? ov.data.yesData : null),
    今日分小时: hourly,
  };
}

/**
 * 商品维度：被动捕获 /sycm/goods_effect 页面自身的明细接口
 * （该接口需要页面 JS 动态生成的 crawlerInfo，无法重放，故采用店透视同款旁路捕获）
 * 初始页加载后自动驱动分页按钮，合并全部页的商品。
 * 每个商品同时含：今日值（密文，经字体映射解密）+ 昨日值（Ppr 字段，明文）
 */
async function goodsRows(page, { waitMs = 12000 } = {}) {
  const pages = new Map(); // pageNum -> goodsDetailList
  let totalNum = null;
  let pageSize = 10;
  const onResp = (resp) => {
    if (!resp.url().includes('queryGoodsDetailVOListForMMS')) return;
    let pn = 1;
    try { pn = JSON.parse(resp.request().postData()).pageNum || 1; } catch { /* ignore */ }
    if (pages.has(pn)) return;
    pages.set(pn, { pending: true });
    resp.json().then((j) => {
      const res = j && (j.result || j);
      if (res && res.goodsDetailList) {
        pages.set(pn, res.goodsDetailList);
        totalNum = res.totalNum ?? totalNum;
      } else pages.delete(pn);
    }).catch(() => pages.delete(pn));
  };
  page.on('response', onResp);
  try {
    await page.goto(GOODS_PAGE, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // 等首页数据
    const t0 = Date.now();
    while (Date.now() < t0 + waitMs && !(pages.has(1) && Array.isArray(pages.get(1)))) await page.waitForTimeout(500);
    // 等分页条渲染（防止 SPA 渲染滞后导致点击落空）
    const t1 = Date.now();
    while (Date.now() < t1 + 10000) {
      const ok = await page.evaluate(() => Boolean(document.querySelector('[class*="PGT_totalText"]'))).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(400);
    }

    // 驱动翻页：点击 PGT_pagerItem 第 2..N 页（带重试）
    let totalPages = totalNum ? Math.ceil(totalNum / pageSize) : 1;
    if (totalPages > 10) totalPages = 10; // 安全上限
    for (let p = 2; p <= totalPages; p++) {
      let ok = false;
      const tStart = Date.now();
      while (Date.now() < tStart + 10000 && !ok) {
        const clicked = await page.evaluate((pn) => {
          const items = [...document.querySelectorAll('li[class*="PGT_pagerItem"]')];
          const btn = items.find((el) => (el.textContent || '').trim() === String(pn));
          if (btn) { btn.click(); return true; }
          return false;
        }, p);
        if (clicked) {
          const t2 = Date.now();
          while (Date.now() < t2 + 8000 && !(pages.has(p) && Array.isArray(pages.get(p)))) await page.waitForTimeout(300);
          if (pages.has(p) && Array.isArray(pages.get(p))) { ok = true; break; }
        }
        await page.waitForTimeout(600);
      }
      if (!ok) break;
    }
  } finally {
    page.removeListener('response', onResp);
  }

  if (![...pages.values()].some((v) => Array.isArray(v))) return { error: '未捕获到商品明细响应（页面未加载或改版）' };

  const all = [];
  for (const pn of [...pages.keys()].sort((a, b) => a - b)) {
    const rows = pages.get(pn);
    if (Array.isArray(rows)) all.push(...rows);
  }

  const map = await getFontMap(page);
  const decodeRow = (o) => deepDecode(o, map);
  return {
    totalNum,
    pages: pages.size,
    rows: all.map((g) => {
      const a = g.activityInfo;
      return {
        goodsId: g.goodsId,
        商品名: g.goodsName,
        今日: decodeRow({
          访客数: g.goodsUv, 浏览量: g.goodsPv, 支付订单: g.payOrdrCnt,
          支付金额: g.payOrdrAmt, 转化率: g.goodsVcr, 支付件数: g.payOrdrGoodsQty, 收藏数: g.goodsFavCnt,
          曝光人数: g.imprUsrCnt, 下单人数: g.ordrCrtUsrCnt, 咨询人数: g.cnsltUsrQty,
        }),
        昨日: {
          访客数: g.goodsUvPpr, 浏览量: g.goodsPvPpr, 支付订单: g.payOrdrCntPpr,
          支付金额: g.payOrdrAmtPpr, 转化率: g.goodsVcrPpr, 支付件数: g.payOrdrGoodsQtyPpr,
          成交订单: g.cfmOrdrCntPpr, 收藏数: g.goodsFavCntPpr,
          曝光人数: g.imprUsrCntPpr, 下单人数: g.ordrCrtUsrCntPpr, 咨询人数: g.cnsltUsrQtyPpr,
        },
        活动推荐: a ? {
          活动名: a.activityName,
          建议报名价: a.goodsBenefitPrice,
          报名建议: a.enrollActivityDesc,
          预警: a.goodsMetricDecreaseDesc || null,
        } : null,
      };
    }),
  };
}

/**
 * 商品数据总入口：
 *  - storeLevel: 店铺级今日实时/汇总（明文）
 *  - goods:      商品维度（页面旁路捕获 + 字体解密）
 */
export async function getGoodsData(page, { withGoodsRows = true } = {}) {
  const store = await storeLevel(page);
  const goods = withGoodsRows ? await goodsRows(page) : null;
  // 商品编码（out_goods_sn，商家自填型号）：从商品列表页采集
  let codes = null;
  if (withGoodsRows && goods && !goods.error) {
    try {
      codes = await getGoodsCodes(page);
      for (const r of goods.rows) r.商品编码 = codes.codes.get(String(r.goodsId)) || '—';
    } catch (e) {
      codes = { error: e.message };
    }
  }
  return {
    店铺级: store,
    商品明细: goods,
    商品编码采集: codes ? { total: codes.total, 已映射: codes.codes.size } : null,
    说明: '今日值为页面密文经字体映射解密；昨日值来自接口 Ppr 字段；商品编码(out_goods_sn)来自商品列表页。翻页已自动驱动，覆盖全部商品',
  };
}

/* ================= 单品销量分析（全部明文接口，只需 goodsId） ================= */

const fmtStat = (d) => d ? {
  统计: d.statDate + (d.statHr != null && d.statHr !== '' ? ` ${d.statHr}时` : ''),
  支付金额: d.payOrdrAmt, 支付订单: d.payOrdrCnt, 支付买家数: d.payOrdrUsrCnt, 支付件数: d.payOrdrGoodsQty,
  访客数: d.goodsUv, 浏览量: d.goodsPv, 收藏数: d.goodsFavCnt,
  下单转化率: d.ordrVstrRto, 支付转化率: d.payOrdrRto, 商品转化率: d.goodsVcr,
  曝光人数: d.imprUsrCnt, 咨询人数: d.cnsltUsrQty,
} : null;

/** 单品深度分析：销量/售后/领航员/体检/评价概况 */
export async function getGoodsDetailAnalysis(page, goodsId) {
  const gid = Number(goodsId);
  if (!gid) throw new Error('goodsId 必填');
  const [stat, after, nav, problems, reviews] = await Promise.all([
    mmsRequest(page, 'post', '/sydney/api/goodsDataShow/queryGoodsStatDtr', { goodsId: gid }),
    mmsRequest(page, 'post', '/sydney/api/mallCoreData/queryGoodsAfterSales', { goodsId: gid }),
    mmsRequest(page, 'post', '/sydney/api/mallCoreData/queryGoodsNavigator', { goodsId: gid }),
    mmsRequest(page, 'post', '/sydney/api/goodsDataShow/queryGoodsProblems', { goodsId: gid }),
    mmsRequest(page, 'post', '/saturn/reviews/list', { goodsId: gid }),
  ]);
  const r = stat.ok ? (stat.data || {}) : null;
  return {
    goodsId: gid,
    销量分析: stat.ok ? {
      今日汇总: fmtStat(r.todayGoodsDetail),
      昨日汇总: fmtStat(r.yesterdayGoodsDetail),
      今日分时: (r.todayGoodsDetailList || []).map((h) => ({ 时: h.statHr, 支付金额: h.payOrdrAmt, 订单: h.payOrdrCnt, 访客: h.goodsUv, 浏览: h.goodsPv })),
      昨日分时: (r.yesterdayGoodsDetailList || []).map((h) => ({ 时: h.statHr, 支付金额: h.payOrdrAmt, 订单: h.payOrdrCnt, 访客: h.goodsUv, 浏览: h.goodsPv })),
    } : { error: stat.error },
    售后质量: after.ok ? {
      统计日期: after.data.statDate,
      平台介入订单: after.data.pltInvlOrdrCnt1m,
      平台介入率: after.data.pltInvlOrdrRto1m,
      纠纷退款单: after.data.dsptRfSucOrdrCnt1m,
      质量退款率: after.data.qltySucRfRto1m,
      退款金额: '¥' + ((after.data.rfSucOrdrAmt1m || 0) / 100).toFixed(2) + '(近1月)',
      退款单数: after.data.rfSucOrdrCnt1m,
      领航员助力率: after.data.goodsPtHelpRate1m,
    } : { error: after.error },
    商品领航员: nav.ok ? {
      数据日期: nav.data.readyDate,
      综合得分排名: nav.data.goodsScoreRk + '(层级' + nav.data.goodsScoreRkStage + ')',
      描述平均分: nav.data.avgDescRevScr1m,
      描述评分排名: nav.data.rankAvgDescRevScr1m + '(同层' + nav.data.rankAvgDescRevScr1mStpl + ')',
      质量退款率: nav.data.qltyRfndOrdrCntRto1m + '%',
      拼差率30天: nav.data.ptHelpPzRate30d + '%',
    } : { error: nav.error },
    商品体检: problems.ok ? { 体检分: problems.data.score, 问题: problems.data.problems } : { error: problems.error },
    评价概况: reviews.ok ? (() => {
      // saturn/reviews/list 无 result 包裹且自带 data 数组，须从 raw 读
      const rv = reviews.raw || {};
      return {
        全部评价: rv.allReviewNum,
        近三月: rv.reviewNumThreeMonth,
        今日新增: rv.reviewNumToday,
        差评未回复: rv.negNoReplyReviewNum,
        店铺DSR对比: rv.goodsOrMallDsr,
      };
    })() : { error: reviews.error },
  };
}

/* ================= 商品领航员（全店列表，明文） ================= */

/** 全店商品领航员列表 */
export async function getNavigatorList(page, { pageNo = 1, pageSize = 20, goodsName = '' } = {}) {
  const body = { total: 0, pageSize, pageNo, goodsIdList: [], goodsNameList: goodsName ? [goodsName] : [] };
  const r = await mmsRequest(page, 'post', '/sydney/api/goodsNavigator/queryGoodsNavigatorList', body);
  if (!r.ok) throw new Error(`领航员列表失败: ${r.error}`);
  const res = r.data || {};
  const rows = (res.goodsList || []).map((g) => {
    const d = g.goodsNavigatorDetailDTO || null;
    if (!d) {
      return {
        goodsId: g.goodsId,
        商品名: g.goodsName,
        领航员数据: '暂无（商品未被领航员评估，可能销量/评价不足）',
        近1月评价数: g.reviewCnt1m,
        库存: g.quantity,
        在售: g.isOnsale,
      };
    }
    return {
      goodsId: g.goodsId,
      商品名: g.goodsName,
      领航员版本: d.versionTag,
      综合得分百分位: d.goodsScoreRk,
      综合得分层级: d.goodsScoreRkStage,
      描述平均分: d.avgDescRevScr1m,
      质量退款率: d.qltyRfndOrdrCntRto1m + '%',
      拼差率30天: d.ptHelpPzRate30d + '%',
      中差评率30天: d.midRto30d != null ? d.midRto30d + '%' : null,
      近1月评价数: g.reviewCnt1m,
      库存: g.quantity,
      在售: g.isOnsale,
    };
  });
  return { total: res.total ?? rows.length, rows };
}
