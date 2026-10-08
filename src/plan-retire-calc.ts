// One general retirement calculation shared by goals, summary and wish impacts.
import type { Income, PlanReview, ProfileState, StoredLifeEvent } from './plan.ts';
import type { Snapshot } from './wealth.ts';
import { normalizeFunds } from './plan-core.ts';
import { emergency } from './plan-fire.ts';
import { ageMonthsAt } from './plan-pension.ts';
import { table } from './plan-ledger.ts';
import { buildBasicCapabilities } from './plan-basic.ts';
import type { PlanningSources } from './plan-basic-contract.ts';
import type { LifeEvent } from './plan-events.ts';
export { buildBasicCapabilities };
export const disposable = (snapshot: Snapshot | null): number | null => normalizeFunds(snapshot).available;

export function buildRetireCalc(saved: NonNullable<ProfileState['saved']>, snapshot: Snapshot | null, review: PlanReview | null, incomes: Income[], today: string, nativeSources?: PlanningSources) {
  const p = saved.profile, r = p.retire;
  const sources = nativeSources ?? { generation: 'adapter', write_version: saved.revision, today, modules: { planning: true, wealth: snapshot !== null }, profile: { status: 'ready', value: { generation: 'adapter', saved } }, snapshot: { status: 'ready', value: snapshot }, accounts: { status: 'ready', value: [] }, review: review ? { status: 'ready', value: review } : { status: 'error', value: { code: 'UNAVAILABLE', message: '历史统计未提供' } }, incomes: { status: 'ready', value: incomes } } satisfies PlanningSources;
  const capabilities = buildBasicCapabilities(sources);
  const pred = capabilities.prediction.status === 'ready' ? capabilities.prediction.value : undefined;
  const assets = capabilities.funds.status === 'ready' ? Number(capabilities.funds.value.available_cents) / (pred?.plan.basis_factor ?? 1) : null;
  const now = p.birth_month === null ? 0 : ageMonthsAt(p.birth_month, capabilities.context.start.date ?? today);
  return { p, r, now, start: pred?.plan.pension_at(now).unlock_age_months ?? now, capabilities, missing: capabilities.prediction.status === 'blocked' ? capabilities.prediction.missing.map(m => m.message) : [], assets, saving: r.basic?.contribution.monthly_cents == null ? null : Number(r.basic.contribution.monthly_cents), measured: null, spend: r.spend_cents === null ? null : Number(r.spend_cents), derivedSpend: null, emergency: pred && assets !== null ? emergency(assets, table(pred.plan).essential[0] ?? 0, r.emergency_months) : undefined, plan: pred?.plan, plan0: pred?.plan0, events: r.life_events.map(toEvent), proj: pred?.projection, out: pred?.outcome };
}
export type RetireCalc = ReturnType<typeof buildRetireCalc>;

/** 存储形态（金额为整数分字符串）转成引擎用的数字。 */
export const toEvent = (e: StoredLifeEvent): LifeEvent => ({
  id: e.id, label: e.label, kind: e.kind, date: e.date, included: e.included,
  price_cents: Number(e.price_cents), down_cents: Number(e.down_cents), extra_cents: Number(e.extra_cents),
  loan_rate_hundredths: e.loan_rate_hundredths, loan_years: e.loan_years,
  holding_cents: Number(e.holding_cents), rent_saved_cents: Number(e.rent_saved_cents),
  cycle_years: e.cycle_years, until_age: e.until_age, resale_cents: Number(e.resale_cents),
});
