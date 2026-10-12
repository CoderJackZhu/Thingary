// Form drafts -> shared section DTOs. Syntax only: blank means unknown (null), never 0. Domain rules stay native.
import { defaultRetire, pctToHundredths, hundredthsToPct } from './plan.ts';
import type { BasicFields, BudgetFields, CostScope, EventsFields, FundsFields, ProfileState, RetireInputs, StoredSpendItem } from './plan.ts';
import { costSources, mustStayInLedger } from './plan-core.ts';
import type { FundRule, FundRelease } from './plan-core.ts';
import type { SimplifiedPlanningFieldsV1 } from './plan-simplified-contract.ts';
import type { SectionInput } from './planning-basic-data.ts';
import type { Snapshot } from './wealth.ts';
import { suggestedFundAvailability } from './planning-fund-scope.ts';

type Saved = ProfileState['saved'];
export type Treatment = '' | 'included' | 'extra' | 'excluded';
export type ScopeDraft = { treatment: Treatment; ref: string };
export type CostSource = { id: string; label: string; cents: string | null };

export type Draft = {
  mode: 'fire' | 'traditional'; budget: string; before: string; after: string; infl: string; emergency: string; volatility?: string;
  simplified: SimplifiedPlanningFieldsV1;
  retScopes: Record<string, ScopeDraft>; conScopes: Record<string, ScopeDraft>;
  start: 'live' | 'simulation'; simId: string; simAmount: string; simDate: string; simNotes: string;
  spendItems: StoredSpendItem[]; contribution: string; contributionId: string; funds: FundRule[]; releases: FundRelease[];
};

const spendSources = (r: RetireInputs): CostSource[] => [
  ...r.spend_items.map(i => ({ id: `spend:${i.id}`, label: i.label, cents: i.monthly_cents })),
  ...(Number(r.rent_cents) > 0 ? [{ id: 'rent', label: '房租', cents: r.rent_cents }] : []),
];
/** Retirement-side sources come from facts the person already has; there is nothing to ask when there are none. */
export const retirementSources = (r: RetireInputs): CostSource[] => [
  ...contributionSources(r), ...spendSources(r),
];
export const contributionSources = (r: RetireInputs): CostSource[] =>
  [...new Map([...costSources(r.life_events).map(s => ({ ...s, cents: null })), ...(r.core?.occurrences ?? []).filter(o => o.status === 'occurred' && o.loan && Number(o.loan.principal_cents) > 0).map(o => ({ id: `event:${o.event_id}:loan`, label: '已发生计划的剩余欠款', cents: null }))].map(s => [s.id, s])).values()];

const scopeDraft = (list: CostScope[] | undefined, sources: CostSource[]): Record<string, ScopeDraft> =>
  Object.fromEntries(sources.map(s => { const c = list?.find(x => x.source_id === s.id); return [s.id, { treatment: (c?.treatment ?? '') as Treatment, ref: c?.reference_cents ?? '' }]; }));

