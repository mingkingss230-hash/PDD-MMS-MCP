#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getBrowser, getMmsPage, waitForMmsFetch } from './cdp.js';
import { getEnvInfo } from './bridge.js';
import { listReviews, captureReviewsTemplate } from './reviews.js';
import { listCsAccounts, exportChats } from './chat.js';
import { toReviewsCsv } from './excel.js';
import { getDataOverview } from './overview.js';
import { getGoodsData, getGoodsDetailAnalysis, getNavigatorList } from './goods.js';
import { getPromotionData } from './promotion.js';
import { getOperationLogs } from './promotion-operations.js';
import { getPromotionExport } from './promotion-export.js';
import { getCreativeDaily, getPromotionDetail, getPromotionList, withPromotionPage } from './promotion-detail.js';
import { collectGoodsReportData } from './reports.js';
import { DIRS } from './config.js';

const server = new McpServer({
  name: 'pdd-mcp',
  version: '0.1.0',
});

function text(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}
function errText(e) {
  return { content: [{ type: 'text', text: `错误：${e.message}` }], isError: true };
}

// 多店铺：所有数据工具支持可选 shop 参数（键名对应 config/shops.json；省略=默认店铺）
const SHOP_PARAM = {
  shop: z.string().optional().describe('店铺名（多店铺时指定，对应 config/shops.json 的键名；省略=默认店铺）'),
};

