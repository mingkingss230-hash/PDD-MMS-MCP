import { mmsRequest } from './bridge.js';
import { buildMapFromFont, deepDecode } from './font-decrypt.js';

const OVERVIEW = '/sydney/api/mallScore/queryMallScoreOverView';
const SCORE_INFO = '/sydney/api/mallScore/queryMallScoreInfo';
const READY_DATE = '/sydney/api/customer/queryReadyDate';
const CS_QUALITY = '/sydney/api/customer/querySpecifiedDayServiceQuality';
const LEVEL_INFO = '/rivendell/api/mallLevel/getEntranceInfo';
const OVERVIEW_PAGE = 'https://mms.pinduoduo.com/sycm/evaluation/overview';

// 数值字段中文名映射（ dealDataVO / goodsDataVO / serviceDataVO ）
const FIELD_LABELS = {
  cfmOrdrAmt1d: '成交金额(昨日)', cfmOrdrCnt1d: '成交订单数(昨日)', cfmOrdrUsrCnt1d: '成交买家数(昨日)',
  cfmOrdrAup1d: '成交客单价(昨日)', goodsVcr1d: '商品转化率(昨日)',
  payOrdrAmt1d: '支付金额(昨日)', payOrdrCnt1d: '支付订单数(昨日)', payOrdrUsrCnt1d: '支付买家数(昨日)', payOrdrAup1d: '支付客单价(昨日)',
  goodsPv1d: '商品浏览量(昨日)', goodsUv1d: '商品访客数(昨日)', goodsFavCntStk: '商品收藏数(存量)', goodsFavCnt1d: '商品收藏(昨日)',
  vstGoodsCnt1d: '有访客商品数(昨日)', cfmOrdrGoodsQty1d: '成交商品件数(昨日)',
  avgSucRfProcTime1m: '平均退款处理时长(近1月)', pltInvlRto1m: '平台介入率(近1月)',
  sucRfOrdrAmt1d: '退款金额(昨日)', sucRfOrdrCnt1d: '退款单数(昨日)', rfRto1m: '退款率(近1月)',
};

// 字体按 URL 缓存（拼多多按页面加载轮换字体，URL 变了映射就变）
const fontMapCache = new Map();

/**
 * 获取当前页面对应的字体映射。
 * 字体地址从页面自身取（HTML 内嵌或已加载资源）——拼多多每次页面加载轮换字体，
 * 必须用与响应密文同会话的字体才能解出正确数字（取法还原自店透视：正则抠 webspider*.ttf）。
 */
export async function getFontMap(page) {
  const info = await page.evaluate(() => {
    const htmlMatch = (document.documentElement.innerHTML.match(/webspider[^"')\s]*?\.ttf/g) || []).slice(-1);
    const perf = performance.getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /webspider.*\.ttf/i.test(n));
    return { html: htmlMatch[0] || null, perf };
  });
  let url = info.perf.length ? info.perf[info.perf.length - 1] : null;
  if (!url && info.html) url = 'https://pfile.pddpic.com/' + info.html;
  if (!url) throw new Error('当前页面未找到 webspider 字体（页面可能未加载完成）');
  if (fontMapCache.has(url)) return fontMapCache.get(url);

  const { map } = await buildMapFromFont(
    async () => url,
    async (u) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`字体下载失败 ${res.status}`);
      return res.arrayBuffer();
    },
  );
  fontMapCache.set(url, map);
  if (fontMapCache.size > 8) fontMapCache.delete(fontMapCache.keys().next().value);
  return map;
}

function sumWithPct(vo, labels) {
  if (!vo || typeof vo !== 'object') return vo;
  const out = {};
  for (const [k, v] of Object.entries(vo)) {
    if (k.endsWith('Pct') || k.endsWith('IsPercent') || k.endsWith('Exact')) continue; // 只留主字段，环比并入其下
    const base = k.replace(/1d$|1m$|Stk$/, '');
    const pctKey = k + 'Pct';
    const item = { value: v };
    if (typeof vo[pctKey] === 'number') item.dayOverDay = vo[pctKey];
    const label = labels[k] || labels[base + '1d'] || labels[base + '1m'] || labels[base + 'Stk'] || k;
    out[label] = item;
  }
  return out;
}

