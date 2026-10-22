import { convertCurrency, currencyCode } from '../../currency.ts';
import { holdingFact } from '../../holdings.ts';
import { dayLabel } from '../format.ts';
import { applyClosing, previewTotals, quickAvailable, snapshotEntryInput } from '../../wealth.ts';
import type { Account, CheckInRow, Draft, SnapshotSave } from '../../wealth.ts';
import { t } from '../../i18n.ts';
/** New inventories start empty. Corrections keep every historical fact, including unchanged rows. */
export function inventoryRows(draft: Draft): Record<string, CheckInRow> {
  return Object.fromEntries(draft.rows.map(({ account }) => {
    const e = draft.existing?.entries.find(e => e.account_id === account.id);
    return [account.id, e ? { ...e, cents: e.amount_cents ?? '' } : { state: null, cents: '' }];
  }));
}
export function enteredRow(account: Account, amount: string, quantity: string, price: string, rate: string): CheckInRow {
  const currency = currencyCode(account.fields.currency);
  let fact;
  try {
    fact = account.fields.holding_mode ? holdingFact(currency, quantity, price, rate)
      : amount === '' ? { amount_cents: null } : currency === 'CNY' ? { amount_cents: amount }
      : { amount_cents: convertCurrency(currency, amount, rate), original_minor: amount, fx_rate_micro: rate };
    if (fact.amount_cents != null && (!/^\d+$/.test(fact.amount_cents) || BigInt(fact.amount_cents) > 99999999999n)) throw Error(t('金额超出范围。'));
  } catch { fact = { amount_cents: null }; }
  return { ...fact, state: fact.amount_cents == null ? null : 'entered', cents: fact.amount_cents ?? '', edited: true,
    ...(account.fields.holding_mode ? { quantity_e8: quantity || null, unit_price_e6: price || null } : currency !== 'CNY' ? { original_minor: amount || null, fx_rate_micro: rate || null } : {}) };
}
const none: ReadonlySet<string> = new Set();
export function inventoryTotals(draft: Draft, rows: Record<string, CheckInRow>, closing: ReadonlySet<string> = none) {
  return previewTotals(draft.rows.filter(({ account }) => !closing.has(account.id)).map(({ account }) => {
    const historical = draft.existing?.entries.find(e => e.account_id === account.id), row = rows[account.id];
    return { side: historical?.side ?? account.fields.side, counted: historical?.counted ?? account.fields.counted,
      cents: row?.state && row.state !== 'missing' && row.cents !== '' ? row.cents : null };
  }));
}
/** Only compare filled rows with the same historical scope; never replace unknown baselines by zero. */
export function inventoryDelta(draft: Draft, rows: Record<string, CheckInRow>, closing: ReadonlySet<string> = none): string | null {
  let delta = 0n, filled = 0;
  for (const { account, previous } of draft.rows) {
    if (closing.has(account.id)) continue;
    const row = rows[account.id];
    if (!row?.state || row.state === 'missing' || row.cents === '') continue;
    filled++;
    const baseline = draft.existing?.entries.find(e => e.account_id === account.id) ?? previous;
    if (baseline?.amount_cents == null) return null;
    const historical = draft.existing?.entries.find(e => e.account_id === account.id);
    if (historical?.counted ?? account.fields.counted) delta += (BigInt(row.cents) - BigInt(baseline.amount_cents)) * ((historical?.side ?? account.fields.side) === 'asset' ? 1n : -1n);
  }
  return filled ? delta.toString() : null;
}
/** `closing` rows are closed at the check-in date and carry no amount; a row marked 这次跳过 is saved as unknown. */
export function inventoryInput(draft: Draft, rows: Record<string, CheckInRow>, notes: string, requestId: string, closing: ReadonlySet<string> = none): SnapshotSave {
  const open = draft.rows.filter(({ account }) => !closing.has(account.id));
  if (!draft.rows.length) throw Error(t('这一天没有需要盘点的账户。'));
  const skipped = open.filter(({ account }) => rows[account.id]?.state === 'missing').length;
  if (inventoryTotals(draft, rows, closing).missing > skipped) throw Error(t('请填齐所有账户，零余额填 0；已注销的账户可标为已注销，不用填。'));
  if ([...notes].length > 10000 || notes.includes('\0')) throw Error(t('备注最多 10000 字，不能含空字符。'));
  const input: SnapshotSave = { request_id: requestId, generation: draft.generation, id: draft.existing?.id ?? null, expected_revision: draft.existing?.revision ?? null,
    date: draft.date, notes, entries: open.map(({ account }) => snapshotEntryInput(account.id, rows[account.id])) };
  return applyClosing(input, draft.rows.map(r => r.account), closing);
}

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
/** The day after `day` (YYYY-MM-DD). */
export function nextDay(day: string): string { return new Date(dayMs(day) + 86400000).toISOString().slice(0, 10); }
/**
 * Dates on which an account can be stopped from its detail page: after it opened and after its latest check-in
 * (the backend rejects a stop date at or before a recorded balance), and not after today. `ok` is false when no such day exists.
 */
export function stopDateRange(account: Pick<Account, 'fields' | 'latest'>, today: string): { min: string; max: string; ok: boolean } {
  const last = [account.fields.opened_on, account.latest?.date ?? ''].sort().at(-1)!;
  const min = nextDay(last);
  return { min, max: today, ok: min <= today };
}
/** Account fields for the save that stops (`date`) or re-enables (`null`) an account; the other fields are kept as they are. */
export function closeFields(fields: Account['fields'], date: string | null): Account['fields'] {
  const next = { ...fields, closed_on: date };
  if (next.currency === 'CNY') delete next.currency;
  if (!next.holding_mode) { delete next.holding_mode; delete next.holding_unit; }
  if (next.holding_unit == null) delete next.holding_unit;
  return next;
}
/** Why 更新余额 is unavailable, or '' when it is available. Mirrors {@link quickAvailable}. */
export function quickBlockedReason(account: Account, points: { date: string }[], today: string): string {
  if (quickAvailable(account, points, today)) return '';
  return account.fields.closed_on
    ? t('这个账户已在 {closed_on} 停用，不能再更新余额；历史金额请到盘点记录更正。', { closed_on: account.fields.closed_on })
    : t('最近一次盘点之后还没有可更新的日期；历史金额请到盘点记录更正。');
}

/** Notice shown on the wealth page after a full check-in is saved. */
export const savedText = (date: string, today: string): string => t('已保存 {v1} 的盘点', { v1: dayLabel(date, today) });
