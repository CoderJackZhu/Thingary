import type { Account, CompareRow } from './wealth.ts';
import { currencyDecimals } from './currency.ts';
import { t } from './i18n.ts';
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

export type GroupTotal = { id: string; name: string; assets_cents: string; liabilities_cents: string; net_cents: string; share_hundredths: number | null; partial: boolean; known: number; accounts: Account[] };
/** One check-in's historical money facts; current grouping only changes display attribution.
 * A missing account ID is kept in the ungrouped bucket, never silently omitted. */
export function accountGroupTotals(accounts: Account[], groups: import('./account-groups').AccountGroup[], entries: import('./wealth').Entry[], markUncovered = false): GroupTotal[] {
  const ordered = [...groups].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const rows = [...ordered.map(g => ({ id: g.id, name: g.name })), { id: '', name: t('未分组') }].map(g => ({ ...g, assets: 0n, liabilities: 0n, partial: false, known: 0, accounts: [] as Account[] }));
  const byGroup = new Map(rows.map(r => [r.id, r]));
  const byAccount = new Map(accounts.map(a => [a.id, a]));
  const bucket = (a: Account | undefined) => byGroup.get(a?.fields.group_id ?? '') ?? byGroup.get('')!;
  for (const account of accounts) { const row = bucket(account); row.accounts.push(account); if (markUncovered && !entries.some(e => e.account_id === account.id)) row.partial = true; }
  for (const entry of entries) {
    const row = bucket(byAccount.get(entry.account_id));
    if (entry.amount_cents === null) { row.partial = true; continue; }
    row.known++;
    if (!entry.counted) continue;
    if (entry.side === 'asset') row.assets += BigInt(entry.amount_cents); else row.liabilities += BigInt(entry.amount_cents);
  }
  const total = rows.reduce((sum, r) => sum + r.assets, 0n);
  return rows.map(r => ({ id: r.id, name: r.name, accounts: r.accounts, partial: r.partial, known: r.known, assets_cents: String(r.assets), liabilities_cents: String(r.liabilities), net_cents: String(r.assets-r.liabilities), share_hundredths: total > 0n && !(r.partial && r.known === 0) ? Number((r.assets*10000n+total/2n)/total) : null }));
}

/** Present one snapshot's facts consistently; a missing fact never falls back to an older amount. */
export function accountBalanceView(account: Account, date?: string | null, entries?: import('./wealth').Entry[]) {
  const entry = date && entries ? entries.find(row => row.account_id === account.id) : undefined;
  if (entry) {
    if (entry.amount_cents === null || entry.state === 'missing') return { fact: { ...entry, amount_cents: null }, date: date!, state: 'unknown' as const, label: t('这次金额待填写') };
    return { fact: entry, date: date!, state: entry.state === 'unchanged' ? 'carried' as const : 'entered' as const,
      label: entry.state === 'unchanged' ? t('沿用旧金额 · {v1}', { v1: account.last_entered_on ? t('最近填写 {last_entered_on}', { last_entered_on: account.last_entered_on }) : t('原填写日期待核对') }) : t('这次填写') };
  }
  return { fact: account.latest, date: account.latest?.date, state: account.latest ? 'other' as const : 'unknown' as const,
    label: account.latest ? date && entries ? t('其他日期记录 · 未列入这次小计') : t('最近已知记录') : ['property', 'vehicle'].includes(account.fields.kind) ? t('尚未估值') : t('尚未填写金额') };
}

/** Stable endpoints from a saved complete snapshot; never substitute a different period. */
export function balanceComparison(points: import('./wealth').Point[], snapshotId?: string) {
  const end = snapshotId ? points.find(point => point.snapshot_id === snapshotId) : [...points].reverse().find(point => point.complete);
  if (!end?.complete || !end.compared_to) return null;
  const start = points.find(point => point.complete && point.date === end.compared_to);
  return start ? { fromSnapshotId: start.snapshot_id, toSnapshotId: end.snapshot_id } : null;
}

/**
 * A foreign account's change split into its own movement (original amount change at the starting rate) and the exchange rate
 * (the end amount times the rate difference). Both are in the direction of the net-worth effect and add up to it. Null unless both ends carry an original amount and a rate.
 */
export function fxSplit(row: Pick<CompareRow, 'side' | 'currency' | 'from' | 'to' | 'change_cents'>): { own_cents: string; fx_cents: string } | null {
  const { from, to } = row;
  if (!row.currency || row.currency === 'CNY' || row.change_cents === null || from.original_minor == null || to.original_minor == null || !from.fx_rate_micro || !to.fx_rate_micro) return null;
  const scale = 10n ** BigInt(2 - currencyDecimals(row.currency));
  const num = BigInt(to.original_minor) * scale * (BigInt(to.fx_rate_micro) - BigInt(from.fx_rate_micro));
  const fx = (num < 0n ? -((-num + 500000n) / 1000000n) : (num + 500000n) / 1000000n);
  const sign = row.side === 'liability' ? -1n : 1n;
  return { own_cents: (sign * (BigInt(row.change_cents) - fx)).toString(), fx_cents: (sign * fx).toString() };
}
