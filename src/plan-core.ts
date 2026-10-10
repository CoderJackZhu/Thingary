// Confirmed planning facts and assumptions. Persistence is the existing profile transaction.
import type { Snapshot } from './wealth.ts';
import type { StoredLifeEvent } from './plan.ts';
import { debtReview } from './plan-debt.ts';
export type DebtTreatment = 'scheduled' | 'included' | 'excluded' | null;
export type DebtRepayment = { account_id: string; recorded_on: string; as_of: string; balance_cents: string; start_month: string; last_month: string | null; monthly_cents: string | null; before: DebtTreatment; after: DebtTreatment };
export type FundRule = { account_id: string; availability: 'available' | 'restricted' | 'excluded'; share_hundredths: number };
export type Payment = { id: string; date: string; amount_cents: string | null; account_id: string | null; absorbed_snapshot_id: string | null; absorbed_revision: number | null; source_kind: 'asset' | 'expense' | 'wish' | null; source_id: string | null };
export type Occurrence = { id: string; event_id: string; status: 'occurred' | 'cancelled'; actual_date: string; payments_complete: boolean; payments: Payment[]; loan: { account_id: string; as_of: string; principal_cents: string; remaining_months: number } | null };
export type PlanningCore = { contract_version: 1; monetary_basis_date: string; fund_rules: FundRule[]; hpf_monthly_cents: string | null; personal_pension_account_id?: string | null; personal_pension_balance_confirmed?: boolean; occurrences: Occurrence[]; debt_repayments?: DebtRepayment[] };
/** Elapsed months at a period boundary after B closes partway through its month. */
export const elapsedMonths = (offset: number, firstFraction = 1) => offset > 0 ? offset - 1 + firstFraction : offset;
export const emptyCore = (date: string): PlanningCore => ({ contract_version: 1, monetary_basis_date: date, fund_rules: [], hpf_monthly_cents: null, occurrences: [] });
export function normalizeFunds(snapshot: Snapshot | null, core?: PlanningCore | null) {
  let available = 0n, restricted = 0n, housingFund = 0n, debt = 0n, net = 0n;
  const missing: string[] = [];
  let unconfirmed = 0;
  if (!snapshot || snapshot.missing?.length) return { available: null, restricted: 0, housingFund: 0, debt: 0, net: null, missing: ['需要完整盘点作为资金起点。'] };
  for (const e of snapshot.entries) {
    if (!e.counted) continue;
    if (e.amount_cents === null) { missing.push('账户余额未知。'); continue; }
    const v = BigInt(e.amount_cents); net += e.side === 'liability' ? -v : v;
    if (e.side === 'liability') { debt += v; continue; }
    const rule = core?.fund_rules.find(x => x.account_id === e.account_id);
    // Only explicit rules can promote investments or other assets into cash.
    const mode = rule?.availability ?? (e.kind === 'cash' ? 'available' : 'restricted');
    if (!rule) unconfirmed++;
    const amount = v * BigInt(rule?.share_hundredths ?? 10000) / 10000n;
    if (mode === 'available') available += amount;
    else if (mode === 'restricted') { restricted += amount; if (e.kind === 'housing_fund') housingFund += amount; }
  }
  if (unconfirmed) missing.push(`${unconfirmed} 个账户的规划用途待确认，请核对资金范围。`);
  return { available: Number(available), restricted: Number(restricted), housingFund: Number(housingFund), debt: Number(debt), net: Number(net), missing };
}
export const eventSource = (id: string, kind: 'loan' | 'holding') => `event:${id}:${kind}`;
/** Loan payments and personal-pension cash transfers are real outflows; they may not be excluded from the ledger. */
export const mustStayInLedger = (sourceId: string) => sourceId.endsWith(':loan') || sourceId === 'personal_pension';
export function costSources(events: StoredLifeEvent[], ppAnnual: string) {
  const out: { id: string; label: string }[] = [];
  for (const e of events) {
    if (Number(e.price_cents) > Number(e.down_cents)) out.push({ id: eventSource(e.id, 'loan'), label: `${e.label}月供` });
    if (Number(e.holding_cents) > 0) out.push({ id: eventSource(e.id, 'holding'), label: `${e.label}持有费` });
  }
  if (Number(ppAnnual) > 0) out.push({ id: 'personal_pension', label: '个人养老金现金转入' });
  return out;
}
export type OccurrenceIssueKind = 'overdue' | 'actual_date' | 'payments' | 'payment_source' | 'absorption' | 'loan' | 'unlinked_debt';
export type OccurrenceIssue = { event_id: string | null; kind: OccurrenceIssueKind; message: string };
export function occurrenceIssues(snapshot: Snapshot, core: PlanningCore | null | undefined, events: StoredLifeEvent[], today: string): OccurrenceIssue[] {
  const missing: OccurrenceIssue[] = [], coveredDebts = new Set<string>();
  for (const e of events) {
    const add = (kind: OccurrenceIssueKind, message: string) => missing.push({ event_id: e.id, kind, message });
    const o = core?.occurrences.find(x => x.event_id === e.id);
    if (!o) { if (e.included && e.date < today.slice(0, 7)) add('overdue', `${e.label}：日期已过，待核对。`); continue; }
    if (o.status === 'cancelled') continue;
    if (o.actual_date > today) add('actual_date', `${e.label}：实际日期不能晚于今天。`);
    if (!o.payments.length) add('payments', `${e.label}：实际付款分项待补充。`);
    for (const p of o.payments) {
      const rule = core?.fund_rules.find(x => x.account_id === p.account_id);
      if (p.amount_cents === null || !p.account_id || rule?.availability !== 'available' || rule.share_hundredths !== 10000) add('payment_source', `${e.label}：付款金额／来源范围待核对。`);
      if (p.date <= snapshot.date && (p.absorbed_snapshot_id !== snapshot.id || p.absorbed_revision !== snapshot.revision)) add('absorption', `${e.label}：付款被哪份盘点吸收待核对。`);
      if (p.date > snapshot.date && p.absorbed_snapshot_id) add('absorption', `${e.label}：起点盘点之后的付款，不能标为已计入盘点。`);
    }
    const paid = o.payments.filter(p => p.amount_cents !== null).reduce((s, p) => s + BigInt(p.amount_cents!), 0n);
    if (!o.payments_complete || paid < 0n) add('payments', `${e.label}：仅部分付款已核对，剩余安排待补充。`);
    if (Number(e.price_cents) > Number(e.down_cents) || o.loan !== null) {
      const l = o.loan;
      if (!l || l.as_of !== snapshot.date) add('loan', `${e.label}：截至资金起点的余债／剩余期待核对。`);
      else {
        const entry = snapshot.entries.find(x => x.account_id === l.account_id && x.side === 'liability' && x.counted);
        if (!entry || entry.amount_cents !== l.principal_cents) add('loan', `${e.label}：余债与盘点负债不一致。`);
        else { if (coveredDebts.has(l.account_id)) add('loan', `${e.label}：同一余债重复接续。`); coveredDebts.add(l.account_id); }
      }
    }
  }
  const debts = debtReview(snapshot, core, events).rows.filter(r => r.pending.length).length;
  if (debts) missing.push({ event_id: null, kind: 'unlinked_debt', message: `${debts} 个负债账户还款待填写，请打开贷款还款安排。` });
  return missing;
}

/** Backward-compatible text projection for all existing calculation callers. */
export function occurrenceMissing(snapshot: Snapshot, core: PlanningCore | null | undefined, events: StoredLifeEvent[], today: string): string[] {
  return occurrenceIssues(snapshot, core, events, today).map(issue => issue.message);
}
