import type { PlanningCore, DebtRepayment, DebtTreatment } from './plan-core.ts';
import type { Snapshot, Account } from './wealth.ts';
import type { StoredLifeEvent } from './plan.ts';
import type { PlanningAnnotation } from './plan-basic-contract.ts';

export const debtMonthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
export const debtMonth = (index: number) => `${Math.floor(index / 12).toString().padStart(4, '0')}-${(index % 12 + 1).toString().padStart(2, '0')}`;
export const debtFirstMonth = (date: string) => debtMonth(debtMonthIndex(date) + 1);
export const validDebtMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0, 4)) > 0;
const validMoney = (v: string | null) => v === null || /^(0|[1-9]\d*)$/.test(v) && BigInt(v) <= 99999999999n;
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function validateDebtRepayment(row: DebtRepayment) {
  if (!row.account_id || !validDate(row.as_of) || !validDate(row.recorded_on) || row.as_of > row.recorded_on || row.balance_cents === null || !validMoney(row.balance_cents) || !validMoney(row.monthly_cents)) throw new Error('还款金额须为合法整数分，日期须完整。');
  if (!validDebtMonth(row.start_month) || row.last_month !== null && (!validDebtMonth(row.last_month) || debtMonthIndex(row.last_month) < debtMonthIndex(row.start_month) || debtMonthIndex(row.last_month) - debtMonthIndex(row.start_month) >= 480)) throw new Error('还款期限请填 1 到 480 个月，最后一期不能早于第一期。');
  if (![null, 'scheduled', 'included', 'excluded'].includes(row.before) || ![null, 'scheduled', 'included', 'excluded'].includes(row.after)) throw new Error('请选择有效的还款处理方式。');
}
export function mergeDebtRepayments(old: readonly DebtRepayment[], updates: readonly DebtRepayment[], remove: readonly string[] = []): DebtRepayment[] {
  if (new Set(remove).size !== remove.length || remove.some(id => !id)) throw new Error('移除的账户不能重复或为空。');
  const ids = new Set<string>();
  for (const row of updates) { validateDebtRepayment(row); if (ids.has(row.account_id) || remove.includes(row.account_id)) throw new Error('同一账户不能重复处理。'); ids.add(row.account_id); }
  return [...old.filter(row => !ids.has(row.account_id) && !remove.includes(row.account_id)), ...updates];
}
/** Changed balance asks for review without resetting a fixed schedule. Zero stops it immediately. */
export function debtBalanceChanged(row: DebtRepayment, amount: string | null) {
  if (amount === null || amount === row.balance_cents) return false;
  const old = BigInt(row.balance_cents), current = BigInt(amount), difference = old > current ? old - current : current - old;
  return current === 0n || old === 0n || difference >= (old / 10n > 10000n ? old / 10n : 10000n);
}
export function debtReview(snapshot: Snapshot | null, core: PlanningCore | null | undefined, events: readonly StoredLifeEvent[], targetMonth?: string, horizonMonth?: string, accounts: readonly Account[] = []) {
  const rows = (snapshot?.entries ?? []).filter(e => e.counted && e.side === 'liability' && (e.amount_cents === null || Number(e.amount_cents) > 0 || core?.debt_repayments?.some(r => r.account_id === e.account_id))).map(entry => {
    const saved = core?.debt_repayments?.find(r => r.account_id === entry.account_id);
    const linked = events.find(e => core?.occurrences.some(o => o.status === 'occurred' && o.event_id === e.id && o.loan?.account_id === entry.account_id));
    const name = accounts.find(a => a.id === entry.account_id)?.fields.name ?? '负债账户';
    const zero = entry.amount_cents === '0', changed = !!saved && debtBalanceChanged(saved, entry.amount_cents);
    const end = saved?.last_month ? debtMonthIndex(saved.last_month) + 1 : Infinity;
    const from = Math.max(debtMonthIndex(snapshot!.date) + 1, saved ? debtMonthIndex(saved.start_month) : 0);
    const target = targetMonth ? debtMonthIndex(targetMonth) : Infinity, horizon = horizonMonth ? debtMonthIndex(horizonMonth) : Infinity;
    const applicable = { before: from < Math.min(end, target, horizon), after: Math.max(from, targetMonth ? target : from) < Math.min(end, horizon) };
    const pending: string[] = [], excluded: string[] = [];
    for (const phase of ['before', 'after'] as const) {
      if (!applicable[phase] || zero || linked) continue;
      const treatment = saved?.[phase];
      if (treatment === 'excluded') excluded.push(phase === 'before' ? '退休前' : '退休后');
      else if (!treatment || treatment === 'scheduled' && (saved?.monthly_cents === null || saved?.last_month === null)) pending.push(phase === 'before' ? '退休前' : '退休后');
    }
    return { entry, saved, linked, name, zero, changed, applicable, pending, excluded };
  });
  const annotations: PlanningAnnotation[] = [];
  for (const row of rows) {
    const common = { source_ids: [`debt:${row.entry.account_id}`], refinement: { owner: 'funds' as const, field: 'core.debt_repayments' } };
    if (row.pending.length) annotations.push({ ...common, id: `debt:${row.entry.account_id}`, reason_code: 'DEBT_UNLINKED', message: `已有负债的${row.pending.join('、')}还款未计入；负债余额保留。`, missing_fields: ['还款方式、月还款额或最后一期'], effect: 'requirement_lower', treatment: 'omitted' });
    if (row.excluded.length) annotations.push({ ...common, id: `debt:${row.entry.account_id}:excluded`, reason_code: 'DEBT_EXCLUDED', message: `你选择了${row.excluded.join('、')}先不考虑，还款未计入，所需投入可能偏低。`, missing_fields: [], effect: 'requirement_lower', treatment: 'omitted', actionable: false });
    if (row.changed && !row.linked) annotations.push({ ...common, id: `debt:${row.entry.account_id}:balance`, reason_code: 'DEBT_BALANCE_CHANGED', message: `负债余额明显变化${row.zero ? '，已归零，独立还款已停用' : '，请复核原还款安排'}。`, missing_fields: [], effect: 'none', treatment: 'not_used' });
  }
  return { rows, annotations };
}
export const debtTreatmentLabel = (value: DebtTreatment) => value === 'scheduled' ? '每月还款' : value === 'included' ? '已含在每月开销里' : value === 'excluded' ? '这次先不考虑' : '尚未处理';
