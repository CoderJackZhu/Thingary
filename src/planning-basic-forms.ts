// Form drafts -> shared section DTOs. Syntax only: blank means unknown (null), never 0. Domain rules stay native.
import { defaultRetire, pctToHundredths, hundredthsToPct } from './plan.ts';
import type { BasicFields, BudgetFields, CostScope, EventsFields, FundsFields, IncomeSelection, PensionFields, ProfileState, RetireInputs, StoredIncomeItem, StoredSpendItem } from './plan.ts';
import { costSources, mustStayInLedger } from './plan-core.ts';
import type { FundRule } from './plan-core.ts';
import { defaultAssumptions, noOverrides } from './plan-params.ts';
import type { Worker } from './plan-pension.ts';
import type { SectionInput } from './planning-basic-data.ts';
import { pcPlanOf, pcValues } from './planning-basic-defaults.ts';
import type { PcPlan } from './planning-basic-defaults.ts';
import type { Snapshot } from './wealth.ts';

type Saved = ProfileState['saved'];
export type Treatment = '' | 'included' | 'extra' | 'excluded';
export type ScopeDraft = { treatment: Treatment; ref: string };
export type CostSource = { id: string; label: string; cents: string | null };
export type IncomeMode = '' | 'excluded' | 'manual' | 'employee';
export type IncomePick = { on: boolean; role: 'state_pension' | 'other' };
export type PensionForm = { region: '' | 'beijing' | 'custom'; birth: string; worker: Worker | ''; paid: string; balance: string; base: string; past: string; flex: string; pp: string; tax: string; wage: string; ppReturn: string; oWage: string; oLower: string; oUpper: string; oNotional: string; oHpf: string };

export type Draft = {
  mode: 'fire' | 'traditional'; birth: string; target: string; budget: string;
  horizon: string; before: string; after: string; infl: string; emergency: string;
  retScopes: Record<string, ScopeDraft>; conScopes: Record<string, ScopeDraft>;
  start: 'live' | 'simulation'; simId: string; simAmount: string; simDate: string; simNotes: string;
  incomeMode: IncomeMode; incomeItems: StoredIncomeItem[]; picks: Record<string, IncomePick>; spendItems: StoredSpendItem[];
  pcStart: string; pcStop: string; pcBase: string; pcPlan: PcPlan;
  contribution: string; contributionId: string;
  funds: FundRule[]; hpf: string; ppAccount: string; ppConfirmed: boolean;
  pension: PensionForm;
};

const spendSources = (r: RetireInputs): CostSource[] => [
  ...r.spend_items.map(i => ({ id: `spend:${i.id}`, label: i.label, cents: i.monthly_cents })),
  ...(Number(r.rent_cents) > 0 ? [{ id: 'rent', label: '房租', cents: r.rent_cents }] : []),
  ...(Number(r.keep_paying_monthly_cents) > 0 ? [{ id: 'social_insurance', label: '自缴社保', cents: r.keep_paying_monthly_cents }] : []),
];
/** Retirement-side sources come from facts the person already has; there is nothing to ask when there are none. */
export const retirementSources = (r: RetireInputs, annualPension: string | null = null): CostSource[] => [
  ...contributionSources(r, annualPension), ...spendSources(r),
];
const occurred = (r: RetireInputs, id: string) => !!r.core?.occurrences.some(o => o.event_id === id && o.status === 'occurred');
export const contributionSources = (r: RetireInputs, annualPension: string | null): CostSource[] =>
  [...new Map([...costSources(r.life_events, annualPension ?? '0').map(s => ({ ...s, cents: null })), ...(r.core?.occurrences ?? []).filter(o => o.status === 'occurred' && o.loan && Number(o.loan.principal_cents) > 0).map(o => ({ id: `event:${o.event_id}:loan`, label: '已发生计划余债', cents: null }))].map(s => [s.id, s])).values()];

