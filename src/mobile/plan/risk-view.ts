import type { Matrix, StressResult, SorrPath, Bands } from "../../plan-risk.ts";

/** A compact view of the engine matrix: keep the current setting and its nearest alternatives. */
export function compactMatrix(matrix: Matrix): Matrix {
  const indices = (length: number, base: number | null) => {
    const start = Math.max(
      0,
      Math.min(length - 3, (base ?? Math.floor(length / 2)) - 1),
    );
    return Array.from({ length: Math.min(3, length) }, (_, i) => start + i);
  };
  const rows = indices(matrix.rows.length, matrix.base_row),
    cols = indices(matrix.cols.length, matrix.base_col);
  return {
    ...matrix,
    rows: rows.map((i) => matrix.rows[i]),
    cols: cols.map((i) => matrix.cols[i]),
    column_labels: matrix.column_labels
      ? cols.map((i) => matrix.column_labels![i])
      : undefined,
    cells: rows.map((i) => cols.map((j) => matrix.cells[i][j])),
    base_row: matrix.base_row === null ? null : rows.indexOf(matrix.base_row),
    base_col: matrix.base_col === null ? null : cols.indexOf(matrix.base_col),
  };
}

export function riskMoney(cents: number): string {
  return (cents / 100).toLocaleString("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  });
}

export function stressConclusion(top: StressResult | null): string {
  if (!top) return "这些压力测试未实质性改变基础计划。";
  return `${top.label}的影响最大：${top.shortfall_delta > 0 ? `目标缺口增加 ${riskMoney(top.shortfall_delta)}` : "目标缺口未增加"}${top.fi_delay_months !== null && top.fi_delay_months > 0 ? `，准备就绪推迟 ${top.fi_delay_months} 个月` : ""}${top.stressed.failure_month !== null ? "，规划期内存在无法支付的月份" : ""}。`;
}

export function sequenceConclusion(paths: SorrPath[] | null): string {
  if (!paths)
    return "需要规划期内已开始退休，且退休开始时有可用投资资金，才能比较收益顺序。";
  const early = paths.find((p) => p.id === "early"),
    late = paths.find((p) => p.id === "late");
  if (!early || !late) return "本次收益顺序结果不完整。";
  const difference = early.final - late.final;
  return `同一次下跌放在开头，期末剩余 ${riskMoney(early.final)}；放在末段，剩余 ${riskMoney(late.final)}。${Math.abs(difference) < 1 ? "两者期末结果相同。" : difference < 0 ? "开头下跌的期末资金更少。" : "末段下跌的期末资金更少。"}`;
}

/** All lines share an axis; SVG paths only project already computed results. */
export function riskPlot(series: number[][], width = 300, height = 128) {
  const values = series.flat().filter(Number.isFinite);
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = Math.max(1, max - min);
  return series.map((values) =>
    values
      .map(
        (value, i) =>
          `${i ? "L" : "M"}${(8 + (i / Math.max(1, values.length - 1)) * (width - 16)).toFixed(2)},${(height - 8 - ((value - min) / span) * (height - 16)).toFixed(2)}`,
      )
      .join(" "),
  );
}

export function fanPlot(bands: Bands) {
  const [lower, middle, upper] = riskPlot([bands.p10, bands.p50, bands.p90]);
  const lowerPoints = lower.replace(/^M/, "").split(" L").reverse();
  return { middle, area: `${upper} L${lowerPoints.join(" L")} Z` };
}
