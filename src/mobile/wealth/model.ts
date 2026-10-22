import { convertCurrency, currencyCode } from '../../currency.ts';
import { holdingFact } from '../../holdings.ts';
import { applyClosing, previewTotals, snapshotEntryInput } from '../../wealth.ts';
import type { Account, CheckInRow, Draft, SnapshotSave } from '../../wealth.ts';

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
    if (fact.amount_cents != null && (!/^\d+$/.test(fact.amount_cents) || BigInt(fact.amount_cents) > 99999999999n)) throw Error('金额超出范围。');
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
  if (!draft.rows.length) throw Error('这一天没有需要盘点的账户。');
  const skipped = open.filter(({ account }) => rows[account.id]?.state === 'missing').length;
  if (inventoryTotals(draft, rows, closing).missing > skipped) throw Error('请填齐所有账户，零余额填 0；已注销的账户可标为已注销，不用填。');
  if ([...notes].length > 10000 || notes.includes('\0')) throw Error('备注最多 10000 字，不能含空字符。');
  const input: SnapshotSave = { request_id: requestId, generation: draft.generation, id: draft.existing?.id ?? null, expected_revision: draft.existing?.revision ?? null,
    date: draft.date, notes, entries: open.map(({ account }) => snapshotEntryInput(account.id, rows[account.id])) };
  return applyClosing(input, draft.rows.map(r => r.account), closing);
}
