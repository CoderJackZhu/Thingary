import type { PredictionValue } from "../../plan.ts";
import {
  project,
  outcome,
  required,
  scaleSpend,
  scaleSaving,
  timeLabel,
} from "../../plan-ledger.ts";
/** Input variations only. Every trajectory, threshold and verdict comes from the shared engine. */
export function budgetComparisons(pred: PredictionValue, year: number) {
  return [
    { label: "停止追加存钱", plan: scaleSaving(pred.plan, 0) },
    { label: "较少预算（−10%）", plan: scaleSpend(pred.plan, 0.9) },
    { label: "完整预算（当前设置）", plan: pred.plan },
    { label: "更宽裕预算（+10%）", plan: scaleSpend(pred.plan, 1.1) },
  ].map(({ label, plan }) => {
    const projection = project(plan, year),
      result = outcome(plan, projection),
      stop = projection.retire_month;
    return {
      label,
      stop: stop === null ? null : timeLabel(plan, stop),
      required: required(plan, stop ?? plan.target_months),
      success: result.success,
    };
  });
}
