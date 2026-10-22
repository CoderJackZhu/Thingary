import type { Account, Snapshot } from "../../wealth.ts";
import type { PlanningCore } from "../../plan-core.ts";
import type { StoredLifeEvent } from "../../plan.ts";
import { debtReview } from "../../plan-debt.ts";

export type DebtSummary = {
  /** Loan accounts in the latest complete snapshot that the plan has to deal with. */
  count: number;
  /** Accounts that still need an answer on how they are repaid. */
  pending: number;
  /** Balance changed a lot since the arrangement was saved. */
  changed: number;
  text: string;
};

/** The one-line state shown where loans can be revisited. Null when there are no loans to arrange. */
export function debtSummary(
  snapshot: Snapshot | null,
  core: PlanningCore | null | undefined,
  events: readonly StoredLifeEvent[],
  accounts: readonly Account[] = [],
): DebtSummary | null {
  if (!snapshot) return null;
  const rows = debtReview(
    snapshot,
    core,
    events,
    undefined,
    undefined,
    accounts,
  ).rows;
  if (!rows.length) return null;
  const pending = rows.filter((r) => r.pending.length).length,
    changed = rows.filter((r) => r.changed && !r.linked).length;
  return {
    count: rows.length,
    pending,
    changed,
    text: `已有贷款 ${rows.length} 笔 · ${
      pending
        ? "还款待确认"
        : changed
          ? `${changed} 笔余额变了，请复核`
          : "还款已确认"
    }`,
  };
}
