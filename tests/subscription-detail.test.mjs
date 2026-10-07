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
