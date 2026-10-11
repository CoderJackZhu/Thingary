import { startAgeMonths, statutoryAgeMonths } from '../plan-pension.ts';
import type { StoredProfile } from '../plan.ts';
const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
export function shiftMonth(month: string, delta: number) {
  const n = index(month) + delta;
  return `${Math.floor(n / 12)}-${String(n % 12 + 1).padStart(2, '0')}`;
}
export function ageAtMonth(birth: string | null, month: string | null) {
  if (!birth || !month) return '年龄待确认';
  const n = index(month) - index(birth);
  return `${Math.floor(n / 12)} 岁${n % 12 ? ` ${n % 12} 个月` : ''}`;
}
export function contributionTimeline(p: StoredProfile, stop: string | null, today: string) {
  const birth = p.birth_month;
  const work = birth && p.retire.target_age !== null ? shiftMonth(birth, p.retire.target_age * 12) : null;
  const statutory = birth && p.worker ? shiftMonth(birth, statutoryAgeMonths(p.worker, birth)) : null;
  const retirement = birth && p.worker && p.flex_months !== null ? shiftMonth(birth, startAgeMonths({ birth_month: birth, worker: p.worker, flex_months: p.flex_months })) : null;
  const start = p.retire.basic?.pension_contributions.start_month;
  const months = work && start && stop ? Math.max(0, index(stop) - Math.max(index(work), index(start), index(today.slice(0, 7)) + 1)) : null;
  return { work, statutory, retirement, stop, last: stop ? shiftMonth(stop, -1) : null, months };
}
