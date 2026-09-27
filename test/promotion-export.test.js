import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const fixture = {
  state: { tasks: [{ id: 9647, exportType: 3, reportPromotionType: 9, dimensionList: [{ dimensionType: 2 }], reportName: '20260914至20260914', taskStatus: 2, downloadUrl: 'https://example.pinduoduo.com/report.xlsx' }] },
  requests: [{ response: { exportTypeConfigList: [{ exportType: { id: 3 }, reportPromotionTypeConfigList: [{ reportPromotionType: { id: 9 }, dimensionTypeList: [{ dimensionType: 2, name: 'goods', id: 1 }] }] }] } }],
};

test('parser rejects missing export fixture without exposing local data', () => {
  const r = spawnSync('python', ['src/parse-promotion-export.py', 'missing-public-fixture.xlsx', 'shop-hourly', '2026-09-14', '2026-09-14'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

test('MCP registers native export with bounded polling and resume schema', () => {
  const source = fs.readFileSync('src/index.js', 'utf8');
  assert(source.includes("registerTool('pdd_promotion_export'"));
  assert(source.includes('maxPolls:'));
  assert(source.includes('taskId:'));
});

test('creative MCP schema has standalone daily tool', () => {
  assert(fs.readFileSync('src/index.js', 'utf8').includes("registerTool('pdd_promotion_creative_daily'"));
});

test('native timeout never regenerates and exact-task wrong date is rejected', async () => {
  const { resolveNativeExport } = await import('../src/promotion-export.js');
  let generations = 0;
  const post = async path => {
    if (path.endsWith('queryWhiteListReportExportConfig')) return fixture.requests[0].response;
    if (path.endsWith('generateReportExportTask')) { generations += 1; return { result: [{ id: 9647 }] }; }
    return { total: 1, result: [{ ...fixture.state.tasks[0], taskStatus: 1, downloadUrl: null }] };
  };
  await assert.rejects(resolveNativeExport({ date: '2026-09-14' }, post, { sleep: async () => {}, maxPolls: 2 }), /pending/);
  assert.equal(generations, 1);
  await assert.rejects(resolveNativeExport({ date: '2026-09-13', taskId: '9647' }, post, { sleep: async () => {}, maxPolls: 1 }), /scope\/date mismatch/);
  assert.equal(generations, 1);
});

test('native export reads exact task ID, not the first queue item', async () => {
  const { resolveNativeExport } = await import('../src/promotion-export.js');
  let generated = 0; let polled = 0;
  const task = fixture.state.tasks[0];
  const result = await resolveNativeExport({ date: '2026-09-14' }, async path => {
    if (path.endsWith('queryWhiteListReportExportConfig')) return fixture.requests[0].response;
    if (path.endsWith('generateReportExportTask')) { generated += 1; return { result: [{ ...task, downloadUrl: null, taskStatus: 1 }] }; }
    polled += 1;
    return { total: 2, result: [{ ...task, id: 99999 }, { ...task, taskStatus: polled === 1 ? 1 : 2, downloadUrl: polled === 1 ? null : task.downloadUrl }] };
  }, { sleep: async () => {}, maxPolls: 3 });
  assert.equal(result.id, 9647);
  assert.equal(generated, 1);
  assert.equal(polled, 2);
});
