import test from 'node:test';
import assert from 'node:assert/strict';
import { listPddExpertNotes } from '../src/pdd-mobile-reviews.js';

test('expert notes returns a safe empty result when no verified endpoint is exposed', async () => {
  const calls = [];
  const page = {
    async goto() {},
    async waitForTimeout() {},
    async evaluate(fn, args) {
      calls.push(args);
      return { status: 404, url: null, json: {} };
    },
  };
  const result = await listPddExpertNotes(page, { goodsId: '123', pageNo: 1, pageSize: 100 });
  assert.equal(result.goodsId, '123');
  assert.equal(result.count, 0);
  assert.deepEqual(result.items, []);
  assert.match(result.warning, /未暴露|未返回/);
  assert.equal(calls.length, 0);
});
