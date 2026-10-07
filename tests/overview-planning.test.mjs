import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ageText, defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { buildRetireCalc, disposable } from '../src/plan-retire-calc.ts';
import { coverageNow, goalHeadline, summaryBasis, summaryRetire, usualSaving } from '../src/plan-summary.ts';
import { clearTrendRange, recallTrendRange, rememberTrendRange } from '../src/review.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const today = '2026-10-06';

const saved = (retire, birth = '1990-06') => ({ revision: 1, updated_at: today, profile: {
  birth_month: birth, worker: 'male', region: 'beijing', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
  personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000, assumptions: defaultAssumptions, overrides: noOverrides, retire: { ...defaultRetire, core: { contract_version: 1, monetary_basis_date: '2026-10-06', fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }], hpf_monthly_cents: '0', costs: [], occurrences: [] }, saving_phases: [{ id: 'default-explicit', label: '显式测试假设', from_age_months: 0, monthly_cents: 1000000 }], ...retire },
} });
const snap = cents => ({ entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: String(cents) }] });
const stats = (median, extra = {}) => ({ mean_monthly_change_cents: median, count: 4, low_sample: false, median_monthly_saving_cents: median, mean_monthly_saving_cents: median, median_monthly_spend_cents: null, window_from: '2025-10-06', latest_date: today, ...extra });
const reviewOf = median => ({ intervals: [], stats: stats(median), incomplete_count: 0 });
const ready = calc => {
  assert.ok(calc.plan && calc.proj && calc.out && calc.assets !== null, 'fixture must be calculable');
  return calc;
};

test('fire headline: waiting keeps month-level age, matching the goals page exactly', () => {
  const calc = ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(20_000_000), reviewOf('1000000'), [], today));
  const h = goalHeadline(calc, today);
  assert.match(h.main, /^预计还需 \d+ 年( \d+ 个月)?$/);
  assert.ok(h.sub.includes(`约 ${Math.floor((2026 * 12 + 9 + (calc.proj.fi_month - calc.plan.now_months)) / 12)} 年`), h.sub);
  assert.ok(h.sub.includes(ageText(calc.proj.fi_month)), 'goal page and summary share the same month-level age');
  assert.equal(h.sub.includes('晚于期望'), calc.proj.fi_month > calc.plan.target_months);
});

test('fire headline: reached and unreachable use the actual search cap, never "forever"', () => {
  const reached = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(500_000_000), reviewOf('1000000'), [], today)), today);
  assert.equal(reached.main, '当前资产已覆盖退休所需');
  assert.equal(reached.sub, '按当前假设估算');
  // 50 万元预算、零储蓄、20 万资产：搜索范围内不可达；horizon 65 早于 70 岁上限时按实际终点年龄。
  const capped = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '50000000', horizon_age: 65, saving_phases: [{ id: 'zero', label: '明确零', from_age_months: 0, monthly_cents: 0 }] }), snap(20_000_000), reviewOf('0'), [], today)), today);
  assert.equal(capped.main, '当前假设下，65 岁前尚未达成');
  const defaultCap = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '50000000', saving_phases: [{ id: 'zero', label: '明确零', from_age_months: 0, monthly_cents: 0 }] }), snap(20_000_000), reviewOf('0'), [], today)), today);
  assert.equal(defaultCap.main, '当前假设下，70 岁前尚未达成');
});

test('traditional headline: surplus and shortfall are words, not just colors', () => {
  const surplus = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000', mode: 'traditional', target_age: 60 }), snap(500_000_000), reviewOf('1000000'), [], today)), today);
  assert.equal(surplus.main, '60 岁退休');
  assert.match(surplus.sub, /^预计盈余 ¥[\d,]+$/);
  const shortfall = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000', mode: 'traditional', target_age: 60, saving_phases: [{ id: 'zero', label: '明确零', from_age_months: 0, monthly_cents: 0 }] }), snap(0), reviewOf('0'), [], today)), today);
  assert.match(shortfall.sub, /^预计缺口 ¥[\d,]+$/);
});

