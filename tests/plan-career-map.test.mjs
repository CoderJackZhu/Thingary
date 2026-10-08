import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { windowMap, minWindow, maxGap, closeMonths, judge, pensionOptions, delayTarget, ageMonthsAt, withChoice } from '../src/plan-career-map.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';
import { careerPensionSources } from '../src/career-preview/pension-fixture.ts';

// Fictional fixture: 600k at 2026-09-30, +15k/month, goal 50 (2044-10) with 3750/month for 480 months = 1.8M, zero returns.
const direct = (l = '0') => { const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = l; return d; };

test('M01 minimum window matches the closed form: 600k + 15k*k >= 1.8M gives k = 80 contributions, so the window closes at 2033-06', () => {
  const x = minWindow(careerSources(), direct());
  assert.deepEqual(x, { status: 'found', months: 81, close_month: '2033-06' });
  const m = windowMap(careerSources(), direct(), ['2033-05', '2033-06', '2033-07'], ['0']);
  assert.deepEqual(m.rows[0].map(c => c.verdict), ['short', 'meets', 'meets']);
  assert.equal(m.rows[0][0].shortfall_cents, 1_500_000);
});

test('M02 the map is monotone in the close month when the current contribution beats the post-window one', () => {
  const s = careerSources(), closes = closeMonths(s, 12), m = windowMap(s, direct(), closes, ['-100000', '0', '500000']);
  assert.equal(closes[0], '2026-09');
  for (const row of m.rows) { const v = row.map(c => c.verdict); const first = v.indexOf('meets'); if (first >= 0) assert.ok(v.slice(first).every(x => x === 'meets'), v.join()); }
  // a larger post-window contribution can only help
  const need = row => row.findIndex(c => c.verdict === 'meets');
  assert.ok(need(m.rows[2]) <= need(m.rows[1]) && need(m.rows[1]) <= need(m.rows[0]));
});

test('M03 longest gap: with the required 4642.86/month after a 12 month gap, 12 months holds and 13 does not', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '464286';
  assert.deepEqual(maxGap(careerSources(), d), { status: 'found', months: 12, limit: 'goal' });
  d.gap_months = 13; assert.equal(judge(evaluateCareerScenario(careerSources(), d)).verdict, 'short');
});

test('M04 longest gap reports cash as the limit when funds run out first, and none when the gap is already too long', () => {
  const s = careerSources(); s.profile.value.saved.profile.retire.basic.start.available_cents = '1500000';
  const d = careerDraft(); d.transition_month = '2026-10'; d.recovery.monthly_cents = '100000000'; d.gap.spend_cents = '1000000';
  const x = maxGap(s, d); assert.equal(x.status, 'found'); assert.equal(x.limit, 'cash');
  const t = careerSources(); t.profile.value.saved.profile.retire.spend_cents = '5000000';
  const e = careerDraft(); e.recovery.monthly_cents = '0';
  assert.deepEqual(maxGap(t, e), { status: 'none', reason: 'goal' });
});

test('M05 undefined searches say so instead of guessing', () => {
  const d = direct(); d.recovery.monthly_cents = null; assert.equal(minWindow(careerSources(), d).status, 'blocked');
  assert.equal(minWindow(careerSources(), direct('1500000')).status, 'not_applicable');
  const e = direct(); e.recovery.monthly_cents = null; assert.equal(maxGap(careerSources(), e).status, 'blocked');
  const s = careerSources(); s.profile.value.saved.profile.retire.spend_cents = '5000000';
  assert.equal(minWindow(s, direct()).status, 'not_reachable');
});

test('M06 nothing is mutated', () => {
  const s = careerSources(), d = direct(), frozen = structuredClone({ s, d });
  minWindow(s, d); windowMap(s, d, ['2030-01'], ['0']); maxGap(s, careerDraft());
  assert.deepEqual({ s, d }, frozen);
});

test('M07 severance and a limited benefit enter the gap once: 120k lump -> need (1.8M-1.14M)/168; 5k x 6 -> (1.8M-1.05M)/168', () => {
  const need = d => { const x = evaluateCareerScenario(careerSources(), d); return { x, v: x.requirement.value.monthly_cents }; };
  const d = careerDraft(); assert.equal(need(d).v, '464286');
  d.gap.extra_income = { lump_cents: '12000000', benefit_monthly_cents: null, benefit_months: null };
  const a = need(d); assert.equal(a.v, '392858'); // the lump lands at month end, after the first start-of-month payment, so the low point moves to 1.14M - 10k
  assert.equal(a.x.cash.value.minimum_cents, '113000000');
  d.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: 6 };
  assert.equal(need(d).v, '446429');
  d.gap.extra_income.benefit_months = 13; assert.equal(evaluateCareerScenario(careerSources(), d).requirement.status, 'blocked');
  d.gap.extra_income = { lump_cents: '-1', benefit_monthly_cents: null, benefit_months: null }; assert.equal(evaluateCareerScenario(careerSources(), d).requirement.status, 'blocked');
});

