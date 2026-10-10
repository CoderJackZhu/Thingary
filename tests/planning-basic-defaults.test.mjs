import test from 'node:test';
import assert from 'node:assert/strict';
import { historyHints, savingFromFlow, pcPlanOf, pcValues, withDefaults } from '../src/planning-basic-defaults.ts';
import { basicInput, draftOf, contributionSection } from '../src/planning-basic-forms.ts';
import { defaultRetire } from '../src/plan.ts';

const today = '2026-10-07';
const stats = (o = {}) => ({ review: { stats: { count: 4, low_sample: false, median_monthly_saving_cents: '300000', mean_monthly_saving_cents: '310000', median_monthly_spend_cents: '650000', window_from: '2025-10-01', latest_date: '2026-09-30', ...o }, intervals: [], incomplete_count: 0, generation: 'g' } });

test('history hints: median of at least 3 usual intervals; fewer or none gives nothing, never zero', () => {
  const ok = historyHints(stats().review);
  assert.equal(ok.saving, '300000'); assert.equal(ok.spend, '650000'); assert.equal(ok.count, 4);
  const two = historyHints(stats({ count: 2 }).review);
  assert.equal(two.saving, null); assert.equal(two.spend, null); assert.match(two.reason, /只有 2 个/);
  assert.equal(historyHints(stats({ count: 0, median_monthly_saving_cents: null }).review).saving, null);
  assert.equal(historyHints(null).saving, null);
  // Negative savings are real information, not "unknown".
  assert.equal(historyHints(stats({ median_monthly_saving_cents: '-50000' }).review).saving, '-50000');
  // A non-positive spend is not offered as a retirement budget.
  assert.equal(historyHints(stats({ median_monthly_spend_cents: '-10' }).review).spend, null);
});

test('income minus spend: blank is unknown, difference may be negative', () => {
  assert.equal(savingFromFlow('1000000', '600000'), '400000');
  assert.equal(savingFromFlow('500000', '800000'), '-300000');
  assert.equal(savingFromFlow('', '600000'), null);
});

test('pension contributions as one question: until retirement / stop; saved months are kept', () => {
  const d = draftOf(null, null, today);
  d.birth = '1990-06-01'; d.target = '55'; d.pension.base = '1000000';
  d.pcPlan = 'until';
  assert.deepEqual(pcValues(d, today), { start: '2026-10', stop: '2045-06', base: '1000000' });
  d.pcBase = '800000'; assert.equal(pcValues(d, today).base, '800000');
  d.pcPlan = 'stop'; d.pcBase = '';
  assert.deepEqual(pcValues(d, today), { start: '2026-10', stop: '2026-10', base: '1000000' });
  // Unknown target/birth stays unknown; the target already passed cannot start after it.
  d.pcPlan = 'until'; d.target = '';
  assert.deepEqual(pcValues(d, today), { start: null, stop: null, base: '1000000' });
  d.target = '30'; assert.equal(pcValues(d, today).start, pcValues(d, today).stop);
  // Re-saving keeps an earlier start month instead of sliding it to today.
  d.target = '55'; d.pcStart = '2025-03'; assert.equal(pcValues(d, today).start, '2025-03');
  // Recognising what is saved.
  assert.equal(pcPlanOf('', '', '1990-06', '55'), '');
  assert.equal(pcPlanOf('2026-10', '2026-10', '1990-06', '55'), 'stop');
  assert.equal(pcPlanOf('2025-03', '2045-06', '1990-06', '55'), 'until');
  assert.equal(pcPlanOf('2025-03', '2040-01', '1990-06', '55'), 'custom');
  // Custom/blank plans pass the raw months through unchanged.
  const raw = draftOf(null, null, today); raw.pcStart = '2026-10'; raw.pcStop = '2030-01'; raw.pcBase = '5';
  assert.deepEqual(pcValues({ ...raw, pcPlan: 'custom' }, today), { start: '2026-10', stop: '2030-01', base: '5' });
});

test('defaults preselect from existing facts only for a plan never set up; nothing else changes', () => {
  const blank = draftOf(null, null, today);
  const none = withDefaults(blank, null);
  assert.equal(none.incomeMode, 'excluded'); assert.equal(none.pcPlan, '');
  assert.equal(none.contribution, ''); assert.equal(none.budget, ''); assert.equal(none.target, '');
  const input = basicInput(none, null, today);
  assert.equal(input.fields.basic.contribution.monthly_cents, null);
  assert.equal(input.fields.basic.retirement_income.mode, 'excluded');
  const complete = { revision: 1, updated_at: 'x', profile: { birth_month: '1990-06', worker: 'male', region: 'beijing', paid_months: 120, account_balance_cents: '1', base_cents: '1000000', past_index_hundredths: 100, flex_months: 0, personal_pension_annual_cents: '0', marginal_tax_hundredths: 300, assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 }, overrides: {}, retire: { ...defaultRetire } } };
  const withPension = withDefaults(draftOf(complete, null, today), complete);
  assert.equal(withPension.incomeMode, 'employee'); assert.equal(withPension.pcPlan, 'until');
  // An existing basic plan is never re-defaulted.
  const saved = { ...complete, profile: { ...complete.profile, retire: { ...defaultRetire, basic: basicInput(none, null, today).fields.basic } } };
  assert.equal(withDefaults(draftOf(saved, null, today), saved).incomeMode, 'excluded');
});

test('adopting a suggestion saves one explicit contribution and leaves other saved parts alone', () => {
  const saved = { revision: 2, updated_at: 'x', profile: { birth_month: '1990-06', worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 }, overrides: {}, retire: { ...defaultRetire } } };
  const input = contributionSection(saved, '300000', today);
  assert.equal(input.section, 'basic'); assert.equal(input.fields.basic.contribution.monthly_cents, '300000');
  assert.equal(input.fields.basic.pension_contributions.start_month, null);
  assert.equal(contributionSection(saved, null, today).fields.basic.contribution.monthly_cents, null);
});