/**
 * 经营总览数据（成交金额/转化率等）。
 * 明文接口直读；密文接口经字体映射解密。
 */
export async function getDataOverview(page) {
  // 密文与字体按会话配对：先落到总览页（该页加载 webspider 字体），再拉数据解密
  await page.goto(OVERVIEW_PAGE, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // 并行拉取
  const [ready, scoreInfo, levelInfo, overview] = await Promise.all([
    mmsRequest(page, 'get', READY_DATE),
    mmsRequest(page, 'post', SCORE_INFO, {}),
    mmsRequest(page, 'post', LEVEL_INFO, {}),
    mmsRequest(page, 'post', OVERVIEW, {}),
  ]);

  const dataDate = ready.ok ? ready.data : null;

  // 客服质量按数据就绪日查
  let csQuality = null;
  if (dataDate) {
    const cs = await mmsRequest(page, 'post', CS_QUALITY, { queryDate: dataDate });
    if (cs.ok) {
      const t = cs.data && cs.data.customerServiceTrendVO ? cs.data.customerServiceTrendVO : {};
      csQuality = {
        statDate: t.statDate || dataDate,
        replyIn5minRate: t.rplyUsrRto5min1d,
        replyIn3minRate: t.in3minRplyUsrRto1d,
        avgReplySeconds: t.avgRplyTime1d,
        dealAmt3d: t.cfmOrdrAmt3d,
      };
    }
  }

  // 密文解密：交易/商品/服务三大块
  let daily = null;
  if (overview.ok) {
    const map = await getFontMap(page);
    const decoded = deepDecode(overview.raw, map);
    const r = decoded && decoded.data !== undefined ? decoded.data : decoded;
    const res = r && (r.result ?? r);
    if (res && typeof res === 'object') {
      daily = {
        交易数据: sumWithPct(res.dealDataVO, FIELD_LABELS),
        商品数据: sumWithPct(res.goodsDataVO, FIELD_LABELS),
        服务数据: sumWithPct(res.serviceDataVO, FIELD_LABELS),
      };
    }
  }

  return {
    dataDate,
    店铺评分与层级: scoreInfo.ok ? {
      综合得分: scoreInfo.data.score,
      店铺层级: scoreInfo.data.mallLevel,
      成交金额: scoreInfo.data.cfmOrdrAmt,
      维度: ['goodsQuality', 'promotionCapacity', 'serviceQuality', 'userViscosity'].map((k) => {
        const d = scoreInfo.data[k] || {};
        return {
          维度: { goodsQuality: '商品质量', promotionCapacity: '推广能力', serviceQuality: '服务质量', userViscosity: '用户粘性' }[k],
          等级: d.level,
          同层百分位: d.pct,
          最弱项: (d.lowestScoreVOList || []).slice(0, 2).map((x) => ({ 项: x.name, 得分: x.score })),
        };
      }),
    } : { error: scoreInfo.error },
    GMV进度: levelInfo.ok ? {
      层级: levelInfo.data.level,
      当前GMV: levelInfo.data.gmv,
      距升级还差: levelInfo.data.restGmv,
      当前区间: [levelInfo.data.rangeVO && levelInfo.data.rangeVO.gmvLowerLimit, levelInfo.data.rangeVO && levelInfo.data.rangeVO.gmvUpperLimit],
    } : { error: levelInfo.error },
    客服质量: csQuality,
    经营日数据: daily,
    说明: '成交/支付/商品/服务数值已从字体密文解密；环比(dayOverDay)为正负小数；数据T+1（dataDate 为就绪日）',
  };
}
