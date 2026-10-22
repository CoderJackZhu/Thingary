import type { PredictionValue } from "../../plan.ts";
import {
  project,
  outcome,
  required,
  scaleSpend,
  scaleSaving,
  timeLabel,
} from "../../plan-ledger.ts";
import { trajectory } from "../../plan-view.ts";
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

/** Projected funds against the funds needed to stop now: the data behind both the goal preview and 测算详情. */
export function fundsChart(pred: PredictionValue, mode: "today" | "nominal" = "today") {
  const points = trajectory(pred.plan, pred.projection, mode),
    retire = pred.projection.retire_month,
    at = retire === null ? -1 : points.findIndex((p) => p.month >= retire);
  return {
    points,
    chart: {
      labels: points.map((p) => p.label),
      xs: points.map((p) => p.month),
      series: [
        { name: "预计资金", values: points.map((p) => p.projected) },
        { name: "所需资金", values: points.map((p) => p.required), color: "var(--muted)", dashed: true, area: false },
      ],
      marker: at < 0 ? undefined : { at, label: "预计停工" },
      shade:
        pred.projection.failure_month === null
          ? undefined
          : { from: pred.projection.failure_month, to: pred.plan.horizon_months, label: "资金耗尽" },
    },
  };
}
