import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionChips, defaultIncomeMode, goalState, moreToolsBadges, questionProgress, retirementMonth, setupDraft, setupFields, refinementCards } from '../src/planning-first-run.ts';
import { unknownCapabilityFixture, unknownBasicUpdate } from '../src/plan-basic-fixtures.ts';
import { defaultRetire } from '../src/plan.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';

const today = '2026-10-09';
const make = () => ({ revision: 3, updated_at: today, profile: {
  birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 120, account_balance_cents: '1234567', base_cents: '900000', past_index_hundredths: 120, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 1000,
  assumptions: { ...defaultAssumptions }, overrides: { ...noOverrides },
  retire: { ...structuredClone(defaultRetire), ...structuredClone(unknownBasicUpdate.fields), core: { monetary_basis_date: today, fund_rules: [], occurrences: [], hpf_monthly_cents: null, personal_pension_account_id: null, personal_pension_balance_confirmed: false } },
} });

test('state 0/1/2/2b and Q1–Q4 progress count only unanswered questions', () => {
  const caps = unknownCapabilityFixture, p = make();
  assert.equal(goalState(null, caps), '0');
  assert.equal(goalState(p, caps), '2');
  p.profile.retire.spend_cents = null;
  p.profile.retire.basic.retirement_income.mode = null;
  assert.deepEqual(questionProgress(p, caps), { answered: [true, false, true, false], remaining: 2, first: 1 });
  assert.equal(goalState(p, caps), '1');
  p.profile.retire.spend_cents = '0'; p.profile.retire.basic.retirement_income.mode = 'excluded';
  const blocked = { ...caps, requirement: { status: 'blocked', missing: [{ code: 'COST_SCOPE_UNKNOWN' }] } };
  assert.equal(questionProgress(p, blocked).remaining, 0);
  assert.equal(goalState(p, blocked), '2b');
  assert.equal(questionProgress(p, { ...blocked, funds: { status: 'blocked', missing: [] } }).first, 2);
  assert.equal(questionProgress(null, null).remaining, 4);
});

test('Q4 default excludes only absent choices; saved manual/excluded/Beijing choices and facts survive', () => {
  const p = make();
  assert.equal(defaultIncomeMode(null), 'excluded');
  p.profile.retire.basic.retirement_income.mode = null;
  assert.equal(defaultIncomeMode(p), 'excluded');
  for (const mode of ['manual', 'excluded', 'beijing']) {
    p.profile.retire.basic.retirement_income.mode = mode;
    const before = structuredClone(p);
    p.profile.retire.basic.pension_contributions = { start_month: '2020-01', stop_month: '2050-06', base_cents: '800000' };
    const d = setupDraft(p, null, today, false); d.target = '61';
    assert.equal(d.incomeMode, mode);
    const fields = setupFields(d, p, today, false);
    assert.equal(fields.pension, null);
    assert.deepEqual(fields.basic.basic.pension_contributions, p.profile.retire.basic.pension_contributions);
    assert.equal(p.profile.account_balance_cents, before.profile.account_balance_cents);
    assert.deepEqual(d.pension.balance, before.profile.account_balance_cents);
  }
  delete p.profile.retire.basic;
  assert.equal(defaultIncomeMode(p), 'excluded');
});

test('condition chips distinguish unknown/zero and conspicuously disclose excluded retirement income', () => {
  const p = make(), fmt = c => `¥${c}`;
  const chips = conditionChips(p, unknownCapabilityFixture, fmt);
  assert.equal(chips.at(-1).text, '暂不计退休收入');
  assert.equal(chips.at(-1).prominent, true);
  p.profile.retire.spend_cents = '0';
  assert.equal(conditionChips(p, unknownCapabilityFixture, fmt)[1].text, '每月生活费 ¥0');
  p.profile.retire.spend_cents = null;
  assert.equal(conditionChips(p, unknownCapabilityFixture, fmt)[1].text, '每月生活费未填');
  p.profile.retire.basic.retirement_income.mode = 'beijing';
  assert.equal(conditionChips(p, unknownCapabilityFixture, fmt).at(-1).text, '已选北京养老金估算');
});

test('retirement month is immediate, blank/invalid remains unknown', () => {
  assert.equal(retirementMonth('1990-06-01', '60'), '2050 年 6 月');
  assert.equal(retirementMonth('', '60'), null);
  assert.equal(retirementMonth('1990-13', '60'), null);
});

test('refinements are applicable and do not inflate question count with optional contribution', () => {
  const p = make();
  assert.deepEqual(refinementCards(p, unknownCapabilityFixture, today).map(c => c.action), ['pension', 'contribution']);
  const caps = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'COST_SCOPE_UNKNOWN' }, { code: 'PENSION_FACTS_UNKNOWN' }] } };
  p.profile.retire.basic.retirement_income.mode = 'beijing';
  assert.equal(refinementCards(p, caps, today).filter(c => c.required).length, 2);
  assert.equal(questionProgress(p, caps).remaining, 0);
});

