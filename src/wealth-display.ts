import type { Account, CompareRow } from './wealth.ts';
export type AccountView = 'active' | 'closed' | 'all';
export const accountVisible = (a: Account, view: AccountView) => view === 'all' || (view === 'closed') === !!a.fields.closed_on;
/** Historical changes must retain closed accounts with money, unknown entries or a scope change. */
export function changeVisible(row: CompareRow, accounts: Account[], view: AccountView): boolean {
  const closed = !!accounts.find(a => a.id === row.account_id)?.fields.closed_on;
  if (view === 'all') return true;
  if (view === 'closed') return closed;
  return !closed || row.group === 'scope_changed' || row.effect_cents === null || row.change_cents === null || row.change_cents !== '0' || [row.from, row.to].some(c => c.amount_cents !== null && c.amount_cents !== '0');
}

/** Fixed asset valuation only: never contributes purchase cost to totals. */
export function fixedAssetChange(purchaseCents: string | null | undefined, latestCents: string | null | undefined): { change_cents: string; rate_hundredths: number | null } | null {
  if (purchaseCents == null || latestCents == null) return null;
  const purchase = BigInt(purchaseCents), change = BigInt(latestCents) - purchase;
  const magnitude = change < 0n ? -change : change;
  const rounded = purchase === 0n ? null : Number((magnitude * 10000n + purchase / 2n) / purchase) * (change < 0n ? -1 : 1);
  return { change_cents: change.toString(), rate_hundredths: rounded };
}
