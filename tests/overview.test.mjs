import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('overview keeps held and history apart and never hides unknowns', () => {
  const page = read('../src/Overview.tsx');
  assert.match(page, /invoke<OverviewData>\('overview', \{ scope \}\)/);
  assert.match(page, /件金额未知，未计入/);
  assert.match(page, /件购入日期未知，未计入/);
  assert.match(page, /历史购入金额/);
  assert.match(page, /money\(data\.history_known_cents\)/);
  assert.match(page, /含已售出 \{data\.sold_count\}/);
  assert.match(page, /不计入金额占比/);
});

test('category colors use the validated palette in fixed category order', () => {
  const css = read('../src/theme.css');
  // Validated with dataviz validate_palette.js on #ffffff (light) and #252931 (dark card).
  assert.match(css, /--series-1:#2a78d6;--series-2:#eb6834;--series-3:#1baf7a;--series-4:#eda100;--series-5:#e87ba4;--series-6:#008300;--series-7:#4a3aa7/);
  assert.match(read('../src/Overview.tsx'), /c\.slot === null \? 'var\(--series-rest\)' : `var\(--series-\$\{c\.slot \+ 1\}\)`/);
});

test('分类分布按当前口径排序，圆环与表格共用同一份顺序', () => {
  const page = read('../src/Overview.tsx');
  // 口径切换必须真的改变顺序：后端按分类位置返回，直接用 data.categories 会让口径看起来无效。
  assert.match(page, /import \{ sortByShare \} from '\.\/distribution'/);
  assert.match(page, /const rows = sortByShare\(data\.categories, metric\)/);
  // 颜色跟随分类自身，不随排序改变。
  assert.match(page, /c\.slot === null \? 'var\(--series-rest\)' : `var\(--series-\$\{c\.slot \+ 1\}\)`/);
  // 当前口径那一列标出降序。
  assert.match(page, /aria-sort=\{metric === 'count' \? 'descending' : 'none'\}/);
  assert.match(page, /aria-sort=\{metric === 'amount' \? 'descending' : 'none'\}/);
});