test('each unanswered Q1–Q4 resumes at its first question; optional and pension gates never inflate N', () => {
  for (const [expected, change] of [
    [0, p => { p.profile.birth_month = null; }],
    [0, p => { p.profile.retire.target_age = null; }],
    [1, p => { p.profile.retire.spend_cents = null; }],
    [3, p => { p.profile.retire.basic.retirement_income.mode = null; }],
  ]) {
    const p = make(); change(p);
    assert.equal(questionProgress(p, unknownCapabilityFixture).remaining, 1);
    assert.equal(questionProgress(p, unknownCapabilityFixture).first, expected);
    assert.equal(goalState(p, unknownCapabilityFixture), '1');
  }
  const p = make(); delete p.profile.retire.basic;
  assert.equal(goalState(p, unknownCapabilityFixture), '0');
  const blocked = { ...unknownCapabilityFixture, funds: { status: 'blocked', missing: [] } };
  assert.deepEqual(questionProgress(make(), blocked), { answered: [true, true, false, true], remaining: 1, first: 2 });
  for (const code of ['OCCURRENCE_UNCONFIRMED', 'COST_SCOPE_UNKNOWN', 'PENSION_FACTS_UNKNOWN']) {
    const c = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code }] } };
    assert.equal(goalState(make(), c), '2b'); assert.equal(questionProgress(make(), c).remaining, 0);
  }
});

test('editing a Beijing plan emits no pension facts/overrides and preserves hidden inputs exactly', () => {
  const p = make(), r = p.profile.retire;
  p.profile.overrides = { ...noOverrides, avg_wage_cents: '987654', notional_rate_hundredths: 137 };
  r.basic.retirement_income = { mode: 'beijing', selected: [{ id: 'annuity', source_id: 'annuity', role: 'other' }] };
  r.income_items = [{ id: 'annuity', label: '虚构年金', monthly_cents: '120000', start_age: 60, end_age: null, indexed: true }];
  r.basic.pension_contributions = { start_month: '2023-01', stop_month: '2053-06', base_cents: '765432' };
  r.rent_cents = '100000';
  r.basic.retirement_costs = [{ source_id: 'rent', treatment: 'extra', reference_cents: null }];
  const before = structuredClone(p), d = setupDraft(p, null, today, false);
  d.budget = '450000'; d.target = '62';
  const fields = setupFields(d, p, today, false);
  assert.equal(fields.pension, null); assert.equal(fields.budget, null); assert.equal(fields.funds, null);
  assert.deepEqual(fields.basic.basic.retirement_income, r.basic.retirement_income);
  assert.deepEqual(fields.basic.basic.pension_contributions, r.basic.pension_contributions);
  assert.deepEqual(fields.basic.basic.retirement_costs, r.basic.retirement_costs);
  assert.deepEqual(p, before);
});

test('all saved income choices survive initialization; facts alone never select Beijing', () => {
  const p = make(); delete p.profile.retire.basic;
  assert.equal(setupDraft(p, null, today, false).incomeMode, 'excluded');
  for (const mode of ['manual', 'beijing', 'excluded']) {
    const p = make(); p.profile.retire.basic.retirement_income.mode = mode;
    assert.equal(setupDraft(p, null, today, false).incomeMode, mode);
  }
});

test('fee names/count come from pending projects, confirmed/cancelled projects are excluded and names stop at two', () => {
  const p = make(), r = p.profile.retire;
  r.spend_items = ['房租', '保险', '医疗'].map((label, i) => ({ id: String(i), label, monthly_cents: '10000', start_age: null, end_age: null, inflation_hundredths: null, essential: true }));
  const caps = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'COST_SCOPE_UNKNOWN' }] } };
  const text = () => refinementCards(p, caps, today).find(c => c.action === 'costs').benefit;
  assert.match(text(), /^房租、保险等 3 项：/); assert.doesNotMatch(text(), /医疗|这笔钱/);
  r.basic.retirement_costs = [{ source_id: 'spend:0', treatment: 'extra', reference_cents: null }];
  assert.match(text(), /^保险、医疗 2 项：/);
  r.basic.retirement_costs.push({ source_id: 'spend:1', treatment: 'included', reference_cents: '10000' });
  assert.match(text(), /^医疗 1 项：/);
  r.basic.retirement_costs.push({ source_id: 'spend:2', treatment: 'included', reference_cents: '999999' });
  assert.match(text(), /^保险、医疗 2 项：/); // over-budget included rows need review
  r.life_events = [{ id: 'cancelled', label: '取消计划', date: '2026-01', included: true, kind: 'car', price_cents: '100000', down_cents: '100000', holding_cents: '10000', rate_hundredths: 0, term_months: 0 }];
  r.core.occurrences = [{ event_id: 'cancelled', status: 'cancelled' }];
  assert.doesNotMatch(text(), /取消计划/);
});

test('more tools badges count saved plans only; zero content and temporary career trials never create a badge', () => {
  assert.deepEqual(moreToolsBadges(null), []);
  const p = make(); assert.deepEqual(moreToolsBadges(p), []);
  p.profile.retire.life_events = [{ id: 'a', included: true }, { id: 'b', included: false }];
  assert.deepEqual(moreToolsBadges(p), ['大额计划 2 项']);
  p.profile.retire.life_events = [];
  // There is currently no saved career-trial field or save action; opening a trial is not a saved item.
  p.profile.retire.temporaryCareerTrial = { gap: 6 };
  assert.deepEqual(moreToolsBadges(p), []);
});


test('non-event repayment/reference gates still get a concrete existing refinement entry', () => {
  const p = make();
  for (const field of ['core.occurrences', 'reference_issues']) {
    const caps = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'OCCURRENCE_UNCONFIRMED', field, message: '1 个负债账户尚未建立还款接续' }] } };
    assert.equal(goalState(p, caps), '2b');
    assert.deepEqual(refinementCards(p, caps, today).filter(c => c.required).map(c => c.action), ['events']);
  }
});


test('fund refinement retains the existing complete funds editor outside the four questions', () => {
  const caps = { ...unknownCapabilityFixture, requirement: { status: 'blocked', missing: [{ code: 'POOL_UNCONFIRMED', field: 'core.personal_pension_balance_confirmed' }] } };
  assert.equal(refinementCards(make(), caps, today).find(c => c.required).action, 'funds');
});
