// Reproducible fictional audit, NOT a passing benchmark or official forecast.
// Keep discrepancies visible until the model has the missing policy inputs.
import { project } from '../src/plan-pension.ts';
import { beijing } from '../src/plan-params.ts';
import { calculateBeijingBenefit } from '../src/plan-pension-policy.ts';
import { prepareBeijingIndex } from '../src/plan-pension-index.ts';
import { beijingBenefitForLedger } from '../src/plan-pension-policy-ledger.ts';
import { project as projectLedger, required } from '../src/plan-ledger.ts';
import { prepareBeijingPensionPath } from '../src/plan-pension-candidate.ts';

const input = {
  today: '2048-01-01', birth_month: '1990-01', paid_months: 240,
  future_pause_months: 24, future_paid_months: 36,
  // Frozen fictional future values, using 2025's 12049 only to make arithmetic
  // reproducible. Neither is represented as the known 2053 policy value.
  benefit_base_cents: 1204900, contribution_base_cents: 1204900,
  historical_index: 1, historical_required_months: 240,
};
const p = {
  birth_month: input.birth_month, worker: 'male', paid_months: input.paid_months,
  account_balance_cents: '0', base_cents: String(input.contribution_base_cents),
  past_index_hundredths: 100, flex_months: 0,
  personal_pension_annual_cents: '0', marginal_tax_hundredths: 0,
  assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 },
};
const actual = project(p, { ...beijing, avg_wage_cents: String(input.benefit_base_cents), notional_rate_hundredths: 0, hpf_rate_hundredths: 0 },
  input.today, 756, { hpf_balance_cents: '0', hpf_monthly_cents: '0' },
  [{ from_age_months: 696, base_cents: input.contribution_base_cents, hpf_monthly_cents: 0 }], age => age < 720 ? 1 : 0);
const cases = [
  { label: 'monthly-weighted index assumption 0.92', excluded_months: 0, expected_cents: 266042 },
  { label: 'monthly-weighted index assumption 1.00', excluded_months: 24, expected_cents: 277127 },
].map(c => {
  // This monthly weighting is an ASSUMPTION, not the complete official annual
  // Z-index algorithm (which treats partial retirement years specially).
  const requiredMonths = input.historical_required_months + input.future_pause_months + input.future_paid_months - c.excluded_months;
  const paidMonths = input.paid_months + input.future_paid_months;
  const index = Math.round((input.paid_months * input.historical_index + input.future_paid_months) / requiredMonths * 10000) / 10000;
  const assumption = { basis: 'assumption', source: 'Explicit fictional condition, not an official entitlement' };
  const kernelInput = {
    scope: 'beijing-enterprise-post-1998', birth_month: input.birth_month, worker: 'male', flex_months: 0,
    paid_months_at_retirement: paidMonths,
    average_index: { ten_thousandths: Math.round(index * 10000), ...assumption },
    benefit_base: { cents: String(input.benefit_base_cents), year: 2053, ...assumption },
    account_at_retirement: { cents: '0', ...assumption }, // Base benefit only in this comparison.
    disbursement: { months: 117, basis: 'verified', source: 'Whole-age 63 table' },
  };
  const kernel = calculateBeijingBenefit(kernelInput);
  return { ...c, assumed_required_months_for_index: requiredMonths, assumed_contribution_index: index,
    expected_base_pension_cents: c.expected_cents, legacy_base_pension_cents: actual.base_pension_nominal_cents,
    legacy_difference_cents: actual.base_pension_nominal_cents - c.expected_cents,
    kernel_input: kernelInput, kernel_result: kernel,
    kernel_matches_conditional_amount: kernel.status === 'ready' && kernel.value.base_monthly_cents === c.expected_cents };
});
// Separate complete-year oracle. Constants below are independently derived:
// 20 annual ratios of 1 + two unpaid years of 0, / 22 = .9091;
// 1204900 * (1 + .9091) / 2 * 20 * .01 = 230027.459 cents;
// 11700000 / 117 = 100000 cents; first retirement month needs 330027 cents.
const assumption = { basis: 'assumption', source: 'Fictional complete-calendar-year audit, not approved benefits' };
const annualInput = {
  scope: 'beijing-enterprise-post-1998', required_start_month: '2032-01', required_start_source: assumption, retirement_month: '2053-12',
  months: Array.from({ length: 264 }, (_, i) => {
    const year = 2032 + Math.floor(i / 12), unpaid = year === 2034 || year === 2035;
    return { month: `${year}-${String(i % 12 + 1).padStart(2, '0')}`, kind: unpaid ? 'unpaid' : 'paid', base_cents: unpaid ? '0' : '1000000', ...assumption };
  }),
  wages: Array.from({ length: 22 }, (_, i) => ({ year: 2031 + i, cents: '12000000', ...assumption })),
};
const annual = prepareBeijingIndex(annualInput);
if (annual.status !== 'ready') throw new Error(JSON.stringify(annual));
const ledgerInput = {
  benefit: { scope: annualInput.scope, birth_month: '1990-12', worker: 'male', flex_months: 0,
    paid_months_at_retirement: annual.value.paid_months, average_index: annual.value.average_index,
    benefit_base: { cents: '1204900', year: 2053, ...assumption }, account_at_retirement: { cents: '11700000', ...assumption },
    disbursement: { months: 117, ...assumption } },
  nominal_factor_at_income_start: 1, inflation_indexed_after_start: true, pool: { lump_cents: 0, unlock_age_months: 756 },
};
const bridge = beijingBenefitForLedger(ledgerInput);
if (bridge.status !== 'ready') throw new Error(JSON.stringify(bridge));
const plan = { input_mode: 'basic', now_months: 756, target_months: 756, horizon_months: 759, search_cap_months: 759,
  mode: 'traditional', assets_cents: 330027, saving_cents: 0, saving_growth_hundredths: 0, r_before_hundredths: 0,
  r_after_hundredths: 0, inflation_hundredths: 0, volatility_hundredths: 0, spends: [], incomes: [],
  items: [{ id: 'fictional-living', label: 'Fictional budget', monthly_cents: 330027, start_age: null, end_age: null, inflation_hundredths: null, essential: true }],
  pension_at: () => bridge.value.pension };
