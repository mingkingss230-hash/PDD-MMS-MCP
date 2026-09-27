import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/promotion-detail.js';

const detail = { mallId: 123456789, adId: 111, goodsId: 222, scenesMode: 1 };
const report = {
  dailyReport: { cost: 10 },
  hourlyReportList: Array.from({ length: 24 }, (_, hour) => ({ date: '2026-09-14 00:00:00', hour })),
  reportLastUpdateTime: '2026-09-14 23:59:59',
};
const creative = {
  mallId: 123456789,
  creativeListForDisplay: [{ creativeId: 7, reportInfo: null }],
  sumReportInfo: {},
};

test('promotion detail preserves 24 hours and null creative metrics', async () => {
  const result = await api.collectPromotionDetail({ adId: '111', expectedMallId: '123456789', date: '2026-09-14' }, async path => (
    path === api.DETAIL_PATH ? detail : path === api.HOURLY_PATH ? report : creative
  ));
  assert.equal(result.hourly.rows.length, 24);
  assert.equal(result.identity.goodsId, '222');
  assert.equal(result.creativeDaily.rows[0].reportInfo, null);
  assert.equal(result.creativeHourly.status, 'unsupported');
});

test('reject invalid identifiers and dates before requests', async () => {
  for (const opt of [{ adId: ' 1' }, { adId: '9007199254740993' }, { date: '2026-02-30' }, { expectedMallId: '' }]) {
    await assert.rejects(api.collectPromotionDetail({ adId: '111', expectedMallId: '123456789', date: '2026-09-14', ...opt }, async () => {
      throw Error('NETWORK CALLED');
    }), /Invalid/);
  }
});

test('reject mismatched shop before report fetch', async () => {
  let calls = 0;
  await assert.rejects(api.collectPromotionDetail({ adId: '111', expectedMallId: '987654321', date: '2026-09-14' }, async () => {
    calls += 1;
    return detail;
  }), /identity/);
  assert.equal(calls, 1);
});

test('deduplicate hours and creative IDs and report incomplete hours honestly', async () => {
  const result = await api.collectPromotionDetail({ adId: '111', expectedMallId: '123456789', date: '2026-09-14' }, async path => (
    path === api.DETAIL_PATH ? detail : path === api.HOURLY_PATH
      ? { ...report, hourlyReportList: [report.hourlyReportList[0], report.hourlyReportList[0]] }
      : { ...creative, creativeListForDisplay: [creative.creativeListForDisplay[0], creative.creativeListForDisplay[0]] }
  ));
  assert.equal(result.hourly.rows.length, 1);
  assert.equal(result.hourly.complete, false);
  assert.equal(result.creativeDaily.rows.length, 1);
});

test('pagination deduplicates until declared total', async () => {
  const seen = [];
  const result = await api.collectPromotionPages({ pageNumber: 1, pageSize: 2, beginDate: '2026-09-14' }, async body => {
    seen.push(body.pageNumber);
    return { totalAdNum: 3, adInfos: body.pageNumber === 1 ? [{ adId: 1, goodsId: 10 }, { adId: 2, goodsId: 20 }] : [{ adId: 2, goodsId: 20 }, { adId: 3, goodsId: 30 }] };
  });
  assert.equal(result.adInfos.length, 3);
  assert.deepEqual(seen, [1, 2]);
});

test('single ad request uses ad dimension and full date', () => {
  assert.deepEqual(api.buildHourlyRequest('111', '2026-09-14', 1), {
    clientType: 1, entityId: 111, queryDimensionType: 2, endDayHour: 23,
    endDate: '2026-09-14 00:00:00', startDate: '2026-09-14 00:00:00', reportPromotionType: 9,
    scenesModes: [1], blockTypes: [4], returnAnchorPoints: true, showGoodsPromotionHistoryReport: false,
  });
});
