// U18 分类栏布局纯函数：溢出边界、选中项唯一可见、尺寸变化与稳定性。
// 只测给定实测宽度后的排布决策；DOM 测量本身由浏览器与原生验收覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCategoryLayout as plan } from '../src/category-layout.ts';

const entries = [
  { id: 'a', width: 90 }, { id: 'b', width: 74 }, { id: 'c', width: 88 },
  { id: 'd', width: 104 }, { id: 'e', width: 76 },
];
const gap = 6, all = 74, none = 61, more = 88;

test('空间充足时全部可见且不出现更多按钮', () => {
  const width = all + gap + none + gap + 5 * 110 + more;
  const result = plan(width, { all, none, more }, entries, null, gap);
  assert.equal(result.compact, false);
  assert.equal(result.showMore, false);
  assert.deepEqual(result.visibleIds, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(result.selectedPinned, false);
});

test('溢出时前缀截断并显示更多分类，更多按钮宽度被预留', () => {
  const width = all + gap + none + gap + 90 + gap + 74 + gap + more + 4; // 只放得下 a、b
  const result = plan(width, { all, none, more }, entries, null, gap);
  assert.equal(result.compact, false);
  assert.equal(result.showMore, true);
  assert.deepEqual(result.visibleIds, ['a', 'b']);
});

test('选中尾部分类时外显一位且不重复、其余前缀让位', () => {
  const width = all + gap + none + gap + 90 + gap + 104 + gap + more + gap; // a + 选中 d
  const result = plan(width, { all, none, more }, entries, 'd', gap);
  assert.equal(result.selectedPinned, true);
  assert.deepEqual(result.visibleIds, ['a']);
  const rendered = [...result.visibleIds, 'd'];
  assert.equal(new Set(rendered).size, rendered.length, '选中分类不得重复渲染');
});

test('选中项本就在前缀内时不额外占位', () => {
  const width = all + gap + none + gap + 90 + gap + 74 + gap + 88 + gap + more;
  const result = plan(width, { all, none, more }, entries, 'c', gap);
  assert.equal(result.selectedPinned, false);
  assert.deepEqual(result.visibleIds, ['a', 'b', 'c']);
});

test('极窄时整栏收敛为单个选择按钮', () => {
  const result = plan(120, { all, none, more }, entries, null, gap);
  assert.equal(result.compact, true);
  assert.deepEqual(result.visibleIds, []);
  assert.equal(result.showMore, false);
});

test('全部能容纳时直接展示，不出现不必要的更多按钮（Review R3）', () => {
  // 容器 250：固定 70/60＋唯一分类 80 实际合计 222，无需更多按钮。
  const result = plan(250, { all: 70, none: 60, more: 90 }, [{ id: 'x', width: 80 }], null, gap);
  assert.equal(result.compact, false);
  assert.equal(result.showMore, false);
  assert.deepEqual(result.visibleIds, ['x']);
});

test('恰好容纳（含间隙的精确总宽）时不收起', () => {
  const total = all + gap + none + entries.reduce((sum, e) => sum + e.width + gap, 0);
  const result = plan(total, { all, none, more }, entries, null, gap);
  assert.equal(result.showMore, false);
  assert.deepEqual(result.visibleIds, ['a', 'b', 'c', 'd', 'e']);
});

test('空分类集合只显示固定项，不出更多按钮', () => {
  const result = plan(600, { all, none, more }, [], null, gap);
  assert.equal(result.showMore, false);
  assert.deepEqual(result.visibleIds, []);
  assert.equal(result.compact, false);
});

test('选中项的外显位放不下时转 compact，不把按钮推出容器（Review R3）', () => {
  // 容器 300：固定 70/60/90 后预算 68，选中项 160 预留不下。
  const result = plan(300, { all: 70, none: 60, more: 90 }, [{ id: 'huge', width: 160 }], 'huge', gap);
  assert.equal(result.compact, true, '长选中项必须收敛为选择按钮');
  assert.deepEqual(result.visibleIds, []);
});

test('首位、末位与超长选中的外显不重复且不越界', () => {
  const first = plan(all + gap + none + gap + 90 + gap + more + gap, { all, none, more }, entries, 'a', gap);
  assert.equal(first.selectedPinned, false, '首位选中本就在前缀');
  const last = plan(all + gap + none + gap + 90 + gap + 76 + gap + more + gap, { all, none, more }, entries, 'e', gap);
  assert.equal(last.selectedPinned, true);
  const rendered = [...last.visibleIds, 'e'];
  assert.equal(new Set(rendered).size, rendered.length);
  const long = plan(320, { all, none, more }, [{ id: 'long', width: 240 }, { id: 'b', width: 74 }], 'long', gap);
  assert.equal(long.compact, true, '超长选中放不下固定项＋外显位时收敛');
});

test('尺寸变小只减少前缀、尺寸恢复后按既定顺序复原，不记录常用项', () => {
  const wide = plan(1000, { all, none, more }, entries, null, gap);
  const narrow = plan(all + gap + none + gap + more + 2, { all, none, more }, entries, null, gap);
  const restored = plan(1000, { all, none, more }, entries, null, gap);
  assert.deepEqual(wide.visibleIds, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(narrow.showMore, true);
  assert.deepEqual(narrow.visibleIds, []);
  assert.deepEqual(restored.visibleIds, wide.visibleIds, '同输入必须给出同排布（无持久化常用分类）');
});

test('相同宽度反复计算稳定，不产生排布循环', () => {
  const width = all + gap + none + gap + 90 + gap + more + 3;
  const first = plan(width, { all, none, more }, entries, null, gap);
  for (let i = 0; i < 5; i++) assert.deepEqual(plan(width, { all, none, more }, entries, null, gap), first);
});