const partial = prepareBeijingIndex({ ...annualInput, retirement_month: '2053-10' });
const expected = { index: 9091, paid_months: 240, required_months: 264, total_monthly_cents: 330027,
  payment_month: '2054-01', required_bridge_cents: 330027, assets_cents: [330027, 0, 0, 0], partial_status: 'blocked' };
const observed = { index: annual.value.average_index.ten_thousandths, paid_months: annual.value.paid_months,
  required_months: annual.value.required_months, total_monthly_cents: bridge.value.benefit.total_monthly_cents,
  payment_month: bridge.value.benefit.scheduled_payment_month, required_bridge_cents: required(plan, 756),
  assets_cents: [...projectLedger(plan, 2053).assets], partial_status: partial.status };
const matches = JSON.stringify(expected) === JSON.stringify(observed);
if (!matches || cases.some(c => !c.kernel_matches_conditional_amount)) process.exitCode = 1;
const candidateCases = [
  { kind: 'paid', expected: { index: 10000, paid_months: 264, account_cents: '11920000', benefit_cents: 366958 } },
  { kind: 'unpaid', expected: { index: 9545, paid_months: 252, account_cents: '10960000', benefit_cents: 340948 } },
  { kind: 'unemployment_benefit', expected: { index: 10000, paid_months: 252, account_cents: '10960000', benefit_cents: 346704 } },
].map(c => {
  const pathInput = {
    index: { ...annualInput, months: annualInput.months.map(m => ({ ...m,
      kind: m.month.startsWith('2052-') ? c.kind : 'paid', base_cents: m.month.startsWith('2052-') && c.kind !== 'paid' ? null : '1000000' })) },
    account: { scope: annualInput.scope, method: 'annual-simple-month-product-assumption',
      opening: { month: '2051-12', cents: '10000000', interest_settled: true, ...assumption },
      rates: [2052,2053].map(year => ({ year, ten_thousandths: 0, ...assumption })) },
    benefit: { scope: annualInput.scope, birth_month: '1990-12', worker: 'male', flex_months: 0,
      benefit_base: { cents: '1204900', year: 2053, ...assumption }, disbursement: { months: 117, ...assumption } },
    ledger: { nominal_factor_at_income_start: 1, inflation_indexed_after_start: true, pool: { lump_cents: 0, unlock_age_months: 756 } },
  };
  const r = prepareBeijingPensionPath(pathInput);
  if (r.status !== 'ready') throw new Error(JSON.stringify(r));
  const observed = { index: r.value.index.average_index.ten_thousandths, paid_months: r.value.index.paid_months,
    account_cents: r.value.account.account_at_end.cents, benefit_cents: r.value.benefit.total_monthly_cents };
  const matches = JSON.stringify(c.expected) === JSON.stringify(observed);
  if (!matches) process.exitCode = 1;
  return { kind: c.kind, input: pathInput, expected: c.expected, observed, matches,
    oracle: '22 versus 21 paid years; zero interest and settled 100000 yuan + future paid months * 800 yuan; cent-rounded benefit components' };
});
console.log(JSON.stringify({ status: 'complete-year arithmetic checked; whole Beijing policy validation is incomplete', input,
  limitation: '110.85 yuan is a conditional index sensitivity, NOT a verified policy error for this birth month. Complete-year index and ledger adapter have isolated tests. Account projection and candidate chaining are now implemented only under an explicitly named scenario method, not officially calibrated settlement. Partial-year index rules and entitlement approval remain unverified. Career search remains blocked; the UI amount-check panel does not use the candidate chain.',
  sources: ['https://rsj.beijing.gov.cn/xxgk/2024zcwj/202407/t20240726_3759985.html',
    'https://www.beijing.gov.cn/zhengce/zhengcefagui/qtwj/200804/t20080414_567066.html',
    'https://fuwu.rsj.beijing.gov.cn/bjdkhy/static/file/oldjbylbxdy/oldjbylbxdy/index7.html'], cases,
  complete_year_audit: { annual_input: annualInput, annual_result: annual, ledger_input: ledgerInput, expected, observed, matches,
    oracle: '20 / 22, rounded to four decimals; cent-rounded base plus account; zero returns and one unpaid retirement month',
    limitation: 'Fictional frozen future base/account, explicit inflation-indexing assumption. Not a live official-calculator comparison or approved entitlement.' },
  candidate_cases: candidateCases }, null, 2));
