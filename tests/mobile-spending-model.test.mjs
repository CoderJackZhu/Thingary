import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, dueBadge, expenseChart, expenseRows, expenseSummary, incomeView, inSegment, matchesPlan, nextPayment, paidInPeriod, periodFromKey, periodList, planAmountText, planCost, progressParts, samePeriod, signedMoney, sortPlans, termText, virtualSummary } from '../src/mobile/spending/model.ts';

const fields = (over = {}) => ({ name: '房租', category: 'rent', amount_cents: '450000', interval_months: 1, first_due: '2026-01-01', service_start: '2026-01-01', coverage_start: '2026-01-01', end_date: null, paused: false, auto_renew: true, interval_days: null, trial_days: null, notes: '', ...over });
const plan = (over = {}, extra = {}) => ({ id: 'p1', fields: fields(over), revision: 1, active_from: '2026-01-01', next_due: '2026-11-01', monthly_cents: '450000', paid_cents: '0', ...extra });
const today = '2026-10-21';

test('期间：本月 今年 全部 自选 按桌面校验器生成', () => {
  assert.deepEqual(periodFromKey('all', today), { ok: true, value: { kind: 'all' } });
  assert.equal(periodFromKey('year', today).value.year, 2026);
  assert.equal(periodFromKey('month', today).value.month, '2026-10');
  assert.equal(periodFromKey('custom', today, { from: '2026-03-01', to: '2026-04-30' }).ok, true);
  assert.equal(periodFromKey('custom', today, { from: '2026-05-01', to: '2026-04-30' }).ok, false);
  assert.equal(periodFromKey('custom', today).ok, false);
});
test('samePeriod 区分类型与边界', () => {
  assert.ok(samePeriod({ kind: 'all' }, { kind: 'all' }));
  assert.ok(!samePeriod({ kind: 'year', year: 2025 }, { kind: 'year', year: 2026 }));
  assert.ok(!samePeriod({ kind: 'year', year: 2026 }, { kind: 'all' }));
});
test('到期徽标：逾期、今天、几天后', () => {
  assert.equal(daysBetween('2026-10-21', '2026-10-25'), 4);
  assert.deepEqual(dueBadge('2026-10-18', today), { text: '已逾期 3 天', tone: 'danger' });
  assert.deepEqual(dueBadge(today, today), { text: '今天', tone: 'warn' });
  assert.deepEqual(dueBadge('2026-10-25', today), { text: '4 天后', tone: 'warn' });
  assert.equal(dueBadge('2026-11-25', today).tone, 'neutral');
});
const line = (over) => ({ source: 'expense', id: 'e1', asset_id: null, title: '东京旅行', category: 'travel', date: '2026-05-01', amount_cents: '800000', notes: null, ...over });
test('支出行：退款为负、未知金额不是零', () => {
  const rows = expenseRows([line(), line({ id: 'r', source: 'refund', amount_cents: '50000' }), line({ id: 'u', title: '培训', amount_cents: null })]);
  assert.equal(signedMoney(rows[0]), '¥8,000');
  assert.match(signedMoney(rows[1]), /^[-−].*¥500$/);
  assert.equal(signedMoney(rows[2]), null);
  assert.equal(expenseRows([line()], '旅行').length, 1);
  assert.equal(expenseRows([line()], '不存在').length, 0);
});
test('支出合计只数进入期间支出的带日期记录；全部未知时不给数字', () => {
  const view = { lines: [line({ amount_cents: null })], spent_cents: '0' };
  const s = expenseSummary(view);
  assert.equal(s.display.value, null);
  assert.equal(s.display.note, '金额待补');
  assert.equal(expenseSummary({ lines: [line(), line({ id: 'x', amount_cents: null })], spent_cents: '800000' }).netUnknown, true);
});
test('支出图：全部期间逐年柱，年份内逐月柱；未知画缺口，并带文字结论', () => {
  const years = { annual_totals: [{ year: 2025, spent_cents: '100000', refund_cents: '0', net_cents: '100000', sale_cents: '0', count: 2, known_count: 2, unknown_count: 0 }, { year: 2026, spent_cents: '0', refund_cents: '0', net_cents: '0', sale_cents: '0', count: 1, known_count: 0, unknown_count: 1 }], months: [] };
  const chart = expenseChart(years, { kind: 'all' });
  assert.deepEqual(chart.bars.map(b => b.value), [100000, null]);
  assert.match(chart.summary, /2025 年最多/);
  assert.match(chart.summary, /金额待补/);
  assert.equal(expenseChart({ annual_totals: [], months: [] }, { kind: 'all' }), null);
  const months = { annual_totals: [], months: [{ month: '2026-01', spent_cents: '5000', refund_cents: '0', count: 1, known_count: 1, unknown_count: 0 }, { month: '2026-02', spent_cents: '0', refund_cents: '0', count: 0, known_count: 0, unknown_count: 0 }] };
  assert.deepEqual(expenseChart(months, { kind: 'year', year: 2026 }).bars.map(b => b.value), [5000, 0]);
  assert.equal(expenseChart(months, { kind: 'month', month: '2026-01' }), null);
});
test('计划排序：进行中按下次付款日，暂停与已结束靠后', () => {
  const a = plan({ name: 'A' }, { id: 'a', next_due: '2026-12-01' }), b = plan({ name: 'B' }, { id: 'b', next_due: '2026-11-01' });
  const c = plan({ name: 'C', paused: true }, { id: 'c' }), d = plan({ name: 'D', end_date: '2026-01-31' }, { id: 'd' });
  assert.deepEqual(sortPlans([d, c, a, b], today).map(p => p.id), ['b', 'a', 'c', 'd']);
  assert.ok(matchesPlan(a, '房租') && !matchesPlan(a, '保险') && matchesPlan(a, ''));
});
test('累计费用与每期金额文字：非月付另列月均', () => {
  assert.deepEqual(planCost({ estimated_cents: '900000', paid_cents: '450000' }), { cents: '900000', estimated: true });
  assert.deepEqual(planCost({ paid_cents: '450000' }), { cents: '450000', estimated: false });
  assert.equal(planAmountText(plan(), false).monthly, null);
  assert.equal(planAmountText(plan({ interval_months: 3, amount_cents: '300000' }, { monthly_cents: '100000' }), false).monthly, '月均 ¥1,000');
  assert.match(planAmountText(plan(), false).main, /每期 ¥4,500 \/ 月/);
});
test('期间已付：按实付日期，未知金额单独计数', () => {
  const pay = (over) => ({ id: 'x', plan_id: 'p1', plan_name: 'p', due_date: '2026-02-01', state: 'paid', paid_date: '2026-02-01', amount_cents: '100', notes: '', revision: 1, off_schedule: false, ...over });
  const r = paidInPeriod([pay({}), pay({ id: 'y', amount_cents: null }), pay({ id: 'z', paid_date: '2025-02-01' }), pay({ id: 'w', state: 'skipped', paid_date: null })], { kind: 'year', year: 2026 });
  assert.deepEqual(r, { cents: '100', count: 2, unknown: 1 });
});
test('付款期次：已确认、已跳过、待确认、未到，固定租期给出总期数和进度', () => {
  const p = plan({ end_date: '2026-12-31', first_due: '2026-08-01', service_start: '2026-08-01', coverage_start: '2026-08-01' });
  const pay = (due, state) => ({ id: due, plan_id: 'p1', plan_name: 'p', due_date: due, state, paid_date: state === 'paid' ? due : null, amount_cents: state === 'paid' ? '450000' : null, notes: '', revision: 1, off_schedule: false });
  const list = periodList(p, [pay('2026-08-01', 'paid'), pay('2026-09-01', 'skipped')], [], today);
  assert.equal(list.total, 5);
  assert.deepEqual([list.paid, list.skipped, list.pending, list.upcoming], [1, 1, 1, 2]);
  assert.equal(list.rows.find(r => r.due === '2026-10-01').state, 'pending');
  assert.equal(list.rows.find(r => r.due === '2026-11-01').state, 'upcoming');
  const parts = progressParts(list);
  assert.equal(parts.paid, 20);
  assert.match(termText(p, list), /2026-08 至 2026-12（5 期）/);
  assert.equal(progressParts(periodList(plan(), [], [], today)), null);
});
test('暂停的计划不列待确认；下次付款对暂停与已结束为空', () => {
  const paused = plan({ paused: true, first_due: '2026-08-01', service_start: '2026-08-01', coverage_start: '2026-08-01' });
  assert.equal(periodList(paused, [], [], today).pending, 0);
  assert.equal(nextPayment(paused, today), null);
  assert.equal(nextPayment(plan({ end_date: '2026-01-31' }), today), null);
  assert.equal(nextPayment(plan(), today).date, '2026-11-01');
});
const virt = (over = {}) => ({ id: 'v', revision: 1, plan_name: null, plan_deleted: false, valid_until: null, status: 'ongoing', spent_cents: null, fields: { name: 'x', kind: 'general', billing: 'subscription', label_id: null, provider: '', purchase_date: null, price_cents: null, expires: null, plan_id: null, url: '', notes: '', stopped_on: null }, ...over });
test('虚拟资产汇总：订阅年化来自每期金额，储值余额只来自已记录余额', () => {
  const sub = virt({ plan: plan({ amount_cents: '10000' }) });
  const yearly = virt({ id: 'y', plan: plan({ amount_cents: '120000', interval_months: 12 }) });
  const t1 = virt({ id: 't1', fields: { ...virt().fields, billing: 'topup' }, status: 'active', balance: { balance_cents: '5000' } });
  const t2 = virt({ id: 't2', fields: { ...virt().fields, billing: 'topup' }, status: 'active' });
  const s = virtualSummary([sub, yearly, t1, t2]);
  assert.equal(s.annual, '240000');
  assert.equal(s.monthly, '20000');
  assert.equal(s.balance, '5000');
  assert.equal(s.balanceUnknown, 1);
  assert.equal(virtualSummary([t2]).balance, null);
  assert.equal(inSegment(t1, 'topup'), true);
  assert.equal(inSegment(t1, 'subscription'), false);
  assert.equal(inSegment(sub, 'all'), true);
});
test('收入视图：期间合计不受搜索影响；同日多笔；未知公积金单列', () => {
  const inc = (id, date, net, hpf, category = 'unclassified', notes = '') => ({ id, revision: 1, fields: { date, net_cents: net, hpf_cents: hpf, notes, category } });
  const all = [inc('a', '2026-05-01', '1000000', '100000', 'non_investment'), inc('b', '2026-05-01', '5000', null, 'non_investment', 'bonus'), inc('c', '2025-05-01', '1', null)];
  const v = incomeView(all, { kind: 'year', year: 2026 }, 'bonus');
  assert.equal(v.count, 2);
  assert.equal(v.net, '1005000');
  assert.equal(v.shown.length, 1);
  assert.equal(v.hpf.unknown, 1);
  assert.equal(incomeView(all, { kind: 'year', year: 2024 }).net, null);
});
