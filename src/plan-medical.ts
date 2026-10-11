import type { StoredProfile, BasicInputs } from './plan.ts';
import { startAgeMonths } from './plan-pension.ts';
import { BEIJING_MEDICAL_MONTHS } from './plan-params.ts';
export type MedicalCheck = { status: 'not_needed' | 'unknown' | 'ok' | 'short'; at_month: string | null; projected_months: number | null; required_months: number | null; local_projected_months: number | null; local_required_months: number | null; short_months: number | null; missing: string[] };
const index = (s: string) => +s.slice(0, 4) * 12 + +s.slice(5, 7) - 1;
const month = (n: number) => `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
export const medicalYears = (n: number) => String(Math.round(n / 12 * 10) / 10);
/** Confirmed contribution intervals are half-open, as in the pension calculation. */
export function medicalCheck(p: StoredProfile, basic: BasicInputs | null | undefined, today: string): MedicalCheck {
  const out: MedicalCheck = { status: 'not_needed', at_month: null, projected_months: null, required_months: null, local_projected_months: null, local_required_months: null, short_months: null, missing: [] };
  const entered = [p.medical_paid_months, p.medical_local_paid_months, p.medical_required_months, p.medical_local_required_months, p.medical_topup_cents].some(v => v != null);
  const age = p.birth_month && p.worker && p.flex_months != null ? startAgeMonths({ birth_month: p.birth_month, worker: p.worker, flex_months: p.flex_months }) : null;
  const checkAge = age ?? (p.birth_month && p.worker ? startAgeMonths({ birth_month: p.birth_month, worker: p.worker, flex_months: 0 }) : null);
  if (!entered && (checkAge === null || p.retire.target_age === null || p.retire.target_age * 12 >= checkAge)) return out;
  out.status = 'unknown';
  if (!p.birth_month) out.missing.push('出生年月');
  if (!p.worker) out.missing.push('职工类型');
  if (p.flex_months == null) out.missing.push('弹性领取月数');
  if (age !== null && p.birth_month) out.at_month = month(index(p.birth_month) + age);
  out.required_months = p.region === 'beijing' ? (p.worker ? BEIJING_MEDICAL_MONTHS[p.worker] : null) : p.medical_required_months ?? null;
  out.local_required_months = p.medical_local_required_months ?? (p.region === 'beijing' ? null : 0);
  if (out.required_months === null) out.missing.push('医保所需累计年限');
  if (out.local_required_months === null) out.missing.push('本地实际缴费要求');
  if (p.medical_paid_months == null) out.missing.push('医保累计缴费月数');
  if (out.local_required_months !== 0 && p.medical_local_paid_months == null) out.missing.push('医保本地实际缴费月数');
  const pc = basic?.pension_contributions;
  let future: number | null = null;
  if (!pc?.start_month || !pc.stop_month) out.missing.push('未来缴费起止月份');
  else if (out.at_month) future = Math.max(0, Math.min(index(pc.stop_month), index(out.at_month) + 1) - Math.max(index(today) + 1, index(pc.start_month)));
  if (future !== null) {
    if (p.medical_paid_months != null) out.projected_months = p.medical_paid_months + future;
    if (p.medical_local_paid_months != null) out.local_projected_months = p.medical_local_paid_months + future;
  }
  if (out.missing.length) return out;
  out.short_months = Math.max(0, out.required_months! - out.projected_months!, out.local_required_months! > 0 ? out.local_required_months! - out.local_projected_months! : 0);
  out.status = out.short_months > 0 ? 'short' : 'ok';
  return out;
}
export function medicalMessage(m: MedicalCheck, topup: string | null | undefined): string {
  if (m.status === 'unknown') return `医保缴费年限还待核对：缺少${m.missing.join('、')}。只作提醒，不影响继续测算。`;
  if (m.status === 'short' && topup != null) return `医保补缴按你填的 ¥${(Number(topup) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 在 ${m.at_month} 计入（估算）`;
  return `到法定退休年龄（${m.at_month}）医保累计约 ${medicalYears(m.projected_months!)} 年，还差 ${m.short_months} 个月；退休时需要补缴，金额以经办机构核定为准，未计入。`;
}
