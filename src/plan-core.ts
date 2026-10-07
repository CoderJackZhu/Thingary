// Confirmed planning facts and assumptions. Persistence is the existing profile transaction.
import type { Snapshot } from './wealth.ts';
import type { StoredLifeEvent, StoredSavingPhase } from './plan.ts';
export type FundRule = { account_id: string; availability: 'available' | 'restricted' | 'excluded'; share_hundredths: number };
export type Payment = { id: string; date: string; amount_cents: string | null; account_id: string | null; absorbed_snapshot_id: string | null; absorbed_revision: number | null; source_kind: 'asset' | 'expense' | 'wish' | null; source_id: string | null };
export type Occurrence = { id: string; event_id: string; status: 'occurred' | 'cancelled'; actual_date: string; payments_complete: boolean; payments: Payment[]; loan: { account_id: string; as_of: string; principal_cents: string; remaining_months: number } | null };
export type CostRule = { phase_id: string; source_id: string; included: boolean; reference_cents: string };
export type PlanningCore = { contract_version: 1; monetary_basis_date: string; fund_rules: FundRule[]; hpf_monthly_cents: string | null; personal_pension_account_id?: string | null; personal_pension_balance_confirmed?: boolean; costs: CostRule[]; occurrences: Occurrence[] };
/** Elapsed months at a period boundary after B closes partway through its month. */
export const elapsedMonths = (offset: number, firstFraction = 1) => offset > 0 ? offset - 1 + firstFraction : offset;
export const emptyCore = (date: string): PlanningCore => ({ contract_version: 1, monetary_basis_date: date, fund_rules: [], hpf_monthly_cents: null, costs: [], occurrences: [] });
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
  if (unconfirmed) missing.push(`${unconfirmed} 个账户的规划用途待确认，请通过引导设置核对资金范围。`);
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
export function includedReference(core: PlanningCore | null | undefined, phase: StoredSavingPhase, source: string): number | null {
  const rule = core?.costs.find(x => x.phase_id === phase.id && x.source_id === source);
  return rule ? (rule.included ? Number(rule.reference_cents) : 0) : null;
}
export function occurrenceMissing(snapshot: Snapshot, core: PlanningCore | null | undefined, events: StoredLifeEvent[], today: string): string[] {
  const missing: string[] = [], coveredDebts = new Set<string>();
  for (const e of events) {
    const o = core?.occurrences.find(x => x.event_id === e.id);
    if (!o) { if (e.included && e.date < today.slice(0, 7)) missing.push(`${e.label}：日期已过，待核对。`); continue; }
    if (o.status === 'cancelled') continue;
    if (o.actual_date > today) missing.push(`${e.label}：实际日期不能晚于今天。`);
    if (!o.payments.length) missing.push(`${e.label}：实际付款分项待补充。`);
    for (const p of o.payments) {
      const rule = core?.fund_rules.find(x => x.account_id === p.account_id);
      if (p.amount_cents === null || !p.account_id || rule?.availability !== 'available' || rule.share_hundredths !== 10000) missing.push(`${e.label}：付款金额／来源范围待核对。`);
      if (p.date <= snapshot.date && (p.absorbed_snapshot_id !== snapshot.id || p.absorbed_revision !== snapshot.revision)) missing.push(`${e.label}：付款被哪份盘点吸收待核对。`);
      if (p.date > snapshot.date && p.absorbed_snapshot_id) missing.push(`${e.label}：起点之后的付款不能标已吸收。`);
    }
    const paid = o.payments.reduce((s, p) => s + BigInt(p.amount_cents ?? '0'), 0n);
    if (!o.payments_complete || paid < 0n) missing.push(`${e.label}：仅部分付款已核对，剩余安排待补充。`);
    if (Number(e.price_cents) > Number(e.down_cents) || o.loan !== null) {
      const l = o.loan;
      if (!l || l.as_of !== snapshot.date) missing.push(`${e.label}：截至资金起点的余债／剩余期待核对。`);
      else {
        const entry = snapshot.entries.find(x => x.account_id === l.account_id && x.side === 'liability' && x.counted);
        if (!entry || entry.amount_cents !== l.principal_cents) missing.push(`${e.label}：余债与盘点负债不一致。`);
        else { if (coveredDebts.has(l.account_id)) missing.push(`${e.label}：同一余债重复接续。`); coveredDebts.add(l.account_id); }
      }
    }
  }
  const debts = snapshot.entries.filter(e => e.counted && e.side === 'liability' && Number(e.amount_cents) > 0 && !coveredDebts.has(e.account_id)).length;
  if (debts) missing.push(`${debts} 个负债账户尚未建立还款接续，请在已发生的大额计划中核对。`);
  return missing;
}
