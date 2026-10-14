import test from 'node:test';
import assert from 'node:assert/strict';
import { sortByShare, shareValue } from '../src/distribution.ts';

// 后端按分类位置（设置里的分类顺序）返回，与件数、金额无关；这里固定这个前提。
const rows = [
  { id: 'camera', name: '相机', count: 3, known_cents: '90000' },
  { id: 'laptop', name: '电脑', count: 7, known_cents: '150000' },
  { id: 'phone', name: '手机', count: 12, known_cents: '240000' },
  { id: 'none', name: '未分类', count: 1, known_cents: '0' },
];

test('按数量时表格与圆环按件数从高到低', () => {
  assert.deepEqual(sortByShare(rows, 'count').map(r => r.name), ['手机', '电脑', '相机', '未分类']);
});

test('按购入金额时改按金额从高到低，不再沿用分类顺序', () => {
  assert.deepEqual(sortByShare(rows, 'amount').map(r => r.name), ['手机', '电脑', '相机', '未分类']);
});

test('两种口径顺序不同：数量最多不等于金额最多', () => {
  const mixed = [
    { id: 'a', name: '多件小额', count: 20, known_cents: '1000' },
    { id: 'b', name: '少件大额', count: 2, known_cents: '990000' },
  ];
  assert.deepEqual(sortByShare(mixed, 'count').map(r => r.name), ['多件小额', '少件大额']);
  assert.deepEqual(sortByShare(mixed, 'amount').map(r => r.name), ['少件大额', '多件小额']);
});

test('金额未知的分类不当作有无，落在金额末位', () => {
  const unknownPrice = [
    { id: 'known', name: '已知', count: 1, known_cents: '5000' },
    { id: 'unknown', name: '未知', count: 9, known_cents: '0' },
  ];
  assert.deepEqual(sortByShare(unknownPrice, 'amount').map(r => r.name), ['已知', '未知']);
  // 按数量时它仍按真实的 9 件参与，不被金额口径的末位影响。
  assert.deepEqual(sortByShare(unknownPrice, 'count').map(r => r.name), ['未知', '已知']);
});

test('同值先比另一口径再按稳定 ID，顺序与系统语言无关且不改写传入数组', () => {
  const tied = [
    { id: 'b', name: '乙', count: 4, known_cents: '7000' },
    { id: 'a', name: '甲', count: 4, known_cents: '7000' },
    { id: 'c', name: '丙', count: 4, known_cents: '9000' },
  ];
  const original = structuredClone(tied);
  // 数量相同，金额大的丙在前；甲乙金额也相同，按稳定 ID 甲在前。
  assert.deepEqual(sortByShare(tied, 'count').map(r => r.name), ['丙', '甲', '乙']);
  assert.deepEqual(sortByShare(tied, 'amount').map(r => r.name), ['丙', '甲', '乙']);
  assert.deepEqual(tied, original);
});

test('未分类没有 ID 时用名称兜底，仍能稳定排序', () => {
  const mixed = [
    { id: null, name: '未分类', count: 2, known_cents: '3000' },
    { id: 'a', name: '甲', count: 2, known_cents: '3000' },
  ];
  assert.deepEqual(sortByShare(mixed, 'count').map(r => r.name), ['甲', '未分类']);
});

test('shareValue 读当前口径的整数分，不按格式化文字比较', () => {
  assert.equal(shareValue(rows[2], 'count'), 12);
  assert.equal(shareValue(rows[2], 'amount'), 240000);
  // 大额保持整数精度：9007199254740993 不能被舍入成 ...92。
  const huge = { id: 'h', name: '大额', count: 1, known_cents: '9007199254740993' };
  const bigger = { ...huge, id: 'h2', known_cents: '9007199254740992' };
  assert.equal(shareValue(huge, 'amount'), 9007199254740993);
  assert.deepEqual(sortByShare([huge, bigger], 'amount').map(r => r.id), ['h', 'h2']);
});

test('空分布与单行分布不报错', () => {
  assert.deepEqual(sortByShare([], 'count'), []);
  assert.deepEqual(sortByShare([rows[0]], 'amount').map(r => r.name), ['相机']);
});