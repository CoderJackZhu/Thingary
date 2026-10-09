// What extra months of contributions buy, as a difference. Absolute Beijing pension amounts are not calibrated
// (index, benefit base, first payment month), but a difference between "stop now" and "keep paying L more months"
// leaves most of those uncertainties in both terms. Rough, labelled as such; never feeds the main answers.
import type { PlanningSources } from '../plan-basic-contract.ts';
import { beijing, effectiveParams } from '../plan-params.ts';
import { ageMonthsAt, project } from '../plan-pension.ts';
import { hasPensionProfile } from '../plan.ts';
import { validCareerAmount } from '../plan-career-contract.ts';

export type MarginalRow = { monthly_cents: number; eligible: boolean; short_months: number; total_paid_months: number; contribution_months: number };
export type Marginal =
  | { status: 'ready'; months: number; stopped: MarginalRow; paying: MarginalRow; delta_monthly_cents: number; cash_total_cents: number | null; payback_years: number | null }
  | { status: 'blocked'; message: string };

export function marginalPension(sources: PlanningSources, o: { months: number; base_cents: string; cash_cents: string | null }): Marginal {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null;
  if (!p) return { status: 'blocked', message: '尚无个人资料。' };
  if (!hasPensionProfile(p)) return { status: 'blocked', message: '需要完整的养老金资料（性别与职工类型、已缴月数、个人账户余额、缴费基数）才能粗估。' };
  if (!Number.isInteger(o.months) || o.months < 1 || o.months > 600) return { status: 'blocked', message: '多交的月数须是 1 到 600 的整数。' };
  const region = effectiveParams(beijing, p.overrides);
  if (!validCareerAmount(o.base_cents) || Number(o.base_cents) < Number(region.base_lower_cents) || Number(o.base_cents) > Number(region.base_upper_cents))
    return { status: 'blocked', message: '缴费基数须在北京缴费基数的上下限之内；不会自动改成上下限。' };
  const nowAge = ageMonthsAt(p.birth_month, sources.today);
  const funds = { hpf_balance_cents: '0', hpf_monthly_cents: '0' };
  const row = (x: ReturnType<typeof project>): MarginalRow => ({
    // Without the minimum contribution years there is no monthly basic pension; do not show the formula amount as payable.
    monthly_cents: x.eligible ? x.total_today_cents : 0, eligible: x.eligible, short_months: Math.max(0, x.required_months - x.total_paid_months),
    total_paid_months: x.total_paid_months, contribution_months: x.contribution_months,
  });
  const stopped = row(project(p, region, sources.today, nowAge, funds, []));
  const paying = row(project(p, region, sources.today, nowAge + o.months, funds, [{ from_age_months: nowAge, base_cents: Number(o.base_cents), hpf_monthly_cents: 0 }]));
  const delta = paying.monthly_cents - stopped.monthly_cents;
  const cash = o.cash_cents !== null && validCareerAmount(o.cash_cents) ? paying.contribution_months * Number(o.cash_cents) : null;
  return { status: 'ready', months: o.months, stopped, paying, delta_monthly_cents: delta, cash_total_cents: cash, payback_years: cash !== null && cash > 0 && delta > 0 ? cash / (delta * 12) : null };
}
