import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as categories from '../src/income-classification.ts';

const record = (id, date, net, hpf, category) => ({ id, fields: { date, net_cents: net, hpf_cents: hpf, category, notes: id } });
test('month filtering keeps income rows and classification totals aligned, including unknown hpf', () => {
  const incomes = { generation: 'fictional', rows: [record('salary', '2026-08-15', '200000', '0', 'non_investment'), record('interest', '2026-09-15', '10000', null, 'interest')] };
  const r = runtime('IncomeRecords', { incomes, onOpen() {}, onNew() {}, disabled: false }, undefined, undefined, { components: [], modules: { './income-classification': categories } });
  r.find('select').props.onChange({ target: { value: '2026-09' } }); r.render();
  assert.equal(r.find('tbody').props.children.length, 1);
  assert.match(r.text(r.find('tbody')), /interest/);
  assert.doesNotMatch(r.text(r.find('tbody')), /salary/);
  assert.match(r.text(r.find('dl')), /10000/);
  assert.doesNotMatch(r.text(r.find('dl')), /200000/);
  assert.match(r.text(r.find('tbody')), /未知/);
  r.props.incomes = { ...incomes, rows: [incomes.rows[0]] }; r.render();
  assert.ok(r.button('查看全部月份'));
  r.button('查看全部月份').props.onClick(); r.render();
  assert.match(r.text(r.find('tbody')), /salary/);
});

test('review headline keeps unknown income and changed account scope distinct from zero', async () => {
  const { fixture } = await import('./planning-ui-fixture.mjs');
  const observations = await import('../src/review-observations.ts');
  const sources = fixture();
  const interval = { from: '2026-08-31', to: '2026-09-30', snapshot_id: 'fictional', delta_nw_cents: '100', income_cents: '0', income_records: 0, status: 'scope_changed' };
  const r = runtime('PlanningReviewSummary', { interval, sources, reasons: null, reasonError: '', summary: { points: [] }, summaryError: '', today: '2026-10-12', reload() {}, onPending() {}, onEditingChange() {}, onAction() {}, onRetry() {}, blocked: false }, undefined, undefined, { components: [], modules: { './income-classification': categories, './review-observations': observations } });
  const facts = () => r.text(r.find('dl', p => p['aria-label'] === '本期事实'));
  assert.match(facts(), /不可比较/);
  assert.match(facts(), /尚未记录/);
  sources.incomes = { status: 'error', value: { message: 'fictional read failure' } }; r.render();
  assert.match(facts(), /暂不可用/);
  assert.doesNotMatch(facts(), /尚未记录/);
});