export const emptyPensionForm = (): PensionForm => ({ region: '', birth: '', worker: '', paid: '', balance: '', base: '', past: '', flex: '0', pp: '', tax: '1000', wage: hundredthsToPct(defaultAssumptions.wage_growth_hundredths), ppReturn: hundredthsToPct(defaultAssumptions.pp_return_hundredths), oWage: '', oLower: '', oUpper: '', oNotional: '', oHpf: '' });
export function pensionFormOf(saved: Saved): PensionForm {
  const p = saved?.profile; if (!p) return emptyPensionForm();
  const o = p.overrides;
  return { region: p.region ?? '', birth: p.birth_month ? p.birth_month + '-01' : '', worker: p.worker ?? '', paid: p.paid_months == null ? '' : String(p.paid_months), balance: p.account_balance_cents ?? '', base: p.base_cents ?? '',
    past: p.past_index_hundredths == null ? '' : String(p.past_index_hundredths / 100), flex: p.flex_months == null ? '0' : String(p.flex_months), pp: p.personal_pension_annual_cents ?? '', tax: p.marginal_tax_hundredths == null ? '' : String(p.marginal_tax_hundredths),
    wage: hundredthsToPct(p.assumptions.wage_growth_hundredths), ppReturn: hundredthsToPct(p.assumptions.pp_return_hundredths),
    oWage: o.avg_wage_cents ?? '', oLower: o.base_lower_cents ?? '', oUpper: o.base_upper_cents ?? '', oNotional: o.notional_rate_hundredths == null ? '' : hundredthsToPct(o.notional_rate_hundredths), oHpf: o.hpf_rate_hundredths == null ? '' : hundredthsToPct(o.hpf_rate_hundredths) };
}

const scopeDraft = (list: CostScope[] | undefined, sources: CostSource[]): Record<string, ScopeDraft> =>
  Object.fromEntries(sources.map(s => { const c = list?.find(x => x.source_id === s.id); return [s.id, { treatment: (c?.treatment ?? '') as Treatment, ref: c?.reference_cents ?? '' }]; }));

/** New plans start blank: no age, no budget, no contribution. Saved values (including the old 90-year end) are kept as saved. */
export function draftOf(saved: Saved, snapshot: Snapshot | null, today: string): Draft {
  const p = saved?.profile, r: RetireInputs = p?.retire ?? defaultRetire, b = r.basic, fresh = !b;
  const entries = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const known = r.core?.fund_rules ?? [];
  const sim = b?.start.kind === 'simulation' ? b.start : null;
  return {
    mode: fresh ? defaultRetire.mode : r.mode, birth: p?.birth_month ? p.birth_month + '-01' : '', target: r.target_age == null || fresh ? '' : String(r.target_age), budget: fresh ? '' : r.spend_cents ?? '',
    horizon: String(fresh ? defaultRetire.horizon_age : r.horizon_age), before: hundredthsToPct(fresh ? defaultRetire.real_return_before_hundredths : r.real_return_before_hundredths), after: hundredthsToPct(fresh ? defaultRetire.real_return_after_hundredths : r.real_return_after_hundredths), infl: hundredthsToPct(fresh ? defaultAssumptions.inflation_hundredths : (p?.assumptions ?? defaultAssumptions).inflation_hundredths), emergency: String(fresh ? defaultRetire.emergency_months : r.emergency_months),
    retScopes: scopeDraft(b?.retirement_costs, retirementSources(r, p?.personal_pension_annual_cents ?? null)), conScopes: scopeDraft(b?.contribution_costs, contributionSources(r, p?.personal_pension_annual_cents ?? null)),
    start: sim ? 'simulation' : 'live', simId: sim?.id ?? crypto.randomUUID(), simAmount: sim?.available_cents ?? '', simDate: sim?.date ?? '', simNotes: sim?.notes ?? '',
    incomeMode: b?.retirement_income.mode ?? '', incomeItems: structuredClone(r.income_items), spendItems: structuredClone(r.spend_items),
    picks: Object.fromEntries(r.income_items.map(i => { const s = b?.retirement_income.selected.find(x => x.id === i.id); return [i.id, { on: !!s, role: s?.role ?? 'other' } as IncomePick]; })),
    pcStart: b?.pension_contributions.start_month ?? '', pcStop: b?.pension_contributions.stop_month ?? '', pcBase: b?.pension_contributions.base_cents ?? '',
    pcPlan: pcPlanOf(b?.pension_contributions.start_month ?? '', b?.pension_contributions.stop_month ?? '', p?.birth_month ?? '', r.target_age == null ? '' : String(r.target_age)),
    contribution: b?.contribution.monthly_cents ?? '', contributionId: b?.contribution.id ?? crypto.randomUUID(),
    funds: [...known.map(f => ({ ...f })), ...entries.filter(e => !known.some(f => f.account_id === e.account_id)).map(e => ({ account_id: e.account_id, availability: e.kind === 'cash' ? 'available' as const : 'restricted' as const, share_hundredths: 10000 }))],
    hpf: r.core?.hpf_monthly_cents ?? '', ppAccount: r.core?.personal_pension_account_id ?? '', ppConfirmed: r.core?.personal_pension_balance_confirmed ?? false,
    pension: pensionFormOf(saved),
  };
}

