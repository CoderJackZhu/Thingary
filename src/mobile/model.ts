import { comparisonText, holdingQuickChange, quickAvailable, quickChanges } from '../wealth.ts';
import type { Account, Draft, Point, QuickChange, QuickUpdate, Summary } from '../wealth.ts';

/** Projection only: all saved totals and comparisons come from wealth_summary. */
export function homeView(summary: Summary) {
  const latest = summary.points.at(-1);
  const complete = [...summary.points].reverse().find(point => point.complete);
  const shown = complete ?? latest;
  return { latest, shown, change: complete?.scope_changed ? '不可比' : comparisonText(complete?.change_cents, complete?.compared_to), comparedTo: complete?.compared_to ?? null };
}

export type BalanceInput = { amount: string; quantity: string; price: string; rate: string };
export const emptyBalance = (): BalanceInput => ({ amount: '', quantity: '', price: '', rate: '' });
export function availableAccounts(accounts: Account[], points: Point[], draft: Draft, today: string): Account[] {
  return accounts.filter(account => quickAvailable(account, points, today)
    && account.fields.opened_on <= draft.date && (!account.fields.closed_on || draft.date < account.fields.closed_on)
    && draft.rows.some(row => row.account.id === account.id));
}
/** Never convert empty or invalid input to zero. Use the desktop fact builders. */
export function balanceChange(draft: Draft, account: Account, input: BalanceInput): QuickChange {
  if (account.fields.holding_mode) return holdingQuickChange(draft, account.id, 'replace', input.quantity, input.price, input.rate);
  return quickChanges(draft, account.id, 'balance', input.amount, '', '', input.rate)[0];
}

/** Validate the whole visible batch before sending its first single-account request. */
export function balanceRequests(draft: Draft, accounts: Account[], values: Record<string, BalanceInput>, requestId: () => string): QuickUpdate[] {
  return accounts.filter(account => values[account.id] !== undefined).map(account => ({
    request_id: requestId(), generation: draft.generation, date: draft.date, note: '',
    changes: [balanceChange(draft, account, values[account.id])],
  }));
}
/** Each success is settled before the next send; rejection always stops the batch. */
export async function saveInOrder(requests: QuickUpdate[], send: (input: QuickUpdate) => Promise<unknown>, onSaved: (id: string) => void): Promise<void> {
  for (const request of requests) {
    await send(request);
    onSaved(request.changes[0].account_id);
  }
}
