// Grouping of calculation annotations for the phone: one line per effect direction (the same text as desktop's
// CoverageNote), details merged by message so eight identical cost warnings read as one entry with a count.
import type { PlanningAnnotation } from "../../plan-basic-contract.ts";
import {
  affectingAnnotations,
  annotationDirection,
  annotationSummary,
} from "../../plan-annotations.ts";

/** Where 去核对 / 去处理 leads: a step of the setup flow, or the 大额支出 page. */
export type CoverageTarget =
  | { route: "plan.setup"; section: string }
  | { route: "plan.events" };
export type CoverageItem = {
  key: string;
  message: string;
  count: number;
  fields: string[];
  direction: string;
  target: CoverageTarget | null;
};
export type CoverageGroup = {
  effect: "requirement_lower" | "requirement_higher" | "uncertain";
  line: string;
  count: number;
  items: CoverageItem[];
  /** Set only when every actionable item leads to the same place. */
  target: CoverageTarget | null;
};

export const targetKey = (t: CoverageTarget | null) =>
  t === null ? "" : t.route === "plan.setup" ? `setup:${t.section}` : t.route;

/** The mobile counterpart of desktop's annotationAction. Null when nothing can be edited for it. */
export function annotationTarget(a: PlanningAnnotation): CoverageTarget | null {
  if (a.actionable === false || a.reason_code === "POOL_NOT_USED") return null;
  const { owner, field = "", event_id } = a.refinement;
  const setup = (section: string): CoverageTarget => ({ route: "plan.setup", section });
  if (event_id) return { route: "plan.events" };
  if (a.reason_code.startsWith("COST_")) return setup("costs");
  if (a.reason_code.startsWith("DEBT_")) return { route: "plan.events" };
  if (field.startsWith("future_incomes.")) return setup("income");
  if (field.startsWith("household.partner.monthly_cents")) return setup("contribution");
  if (field.startsWith("household.")) return setup("time");
  if (owner === "budget" && a.reason_code === "TIME_PENDING") return { route: "plan.events" };
  if (owner === "budget") return setup("costs");
  if (owner === "events") return { route: "plan.events" };
  if (owner === "funds") return field.startsWith("core.debt_repayments") ? { route: "plan.events" } : setup("funds");
  return null;
}

const EFFECTS = ["requirement_lower", "requirement_higher", "uncertain"] as const;

/** Merge annotations that say the same thing; the count is how many sources share the message. */
export function coverageItems(rows: readonly PlanningAnnotation[]): CoverageItem[] {
  const byMessage = new Map<string, PlanningAnnotation[]>();
  for (const a of rows) byMessage.set(a.message, [...(byMessage.get(a.message) ?? []), a]);
  return [...byMessage].map(([message, list]) => ({
    key: message,
    message,
    count: list.length,
    fields: [...new Set(list.flatMap((a) => a.missing_fields))],
    direction: annotationDirection(list[0]),
    target: list.map(annotationTarget).find((t) => t !== null) ?? null,
  }));
}

export function coverageGroups(annotations: readonly PlanningAnnotation[] = []): CoverageGroup[] {
  const rows = affectingAnnotations(annotations);
  return EFFECTS.flatMap((effect) => {
    const group = rows.filter((a) => a.effect === effect || (effect === "uncertain" && a.effect === "none"));
    const line = annotationSummary(group)[0];
    if (!group.length || !line) return [];
    const items = coverageItems(group),
      targets = items.map((i) => i.target).filter((t) => t !== null),
      same = new Set(targets.map(targetKey)).size === 1;
    return [{ effect, line, count: group.length, items, target: same ? targets[0] : null }];
  });
}
