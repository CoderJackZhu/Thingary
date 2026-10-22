import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPull, pullDistance, pullMax, pullTrigger, shouldRefresh } from '../src/mobile/ui/pull-refresh.ts';
import { stepMonth, yearCard } from '../src/mobile/plan/detail-model.ts';
import { newPurchaseDraft, purchaseSave, yuanText } from '../src/mobile/wishes/model.ts';

const src = path => readFileSync(new URL(`../src/mobile/${path}`, import.meta.url), 'utf8');

test('下拉刷新：阻尼、阈值与手势判断', () => {
  assert.equal(pullDistance(-20), 0);
  assert.equal(pullDistance(60), 30);
  assert.equal(pullDistance(1000), pullMax);
  assert.equal(shouldRefresh(pullTrigger - 1), false);
  assert.equal(shouldRefresh(pullTrigger), true);
  assert.equal(isPull(0, 2, 40), true);
  assert.equal(isPull(120, 2, 40), false, '页面没滚到顶时不触发');
  assert.equal(isPull(0, 60, 40), false, '横向滑动（如行滑动操作）不触发');
  assert.equal(isPull(0, 0, 4), false, '位移太小不算下拉');
});

test('查看月份：加减按钮不越界', () => {
  assert.equal(stepMonth(100, 1, 60, 300), 101);
  assert.equal(stepMonth(100, -12, 60, 300), 88);
  assert.equal(stepMonth(65, -12, 60, 300), 60);
  assert.equal(stepMonth(295, 12, 60, 300), 300);
});

test('逐年表卡片：标题、年龄、期末资金与缺口', () => {
  const row = { period: '2046-01 至 2046-12', year: 2046, age: 52, marks: ['退休'], end: 100, unfunded: 0, contribution: 1, income: 2, unlock: 3, spend: 4, oneoff: 5 };
  const card = yearCard(row);
  assert.equal(card.title, '2046-01 至 2046-12 · 退休');
  assert.equal(card.age, '52岁');
  assert.equal(card.hasGap, false);
  assert.deepEqual(card.details.map(d => d.value), [1, 5, 9]);
  const gap = yearCard({ ...row, period: null, age: null, marks: [], unfunded: 70 });
  assert.equal(gap.title, '2046');
  assert.equal(gap.age, '', '年龄未知时不显示年龄');
  assert.equal(gap.hasGap, true);
});

test('记录购入：金额输入用分，元文本往返不丢精度', () => {
  assert.equal(yuanText('199900'), '1999');
  assert.equal(yuanText('199905'), '1999.05');
  const wish = { id: 'w', revision: 1, fields: { name: '耳机', category_id: null, estimated_price_cents: '100000' } };
  const draft = newPurchaseDraft(wish, 'g', '2026-10-22', null);
  draft.fields.price = yuanText('199905');
  const built = purchaseSave(draft, '2026-10-22', 'r');
  assert.equal(built.input.base.price_cents, '199905');
});

test('界面约定：入口、默认值与文案', () => {
  const batch = src('items/ItemBatch.tsx'), filter = src('items/ItemFilter.tsx');
  assert.match(batch, /useState<Kind>\(initialKind\)/);
  assert.match(batch, /initialKind='none'/, '批量操作默认不选动作');
  assert.ok(batch.indexOf("['label','改标签']") < batch.indexOf("['delete','删除']"), '删除排在最后');
  assert.doesNotMatch(filter, /应用条件/);
  assert.match(filter, /共 \$\{total\} 件/);
  assert.match(src('spending/parts.tsx'), /<Fab /);
  assert.doesNotMatch(src('spending/parts.tsx'), /IconButton/);
  assert.doesNotMatch(src('spending/SpendingHome.tsx'), /switchTab/);
  assert.match(src('spending/ReviewPage.tsx'), /所有页面的金融金额都会隐藏/);
  const welcome = src('home/Welcome.tsx');
  assert.match(welcome, /以后再说/);
  assert.doesNotMatch(welcome, />跳过</);
  assert.match(src('wishes/WishPurchase.tsx'), /<MoneyField label="实付金额"/);
  assert.match(src('wishes/WishPurchase.tsx'), /nav\.replace\('items\.detail'/);
  for (const page of ['home/Overview.tsx', 'items/ItemList.tsx', 'wealth/Overview.tsx']) assert.match(src(page), /<PullToRefresh /);
  for (const page of ['wishes/WishList.tsx', 'me/settings/Trash.tsx']) assert.match(src(page), /<SwipeRow /);
  assert.match(src('plan/Detail.tsx'), /nav\.push\("plan\.whatif"\)/);
  assert.ok(src('plan/Detail.tsx').indexOf('plan.whatif') < src('plan/Detail.tsx').indexOf('逐年表'), '假设分析入口在逐年表之前');
});