const fail = (m: string): never => { throw new Error(m); };
const int = (t: string, label: string, min: number, max: number): number | null => { const s = t.trim(); if (s === '') return null; const n = Number(s); return Number.isInteger(n) && n >= min && n <= max ? n : fail(`${label}须是 ${min} 到 ${max} 的整数。`); };
const rate = (t: string, label: string): number => pctToHundredths(t) ?? fail(`${label}请填百分数，例如 2 或 2.5。`);
export const monthOf = (d: string) => (d ? d.slice(0, 7) : null);

const scopes = (sources: CostSource[], d: Record<string, ScopeDraft>): CostScope[] => sources.flatMap((s): CostScope[] => {
  const x = d[s.id]; if (!x || x.treatment === '' || (x.treatment === 'excluded' && mustStayInLedger(s.id))) return [];
  if (x.treatment === 'included') return [{ source_id: s.id, treatment: 'included', reference_cents: x.ref === '' ? fail(`「${s.label}」已含在预算里时，请填写含多少。`) : x.ref }];
  return [{ source_id: s.id, treatment: x.treatment, reference_cents: null }];
});
const selections = (d: Draft): IncomeSelection[] => d.incomeItems.filter(i => d.picks[i.id]?.on).map(i => ({ id: i.id, source_id: i.id, role: d.picks[i.id].role }));
export const retirementIncomeOf = (d: Draft) => ({ mode: d.incomeMode === '' ? null : d.incomeMode, selected: d.incomeMode === 'manual' || d.incomeMode === 'employee' ? selections(d).filter(s => d.incomeMode === 'manual' || s.role === 'other') : [] });

export function basicInput(d: Draft, saved: Saved, today: string): SectionInput {
  const r = saved?.profile.retire ?? defaultRetire;
  const fields: BasicFields = {
    birth_month: monthOf(d.birth), spend_cents: d.budget === '' ? null : d.budget, target_age: int(d.target, '目标年龄', 20, 109), horizon_age: int(d.horizon, '规划终点', 70, 110) ?? fail('请填写规划终点。'),
    mode: d.mode, real_return_before_hundredths: rate(d.before, '退休前实际收益'), real_return_after_hundredths: rate(d.after, '退休后实际收益'), volatility_hundredths: r.volatility_hundredths,
    emergency_months: int(d.emergency, '应急金月数', 0, 36) ?? fail('请填写应急金月数。'), inflation_hundredths: rate(d.infl, '通胀'),
    monetary_basis_date: r.core?.monetary_basis_date ?? today,
    basic: {
      contract_version: 1,
      start: d.start === 'live' ? { kind: 'live' } : { kind: 'simulation', id: d.simId, available_cents: d.simAmount === '' ? null : d.simAmount, date: d.simDate === '' ? null : d.simDate, notes: d.simNotes },
      contribution: { id: d.contributionId, monthly_cents: d.contribution === '' ? null : d.contribution },
      retirement_income: retirementIncomeOf(d),
      pension_contributions: (({ start, stop, base }) => ({ start_month: start, stop_month: stop, base_cents: base }))(pcValues(d, today)),
      contribution_costs: scopes(contributionSources(r, (d.incomeMode === 'employee' ? d.pension.pp || null : saved?.profile.personal_pension_annual_cents ?? null)), d.conScopes), retirement_costs: scopes(retirementSources({ ...r, spend_items: d.spendItems }, (d.incomeMode === 'employee' ? d.pension.pp || null : saved?.profile.personal_pension_annual_cents ?? null)), d.retScopes),
    },
  };
  return { section: 'basic', fields };
}
export function budgetInput(d: Draft, r: RetireInputs): SectionInput {
  const fields: BudgetFields = { spend_items: d.spendItems, income_items: d.incomeItems, rent_cents: r.rent_cents, keep_paying_until_age: r.keep_paying_until_age, keep_paying_monthly_cents: r.keep_paying_monthly_cents, keep_paying_base_cents: r.keep_paying_base_cents };
  return { section: 'budget', fields };
}
export const budgetItemsChanged = (d: Draft, r: RetireInputs) => JSON.stringify(d.incomeItems) !== JSON.stringify(r.income_items) || JSON.stringify(d.spendItems) !== JSON.stringify(r.spend_items);
export function fundsInput(d: Draft, saved: Saved, today: string): SectionInput {
  const fields: FundsFields = { monetary_basis_date: saved?.profile.retire.core?.monetary_basis_date ?? today, fund_rules: d.funds, hpf_monthly_cents: d.hpf === '' ? null : d.hpf, personal_pension_account_id: d.ppAccount === '' ? null : d.ppAccount, personal_pension_balance_confirmed: d.ppConfirmed };
  return { section: 'funds', fields };
}
export function pensionInput(f: PensionForm): SectionInput {
  const optPct = (t: string, label: string) => (t.trim() === '' ? null : rate(t, label));
  const past = f.past.trim() === '' ? null : Math.round(Number(f.past) * 100);
  if (past !== null && !(past >= 1 && past <= 1000)) fail('历史平均缴费指数请填 0.01 到 10 之间的数，或留空。');
  const fields: PensionFields = {
    birth_month: monthOf(f.birth), worker: f.worker === '' ? null : f.worker, region: f.region === '' ? null : f.region, paid_months: int(f.paid, '累计缴费月数', 0, 1200), account_balance_cents: f.balance === '' ? null : f.balance, base_cents: f.base === '' ? null : f.base,
    past_index_hundredths: past, flex_months: int(f.flex, '弹性领取月数', -36, 36), personal_pension_annual_cents: f.pp === '' ? null : f.pp, marginal_tax_hundredths: f.tax === '' ? null : Number(f.tax),
    wage_growth_hundredths: rate(f.wage, '工资增长率'), pp_return_hundredths: rate(f.ppReturn, '个人养老金收益率'),
    overrides: { ...noOverrides, avg_wage_cents: f.oWage || null, base_lower_cents: f.oLower || null, base_upper_cents: f.oUpper || null, notional_rate_hundredths: optPct(f.oNotional, '记账利率'), hpf_rate_hundredths: optPct(f.oHpf, '公积金利率') },
  };
  return { section: 'pension', fields };
}
export const eventsInput = (fields: EventsFields): SectionInput => ({ section: 'events', fields });

