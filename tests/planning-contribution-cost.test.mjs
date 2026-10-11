import test from 'node:test';
import assert from 'node:assert/strict';
import { fictionalSources } from './helpers/planning-fixtures.mjs';
import { contributionCostDraft, contributionCostInput } from '../src/planning-contribution-cost.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { basicInput, draftOf, retirementSources } from '../src/planning-basic-forms.ts';
import { required, table, savingsOf } from '../src/plan-ledger.ts';
const source = () => {
  const s = fictionalSources('500000'), p = s.profile.value.saved.profile, r = p.retire;
  r.target_age = 45;
  r.basic.pension_contributions = { start_month: '2027-01', stop_month: '2053-06', base_cents: '1500000' };
  return s;
};
const saved = s => s.profile.value.saved;
const change = (s, treatment, monthly = '300000', stop = '2053-06') => overlayPlanningDrafts(s, [contributionCostInput({ treatment, monthly, stop }, saved(s))]);
const caps = s => buildBasicCapabilities(s);
const plan = s => { const c = caps(s); assert.equal(c.prediction.status, 'ready', JSON.stringify(c)); return c.prediction.value.plan; };
const note = s => caps(s).annotations.find(x => x.reason_code === 'PENSION_COST_UNCONFIRMED');

test('personal extra cost changes retirement need by 3000 x 18 years, without reducing pre-retirement saving', () => {
  const s = source(), p = plan(s), next = plan(change(s, 'extra'));
  assert.equal(Math.round(required(next, 540) - required(p, 540)), 64800000);
  assert.deepEqual(savingsOf(next), savingsOf(p));
  assert.equal(table(next).spend[756 - next.now_months], 400000);
  assert.equal(note(change(s, 'extra')), undefined);
});

test('included cost equals extra cost when total budget includes its exact amount; no duplicate legacy charge', () => {
  const s = source(), extra = plan(change(s, 'extra'));
  saved(s).profile.retire.spend_cents = '700000';
  saved(s).profile.retire.keep_paying_monthly_cents = '900000';
  saved(s).profile.retire.keep_paying_until_age = 70;
  saved(s).profile.retire.basic.retirement_costs = [{ source_id: 'social_insurance', treatment: 'extra', reference_cents: null }];
  const c = change(s, 'included'), included = plan(c);
  assert.deepEqual(table(included), table(extra));
  assert.equal(required(included, 540), required(extra, 540));
  assert.equal(saved(c).profile.retire.keep_paying_monthly_cents, '900000', 'old fact retained but superseded');
  assert.ok(!retirementSources(saved(c).profile.retire).some(x => x.id === 'social_insurance'));
});

test('exact months, interval cap, insufficient coverage and first-month proration use the shared ledger', () => {
  const s = source(), r = saved(s).profile.retire;
  r.basic.pension_contributions.start_month = '2036-09';
  const p = plan(change(s, 'extra', '300000', '2053-07')), t = table(p);
  const start = (2036 - 1990) * 12 + 8 - 5 - p.now_months, stop = 756 - p.now_months;
  assert.equal(t.spend[start - 1], 400000); assert.equal(t.spend[start], 700000);
  assert.equal(t.spend[stop - 1], 700000); assert.equal(t.spend[stop], 400000);
  assert.equal(note(change(s, 'extra', '300000', '2053-05')).actionable, true);
  const partial = { ...p, now_months: 600, first_month_fraction: 0.5 };
  assert.equal(table(partial).spend[0], 350000);
});

test('unknown preserves nulls and warnings; external payer and explicit zero are confirmed only for the named period', () => {
  const s = source();
  assert.deepEqual(contributionCostDraft(saved(s)), { treatment: 'unknown', monthly: '', stop: '' });
  const unknown = change(s, 'extra', '', '2053-06');
  assert.equal(saved(unknown).profile.retire.basic.retirement_contribution_cost.monthly_cents, null);
  assert.ok(note(unknown)); assert.deepEqual(table(plan(unknown)), table(plan(s)));
  assert.ok(note(change(s, 'unknown')));
  assert.equal(note(change(s, 'external')), undefined);
  assert.ok(note(change(s, 'external', '', '2053-05')));
  assert.equal(note(change(s, 'extra', '0')), undefined);
  const excluded = change(s, 'excluded');
  assert.equal(note(excluded).actionable, false); assert.deepEqual(table(plan(excluded)), table(plan(s)));
  saved(unknown).profile.retire.basic.pension_contributions.start_month = null;
  assert.ok(note(unknown));
});

test('cost edit preserves unrelated inputs, survives other basic edits, and reopening returns exact values', () => {
  const s = source(), before = structuredClone(saved(s)), next = change(s, 'included', '100000', '2053-06');
  assert.deepEqual(saved(s), before);
  const b = saved(next).profile.retire.basic;
  assert.deepEqual(b.pension_contributions, before.profile.retire.basic.pension_contributions);
  assert.deepEqual(b.retirement_income, before.profile.retire.basic.retirement_income);
  assert.deepEqual(contributionCostDraft(saved(next)), { treatment: 'included', monthly: '100000', stop: '2053-06' });
  const d = draftOf(saved(next), null); d.target = '46';
  assert.deepEqual(basicInput(d, saved(next), s.today).fields.basic.retirement_contribution_cost, b.retirement_contribution_cost);
});

test('bad cents, dates and over-budget references are rejected, not converted into plausible results', () => {
  const s = source();
  for (const monthly of ['-1', '1.5', '01', '100000001']) assert.throws(() => change(s, 'extra', monthly), /整数分/);
  assert.throws(() => change(s, 'extra', '1', '2053-13'), /月份/);
  assert.throws(() => change(s, 'extra', '1', '2020-01'), /早于/);
  const invalid = caps(change(s, 'included', '500000'));
  assert.equal(invalid.requirement.status, 'blocked');
  assert.ok(invalid.requirement.missing.some(x => x.code === 'COST_SCOPE_INVALID'));
});


test('excluding a legacy expired cost ignores its hidden end date; changing contribution dates reopens coverage', () => {
  const s = source(), r = saved(s).profile.retire;
  r.keep_paying_monthly_cents = '300000'; r.keep_paying_until_age = 40;
  r.basic.pension_contributions.start_month = '2035-01';
  const d = contributionCostDraft(saved(s));
  assert.equal(d.stop, '2030-06'); d.treatment = 'excluded';
  const input = contributionCostInput(d, saved(s));
  assert.equal(input.fields.basic.retirement_contribution_cost.stop_month, null);
  assert.equal(caps(overlayPlanningDrafts(s, [input])).requirement.status, 'ready');
  const changed = change(source(), 'included');
  saved(changed).profile.retire.basic.pension_contributions.start_month = '2054-01';
  saved(changed).profile.retire.basic.pension_contributions.stop_month = '2055-01';
  assert.equal(caps(changed).requirement.status, 'ready'); assert.ok(note(changed));
  assert.equal(table(plan(changed)).spend[1], 400000, 'outdated reference does not shrink the budget');
});