function pensionSources() {
  const s = careerSources(), p = s.profile.value.saved.profile, ret = p.retire;
  Object.assign(p, { worker: 'male', region: 'beijing', paid_months: 200, account_balance_cents: '5000000', base_cents: '1000000', past_index_hundredths: 100, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 0 });
  p.assumptions.wage_growth_hundredths = 0; ret.core.hpf_monthly_cents = '100000';
  ret.basic.retirement_income = { mode: 'beijing', selected: [] };
  ret.basic.pension_contributions = { start_month: '2026-10', stop_month: '2030-10', base_cents: '1000000' };
  return s;
}
test('M08 pension choices for the gap: pausing saves cash but loses eligibility; paying keeps it; rows are independent', () => {
  const s = pensionSources(), d = careerDraft(); d.recovery.monthly_cents = '500000';
  const frozen = structuredClone({ s, d });
  const r = pensionOptions(s, d, 'gap', [
    { label: '停缴', pension: 'pause', cash_cents: '0' },
    { label: '下限自缴', pension: { base_cents: '727000', hpf_monthly_cents: '0' }, cash_cents: '200000' },
    { label: '原基数', pension: 'unchanged', cash_cents: '200000' },
  ]);
  assert.equal(r.stage_months, 12);
  const [pause, floor, same] = r.rows;
  assert.equal(pause.stage_cash_cents, 0); assert.equal(floor.stage_cash_cents, 2_400_000);
  assert.equal(pause.pension.eligible, false); assert.equal(pause.pension.monthly_cents, 0); assert.ok(pause.pension.short_months > 0);
  assert.equal(floor.pension.eligible, true); assert.equal(same.pension.eligible, true);
  assert.ok(floor.pension.monthly_cents <= same.pension.monthly_cents + 1);
  assert.deepEqual({ s, d }, frozen);
});

test('M09 without the Beijing pension selected, choices still compare cash but report no pension', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '500000';
  const r = pensionOptions(careerSources(), d, 'gap', [{ label: '停缴', pension: 'pause', cash_cents: '0' }, { label: '自缴', pension: { base_cents: '727000', hpf_monthly_cents: '0' }, cash_cents: '200000' }]);
  assert.ok(r.rows.every(x => x.pension === null));
  assert.ok(r.rows[0].assets_at_goal_cents > r.rows[1].assets_at_goal_cents, 'cash paid for insurance lowers assets when no pension is counted');
});

test('M10 a gap whose payment check cannot run is blocked, never a pass or a length limit', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '464286';
  assert.equal(judge(evaluateCareerScenario(careerSources(), d)).verdict, 'meets');
  d.liquid_funds_confirmed = false;
  const j = judge(evaluateCareerScenario(careerSources(), d)); assert.equal(j.verdict, 'blocked'); assert.ok(j.issues.length);
  assert.equal(maxGap(careerSources(), d).status, 'blocked');
  const m = windowMap(careerSources(), { ...d, gap_months: 6 }, ['2029-10'], ['464286']); assert.equal(m.rows[0][0].verdict, 'blocked');
});

test('M11 a lump sum counts with or without a gap; a benefit amount without months or without a gap is rejected, not dropped', () => {
  const need = d => evaluateCareerScenario(careerSources(), d).requirement;
  const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = '0';
  assert.equal(need(d).value.monthly_cents, '366667');
  d.gap.extra_income = { lump_cents: '12000000', benefit_monthly_cents: null, benefit_months: null };
  assert.equal(need(d).value.monthly_cents, '300000', '120k over the 180 months after the change');
  d.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: null };
  assert.equal(need(d).status, 'blocked');
  d.gap.extra_income.benefit_months = 3; assert.equal(need(d).status, 'blocked', 'no gap to receive it in');
  const e = careerDraft(); e.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: null };
  assert.equal(need(e).status, 'blocked', 'amount without months');
  e.gap.extra_income.benefit_months = 6; assert.equal(need(e).status, 'ready');
});