test('coverage ratio uses the goals-page function including its boundaries', () => {
  const base = ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(20_000_000), reviewOf('1000000'), [], today));
  const c = coverageNow(base);
  assert.equal(c.percent, Math.max(0, Math.min(10000, Math.round(Math.min(1, c.assets / c.requiredNow) * 10000))));
  const debtOnly = buildRetireCalc(saved({ spend_cents: '500000' }), { entries: [{ account_id: 'debt', counted: true, side: 'liability', kind: 'loan', amount_cents: '9000000' }] }, reviewOf('1000000'), [], today);
  assert.equal(debtOnly.assets, 0, 'debt principal is not an initial cash withdrawal');
  assert.match(debtOnly.missing.join(' '), /还款接续/);
  // 所需为零（预算 0）：按现有函数视为 100%。
  const zeroNeed = ready(buildRetireCalc(saved({ spend_cents: '0' }), snap(12345), reviewOf('0'), [], today));
  assert.equal(coverageNow(zeroNeed).requiredNow, 0);
  assert.equal(coverageNow(zeroNeed).percent, 10000);
});

const sources = (over = {}) => ({
  review: over.review ?? { status: 'ready', value: over.noMedian ? reviewOf(null) : reviewOf('1000000') },
  incomes: { status: 'ready', value: [] },
  profile: over.profile ?? { status: 'ready', value: { generation: 'g', saved: saved(over.retire ?? {}) } },
  snapshot: over.snapshot ?? { status: 'ready', value: snap(20_000_000) },
  snapshotId: 'snapshotId' in over ? over.snapshotId : 's1',
  snapshotDate: 'snapshotDate' in over ? over.snapshotDate : today,
});

test('missing inputs follow the design order: snapshot → profile → budget → saving', () => {
  const noSnapshot = sources({ snapshot: { status: 'ready', value: null }, snapshotId: null, snapshotDate: null });
  assert.equal(summaryRetire(noSnapshot, today).kind, 'blocked');
  assert.equal(summaryRetire(noSnapshot, today).step, 'snapshot');
  assert.equal(summaryRetire(sources({ profile: { status: 'ready', value: { generation: 'g', saved: null } } }), today).step, 'profile');
  // 预算与储蓄同时缺：预算先提示。
  assert.equal(summaryRetire(sources({ retire: {} }), today).step, 'budget');
  assert.equal(summaryRetire(sources({ retire: { spend_cents: '500000', saving_phases: [] }, noMedian: true }), today).step, 'saving');
  // 历史储蓄未知但阶段已填：退休仍可算（A08）。
  const phased = summaryRetire(sources({ retire: { spend_cents: '500000', saving_phases: [{ id: 'p', label: '阶段', from_age_months: 0, monthly_cents: 800000 }] }, noMedian: true }), today);
  assert.equal(phased.kind, 'ready');
});

test('a failed source degrades the retire area without wiping independent savings', () => {
  const r = summaryRetire(sources({ profile: { status: 'error', value: { code: '', message: 'x' } } }), today);
  assert.equal(r.kind, 'error');
  assert.equal(r.message, 'x');
});

test('usual saving keeps known values (zero and negative) and explains unknowns precisely', () => {
  const iv = over => ({ status: 'ok', excluded: false, in_window: true, ...over });
  assert.equal(usualSaving(reviewOf('0')).kind, 'known');
  assert.equal(usualSaving(reviewOf('0')).negative, false);
  assert.equal(usualSaving(reviewOf('-5000')).negative, true);
  assert.equal(usualSaving({ intervals: [], stats: stats(null), incomplete_count: 0 }).kind, 'unknown');
  const noComplete = { intervals: [], stats: { ...stats(null), latest_date: null }, incomplete_count: 0 };
  assert.match(usualSaving(noComplete).reason, /还没有完整盘点/);
  assert.match(usualSaving({ intervals: [], stats: stats(null), incomplete_count: 0 }).reason, /至少两次完整盘点/);
  assert.match(usualSaving({ intervals: [iv({ status: 'no_income' })], stats: stats(null), incomplete_count: 0 }).reason, /月度收入/);
  assert.match(usualSaving({ intervals: [iv({ status: 'scope_changed' })], stats: stats(null), incomplete_count: 0 }).reason, /计入范围/);
  assert.match(usualSaving({ intervals: [iv({ excluded: true })], stats: stats(null), incomplete_count: 0 }).reason, /一次性变动/);
  assert.match(usualSaving({ intervals: [iv({ in_window: false })], stats: stats(null), incomplete_count: 0 }).reason, /近 12 个月内没有可比区间/);
  // 样本少时保留数字，只加标注。
  const low = usualSaving({ intervals: [], stats: stats('761920', { count: 2, low_sample: true }), incomplete_count: 0 });
  assert.deepEqual([low.kind, low.count, low.low_sample], ['known', 2, true]);
});