/** New plans start blank; explicit saved months and estimates are retained. */
export function draftOf(saved: Saved, snapshot: Snapshot | null): Draft {
  const p = saved?.profile, r: RetireInputs = p?.retire ?? defaultRetire, b = r.basic, fresh = !b;
  const entries = snapshot?.entries.filter(e => e.counted && e.side === 'asset') ?? [];
  const known = r.core?.fund_rules ?? [];
  const sim = b?.start.kind === 'simulation' ? b.start : null;
  return {
    mode: fresh ? defaultRetire.mode : r.mode, budget: fresh ? '' : r.spend_cents ?? '',
    simplified: structuredClone(r.simplified),
    volatility: hundredthsToPct(r.volatility_hundredths), before: hundredthsToPct(r.real_return_before_hundredths), after: hundredthsToPct(r.real_return_after_hundredths), infl: hundredthsToPct(p?.assumptions.inflation_hundredths ?? 200), emergency: String(r.emergency_months),
    retScopes: scopeDraft(b?.retirement_costs, retirementSources(r)), conScopes: scopeDraft(b?.contribution_costs, contributionSources(r)),
    start: sim ? 'simulation' : 'live', simId: sim?.id ?? crypto.randomUUID(), simAmount: sim?.available_cents ?? '', simDate: sim?.date ?? '', simNotes: sim?.notes ?? '',
    spendItems: structuredClone(r.spend_items),
    contribution: b?.contribution.monthly_cents ?? '', contributionId: b?.contribution.id ?? crypto.randomUUID(),
    releases: structuredClone(r.core?.releases ?? []),
    funds: [...known.map(f => ({ ...f })), ...entries.filter(e => !known.some(f => f.account_id === e.account_id)).map(e => ({ account_id: e.account_id, availability: suggestedFundAvailability(e.kind), share_hundredths: 10000 }))],
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
export function basicInput(d: Draft, saved: Saved, today: string): SectionInput {
  const r = saved?.profile.retire ?? defaultRetire;
  const fields: BasicFields = {
    spend_cents: d.budget === '' ? null : d.budget,
    mode: d.mode, real_return_before_hundredths: rate(d.before, '退休前实际收益'), real_return_after_hundredths: rate(d.after, '退休后实际收益'), volatility_hundredths: d.volatility === undefined ? r.volatility_hundredths : rate(d.volatility, '市场模拟年波动率'),
    emergency_months: int(d.emergency, '应急金月数', 0, 36) ?? fail('请填写应急金月数。'), inflation_hundredths: rate(d.infl, '通胀'),
    monetary_basis_date: r.core?.monetary_basis_date ?? today,
    basic: {
      contract_version: 1,
      start: d.start === 'live' ? { kind: 'live' } : { kind: 'simulation', id: d.simId, available_cents: d.simAmount === '' ? null : d.simAmount, date: d.simDate === '' ? null : d.simDate, notes: d.simNotes },
      contribution: { id: d.contributionId, monthly_cents: d.contribution === '' ? null : d.contribution },
      contribution_costs: scopes(contributionSources(r), d.conScopes), retirement_costs: scopes(retirementSources({ ...r, spend_items: d.spendItems }), d.retScopes),
    },
  };
  return { section: 'basic', fields };
}
export function budgetInput(d: Draft, r: RetireInputs): SectionInput {
  const fields: BudgetFields = { spend_items: d.spendItems, rent_cents: r.rent_cents };
  return { section: 'budget', fields };
}
export const budgetItemsChanged = (d: Draft, r: RetireInputs) => JSON.stringify(d.spendItems) !== JSON.stringify(r.spend_items);
export function fundsInput(d: Draft, saved: Saved, today: string): SectionInput {
  const fields: FundsFields = { monetary_basis_date: saved?.profile.retire.core?.monetary_basis_date ?? today, fund_rules: d.funds, releases: structuredClone(d.releases) };
  return { section: 'funds', fields };
}
export const eventsInput = (fields: EventsFields): SectionInput => ({ section: 'events', fields });

/** Saving a contribution alone (adopt a suggestion, save a trial): rebuilds the basic section from the saved plan. */
export function contributionSection(saved: NonNullable<Saved>, value: string | null, today: string): SectionInput | null {
  const d = draftOf(saved, null); d.contribution = value ?? '';
  try { return basicInput(d, saved, today); } catch { return null; }
}

/** Fee review changes only the two scopes; saved timing, income, goal and contribution remain exact. */
export function costsInput(d: Draft, saved: NonNullable<Saved>): SectionInput {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) return fail('请先设置目标与金额基准。');
  return { section: 'basic', fields: {
    spend_cents: r.spend_cents,
    mode: r.mode, real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths,
    volatility_hundredths: r.volatility_hundredths, emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths,
    monetary_basis_date: r.core.monetary_basis_date,
    basic: { ...r.basic, contribution_costs: scopes(contributionSources(r), d.conScopes), retirement_costs: scopes(retirementSources(r), d.retScopes) },
  } };
}

/** 新的阶段性支出按「额外」计入退休预算，避免与生活费总额重复。 */
export const withSpendItem = (d: Draft, item: StoredSpendItem): Draft => ({ ...d, spendItems: [...d.spendItems, item], retScopes: { ...d.retScopes, [`spend:${item.id}`]: { treatment: 'extra', ref: '' } } });
export const withoutSpendItem = (d: Draft, id: string): Draft => { const { [`spend:${id}`]: _, ...retScopes } = d.retScopes; return { ...d, spendItems: d.spendItems.filter(i => i.id !== id), retScopes }; };
