import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRetire } from '../src/plan.ts';
import { basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { emptyCore } from '../src/plan-core.ts';
import * as ledger from '../src/plan-ledger.ts';
import { buildRetireCalc, disposable } from '../src/plan-retire-calc.ts';
import { coverageNow, goalHeadline, summaryBasis, summaryRetire, usualSaving } from '../src/plan-summary.ts';
import { clearTrendRange, recallTrendRange, rememberTrendRange } from '../src/review.ts';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const today = '2026-10-06';

const saved = (retire) => ({ revision: 1, updated_at: today, profile: {
  assumptions: { inflation_hundredths: 0 },
  retire: { ...structuredClone(defaultRetire), mode: 'fire', core: { ...emptyCore(today), fund_rules: [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }] },
    basic: { ...structuredClone(basicInputFixtures.prediction.basic), start: { kind: 'live' }, contribution: { id: 'contribution', monthly_cents: retire.contribution_cents === undefined ? '1000000' : retire.contribution_cents } },
    simplified: { contract_version: 1, time: { reference: null, target_month: '2040-06', horizon_month: '2080-05' }, income_mode: 'excluded', future_incomes: [], household: { mode: 'single', partner: null } }, ...retire },
} });
const snap = cents => ({id:'s1',date:today,revision:1, entries: [{ account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: String(cents) }] });
const stats = (median, extra = {}) => ({ mean_monthly_change_cents: median, count: 4, low_sample: false, median_monthly_saving_cents: median, mean_monthly_saving_cents: median, median_monthly_spend_cents: null, window_from: '2025-10-06', latest_date: today, ...extra });
const reviewOf = median => ({ intervals: [], stats: stats(median), incomplete_count: 0 });
const ready = calc => {
  assert.ok(calc.plan && calc.proj && calc.out && calc.assets !== null, 'fixture must be calculable');
  return calc;
};

test('fire headline: waiting keeps explicit month, matching the goals page exactly', () => {
  const calc = ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(20_000_000), reviewOf('1000000'), [], today));
  const h = goalHeadline(calc, today);
  assert.match(h.main, /^预计还需 \d+ 年( \d+ 个月)?$/);
  assert.ok(h.sub.includes(`约 ${Math.floor((2026 * 12 + 9 + (calc.proj.fi_month - calc.plan.now_months)) / 12)} 年`), h.sub);
  assert.ok(h.sub.includes(ledger.timeLabel(calc.plan, calc.proj.fi_month)), 'goal page and summary share the same explicit month');
  assert.equal(h.sub.includes('晚于期望'), calc.proj.fi_month > calc.plan.target_months);
});

test('fire headline: reached and unreachable use the actual search cap, never "forever"', () => {
  const reached = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(500_000_000), reviewOf('1000000'), [], today)), today);
  assert.equal(reached.main, '当前资产已覆盖退休所需');
  assert.equal(reached.sub, '估算');
  // 50 万元预算、零储蓄、20 万资产：搜索范围内不可达；horizon 70 早于 70 岁上限时按实际终点年龄。
  const capped = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '50000000', simplified: { contract_version: 1, time: { reference: null, target_month: '2040-06', horizon_month: '2060-05' }, income_mode: 'excluded', future_incomes: [], household: { mode: 'single', partner: null } }, contribution_cents:'0' }), snap(20_000_000), reviewOf('0'), [], today)), today);
  assert.equal(capped.main, '当前假设下，2060-05 前尚未达成');
  const defaultCap = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '50000000', contribution_cents:'0' }), snap(20_000_000), reviewOf('0'), [], today)), today);
  assert.equal(defaultCap.main, '当前假设下，2080-05 前尚未达成');
});

test('traditional headline: surplus and shortfall are words, not just colors', () => {
  const surplus = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000', mode: 'traditional' }), snap(500_000_000), reviewOf('1000000'), [], today)), today);
  assert.equal(surplus.main, '2040-06 开始使用规划资金');
  assert.match(surplus.sub, /^预计盈余 ¥[\d,.]+$/);
  const shortfall = goalHeadline(ready(buildRetireCalc(saved({ spend_cents: '500000', mode: 'traditional', contribution_cents:'0' }), snap(0), reviewOf('0'), [], today)), today);
  assert.match(shortfall.sub, /^预计缺口 ¥[\d,.]+$/);
});

