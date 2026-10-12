import type { FundRule } from './plan-core.ts';
import type { Account, Snapshot } from './wealth.ts';

const investmentKinds = new Set(['investment', 'mixed', 'fund', 'bond']);

/** Draft suggestion only. Saved choices and the calculation's confirmation gate take precedence. */
export const suggestedFundAvailability = (kind: string): FundRule['availability'] =>
  kind === 'cash' || investmentKinds.has(kind) ? 'available' : 'restricted';

export function fundScopeSummary(snapshot: Snapshot | null, rules: FundRule[], accounts: Account[]) {
  const totals: Record<string, bigint | null> = { cash: 0n, investment: 0n, other: 0n };
  const unavailable: string[] = [];
  for (const entry of snapshot?.entries ?? []) {
    if (!entry.counted || entry.side !== 'asset') continue;
    const rule = rules.find(r => r.account_id === entry.account_id);
    const name = accounts.find(a => a.id === entry.account_id)?.fields.name ?? '历史账户';
    if (!rule || rule.availability !== 'available' || rule.share_hundredths === 0) {
      unavailable.push(`${name}（${!rule ? '用途待确认' : rule.availability === 'restricted' ? '暂不能动用' : '不参与'}）`);
      continue;
    }
    const group = entry.kind === 'cash' ? 'cash' : investmentKinds.has(entry.kind) ? 'investment' : 'other';
    if (entry.amount_cents === null) totals[group] = null;
    else if (totals[group] !== null) totals[group] += BigInt(entry.amount_cents) * BigInt(rule.share_hundredths) / 10000n;
  }
  return { totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value?.toString() ?? null])) as Record<'cash' | 'investment' | 'other', string | null>, unavailable };
}
