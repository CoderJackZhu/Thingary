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
import { t } from '../../i18n.ts';
/** Input variations only. Every trajectory, threshold and verdict comes from the shared engine. */
export function budgetComparisons(pred: PredictionValue, year: number) {
  return [
    { label: t('停止追加存钱'), plan: scaleSaving(pred.plan, 0) },
    { label: t('较少预算（−10%）'), plan: scaleSpend(pred.plan, 0.9) },
    { label: t('完整预算（当前设置）'), plan: pred.plan },
    { label: t('更宽裕预算（+10%）'), plan: scaleSpend(pred.plan, 1.1) },
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
      marker: at < 0 ? undefined : { at, label: t('预计停工') },
      shade:
        pred.projection.failure_month === null
          ? undefined
          : { from: pred.projection.failure_month, to: pred.plan.horizon_months, label: t('资金耗尽') },
    },
  };
}

/** Move the 查看月份 selection by `delta` months, staying inside [min, max]. */
export const stepMonth = (selected: number, delta: number, min: number, max: number): number => Math.min(max, Math.max(min, selected + delta));

/** Fields of one 逐年表 row as a compact card: head line (period · age), the two headline numbers, and the rest behind a tap. */
export function yearCard(row: { period: string | null; year: number; age: number | null; marks: string[]; end: number; unfunded: number; contribution: number; income: number; unlock: number; spend: number; oneoff: number }) {
  const title = `${row.period ?? row.year}${row.marks.length ? ` · ${row.marks.join("/")}` : ""}`;
  return {
    title,
    age: row.age === null ? "" : `${row.age}岁`,
    end: row.end,
    unfunded: row.unfunded,
    hasGap: row.unfunded > 0,
    details: [
      { label: t('存入'), value: row.contribution },
      { label: t('收入与解锁'), value: row.income + row.unlock },
      { label: t('支出（含大额）'), value: row.spend + row.oneoff },
    ],
  };
}