/** Saving a contribution alone (adopt a suggestion, save a trial): rebuilds the basic section from the saved plan. */
export function contributionSection(saved: NonNullable<Saved>, value: string | null, today: string): SectionInput | null {
  const d = draftOf(saved, null, today); d.contribution = value ?? '';
  try { return basicInput(d, saved, today); } catch { return null; }
}

/** Fee review changes only the two scopes; saved timing, income, goal and contribution remain exact. */
export function costsInput(d: Draft, saved: NonNullable<Saved>): SectionInput {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) return fail('请先设置目标与金额基准。');
  return { section: 'basic', fields: {
    birth_month: p.birth_month, spend_cents: r.spend_cents, target_age: r.target_age, horizon_age: r.horizon_age,
    mode: r.mode, real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths,
    volatility_hundredths: r.volatility_hundredths, emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths,
    monetary_basis_date: r.core.monetary_basis_date,
    basic: { ...r.basic, contribution_costs: scopes(contributionSources(r, p.personal_pension_annual_cents), d.conScopes), retirement_costs: scopes(retirementSources(r, p.personal_pension_annual_cents), d.retScopes) },
  } };
}

/** Nominal retirement-year estimates are converted once before entering the real-money ledger. */
export function incomeInflationContext(birth: string, infl: string, today: string): { age: number; rate: number } | null {
  const month = birth.slice(0, 7), rate = pctToHundredths(infl);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= today.slice(0, 7) || rate === null || rate <= -10000) return null;
  const age = ((Number(today.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(month.slice(5, 7))) / 12;
  return { age, rate: rate / 10000 };
}
export function retirementIncomeToday(cents: string, start: string, birth: string, infl: string, today: string): string | null {
  const context = incomeInflationContext(birth, infl, today), age = Number(start);
  if (!context || !/^\d+$/.test(cents) || !start.trim() || !Number.isInteger(age) || age < 0 || age > 120) return null;
  const value = Math.round(Number(cents) / (1 + context.rate) ** (age - context.age));
  return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
/** 支出项年龄都按本人年龄：「孩子现在 c 岁、供到 u 岁」结束于本人现在的整岁 + (u − c)。 */
export function ownAgeWhenChild(birth: string, today: string, childAge: string, untilAge: string): number | null {
  const month = birth.slice(0, 7), c = Number(childAge), u = Number(untilAge);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month >= today.slice(0, 7) || !/^\d+$/.test(childAge.trim()) || !/^\d+$/.test(untilAge.trim()) || u <= c) return null;
  const own = Math.floor(((Number(today.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(month.slice(5, 7))) / 12);
  return own + u - c <= 120 ? own + u - c : null;
}
/** 新的阶段性支出按「额外」计入退休预算，避免与生活费总额重复。 */
export const withSpendItem = (d: Draft, item: StoredSpendItem): Draft => ({ ...d, spendItems: [...d.spendItems, item], retScopes: { ...d.retScopes, [`spend:${item.id}`]: { treatment: 'extra', ref: '' } } });
export const withoutSpendItem = (d: Draft, id: string): Draft => { const { [`spend:${id}`]: _, ...retScopes } = d.retScopes; return { ...d, spendItems: d.spendItems.filter(i => i.id !== id), retScopes }; };
