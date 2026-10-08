// Temporary contribution overrides; no profile mutation or career-specific defaults.
import { monthIndex } from './plan-events.ts';
import type { Employment } from './plan-pension.ts';
import type { RegionParams } from './plan-params.ts';

export type ContributionPeriod = { from_month: string; to_month: string; base_cents: string; hpf_monthly_cents: string };
const month = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const amount = (s: string) => /^(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s) <= 100_000_000;

export function pensionPeriodIssue(periods: readonly ContributionPeriod[], region: RegionParams): string | null {
  let end = '';
  for (const p of periods) {
    if (!month(p.from_month) || !month(p.to_month) || p.from_month >= p.to_month || p.from_month < end) return '缴费区间须按月排序，且不能重叠或逆序。';
    if (!amount(p.base_cents) || !amount(p.hpf_monthly_cents)) return '缴费基数和公积金月缴存须是合法非负整数分。';
    const b = Number(p.base_cents);
    if (b === 0 && p.hpf_monthly_cents !== '0') return '本原型的停缴区间不支持继续公积金缴存，请分别核对安排。';
    if (b > 0 && (b < Number(region.base_lower_cents) || b > Number(region.base_upper_cents))) return '缴费基数超出当前所用参数范围；不会自动改成上下限。';
    end = p.to_month;
  }
  return null;
}

/** Outside overrides, retain the explicit baseline schedule, including its stop month. */
export function pensionPath(periods: readonly ContributionPeriod[], birth: string, now: number, from: number, stop: number, base: number, hpf: number, factor: number) {
  const age = (m: string) => monthIndex(m) - monthIndex(birth);
  const at = (m: number) => periods.find(p => age(p.from_month) <= m && m < age(p.to_month));
  const points = [...new Set([now, ...periods.flatMap(p => [age(p.from_month), age(p.to_month)])])].filter(m => m >= now).sort((a, b) => a - b);
  const employment: Employment[] = points.map(m => {
    const p = at(m);
    return { from_age_months: m, base_cents: p ? Number(p.base_cents) : base, hpf_monthly_cents: Math.round((p ? Number(p.hpf_monthly_cents) : hpf) * factor) };
  });
  return { employment, idle: (m: number) => m < from || m >= stop || at(m)?.base_cents === '0' ? 1 : 0 };
}
