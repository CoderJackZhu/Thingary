import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('recurring and virtual pages open the same subscription detail', () => {
  assert.match(read('RecurringPage.tsx'), /<SubscriptionDetail /);
  assert.match(read('VirtualPage.tsx'), /<SubscriptionDetail /);
  assert.doesNotMatch(read('RecurringPage.tsx'), /function PlanDetailDialog/);
});

test('linked subscriptions no longer carry cross-page "关联" rows', () => {
  const detail = read('SubscriptionDetail.tsx');
  assert.doesNotMatch(detail, /查看服务档案|查看付款计划|关联对象/);
  const virtual = read('VirtualPage.tsx');
  assert.doesNotMatch(virtual, /查看付款计划|关联对象/);
  // 列表副标题只在计划名与档案名不同时才提示付款计划。
  assert.match(virtual, /v\.plan_name !== v\.fields\.name/);
});

test('old-subscription merge is offered on both pages and only submits after a user pick', () => {
  assert.match(read('RecurringPage.tsx'), /<MergeNotice /);
  assert.match(read('VirtualPage.tsx'), /<MergeNotice /);
  const merge = read('MergeOldSubscriptions.tsx');
  // 有旧单次价格的候选不默认勾选，避免未看金额影响就合并。
  assert.match(merge, /filter\(p => !p\.asset_price_cents\)/);
  assert.match(merge, /command: 'link_merge'/);
});