test('with the defaults, a Beijing plan needs only age, budget, funds, social-insurance facts and one public-fund number', async () => {
  const { buildBasicCapabilities } = await import('../src/plan-basic.ts');
  const { overlayPlanningDrafts } = await import('../src/planning-draft.ts');
  const { basicInput, fundsInput, pensionInput } = await import('../src/planning-basic-forms.ts');
  const { defaultAssumptions, noOverrides } = await import('../src/plan-params.ts');
  const profile = { birth_month: null, worker: null, region: null, paid_months: null, account_balance_cents: null, base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null, assumptions: defaultAssumptions, overrides: noOverrides, retire: structuredClone(defaultRetire) };
  const unavailable = { status: 'error', value: { code: 'X', message: 'x' } };
  const ready = value => ({ status: 'ready', value });
  const sources = { generation: 'g', write_version: 1, today, modules: { planning: true, wealth: false }, profile: ready({ generation: 'g', saved: { revision: 1, updated_at: today, profile } }), snapshot: unavailable, accounts: unavailable, review: unavailable, incomes: unavailable };
  const saved = sources.profile.value.saved;
  const d = withDefaults(draftOf(saved, null, today), saved);
  Object.assign(d, { birth: '1990-06-01', target: '55', budget: '600000', start: 'simulation', simAmount: '50000000', simDate: '2026-09-30', hpf: '200000', incomeMode: 'employee', pcPlan: 'until' });
  Object.assign(d.pension, { region: 'beijing', birth: '1990-06-01', worker: 'male', paid: '120', balance: '10000000', base: '1000000', flex: '0', pp: '0', tax: '1000' });
  const drafts = [basicInput(d, saved, today), fundsInput(d, saved, today), pensionInput({ ...d.pension, birth: d.birth })];
  const caps = buildBasicCapabilities(overlayPlanningDrafts(sources, drafts));
  assert.deepEqual(caps.requirement.status === 'blocked' ? caps.requirement.missing.map(m => m.code) : [], []);
  assert.equal(caps.requirement.status, 'ready');
  assert.equal(caps.prediction.status, 'blocked'); // contribution still unknown until a number is chosen
  // The history number only makes a temporary, labelled prediction; the saved value is unchanged.
  const shown = buildBasicCapabilities(overlayPlanningDrafts(sources, drafts), '300000');
  assert.equal(shown.prediction.value.source, 'temporary');
  assert.equal(drafts[0].fields.basic.contribution.monthly_cents, null);
});

test('history prefers cash-only figures and reports the investment change beside them, never inside', async () => {
  const withCash = stats({ median_monthly_cash_saving_cents: '120000', median_monthly_cash_spend_cents: '700000', median_monthly_market_change_cents: '250000' }).review;
  const h = historyHints(withCash);
  assert.equal(h.saving, '120000'); assert.equal(h.spend, '700000'); assert.equal(h.market, '250000');
  // No investment accounts (or no change): nothing to report.
  assert.equal(historyHints(stats({ median_monthly_market_change_cents: '0' }).review).market, null);
  // Older review data without the cash fields falls back to the mixed ones.
  assert.equal(historyHints(stats().review).saving, '300000');

  const { computeReview } = await import('../src/plan.ts');
  const point = (id, date, from, change, market) => ({ snapshot_id: id, date, notes: '', assets_cents: '0', liabilities_cents: '0', net_cents: '0', complete: true, missing: 0, compared_to: from, scope_changed: false, change_cents: change, hpf_change_cents: null, market_change_cents: market, change_rate_hundredths: null });
  const incomes = [{ id: 'i1', revision: 1, fields: { date: '2026-02-15', net_cents: '2000000', hpf_cents: '0', notes: '' } }, { id: 'i2', revision: 1, fields: { date: '2026-03-15', net_cents: '2000000', hpf_cents: '0', notes: '' } }];
  const r = computeReview([point('a', '2026-01-31', null, null, null), point('b', '2026-03-31', '2026-01-31', '3000000', '2000000')], incomes, new Set(), 'g');
  const i = r.intervals[0];
  // Same arithmetic as the Rust side: 59 days, 30.4375-day months.
  assert.equal(i.monthly_saving_cents, '1547669'); assert.equal(i.monthly_cash_saving_cents, '515890');
  assert.equal(i.monthly_spend_cents, '515890'); assert.equal(i.monthly_cash_spend_cents, '1547669');
  assert.equal(r.stats.median_monthly_market_change_cents, '1031780');
});

test('goal wording says whether the money is enough at the target age, not only at the end of the plan', async () => {
  const { goalFitText } = await import('../src/planning-basic-view.ts');
  const fmt = c => `¥${c}`;
  assert.equal(goalFitText({ funded_at_goal: true, shortfall_at_goal: 0 }, fmt), '到目标年龄时资金已够用');
  assert.match(goalFitText({ funded_at_goal: false, shortfall_at_goal: 123456.4 }, fmt), /还差 ¥123456，要更晚退休才够/);
});

test('historical spend requires its own three valid samples, saving keeps its original sample semantics',()=>{
 const two=historyHints(stats({spend_count:2}).review);assert.equal(two.saving,'300000');assert.equal(two.spend,null);assert.equal(two.count,4);assert.equal(two.spend_count,2);
 const three=historyHints(stats({spend_count:3}).review);assert.equal(three.spend,'650000');assert.equal(three.spend_count,3);
});
