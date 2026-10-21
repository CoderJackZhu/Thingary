import type { HouseholdV1 } from '../plan-simplified-contract.ts';
import { householdLines } from './household-view';

/** The couple's extra result lines (at most two). Renders nothing for one person. */
export function HouseholdLines({ household, summary, myStopMonth }: { household: HouseholdV1 | null | undefined; summary?: { both_stop_month: string | null; same_time_stop_month: string | null }; myStopMonth: string | null }) {
  const lines = householdLines(household, summary, myStopMonth);
  return lines.length ? <div className="goal-household" aria-label="两人的结果">{lines.map(line => <p className="muted small" key={line}>{line}</p>)}</div> : null;
}