test('basis notes separate historical median from configured phases and list included events', () => {
  const plain = summaryRetire(sources({ retire: { spend_cents: '500000' } }), today);
  const notes = summaryBasis(plain);
  assert.ok(notes.includes(`依据 ${today} 完整盘点`));
  assert.ok(notes.includes('退休估算采用已设置的储蓄阶段／路线'));
  assert.ok(notes.includes('按当前假设估算'));
  const withPhases = summaryRetire(sources({ retire: { spend_cents: '500000', saving_phases: [{ id: 'p', label: '阶段', from_age_months: 0, monthly_cents: 800000 }], life_events: [{ id: 'e', label: '买车', kind: 'car', date: '2027-06', included: true, price_cents: '7000000', down_cents: '7000000', extra_cents: '0', loan_rate_hundredths: 350, loan_years: 3, holding_cents: '120000', rent_saved_cents: '0', cycle_years: null, until_age: null, resale_cents: '0' }] } }), today);
  const phaseNotes = summaryBasis(withPhases);
  assert.ok(phaseNotes.includes('退休估算采用已设置的储蓄阶段／路线'));
  assert.ok(phaseNotes.includes('已计入大额计划'));
});

test('trend range memory is per-library and session-only', () => {
  rememberTrendRange('g1', '6m');
  assert.equal(recallTrendRange('g1'), '6m');
  assert.equal(recallTrendRange('g2'), 'all', 'a different library never inherits the choice');
  // 单值记忆：切库后的新选择取代旧库，不把同库旧数据持久化成跨库缓存。
  rememberTrendRange('g2', '1y');
  assert.equal(recallTrendRange('g2'), '1y');
  assert.equal(recallTrendRange('g1'), 'all');
  clearTrendRange();
  assert.equal(recallTrendRange('g2'), 'all');
});

test('top layout is a container-driven 2:1 grid that collapses below 960px', () => {
  const css = read('../src/review.css');
  assert.match(css, /container-type:inline-size/);
  assert.match(css, /@container \(min-width:960px\)\{\.review-top\.duo\{grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\)\}\}/);
});

test('the summary mounts only behind module gating and degrades to a dependency notice', () => {
  const view = read('../src/ReviewView.tsx');
  assert.match(view, /modules\.planning && \(modules\.wealth/);
  assert.match(view, /\? <ReviewPlanSummary/);
  assert.match(view, /开启「账户与盘点」后显示规划摘要/);
  assert.match(view, /planning: modules\.planning && modules\.wealth/);
  assert.match(view, /data=\{data\.planning \?\? null\}/);
  const overview = read('../src/Overview.tsx');
  assert.match(overview, /financeOff\(modules\) && !modules\.planning/);
});

test('the goals page shares the projection instead of rounding ages differently', () => {
  const goals = read('../src/PlanningGoals.tsx');
  assert.match(goals, /goalHeadline\(calc, today\)/);
  assert.match(goals, /coverageNow\(calc\)/);
  assert.ok(!goals.includes('const ageOf'), 'no second age formatter that would truncate months');
  assert.match(goals, /显式阶段假设/);
});


test('a disappeared snapshot is a missing baseline, never a numeric estimate', () => {
  assert.equal(summaryRetire(sources({ snapshot: { status: 'ready', value: null } }), today).step, 'snapshot');
});


test('unknown saving reasons describe the current statistical window', () => {
  const old = { status: 'no_income', excluded: false, in_window: false };
  const r = { intervals: [old], stats: stats(null), incomplete_count: 0 };
  assert.equal(usualSaving(r).reason, '近 12 个月内没有可比区间。');
  r.intervals.push({ status: 'ok', excluded: true, in_window: true });
  assert.equal(usualSaving(r).reason, '可比区间都已标记为一次性变动。');
});
