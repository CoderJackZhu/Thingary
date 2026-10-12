import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as categories from '../src/income-classification.ts';
import * as contract from '../src/finance-contract.ts';

const record = (id, date, net, hpf, category) => ({ id, fields: { date, net_cents: net, hpf_cents: hpf, category, notes: id } });
const income = (id, date, net, hpf, category, notes = id) => ({ id, fields: { date, net_cents: net, hpf_cents: hpf, category, notes } });
// Controlled host view: the real finance-contract is injected so period boundaries are the production ones.
const controlled = (incomes, props = {}) => runtime('IncomeRecords', { incomes, onOpen() {}, onNew() {}, disabled: false, ...props }, undefined, undefined, { components: [], modules: { './income-classification': categories, './finance-contract': contract } });
const periodSummary = r => r.find('dl', p => p['aria-label'] === '期间合计');
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

test('controlled range excludes the opening day and includes the closing day', () => {
  const incomes = { generation: 'fictional', rows: [
    income('start', '2026-09-01', '100000', '0', 'non_investment'),
    income('inside', '2026-09-15', '200000', '0', 'non_investment'),
    income('end', '2026-09-30', '300000', '0', 'non_investment'),
    income('after', '2026-10-01', '400000', '0', 'non_investment'),
  ] };
  const r = controlled(incomes, { period: { kind: 'range', from: '2026-09-01', to: '2026-09-30', includeFrom: false } });
  // Controlled mode hides the legacy month selector.
  assert.equal(r.find('select'), undefined);
  const body = r.text(r.find('tbody'));
  assert.doesNotMatch(body, /2026-09-01/);
  assert.match(body, /2026-09-15/);
  assert.match(body, /2026-09-30/);
  assert.doesNotMatch(body, /2026-10-01/);
  assert.equal(r.find('tbody').props.children.length, 2);
  const summary = r.text(periodSummary(r));
  assert.match(summary, /已记录到账/);
  assert.match(summary, /500000/);
  assert.match(summary, /2 笔/);
});

test('controlled month and year periods use inclusive natural-day boundaries', () => {
  const incomes = { generation: 'fictional', rows: [
    income('jan', '2026-01-01', '100000', '0', 'non_investment'),
    income('sep-start', '2026-09-01', '110000', '0', 'non_investment'),
    income('sep-end', '2026-09-30', '120000', '0', 'non_investment'),
    income('dec', '2026-12-31', '130000', '0', 'non_investment'),
  ] };
  const month = controlled(incomes, { period: { kind: 'month', month: '2026-09' } });
  const monthBody = month.text(month.find('tbody'));
  assert.match(monthBody, /2026-09-01/);
  assert.match(monthBody, /2026-09-30/);
  assert.doesNotMatch(monthBody, /2026-01-01/);
  assert.doesNotMatch(monthBody, /2026-12-31/);
  assert.equal(month.find('tbody').props.children.length, 2);
  const year = controlled(incomes, { period: { kind: 'year', year: 2026 } });
  const yearBody = year.text(year.find('tbody'));
  assert.match(yearBody, /2026-01-01/);
  assert.match(yearBody, /2026-12-31/);
  assert.equal(year.find('tbody').props.children.length, 4);
});

test('search filters only detail rows and never recomputes the period summary', () => {
  const incomes = { generation: 'fictional', rows: [
    income('salary', '2026-09-10', '300000', '0', 'non_investment', 'ACME payroll'),
    income('interest', '2026-09-15', '10000', null, 'interest', 'Bank Interest'),
    income('gift', '2026-09-20', '0', '0', 'unclassified', 'gift note'),
  ] };
  const categoryDl = r => r.nodes().find(n => n.type === 'dl' && n.props['aria-label'] === undefined);
  const r = controlled(incomes, { period: { kind: 'month', month: '2026-09' } });
  const summaryBefore = r.text(periodSummary(r));
  const categoriesBefore = r.text(categoryDl(r));
  assert.match(summaryBefore, /310000/);
  assert.match(summaryBefore, /3 笔/);
  // Case-insensitive and trim-tolerant: notes match while the totals stay put.
  r.props.search = '  INTEREST  '; r.render();
  const body = r.text(r.find('tbody'));
  assert.match(body, /2026-09-15/);
  assert.doesNotMatch(body, /2026-09-10/);
  assert.equal(r.find('tbody').props.children.length, 1);
  assert.equal(r.text(periodSummary(r)), summaryBefore);
  assert.equal(r.text(categoryDl(r)), categoriesBefore);
  // Chinese category and date matching also filter details only.
  r.props.search = '未分类'; r.render();
  assert.equal(r.find('tbody').props.children.length, 1);
  assert.equal(r.text(periodSummary(r)), summaryBefore);
  r.props.search = '2026-09-20'; r.render();
  assert.equal(r.find('tbody').props.children.length, 1);
  assert.equal(r.text(periodSummary(r)), summaryBefore);
  // No match: the empty note is about the search, never about the period being empty or zeroed.
  r.props.search = 'zzz'; r.render();
  const root = r.text(r.nodes()[0]);
  assert.match(root, /没有匹配的收入记录/);
  assert.doesNotMatch(root, /尚未记录/);
  assert.equal(r.text(periodSummary(r)), summaryBefore);
});

test('unknown hpf, explicit zero and an empty period stay distinct', () => {
  const rows = [
    income('known-zero', '2026-09-10', '0', '0', 'non_investment'),
    income('unknown-hpf', '2026-09-12', '50000', null, 'non_investment'),
  ];
  const mixed = controlled({ generation: 'fictional', rows }, { period: { kind: 'month', month: '2026-09' } });
  const mixedSummary = mixed.text(periodSummary(mixed));
  assert.match(mixedSummary, /50000/);
  assert.match(mixedSummary, /未知/);
  assert.match(mixedSummary, /另有 1 条未知/);

  const zero = controlled({ generation: 'fictional', rows: [income('zero', '2026-09-10', '0', '0', 'unclassified')] }, { period: { kind: 'month', month: '2026-09' } });
  const zeroSummary = zero.text(periodSummary(zero));
  assert.match(zeroSummary, /0/);
  assert.doesNotMatch(zeroSummary, /尚未记录/);

  const empty = controlled({ generation: 'fictional', rows: [income('other', '2026-08-10', '1000', '0', 'non_investment')] }, { period: { kind: 'month', month: '2026-09' } });
  const emptySummary = empty.text(periodSummary(empty));
  assert.match(emptySummary, /尚未记录/);
  assert.doesNotMatch(emptySummary, /0/);
  assert.match(empty.text(empty.nodes()[0]), /尚未记录/);
});

test('disabled keeps open and record actions inert in controlled mode', () => {
  const incomes = { generation: 'fictional', rows: [income('one', '2026-09-10', '1000', '0', 'non_investment')] };
  const r = controlled(incomes, { period: { kind: 'month', month: '2026-09' }, disabled: true });
  const link = r.find('button', p => p.className === 'link-cell');
  assert.equal(link.props.disabled, true);
  const empty = controlled({ generation: 'fictional', rows: [] }, { period: { kind: 'month', month: '2026-09' }, disabled: true });
  const add = empty.nodes().find(n => n.type === 'button' && empty.text(n) === '记一笔收入');
  assert.equal(add.props.disabled, true);
});