test('coverage ratio uses the goals-page function including its boundaries', () => {
  const base = ready(buildRetireCalc(saved({ spend_cents: '500000' }), snap(20_000_000), reviewOf('1000000'), [], today));
  const c = coverageNow(base);
  assert.equal(c.percent, Math.max(0, Math.min(10000, Math.round(Math.min(1, c.assets / c.requiredNow) * 10000))));
  const debtOnly = buildRetireCalc(saved({ spend_cents: '500000' }), {id:'s1',date:today,revision:1, entries: [{ account_id: 'debt', counted: true, side: 'liability', kind: 'loan', amount_cents: '9000000' }] }, reviewOf('1000000'), [], today);
  assert.equal(debtOnly.assets, 0, 'debt principal is not an initial cash withdrawal');
  assert.equal(debtOnly.missing.length, 0);
  assert.match(debtOnly.annotations.find(a => a.reason_code === 'DEBT_UNLINKED').message, /还款未计入/);
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

test('old estimates are never used without general configuration; new budget and contribution gate independently',()=>{
 const old=sources();delete old.profile.value.saved.profile.retire.basic;
 assert.equal(summaryRetire(old,today).step,'profile');
 assert.equal(summaryRetire(sources({retire:{spend_cents:'500000',contribution_cents:null}}),today).step,'saving');
 const missing=summaryRetire(sources(),today);assert.equal(missing.kind,'blocked');assert.equal(missing.capabilities.requirement.status,'blocked');
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
  assert.match(usualSaving({ intervals: [iv({ status: 'scope_changed' })], stats: stats(null), incomplete_count: 0 }).reason, /参与比较的账户/);
  assert.match(usualSaving({ intervals: [iv({ excluded: true })], stats: stats(null), incomplete_count: 0 }).reason, /一次性变动/);
  assert.match(usualSaving({ intervals: [iv({ in_window: false })], stats: stats(null), incomplete_count: 0 }).reason, /近 12 个月没有可比较的两次盘点/);
  // 样本少时保留数字，只加标注。
  const low = usualSaving({ intervals: [], stats: stats('761920', { count: 2, low_sample: true }), incomplete_count: 0 });
  assert.deepEqual([low.kind, low.count, low.low_sample], ['known', 2, true]);
});

test('basis notes separate historical median from the saved single contribution', () => {
  const plain = summaryRetire(sources({ retire: { spend_cents: '500000' } }), today);
  const notes = summaryBasis(plain);
  assert.ok(notes.includes(`依据 ${today} 完整盘点`));
  assert.ok(notes.includes('预测采用已保存的单一预计投入'));
  assert.ok(!notes.includes('估算'));

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

test('the summary mounts behind module gating and planning alone offers manual setup', () => {
  const view = read('../src/ReviewView.tsx');
  assert.match(view, /modules\.planning && \(modules\.wealth/);
  assert.match(view, /: <ReviewPlanSummary/);
  assert.match(view, /可以先手动填写资金和收支/);
  assert.match(view, /onClick=\{\(\) => onGotoPlanning\('goals'\)\}>设置计划/);
  assert.match(view, /planning: modules\.planning && modules\.wealth/);
  assert.match(view, /data=\{data\.planning \?\? null\}/);
  const overview = read('../src/Overview.tsx');
  assert.match(overview, /financeOff\(modules\) && !modules\.planning/);
});

test('the goals page shares the projection instead of rounding ages differently', () => {
  const goals = read('../src/PlanningBasicGoals.tsx');
  assert.match(goals, /useCapabilities\(sources\)/);
  assert.match(goals, /retireCalcFromCapabilities/);
  assert.ok(!goals.includes('const ageOf'), 'no second age formatter that would truncate months');
  assert.doesNotMatch(goals, /储蓄阶段|路线/);
});


test('a disappeared snapshot is a missing baseline, never a numeric estimate', () => {
  assert.equal(summaryRetire(sources({ snapshot: { status: 'ready', value: null } }), today).kind, 'blocked');
});


test('unknown saving reasons describe the current statistical window', () => {
  const old = { status: 'no_income', excluded: false, in_window: false };
  const r = { intervals: [old], stats: stats(null), incomplete_count: 0 };
  assert.equal(usualSaving(r).reason, '近 12 个月没有可比较的两次盘点。');
  r.intervals.push({ status: 'ok', excluded: true, in_window: true });
  assert.equal(usualSaving(r).reason, '可比较的盘点区间都已标记为一次性变动。');
});
