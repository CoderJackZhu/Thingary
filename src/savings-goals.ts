import type { Account } from './wealth.ts';

export type SavingsGoalFields = { name: string; target_cents: string; target_date: string | null; notes: string };
export type SavingsGoal = { id: string; fields: SavingsGoalFields; account_ids: string[]; position: number; revision: number; created_on: string; created_at: string; updated_at: string; deleted_at: string | null };
export type SavingsObservation = { account_id: string; name: string; kind: string; status: 'known' | 'missing' | 'unavailable'; amount_cents: string | null; reason: string };
export type SavingsBasis = { snapshot_id: string; date: string; revision: number };
export type SavingsHistory = { basis: SavingsBasis; observations: SavingsObservation[] };
export type SavingsGoalView = { goal: SavingsGoal; observations: SavingsObservation[]; shared_account_ids: string[]; planning_overlap: boolean | null; history: SavingsHistory[] };
export type SavingsRead = { generation: string; write_version: number; today: string; year: number; years: number[]; basis: SavingsBasis | null; newer_incomplete: boolean; accounts: Account[]; goals: SavingsGoalView[] };
export type SavingsSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: SavingsGoalFields; account_ids: string[] };
export type SavingsTrash = { request_id: string; generation: string; id: string; expected_revision: number; deleted: boolean };
export type SavingsProgress = {
  known_cents: string | null; missing: number; unavailable: number; complete: boolean;
  reached: boolean | null; gap_cents: string | null; percent_hundredths: number | null;
  monthly_cents: string | null; months: number | null;
  deadline: 'none' | 'future' | 'this_month' | 'today' | 'past';
};
const monthIndex = (day: string) => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

/** One calculation shared by current cards, history and the annual review. */
export function savingsProgress(fields: SavingsGoalFields, rows: SavingsObservation[], basis: SavingsBasis | null, today: string): SavingsProgress {
  const target = BigInt(fields.target_cents);
  if (target <= 0n || target > 99_999_999_999n) throw new RangeError('Invalid savings target');
  let known = 0n, knownCount = 0, missing = 0, unavailable = 0;
  for (const row of rows) {
    if (row.status === 'unavailable') { unavailable++; continue; }
    if (row.status !== 'known' || row.amount_cents === null || !basis) { missing++; continue; }
    if (!/^\d+$/.test(row.amount_cents)) throw new RangeError('Invalid account balance');
    const value = BigInt(row.amount_cents);
    if (value > 99_999_999_999n) throw new RangeError('Invalid account balance');
    known += value; knownCount++;
  }
  const complete = basis !== null && rows.length > 0 && missing === 0 && unavailable === 0;
  const reached = complete ? known >= target : null;
  const gap = complete ? target > known ? target - known : 0n : null;
  const date = fields.target_date;
  let deadline: SavingsProgress['deadline'] = date === null ? 'none' : date < today ? 'past' : date === today ? 'today' : 'future';
  let months: number | null = null, monthly: bigint | null = null;
  if (date && basis && complete && !reached && deadline === 'future') {
    months = monthIndex(date) - monthIndex(basis.date);
    if (months > 0 && gap !== null) monthly = (gap + BigInt(months) - 1n) / BigInt(months);
    else { months = 0; deadline = 'this_month'; }
  }
  return { known_cents: knownCount ? known.toString() : null, missing, unavailable, complete, reached, gap_cents: gap?.toString() ?? null,
    percent_hundredths: complete ? Number((known * 10000n / target) > 10000n ? 10000n : known * 10000n / target) : null,
    monthly_cents: monthly?.toString() ?? null, months, deadline };
}
export const savingsAccountEligible = (a: Account, today: string) => a.fields.side === 'asset' && a.fields.kind !== 'property' && (!a.fields.closed_on || a.fields.closed_on > today);
export const savingsRestricted = (kind: string) => ['pension', 'housing_fund', 'insurance', 'other_asset'].includes(kind);

/** Historical comparisons intentionally follow today's goal settings. */
export function savingsYearEndpoints(view: SavingsGoalView, year: number) {
  const start = `${String(year).padStart(4, '0')}-01-01`, end = `${String(year).padStart(4, '0')}-12-31`;
  const valid = view.history.filter(p => p.basis.date >= view.goal.created_on && p.basis.date <= end);
  const inside = valid.filter(p => p.basis.date >= start);
  const from = valid.filter(p => p.basis.date < start).at(-1) ?? inside[0] ?? null;
  const to = inside.at(-1) ?? null;
  return { from, to, createdDuringYear: view.goal.created_on >= start && view.goal.created_on <= end, comparable: !!from && !!to && from.basis.date < to.basis.date };
}
