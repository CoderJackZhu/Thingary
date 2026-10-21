import type { BasicFields, ProfileState } from '../plan.ts';
import type { SectionInput } from '../planning-basic-data.ts';
import { householdOf, isCouple } from '../planning-simplified-ui/household-view.ts';
export type Saved = NonNullable<ProfileState['saved']>;
export type GoalEdit = 'mode' | 'time' | 'spend' | 'saving' | 'assumptions' | 'start' | 'emergency';
export const editTitles: Record<GoalEdit, string> = { mode: '目标类型', time: '停止工作时间', spend: '退休生活费', saving: '每月能存的钱', assumptions: '计算假设', start: '现在可用的钱', emergency: '应急金' };

/** Scoped editors copy untouched values verbatim; they never normalize unrelated drafts. */
export function basicFields(saved: Saved): BasicFields {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) throw new Error('请先完成基础规划设置。');
  return structuredClone({ spend_cents: r.spend_cents, mode: r.mode,
    real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths, volatility_hundredths: r.volatility_hundredths,
    emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths, monetary_basis_date: r.core.monetary_basis_date, basic: r.basic });
}
export function goalInput(kind: GoalEdit, saved: Saved, draft: BasicFields, simplified: import('../plan-simplified-contract.ts').SimplifiedPlanningFieldsV1 = saved.profile.retire.simplified): SectionInput {
  if (kind === 'time') return { section: 'simplified', fields: structuredClone(simplified) };
  const f = basicFields(saved);
  if (kind === 'mode') f.mode = draft.mode;
  if (kind === 'spend') f.spend_cents = draft.spend_cents;
  if (kind === 'saving') f.basic.contribution.monthly_cents = draft.basic.contribution.monthly_cents;
  // A couple's share lives in the simplified partition: one atomic setup save carries both.
  if (kind === 'saving' && isCouple(householdOf(simplified))) return { section: 'setup', fields: { basic: f, budget: null, funds: null, simplified: structuredClone(simplified) } };
  if (kind === 'start') f.basic.start = structuredClone(draft.basic.start);
  if (kind === 'assumptions') { f.real_return_before_hundredths = draft.real_return_before_hundredths; f.real_return_after_hundredths = draft.real_return_after_hundredths; f.inflation_hundredths = draft.inflation_hundredths; }
  if (kind === 'emergency') f.emergency_months = draft.emergency_months;
  return { section: 'basic', fields: f };
}
