import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedAssetChange } from '../src/wealth-display.ts';

test('虚构固定资产涨跌：升值、贬值、零购入价、未知购入价和未知估值', () => {
  assert.deepEqual(fixedAssetChange('10000', '12500'), { change_cents: '2500', rate_hundredths: 2500 });
  assert.deepEqual(fixedAssetChange('10000', '7500'), { change_cents: '-2500', rate_hundredths: -2500 });
  assert.deepEqual(fixedAssetChange('0', '12500'), { change_cents: '12500', rate_hundredths: null });
  assert.equal(fixedAssetChange(null, '12500'), null);
  assert.equal(fixedAssetChange('10000', null), null);
  assert.equal(fixedAssetChange(undefined, '0'), null);
  assert.deepEqual(fixedAssetChange('300', '299'), { change_cents: '-1', rate_hundredths: -33 });
});
