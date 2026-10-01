import test from 'node:test';
import assert from 'node:assert/strict';
import { savingsErrorNotice } from '../src/asset.ts';

test('sample library explains why the final savings amount was not saved', () => {
  const text = savingsErrorNotice({ code: 'SAMPLE_NO_NEW_ASSET', message: '后端原文' });
  assert.match(text, /样例里不能新增物品/);
  assert.match(text, /开始记录我的资料/);
});

test('other savings errors keep their own message', () => {
  assert.equal(savingsErrorNotice({ code: 'REVISION_CONFLICT', message: '心愿已被更新' }), '心愿已被更新');
  assert.equal(savingsErrorNotice(null), '操作未完成，请重试。');
});
