#!/usr/bin/env node
// 冒烟测试（不经 MCP，直接调内部模块）：
//   node scripts/smoke.js status
//   node scripts/smoke.js reviews <pages> [pageSize] [reportableOnly]
//   node scripts/smoke.js chatusers
//   node scripts/smoke.js chat <mode> <startDate> <endDate> [orderSn|goodsId]   # 只统计不写文件
//   node scripts/smoke.js template
import { getBrowser, getMmsPage } from '../src/cdp.js';
import { getEnvInfo } from '../src/bridge.js';
import { listReviews, captureReviewsTemplate } from '../src/reviews.js';
import { listCsAccounts, exportChats } from '../src/chat.js';
import { getDataOverview } from '../src/overview.js';
import { getGoodsData, getGoodsDetailAnalysis, getNavigatorList } from '../src/goods.js';

const [, , cmd, ...rest] = process.argv;

async function ready() {
  const browser = await getBrowser();
  const page = await getMmsPage();
  const env = await getEnvInfo(page);
  console.log('mms tab:', env.href, '| mallId:', env.mallId, '| __mms.fetch:', env.hasMmsFetch);
  void browser;
  return { page, env };
}

try {
  if (cmd === 'status') {
    await ready();
  } else if (cmd === 'template') {
    const { page } = await ready();
    const t = await captureReviewsTemplate(page);
    console.log('captured from:', t.url, '\nbody:', JSON.stringify(t.body));
  } else if (cmd === 'reviews') {
    const { page } = await ready();
    const pages = Number(rest[0] || 1);
    const pageSize = Number(rest[1] || 20);
    const { reviews, total, pagesFetched } = await listReviews(page, { pages, pageSize });
    const reportable = reviews.filter((r) => r.reportState === 99);
    console.log(`total=${total} pagesFetched=${pagesFetched} fetched=${reviews.length} reportable=${reportable.length}`);
    console.log(JSON.stringify(reviews.slice(0, 3), null, 2));
  } else if (cmd === 'overview') {
    const { page } = await ready();
    console.log(JSON.stringify(await getDataOverview(page), null, 2));
  } else if (cmd === 'goods') {
    const { page } = await ready();
    console.log(JSON.stringify(await getGoodsData(page, { withGoodsRows: !rest.includes('noRows') }), null, 2));
  } else if (cmd === 'goodsdetail') {
    const { page } = await ready();
    console.log(JSON.stringify(await getGoodsDetailAnalysis(page, Number(rest[0])), null, 2));
  } else if (cmd === 'navigator') {
    const { page } = await ready();
    console.log(JSON.stringify(await getNavigatorList(page, { pageSize: Number(rest[0] || 20) }), null, 2));
  } else if (cmd === 'chatusers') {
    const { page } = await ready();
    console.log(JSON.stringify(await listCsAccounts(page), null, 2));
  } else if (cmd === 'chat') {
    const { page } = await ready();
    const [mode, startDate, endDate, key] = rest;
    const { sessions, messages, warnings } = await exportChats(page, {
      mode, startDate, endDate,
      orderSn: mode === 'order' ? key : undefined,
      goodsId: mode === 'goods' ? key : undefined,
      maxConversations: 5,
      onProgress: (s) => console.log(' ', s),
    });
    console.log(`sessions=${sessions.length} messages=${messages.length} warnings=${JSON.stringify(warnings)}`);
    console.log(JSON.stringify(messages.slice(0, 5), null, 2));
  } else {
    console.log('usage: node smoke.js status|template|reviews <pages> [pageSize]|chatusers|chat <mode> <start> <end> [key]');
  }
} catch (e) {
  console.error('SMOKE ERROR:', e.message);
  process.exit(1);
}
process.exit(0);
