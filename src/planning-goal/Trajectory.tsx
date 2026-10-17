import { useMemo } from 'react';
import { forecastMoney } from '../plan-format';
import { timeLabel } from '../plan-ledger';
import type { Outcome, Plan, Projection } from '../plan-ledger';
import { snapshotRows, trajectory, verdict } from '../plan-view';
import { TrajectoryChart } from '../RetireCharts';
import { useValueMode, valueModeLabel } from '../RetireOverview';

export type GoalTrajectoryInput = { plan: Plan; projection: Projection; outcome: Outcome; assets: number };

/** 目标页的单一主资产轨迹：复用测算详情的轨迹图表与展示模型，不新增计算。
 *  逐年快照、压力测试与市场模拟仍只在测算详情。 */
export function GoalTrajectory({ calc }: { calc: GoalTrajectoryInput | null }) {
  const [mode] = useValueMode();
  const points = useMemo(() => calc ? trajectory(calc.plan, calc.projection, mode) : [], [calc, mode]);
  const rows = useMemo(() => calc ? snapshotRows(calc.plan, calc.projection, mode) : [], [calc, mode]);
  if (!calc || points.length < 2) return <article className="ui-card ui-content goal-chart" aria-label="资产轨迹">
    <div className="goal-chart-head"><h3>资产轨迹</h3><span className="muted small">按已保存条件推演</span></div>
    <p className="muted small">填好每月能存的钱后，这里显示资产轨迹。逐年表、压力测试与市场模拟在「测算详情」。</p>
  </article>;
  const tone = verdict(calc.plan, calc.projection, calc.outcome, calc.assets, mode, forecastMoney).tone;
  return <article className="ui-card ui-content goal-chart" aria-label="资产轨迹">
    <div className="goal-chart-head"><h3>资产轨迹</h3><span className="muted small">预测 · {points[0].label} → {timeLabel(calc.plan, calc.plan.horizon_months - 1)}</span></div>
    <TrajectoryChart points={points} rows={rows} goalMonth={calc.plan.target_months} timeLabel={m => timeLabel(calc.plan, m)} fiMonth={calc.projection.fi_month} retireMonth={calc.projection.retire_month} tone={tone} fmt={forecastMoney} valueLabel={valueModeLabel[mode]}/>
    <p className="muted small">{valueModeLabel[mode]}；逐年快照、压力测试与市场模拟在「测算详情」。</p>
  </article>;
}
