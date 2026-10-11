// Fictional inputs shared by the comparison tests and reproducible benchmark export.
import { careerSources, careerDraft } from '../../src/career-preview/fixtures.ts';
import { fictionalFutureIncome } from './simplified-planning-fixtures.mjs';
export function inputs(o = {}) {
  const s = careerSources(), d = careerDraft(), p = s.profile.value.saved.profile, r = p.retire;
  const firstMonth = o.firstFraction === undefined ? 2026 * 12 + 9 : 2026 * 12 + 8;
  const transition = firstMonth + (o.preMonths ?? 36);
  d.transition_month = `${Math.floor(transition / 12)}-${String(transition % 12 + 1).padStart(2, '0')}`;
  if (o.firstFraction !== undefined) r.basic.start.date = '2026-09-15';
  if (o.lumps) d.lumps = o.lumps.map(l => { const at = firstMonth + l.month; return { month: `${Math.floor(at / 12)}-${String(at % 12 + 1).padStart(2, '0')}`, cents: String(l.cents) }; });
  r.basic.start.available_cents = String(o.start ?? 60_000_000);
  r.real_return_before_hundredths = Math.round((o.beforeRate ?? 0) * 10000);
  r.real_return_after_hundredths = Math.round((o.afterRate ?? 0) * 10000);
  p.assumptions.inflation_hundredths = Math.round((o.inflation ?? 0) * 10000);
  d.gap_months = o.gap ?? 12;
  d.recovery.monthly_cents = String(o.recovery ?? 600_000);
  d.gap.spend_cents = String(o.spend ?? 1_000_000); d.gap.income_cents = String(o.income ?? 0);
  d.gap.insurance = { monthly_cents: String(o.gapInsurance ?? 0), included: o.gapIncluded ?? false };
  d.recovery.insurance = { monthly_cents: String(o.recoveryInsurance ?? 0), included: o.recoveryIncluded ?? false };
  d.gap.extra_income = { lump_cents: o.lump ? String(o.lump) : null, benefit_monthly_cents: o.benefit ? String(o.benefit) : null, benefit_months: o.benefitMonths ?? null };
  d.floor_cents = o.floor === undefined ? null : String(o.floor);
  if (o.retirementSpend !== undefined) r.spend_cents = String(o.retirementSpend);
  if (o.loanPayment) addLoan(s, d, o);
  if (o.unlock) {
    s.modules.wealth=true;r.basic.start={kind:'live'};
    s.snapshot={status:'ready',value:{id:'pool-snapshot',revision:1,date:'2026-09-30',missing:[],entries:[{account_id:'cash',counted:true,side:'asset',kind:'cash',amount_cents:String(o.start??60000000)},{account_id:'hpf',counted:true,side:'asset',kind:'housing_fund',amount_cents:String(o.unlock.cents)}]}};
    r.core.fund_rules=[{account_id:'cash',availability:'available',share_hundredths:10000},{account_id:'hpf',availability:'restricted',share_hundredths:10000}];
  }
  if (o.pension) {
    r.simplified.income_mode='manual';r.simplified.future_incomes=[fictionalFutureIncome({id:'manual-pension',role:'pension',monthly_cents:String(o.pension),start_month:'2057-10',basis:o.pensionIndexed===false?'start_month':'reference_month',basis_month:o.pensionIndexed===false?null:'2026-09',growth:o.pensionIndexed===false?'fixed_nominal':'constant_purchasing_power'})];
  }
  return { s, d };
}
function addLoan(s, d, o) {
  const r = s.profile.value.saved.profile.retire;
  s.modules.wealth = true; r.basic.start = { kind: 'live' };
  s.snapshot = { status: 'ready', value: { id: 'ref-snapshot', revision: 1, date: '2026-09-30', missing: [], entries: [
    { account_id: 'cash', counted: true, side: 'asset', kind: 'cash', amount_cents: String(o.start ?? 60_000_000) },
    { account_id: 'loan', counted: true, side: 'liability', kind: 'loan', amount_cents: String(o.loanPayment * o.loanMonths) },
  ] } };
  r.core.fund_rules = [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }];
  r.life_events = [{ id: 'loan-origin', label: '虚构已付款', kind: 'other', date: '2026-01', included: false, price_cents: '1000000', down_cents: '1000000', extra_cents: '0', loan_rate_hundredths: 0, loan_years: 1, holding_cents: '0', rent_saved_cents: '0', cycle_years: null, until_month:null,time_unconfirmed:false, resale_cents: '0' }];
  r.core.occurrences = [{ id: 'occurred', event_id: 'loan-origin', status: 'occurred', actual_date: '2026-01-01', payments_complete: true, payments: [{ id: 'paid', date: '2026-01-01', amount_cents: '1000000', account_id: 'cash', absorbed_snapshot_id: 'ref-snapshot', absorbed_revision: 1, source_kind: null, source_id: null }], loan: { account_id: 'loan', as_of: '2026-09-30', principal_cents: String(o.loanPayment * o.loanMonths), remaining_months: o.loanMonths } }];
  const scope = [{ source_id: 'event:loan-origin:loan', treatment: o.loanIncluded ? 'included' : 'extra', reference_cents: o.loanIncluded ? String(o.loanPayment) : null }];
  r.basic.contribution_costs = structuredClone(scope); r.basic.retirement_costs = [{ ...scope[0], treatment: 'extra', reference_cents: null }];
  d.gap.costs = structuredClone(scope); d.recovery.costs = structuredClone(scope);
}
export const cases = [
  ['zero-return closed form', {}],
  ['delayed inflow with large recovery payment', { start: 1_000_000, preMonths: 0, spend: 100_000, recovery: 1_000_000, recoveryInsurance: 900_000, recoveryIncluded: true, retirementSpend: 100_000, lumps: [{ month: 4, cents: 2_000_000 }] }],
  ['half first month with growth', { firstFraction: .5, accumulationMonths: 217, preMonths: 0, gap: 1, beforeRate: .02 }],
  ['included loan expires after recovery', { preMonths: 0, gap: 6, loanPayment: 100_000, loanMonths: 12, loanIncluded: true }],
  ['extra loan expires after recovery', { preMonths: 0, gap: 6, loanPayment: 100_000, loanMonths: 12 }],
  ['unreferenced housing fund stays locked with excluded income', { unlock: { month: 372, cents: 20_400_000 } }],
  ['unreferenced large pool cannot erase retirement bridge', { hpfMonthly: 1_000_000, unlock: { month: 372, cents: 204_000_000 } }],
  ['gap self-pay extra', { gapInsurance: 200_000 }],
  ['gap self-pay included', { gapInsurance: 200_000, gapIncluded: true }],
  ['recovery self-pay extra', { recoveryInsurance: 200_000 }],
  ['included insurance still paid before interest', { gapInsurance: 200_000, gapIncluded: true, recoveryInsurance: 200_000, recoveryIncluded: true, beforeRate: .01 }],
  ['lump and six-month benefit', { lump: 12_000_000, benefit: 500_000, benefitMonths: 6 }],
  ['benefit stops on early recovery', { gap: 3, benefit: 500_000, benefitMonths: 6 }],
  ['zero gap receives no benefit but does receive severance', { gap: 0, lump: 12_000_000, benefit: 500_000, benefitMonths: 6 }],
  ['different accumulation and retirement returns', { beforeRate: .02, afterRate: .01 }],
  ['inflation with fixed purchasing-power budgets', { inflation: .025, beforeRate: .01 }],
  ['manual pension starts at 63, not target 50', { pension: 100_000 }],
  ['nominal pension loses purchasing power', { pension: 100_000, pensionIndexed: false, inflation: .025, calendarIncomeOffset: 1 }],
];