test('M12 contribution choices need an entered monthly cash amount; empty is not zero, explicit 0 is', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '500000';
  const r = pensionOptions(careerSources(), d, 'gap', [{ label: '自缴', pension: { base_cents: '727000', hpf_monthly_cents: '0' }, cash_cents: null }, { label: '停缴', pension: 'pause', cash_cents: '0' }]);
  assert.equal(r.rows[0].judgement.verdict, 'blocked'); assert.equal(r.rows[0].stage_cash_cents, null); assert.equal(r.rows[0].assets_at_goal_cents, null);
  assert.notEqual(r.rows[1].judgement.verdict, 'blocked'); assert.equal(r.rows[1].stage_cash_cents, 0);
});

test('M13 when even closing one month early fails, the answer is "until the target", not "not reachable"', () => {
  const s = careerSources(); s.profile.value.saved.profile.retire.spend_cents = '600000';
  const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = '-100000000';
  assert.equal(minWindow(s, d).status, 'until_target');
});

test('M14 retirement concession: with 3000/month after a 12 month gap the goal needs age 54 (81000A >= 4326000), and the original is untouched', () => {
  const s = careerSources(), d = careerDraft(); d.recovery.monthly_cents = '300000';
  const frozen = structuredClone({ s, d });
  assert.deepEqual(delayTarget(s, d), { status: 'found', age: 54, delay_years: 4 });
  assert.deepEqual({ s, d }, frozen);
  d.recovery.monthly_cents = '464286'; assert.deepEqual(delayTarget(s, d), { status: 'already_met' });
  d.recovery.monthly_cents = '0'; assert.equal(delayTarget(s, d, 55).status, 'not_found');
  d.recovery.monthly_cents = null; assert.equal(delayTarget(s, d).status, 'blocked');
});

test('M15 age at a month', () => {
  assert.equal(ageMonthsAt(careerSources(), '2033-06'), (2033 - 1994) * 12 + (6 - 10));
});

test('M16 one-off inflows anywhere on the timeline count once: 120k in 2028-06 lowers the need to (1.8M-1.14M)/168 and closes the window 8 months earlier', () => {
  const d = careerDraft(); d.lumps = [{ month: '2028-06', cents: '12000000' }];
  assert.equal(evaluateCareerScenario(careerSources(), d).requirement.value.monthly_cents, '392858');
  const e = careerDraft(); e.gap_months = 0; e.recovery.monthly_cents = '0'; e.lumps = [{ month: '2028-06', cents: '12000000' }];
  assert.deepEqual(minWindow(careerSources(), e), { status: 'found', months: 73, close_month: '2032-10' });
  for (const bad of [{ month: '2026-08', cents: '100' }, { month: '2044-10', cents: '100' }, { month: '2030-13', cents: '100' }, { month: '2030-01', cents: '-5' }]) {
    const f = careerDraft(); f.lumps = [bad]; assert.equal(evaluateCareerScenario(careerSources(), f).requirement.status, 'blocked', JSON.stringify(bad));
  }
  const g = careerDraft(); g.lumps = Array.from({ length: 25 }, () => ({ month: '2028-06', cents: '1' })); assert.equal(evaluateCareerScenario(careerSources(), g).requirement.status, 'blocked');
});

test('M17 the chosen contribution arrangement feeds the answers: free default 84 months, self-paying 2000/month 73; the helper changes nothing in place', () => {
  const s = careerPensionSources(), d = careerDraft(); d.recovery.monthly_cents = '300000';
  const frozen = structuredClone(d);
  assert.deepEqual(maxGap(s, d), { status: 'found', months: 84, limit: 'goal' });
  const picked = withChoice(d, 'gap', { label: '自己交', pension: { base_cents: '727000', hpf_monthly_cents: '0' }, cash_cents: '200000' });
  assert.deepEqual(d, frozen);
  assert.equal(picked.gap.insurance.monthly_cents, '200000'); assert.equal(picked.gap.insurance.included, false);
  assert.deepEqual(maxGap(s, picked), { status: 'found', months: 73, limit: 'goal' });
});

test('M18 a blocked choice (custom base not entered) is shown with its reason and never evaluated', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '500000';
  const r = pensionOptions(careerSources(), d, 'gap', [{ label: '自选', pension: { base_cents: '0', hpf_monthly_cents: '0' }, cash_cents: '100', blocked: '先填基数' }]);
  assert.equal(r.rows[0].judgement.verdict, 'blocked'); assert.deepEqual(r.rows[0].judgement.issues, ['先填基数']); assert.equal(r.rows[0].assets_at_goal_cents, null);
});
