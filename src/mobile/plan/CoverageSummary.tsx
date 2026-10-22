import { useState } from "react";
import type { PlanningAnnotation } from "../../plan-basic-contract";
import { useNav } from "../nav-context";
import { Icon } from "../ui";
import { coverageGroups } from "./coverage-model";
import type { CoverageTarget } from "./coverage-model";
import "./plan.css";

/** Open the page where a calculation condition is edited. */
export function useOpenTarget() {
  const nav = useNav();
  return (t: CoverageTarget) =>
    t.route === "plan.setup"
      ? nav.push("plan.setup", { section: t.section })
      : nav.push(t.route);
}

/**
 * Calculation coverage on the phone: one line per effect direction with a count, details folded away,
 * identical messages merged. Same grouping as desktop's CoverageNote; nothing is saved here.
 */
export function CoverageSummary({
  annotations,
}: {
  annotations?: readonly PlanningAnnotation[];
}) {
  const open = useOpenTarget(),
    [shown, setShown] = useState<string | null>(null),
    groups = coverageGroups(annotations);
  if (!groups.length) return null;
  return (
    <div className="mp-coverage" role="note" aria-label="计算条件与确认依据">
      {groups.map((g) => {
        const expanded = shown === g.effect;
        return (
          <div className="mp-coverage-group" key={g.effect}>
            <div className="mp-coverage-head">
              <button
                type="button"
                className="mp-coverage-line"
                aria-expanded={expanded}
                onClick={() => setShown(expanded ? null : g.effect)}
              >
                <span>{g.line}</span>
                <Icon name={expanded ? "chevronUp" : "chevronDown"} size={18} />
              </button>
              {g.target && (
                <button
                  type="button"
                  className="mp-coverage-go"
                  onClick={() => open(g.target!)}
                >
                  去核对
                </button>
              )}
            </div>
            {expanded && (
              <ul className="mp-coverage-items">
                {g.items.map((item) => (
                  <li key={item.key}>
                    <span>
                      {item.message}
                      {item.count > 1 ? `（共 ${item.count} 项）` : ""}
                    </span>
                    {item.fields.length > 0 && (
                      <small>还差：{item.fields.join("、")}</small>
                    )}
                    {!g.target && item.target && (
                      <button
                        type="button"
                        className="mp-coverage-go"
                        onClick={() => open(item.target!)}
                      >
                        去核对
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
