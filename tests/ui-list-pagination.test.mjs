import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import { inputMoney, money } from '../src/asset.ts';
import { readFileSync } from 'node:fs';

const rows = Array.from({ length: 1000 }, (_, index) => ({ id: `fictional-${index}` }));
const view = (items = rows) => runtime('ListPagination', {
  rows: items, label: '虚构来源', render: row => ({ type: 'li', props: { children: row.id }, key: row.id }),
}, undefined, undefined, { components: [] });

test('1000 fictional source rows render 50 at a time while the final row remains reachable', () => {
  const page = view();
  assert.equal(page.nodes().filter(node => node.type === 'li').length, 50);
  assert.match(page.text(page.nodes()[0]), /fictional-0/);
  assert.doesNotMatch(page.text(page.nodes()[0]), /fictional-50/);
  assert.match(page.text(page.nodes()[0]), /共 1000 条/);
  for (let i = 0; i < 19; i++) { page.button('下一页').props.onClick(); page.render(); }
  assert.equal(page.nodes().filter(node => node.type === 'li').length, 50);
  assert.match(page.text(page.nodes()[0]), /fictional-999/);
  assert.equal(page.button('下一页').props.disabled, true);
});

test('a shorter refreshed result clamps the visible page without losing rows', () => {
  const page = view();
  page.button('下一页').props.onClick(); page.render();
  page.props.rows = rows.slice(0, 4); page.render();
  assert.equal(page.nodes().filter(node => node.type === 'li').length, 4);
  assert.match(page.text(page.nodes()[0]), /fictional-3/);
  assert.equal(page.find('nav'), undefined);
});

test('the largest valid asset amount remains a complete display value', () => {
  const formatted = money(inputMoney('999999999.99'));
  assert.match(formatted, /999,999,999\.99/);
  const css = readFileSync(new URL('../src/ui.css', import.meta.url), 'utf8');
  const metricValueRule = css.match(/\.ui-metrics \.ui-value\{([^}]*)\}/)?.[1] ?? '';
  assert.match(metricValueRule, /overflow-wrap:anywhere/);
  assert.doesNotMatch(metricValueRule, /overflow:hidden|text-overflow:ellipsis|white-space:nowrap/);
});
