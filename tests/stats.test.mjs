import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('purchase trend states its scope and keeps undated purchases out of periods', () => {
  const page = readFileSync(new URL('../src/Stats.tsx', import.meta.url), 'utf8');
  assert.match(page, /invoke<Trend>\('purchase_trend', \{ granularity \}\)/);
  assert.match(page, /历史全部：含已售出，不含已删除/);
  assert.match(page, /件购入日期未知，不归入任何期间/);
  assert.match(page, /出售不回减，不是当前估值/);
  // Two single-axis charts, never a dual axis.
  assert.equal((page.match(/<Chart buckets=/g) ?? []).length, 2);
  assert.match(page, /查看表格/);
});

test('axis ticks always reach the maximum value', () => {
  const src = readFileSync(new URL('../src/Stats.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function ticks'), src.indexOf('\n}\n', src.indexOf('function ticks')) + 2);
  const ticks = new Function(`${body.replace(/: number/g, '')}; return ticks;`)();
  for (const max of [1, 99, 100, 101, 1029900, 4292650, 999999999]) {
    const t = ticks(max);
    assert.ok(t.at(-1) >= max && t.length <= 6, `${max} -> ${t}`);
  }
});

test('rankings keep backend exact order and separate gross from net', () => {
  const src = readFileSync(new URL('../src/Stats.tsx', import.meta.url), 'utf8');
  assert.match(src, /invoke<Holding>\('holding', \{ scope \}\)/);
  assert.match(src, /const list = descending \? rows : rows\.slice\(\)\.reverse\(\);/);
  assert.doesNotMatch(src, /\.sort\(/, 'no client-side re-sort on rounded values');
  assert.match(src, /当前持有 · 毛日均/);
  assert.match(src, /已售出 · 净日均/);
  assert.match(src, /件资料不完整，未参与排行/);
  assert.match(src, /件购入日期未知，未计入分组与平均/);
});