/* ---------------- pdd_status ---------------- */
server.registerTool('pdd_status', {
  title: '拼多多环境检查',
  description: '检查 Chrome 调试端口连接、mms.pinduoduo.com 标签页、登录态与页面内请求通道是否可用。其他工具报错时先调这个。',
  inputSchema: { ...SHOP_PARAM },
}, async (args) => {
  try {
    const browser = await getBrowser({ shop: args.shop });
    const page = await getMmsPage({ shop: args.shop });
    if (!page) return text({ ok: false, hint: '调试 Chrome 里没有 mms.pinduoduo.com 标签页，请打开商家后台' });
    const env = await getEnvInfo(page);
    const mmsReady = env.hasMmsFetch ? true : await waitForMmsFetch(page, 8000);
    return text({
      ok: true,
      cdp: 'connected',
      pages: browser.contexts().flatMap((c) => c.pages()).map((p) => p.url()).slice(0, 20),
      currentMmsTab: { url: env.href, title: env.title, mallId: env.mallId },
      mmsFetchReady: mmsReady,
      hint: mmsReady ? '就绪，可以调用其他工具' : '未检测到 __mms.fetch：多半未登录（登录页没有该对象）。请在调试 Chrome 里扫码登录商家后台后重试。',
    });
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_reviews_list ---------------- */
server.registerTool('pdd_reviews_list', {
  title: '拉取店铺评价',
  description: '跨页拉取 mms 后台评价列表（自动复用页面自身请求体模板）。可只看待举报、关键词过滤、导出 CSV。',
  inputSchema: { ...SHOP_PARAM,
    pages: z.number().int().min(1).max(100).default(1).describe('拉取页数'),
    pageSize: z.number().int().min(10).max(100).default(20).describe('每页条数'),
    reportableOnly: z.boolean().default(false).describe('只看待举报(reportState=99)的评价'),
    keyword: z.string().optional().describe('按商品名/商品ID/评价内容过滤（本地过滤）'),
    refreshTemplate: z.boolean().default(false).describe('强制重新抓取页面请求体模板（接口报错/改过筛选条件时用）'),
    outCsv: z.boolean().default(false).describe('同时导出 CSV 到 output/'),
  },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const { reviews, total, pagesFetched, templateCapturedAt } = await listReviews(page, {
      pages: args.pages, pageSize: args.pageSize, refreshTemplate: args.refreshTemplate,
    });
    let list = reviews;
    if (args.reportableOnly) list = list.filter((r) => r.reportState === 99);
    if (args.keyword) {
      const kw = args.keyword.toLowerCase();
      list = list.filter((r) =>
        String(r.goodsName || '').toLowerCase().includes(kw) ||
        String(r.goodsId || '').includes(kw) ||
        String(r.comment || '').toLowerCase().includes(kw));
    }
    let csvPath = null;
    if (args.outCsv) {
      const file = path.join(DIRS.output, `reviews_${Date.now()}.csv`);
      fs.writeFileSync(file, toReviewsCsv(list));
      csvPath = file;
    }
    return text({
      totalInStore: total, pagesFetched, fetchedRaw: reviews.length,
      filtered: list.length,
      reportableCount: reviews.filter((r) => r.reportState === 99).length,
      csvPath, templateCapturedAt,
      // 最多展示前 30 条完整信息，其余只给 reviewId 便于后续举报
      reviews: list.slice(0, 30),
      remainingReviewIds: list.slice(30).map((r) => r.reviewId),
    });
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_chat_users ---------------- */
server.registerTool('pdd_chat_users', {
  title: '客服账号列表',
  description: '列出店铺的客服账号（mmsId + 名称），配合 pdd_chat_export 的 mmsId 参数使用。',
  inputSchema: { ...SHOP_PARAM },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const users = await listCsAccounts(page);
    return text({ count: users.length, users });
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_chat_data ---------------- */
server.registerTool('pdd_chat_data', {
  title: '聊天数据查询',
  description: '按客服账号/订单号/商品ID 查询聊天记录（纯数据 JSON；时间跨度限制与后台一致：按客服/订单 ≤31 天、按商品 ≤7 天）。如需导出 Excel 文件，用 pdd-chat-export skill。',
  inputSchema: { ...SHOP_PARAM,
    mode: z.enum(['cs', 'order', 'goods']).describe('cs=按客服/时间查全部会话；order=按订单号；goods=按商品ID'),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('开始日期 YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('结束日期 YYYY-MM-DD'),
    mmsId: z.string().optional().describe('客服账号 mmsId（mode=cs 可选，来自 pdd_chat_users）'),
    orderSn: z.string().optional().describe('订单号（mode=order 必填）'),
    goodsId: z.union([z.string(), z.number()]).optional().describe('商品ID（mode=goods 必填）'),
    maxConversations: z.number().int().min(1).max(2000).default(100).describe('最多查询多少个会话（防止失控）'),
    maxMessagesPerConv: z.number().int().min(0).default(0).describe('每个会话最多查询多少条消息，0=不限制'),
    previewLimit: z.number().int().min(0).max(500).default(50).describe('返回消息预览条数（0=只返回统计）'),
  },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const { previewLimit, ...query } = args;
    const { sessions, messages, warnings } = await exportChats(page, query);
    return text({
      会话数: sessions.length,
      消息数: messages.length,
      warnings,
      会话: sessions,
      消息预览: messages.slice(0, previewLimit),
      消息已截断: messages.length > previewLimit,
    });
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_overview_data ---------------- */
server.registerTool('pdd_overview_data', {
  title: '经营总览数据',
  description: '拉取经营总览数据（纯 JSON，数据为最近已就绪日即前一日）：成交金额/订单/转化率/退款等核心指标+环比、店铺评分与五维能力、GMV升级进度、客服质量。如需 Excel 报表，用 pdd-daily-report skill。',
  inputSchema: { ...SHOP_PARAM },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const data = await getDataOverview(page);
    return text(data);
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_goods_data ---------------- */
server.registerTool('pdd_goods_data', {
  title: '商品数据',
  description: '拉取商品维度数据（纯 JSON）：全部商品列表，每商品含昨日全天指标、今日实时指标、活动推荐；附带推广数据（昨日，单元花费/ROI/商品ID）与店铺级今日实时。withYesterdayFullDay=true 时逐商品拉取更精确的昨日数据（较慢）。如需 Excel 报表，用 pdd-daily-report skill。',
  inputSchema: { ...SHOP_PARAM,
    withYesterdayFullDay: z.boolean().default(false).describe('逐商品拉取昨日全天精确数据（较慢，约30秒）'),
  },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    if (args.withYesterdayFullDay) {
      const collected = await collectGoodsReportData(page);
      const failed = collected.yesterdayRows.filter((r) => r.错误);
      return text({
        商品明细: collected.yesterdayRows,
        拉取失败: failed.length ? failed.map((r) => ({ goodsId: r.goodsId, err: r.错误 })) : '无',
        推广: { 数据日期: collected.promo.数据日期, 汇总: collected.promo.汇总, 单元: collected.promo.单元, 每日花费: collected.promo.每日花费 },
      });
    }
    const data = await getGoodsData(page, { withGoodsRows: true });
    return text(data);
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_goods_detail ---------------- */
server.registerTool('pdd_goods_detail', {
  title: '单品销量分析',
  description: '单品深度分析（全部明文接口）：今日/昨日完整指标+分时销量趋势、售后质量（平台介入/质量退款）、商品领航员得分、商品体检分、评价概况。goodsId 从 pdd_goods_data 的结果里拿。',
  inputSchema: { ...SHOP_PARAM,
    goodsId: z.union([z.string(), z.number()]).describe('商品ID'),
  },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const result = await getGoodsDetailAnalysis(page, args.goodsId);
    return text(result);
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_goods_navigator ---------------- */
server.registerTool('pdd_goods_navigator', {
  title: '商品领航员',
  description: '全店商品领航员列表：每商品的综合得分百分位/层级、描述平均分、质量退款率、拼差率、中差评率、库存、在售状态。用于找出拖后腿的商品。',
  inputSchema: { ...SHOP_PARAM,
    pageNo: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(50).default(20),
    goodsName: z.string().optional().describe('按商品名过滤'),
  },
}, async (args) => {
  try {
    const page = await getMmsPage({ shop: args.shop });
    const result = await getNavigatorList(page, args);
    return text(result);
  } catch (e) {
    return errText(e);
  }
});

server.registerTool('pdd_promotion_operations', {
 title:'单推广链接操作记录（只读）',description:'真实商品推广抽屉操作记录接口；参数化日期范围，核验店铺/广告/商品，逐页校验total，按事件ID去重；保留秒级操作时间及原始变更文案，操作人匿名化，类型未返回时为null；早于平台窗口明确报错。不请求小时、不改投放。',annotations:{readOnlyHint:true,destructiveHint:false},
 inputSchema:{...SHOP_PARAM,cdpUrl:z.string().optional(),expectedMallId:z.string().regex(/^[1-9]\d*$/),adId:z.string().regex(/^[1-9]\d*$/),startDate:z.string(),endDate:z.string()},
},async args=>{try{return text(await withPromotionPage(args,page=>getOperationLogs(page,args)));}catch(e){return errText(e);}});

server.registerTool('pdd_promotion_creative_daily', {
 title:'单链接创意图片日报（不请求小时）',description:'从当前推广列表核验店铺/广告/商品，仅读取该ad创意日报；保留null抑制指标，无创意小时或单品小时请求。',annotations:{readOnlyHint:true,destructiveHint:false},
 inputSchema:{...SHOP_PARAM,cdpUrl:z.string().optional(),expectedMallId:z.string().regex(/^[1-9]\d*$/),adId:z.string().regex(/^[1-9]\d*$/),date:z.string().default('yesterday')},
},async args=>{try{return text(await withPromotionPage(args,page=>getCreativeDaily(page,args)));}catch(e){return errText(e);}});

server.registerTool('pdd_promotion_export', {
 title:'原生商品推广报表下载（不改投放）',
 description:'生成只读报表任务并下载原始XLS/XLSX、解析JSON及身份/日期/覆盖/总计manifest；不改预算出价。shop-hourly全店单日小时通常数秒至数分钟，默认最多60轮每轮间隔2秒另加网络下载时间；超时从同一taskId/输出目录恢复，不反复生成。unit-hourly单商品单日、unit-daily单商品日期区间直接下载。全店文件只含有数据商品，缺行不补零；创意不在此报表。依赖python openpyxl/xlrd。',
 annotations:{readOnlyHint:true,destructiveHint:false},
 inputSchema:{...SHOP_PARAM,cdpUrl:z.string().optional(),expectedMallId:z.string().regex(/^[1-9]\d*$/),mode:z.enum(['shop-hourly','unit-hourly','unit-daily']).default('shop-hourly'),date:z.string().default('yesterday'),endDate:z.string().optional(),adId:z.string().regex(/^[1-9]\d*$/).optional(),taskId:z.string().regex(/^[1-9]\d*$/).optional().describe('恢复同一原生异步任务，仍核验日期/维度'),outDir:z.string().optional().describe('本地独立工件目录；同目录可恢复'),maxPolls:z.number().int().min(1).max(120).default(60)},
},async args=>{try{return text(await withPromotionPage(args,page=>getPromotionExport(page,args)));}catch(e){return errText(e);}});

server.registerTool('pdd_promotion_list', {
 title:'全量商品推广昨日列表（只读、身份绑定）',
 description:'按明确CDP端点读取商品推广scenesMode=1全量列表及汇总，分页去重与店铺身份核验；配合pdd_promotion_detail逐单元读取小时和创意昨日数据。',
 annotations:{readOnlyHint:true,destructiveHint:false},
 inputSchema:{...SHOP_PARAM,cdpUrl:z.string().optional(),expectedMallId:z.string().regex(/^[1-9]\d*$/),date:z.string().default('yesterday')},
},async args=>{try{return text(await withPromotionPage(args,page=>getPromotionList(page,args)));}catch(e){return errText(e);}});

server.registerTool('pdd_promotion_detail', {
  title: '单品推广日报、分时及创意图日报（只读）',
  description: '按adId读取单个稳定成本推广的昨日/指定日数据：dailyReport、24小时原始指标、创意图片及日指标。强制expectedMallId核验店铺；创意小时明确unsupported，平台抑制的null指标不是零。仅已验证scenesMode=1。',
  annotations: {readOnlyHint:true,destructiveHint:false},
  inputSchema: {...SHOP_PARAM,cdpUrl:z.string().optional().describe('明确选择店铺的本机CDP HTTP端点；与shop互斥，不改全局配置'),adId:z.string().regex(/^[1-9]\d*$/),expectedMallId:z.string().regex(/^[1-9]\d*$/),date:z.string().default('yesterday').describe('yesterday 或 YYYY-MM-DD；北京时间')},
}, async(args)=>{try{return text(await withPromotionPage(args,page=>getPromotionDetail(page,args)));}catch(e){return errText(e);}});

/* ---------------- pdd_promotion_data ---------------- */
server.registerTool('pdd_promotion_data', {
  title: '推广数据',
  description: '拉取营销中心推广数据（默认昨日）：全部推广单元（花费/ROI/GMV/订单/目标投产比/日限额/商品ID/分组/托管状态）+ 账户汇总 + 近几日每日花费。均为明文。会临时打开营销中心页采集，耗时约30秒。',
  inputSchema: { ...SHOP_PARAM,
    date: z.enum(['yesterday', 'today']).default('yesterday').describe('数据日期，默认昨日'),
  },
}, async (args) => {
  try {
    const result = await getPromotionData(null, { date: args.date, shop: args.shop });
    return text(result);
  } catch (e) {
    return errText(e);
  }
});

/* ---------------- pdd_capture_reviews_template ---------------- */
server.registerTool('pdd_capture_reviews_template', {
  title: '抓取评价接口模板',
  description: '调试用：驱动浏览器依次打开评价管理候选页，抓取页面自身 /saturn/reviews/list 请求体并保存为模板（pdd_reviews_list 首次会自动做，一般无需手动调）。',
  inputSchema: { ...SHOP_PARAM },
}, async (args) => {
  try {
    await getBrowser(); // 先确保 CDP 可连
    const page = await getMmsPage({ shop: args.shop });
    const captured = await captureReviewsTemplate(page);
    return text({ ok: true, url: captured.url, body: captured.body, savedTo: 'config/reviews-template.json' });
  } catch (e) {
    return errText(e);
  }
});

process.on('uncaughtException', (e) => {
  // 保持 stdio 通道干净，异常写 stderr
  console.error('[pdd-mcp] uncaught:', e && e.message);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[pdd-mcp] started on stdio');
