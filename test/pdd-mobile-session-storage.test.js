import test from 'node:test';
import assert from 'node:assert/strict';
import { unwrapPddMobileDetailData } from '../src/pdd-mobile.js';

test('unwraps the buyer page sessionStorage payload from props', () => {
  const payload = { props: { goods: { goodsID: 123 } }, state: {} };
  assert.deepEqual(unwrapPddMobileDetailData(payload), payload.props);
});
