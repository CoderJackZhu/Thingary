import type { BasicFields, PensionFields, ProfileState } from '../plan.ts';
import type { SectionInput } from '../planning-basic-data.ts';
export type Saved = NonNullable<ProfileState['saved']>;
export type GoalEdit = 'time' | 'spend' | 'saving' | 'assumptions' | 'start' | 'medical';
export const editTitles: Record<GoalEdit, string> = { time: '停止工作时间', spend: '退休生活费', saving: '每月能存的钱', assumptions: '计算假设', start: '现在可用的钱', medical: '退休医保' };

/** Scoped editors copy untouched values verbatim; they never normalize unrelated drafts. */
export function basicFields(saved: Saved): BasicFields {
  const p = saved.profile, r = p.retire;
  if (!r.basic || !r.core) throw new Error('请先完成基础规划设置。');
  return structuredClone({ birth_month: p.birth_month, spend_cents: r.spend_cents, target_age: r.target_age, horizon_age: r.horizon_age, mode: r.mode,
    real_return_before_hundredths: r.real_return_before_hundredths, real_return_after_hundredths: r.real_return_after_hundredths, volatility_hundredths: r.volatility_hundredths,
    emergency_months: r.emergency_months, inflation_hundredths: p.assumptions.inflation_hundredths, monetary_basis_date: r.core.monetary_basis_date, basic: r.basic });
}
export function medicalFields(saved: Saved): PensionFields {
  const p = saved.profile;
  return structuredClone({ birth_month: p.birth_month, worker: p.worker, region: p.region, paid_months: p.paid_months, account_balance_cents: p.account_balance_cents,
    base_cents: p.base_cents, past_index_hundredths: p.past_index_hundredths, flex_months: p.flex_months, personal_pension_annual_cents: p.personal_pension_annual_cents,
    marginal_tax_hundredths: p.marginal_tax_hundredths, overrides: p.overrides, wage_growth_hundredths: p.assumptions.wage_growth_hundredths, pp_return_hundredths: p.assumptions.pp_return_hundredths,
    medical_paid_months: p.medical_paid_months, medical_local_paid_months: p.medical_local_paid_months, medical_required_months: p.medical_required_months, medical_local_required_months: p.medical_local_required_months, medical_topup_cents: p.medical_topup_cents });
}
export function goalInput(kind: GoalEdit, saved: Saved, draft: BasicFields, medical: PensionFields): SectionInput {
  if (kind === 'medical') {
    const f = medicalFields(saved);
    for (const k of ['medical_paid_months', 'medical_local_paid_months', 'medical_required_months', 'medical_local_required_months'] as const) {
      const n = medical[k];
      if (n != null && (!Number.isInteger(n) || n < 0 || n > 1200)) throw new Error('医保月数须为 0 到 1200 的整数，或留空。');
      f[k] = n;
    }
    if (f.medical_paid_months != null && f.medical_local_paid_months != null && f.medical_local_paid_months > f.medical_paid_months) throw new Error('本地实际缴费不能多于累计缴费。');
    f.medical_topup_cents = medical.medical_topup_cents;
    return { section: 'pension', fields: f };
  }
  const f = basicFields(saved);
  if (kind === 'time') { f.birth_month = draft.birth_month; f.target_age = draft.target_age; f.horizon_age = draft.horizon_age; f.mode = draft.mode; }
  if (kind === 'spend') f.spend_cents = draft.spend_cents;
  if (kind === 'saving') f.basic.contribution.monthly_cents = draft.basic.contribution.monthly_cents;
  if (kind === 'start') f.basic.start = structuredClone(draft.basic.start);
  if (kind === 'assumptions') { f.real_return_before_hundredths = draft.real_return_before_hundredths; f.real_return_after_hundredths = draft.real_return_after_hundredths; f.inflation_hundredths = draft.inflation_hundredths; }
  return { section: 'basic', fields: f };
}
