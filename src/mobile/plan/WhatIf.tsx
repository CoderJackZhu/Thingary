import { useEffect, useMemo, useRef, useState } from "react";
import type { Plan } from "../../plan-ledger.ts";
import { timeLabel } from "../../plan-ledger.ts";
import {
  contributionReturnMatrix,
  targetSpendingMatrix,
  largestRisk,
  monteCarlo,
  sensitivityParameters,
  sorr,
  stressTests,
} from "../../plan-risk.ts";
import type { Matrix, MonteCarlo } from "../../plan-risk.ts";
import { rateText } from "../../plan.ts";
import { usePlan } from "./data";
import { useNav } from "../nav-context";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormGroup,
  HBarChart,
  LineChart,
  Loading,
  NavBar,
  Notice,
  Section,
  SelectField,
  UnknownState,
} from "../ui";
import {
  compactMatrix,
  fanChart,
  riskMoney,
  sequenceChart,
  sequenceConclusion,
  stressConclusion,
} from "./risk-view.ts";
import { CoverageSummary } from "./CoverageSummary";
import "./risk.css";
import { t, numberLocale } from '../../i18n.ts';
export default function WhatIf() {
  const { capabilities, loading, error, reload, today } = usePlan();
  const nav = useNav();
  const prediction = capabilities?.prediction;
  return (
    <div className="m-page mp-risk">
      <NavBar title={t('假设分析')} />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !prediction ? (
        <EmptyState
          icon="chart"
          title={t('先设置规划条件')}
          action={
            <Button onClick={() => nav.push("plan.setup")}>{t('设置条件')}</Button>
          }
        />
      ) : prediction.status !== "ready" ? (
        <UnknownState
          title={t('条件尚不完整')}
          message={prediction.missing.map((item) => item.message).join("；")}
          action={
            <Button onClick={() => nav.push("plan.setup")}>{t('补充条件')}</Button>
          }
        />
      ) : (
        <RiskAnalysis plan={prediction.value.plan} today={today} />
      )}
    </div>
  );
}

function RiskAnalysis({ plan, today }: { plan: Plan; today: string }) {
  const year = Number(today.slice(0, 4));
  const stress = useMemo(() => stressTests(plan, year), [plan, year]);
  const showShortfall = stress.some((result) => result.shortfall_delta > 0);
  const top = largestRisk(stress),
    stressText = stressConclusion(top);
  const [kind, setKind] = useState("contribution"),
    [metric, setMetric] = useState("money");
  const matrix = useMemo(
    () =>
      compactMatrix(
        kind === "contribution"
          ? contributionReturnMatrix(plan, year)
          : targetSpendingMatrix(plan, year),
      ),
    [plan, year, kind],
  );
  const baseCell = matrix.cells[matrix.base_row ?? 0]?.[matrix.base_col ?? 0];
  const defaultShock = useMemo(
    () => sensitivityParameters(plan).adverse_return,
    [plan],
  );
  const [shock, setShock] = useState<string>("default");
  const paths = useMemo(
    () => sorr(plan, year, shock === "default" ? defaultShock : Number(shock)),
    [plan, year, defaultShock, shock],
  );
  const sequenceText = sequenceConclusion(paths);
  const sequence = useMemo(() => (paths ? sequenceChart(paths) : null), [paths]);
  const [count, setCount] = useState("1000"),
    [run, setRun] = useState(0);
  const [market, setMarket] = useState<{
      plan: Plan;
      result: MonteCarlo;
    } | null>(null),
    [running, setRunning] = useState(false),
    [done, setDone] = useState(0),
    [failure, setFailure] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const mc = market?.plan === plan ? market.result : null;
  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setMarket(null);
    setRunning(true);
    setDone(0);
    setFailure("");
    const timer = setTimeout(() => {
      void monteCarlo(plan, Number(count), {
        signal: controller.signal,
        progress: (value) => {
          if (!controller.signal.aborted) setDone(value);
        },
      })
        .then((result) => {
          if (!controller.signal.aborted) setMarket({ plan, result });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setFailure(
              error instanceof Error ? error.message : "请重试市场路径。",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setRunning(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [plan, count, run]);
  const fan = useMemo(() => (mc ? fanChart(mc) : null), [mc]);
  const marketText = mc
    ? `${mc.n.toLocaleString(numberLocale())} 条路径中，${Math.round(mc.success_rate * 100)}% 按完整预算覆盖到 ${timeLabel(plan, plan.horizon_months - 1)}${plan.mode === "fire" ? "并实现财务独立" : ""}。`
    : running
      ? `正在计算 ${done.toLocaleString(numberLocale())} / ${Number(count).toLocaleString(numberLocale())} 条路径。`
      : "暂无本次市场路径结果。";
  return (
    <>
      <p className="mp-risk-intro">
        {t('用临时条件检查规划能否承受变化，所有金额均为今天的钱。')}
      </p>
      <CoverageSummary annotations={plan.annotations} />
      <Section title={t('压力测试')}>
        <Card label={t('压力测试')} className="mp-risk-card">
          <Notice>{stressText}</Notice>
          <p className="mp-risk-note">
            {showShortfall
              ? t('相对原计划，目标缺口增加')
              : t('相对原计划，准备就绪推迟（月）')}
          </p>
          <HBarChart
            rows={stress.map((result) => ({
              label: result.label,
              value: showShortfall
                ? Math.max(0, result.shortfall_delta)
                : result.fi_delay_months === null
                  ? null
                  : Math.max(0, result.fi_delay_months),
              display: showShortfall
                ? result.shortfall_delta > 0
                  ? `+${riskMoney(result.shortfall_delta)}`
                  : "缺口未增加"
                : result.fi_delay_months === null
                  ? "没有可比时间"
                  : result.fi_delay_months > 0
                    ? `${result.fi_delay_months} 个月`
                    : "未推迟",
            }))}
            summary={`${stressText}${showShortfall ? "图中比较目标缺口增加金额。" : "图中比较准备就绪推迟月数。"}`}
          />
          <details>
            <summary>{t('查看 {length} 个情景', { length: stress.length })}</summary>
            <div className="mp-risk-scenarios">
              {stress.map((result) => (
                <div key={result.id}>
                  <strong>
                    {t('{label} · 影响{v2}', { label: result.label, v2: { high: "高", medium: "中", low: "低" }[result.severity] })}
                  </strong>
                  <p>{result.description}</p>
                  <p>
                    {t('准备就绪：')}
                    {result.stressed.fi_month === null
                      ? t('规划期内未达成')
                      : timeLabel(plan, result.stressed.fi_month)}
                    {t('；期末剩余 {v1}。', { v1: riskMoney(result.stressed.at_horizon) })}
                    {result.stressed.failure_month !== null &&
                      t('资金不足始于 {v1}。', { v1: timeLabel(plan, result.stressed.failure_month) })}
                  </p>
                </div>
              ))}
            </div>
          </details>
          <p className="mp-risk-note">
            {t('每次只改一个条件，固定事件付款保留。FIRE 下期末资金可能因推迟停工而增加，请一起看准备就绪月份。')}
          </p>
        </Card>
      </Section>
      <Section title={t('市场路径')}>
        <Card label={t('市场路径')} className="mp-risk-card">
          <p role="status" className="mp-risk-conclusion">
            {marketText}
          </p>
          {fan && (
            <>
              <LineChart
                {...fan}
                height={200}
                summary={t('{marketText} 实线是中位数，阴影为各月份第 10 至 90 百分位区间。', { marketText })}
              />
              <p className="mp-risk-note">
                {t('实线：中位数；阴影：10%–90% 区间。期末较低')}{" "}
                {t('{v1}／中位 {v2}／较高 {v3}。', { v1: riskMoney(mc!.final.p10), v2: riskMoney(mc!.final.p50), v3: riskMoney(mc!.final.p90) })}
              </p>
            </>
          )}
          {failure && (
            <ErrorState
              title={t('市场路径未完成')}
              message={failure}
              onRetry={() => setRun((value) => value + 1)}
            />
          )}
          <FormGroup>
            <SelectField
              label={t('模拟路径')}
              value={count}
              disabled={running}
              onChange={setCount}
              options={[
                { id: "1000", label: t('1,000 条') },
                { id: "10000", label: t('1 万条') },
                { id: "20000", label: t('2 万条') },
              ]}
            />
          </FormGroup>
          {running ? (
            <Button
              block
              onClick={() => {
                controllerRef.current?.abort();
                setRunning(false);
              }}
            >
              {t('停止计算')}
            </Button>
          ) : (
            <Button block onClick={() => setRun((value) => value + 1)}>
              {t('重新计算')}
            </Button>
          )}
          <p className="mp-risk-note">
            {t('按实际年收益与波动率 {v1}', { v1: rateText(plan.volatility_hundredths) })}{" "}
            {t('模拟，固定种子。资金充足允许终点为零；这是模型路径占比，不是现实成功概率。离开本页停止后续批次。')}
          </p>
        </Card>
      </Section>
      <Section title={t('敏感性')}>
        <Card label={t('敏感性')} className="mp-risk-card">
          <FormGroup>
            <SelectField
              label={t('比较条件')}
              value={kind}
              onChange={setKind}
              options={[
                { id: "contribution", label: t('每月投入 × 收益率') },
                { id: "target", label: t('目标月份 × 生活预算') },
              ]}
            />
            <SelectField
              label={t('显示结果')}
              value={metric}
              onChange={setMetric}
              options={[
                { id: "money", label: t('期末剩余资金') },
                { id: "date", label: t('准备就绪月份') },
              ]}
            />
          </FormGroup>
          <p className="mp-risk-conclusion">
            {t('当前条件下，')}
            {baseCell.fi_month === null
              ? t('规划期内未准备就绪')
              : t('准备就绪于 {v1}', { v1: timeLabel(plan, baseCell.fi_month) })}
            {t('，期末剩余 {v1}；列出的情景中', { v1: riskMoney(baseCell.at_horizon) })}{" "}
            {matrix.cells.flat().filter((cell) => cell.failed).length}{" "}
            {t('个存在缺口。')}
          </p>
          <p className="mp-risk-note">
            {t('展示当前设置及相邻条件。边框与「当前」标记基础计划；每格直接列出结果。')}
          </p>
          <MatrixGrid matrix={matrix} plan={plan} kind={kind} metric={metric} />
        </Card>
      </Section>
      <Section title={t('收益顺序')}>
        <Card label={t('收益顺序')} className="mp-risk-card">
          <p className="mp-risk-conclusion">{sequenceText}</p>
          <FormGroup>
            <SelectField
              label={t('一次下跌的年收益')}
              value={shock}
              onChange={setShock}
              options={[
                {
                  id: "default",
                  label: t('引擎参照 {v1}', { v1: rateText(Math.round(defaultShock * 10000)) }),
                },
                { id: "-0.2", label: "−20%" },
                { id: "-0.3", label: "−30%" },
                { id: "-0.5", label: "−50%" },
              ]}
            />
          </FormGroup>
          {paths && sequence && (
            <>
              <LineChart
                {...sequence}
                height={200}
                summary={sequenceText}
              />
              <div className="mp-risk-scenarios">
                {paths.map((path) => (
                  <p key={path.id}>
                    <i
                      className="mp-risk-key"
                      style={{ background: sequence.series[paths.indexOf(path)].color }}
                      aria-hidden="true"
                    />
                    <strong>{path.label}</strong>：
                    {path.survived
                      ? t('全程够用')
                      : t('资金不足于 {v1}', { v1: timeLabel(plan, path.failure_month ?? path.shortfall_month!) })}
                    {t('；期末 {v1}。', { v1: riskMoney(path.final) })}
                  </p>
                ))}
              </div>
            </>
          )}
          <p className="mp-risk-note">
            {t('下跌分别放在退休开头和末段，持续时间相同、最多一年；其余时间沿用所设收益。基准不含下跌，两条压力路径只改变顺序。')}
          </p>
        </Card>
      </Section>
    </>
  );
}

function MatrixGrid({
  matrix,
  plan,
  kind,
  metric,
}: {
  matrix: Matrix;
  plan: Plan;
  kind: string;
  metric: string;
}) {
  const base = matrix.cells[matrix.base_row ?? 0]?.[matrix.base_col ?? 0];
  const rowLabel = (value: number) =>
    kind === "contribution"
      ? rateText(plan.r_before_hundredths + value)
      : riskMoney(value);
  return (
    <div
      className="mp-risk-matrix"
      role="table"
      aria-label={
        kind === "contribution"
          ? t('收益率为行，每月投入为列')
          : t('每月生活预算为行，目标月份为列')
      }
    >
      <div role="row" className="mp-risk-matrix-row">
        <span role="columnheader">
          {kind === "contribution" ? t('收益／投入') : t('预算／目标')}
        </span>
        {Array.from({ length: 3 }, (_, index) => (
          <span key={index} role="columnheader">
            {matrix.cols[index] === undefined
              ? "—"
              : (matrix.column_labels?.[index] ??
                (kind === "contribution"
                  ? riskMoney(matrix.cols[index])
                  : timeLabel(plan, matrix.cols[index])))}
          </span>
        ))}
      </div>
      {matrix.rows.map((value, i) => (
        <div role="row" className="mp-risk-matrix-row" key={i}>
          <span role="rowheader">{rowLabel(value)}</span>
          {Array.from({ length: 3 }, (_, j) => {
            const cell = matrix.cells[i][j];
            if (!cell)
              return (
                <span role="cell" className="mp-risk-cell" key={j}>
                  {t('无此情景')}
                </span>
              );
            const current = i === matrix.base_row && j === matrix.base_col;
            const label =
              metric === "date"
                ? cell.fi_month === null
                  ? "未达成"
                  : timeLabel(plan, cell.fi_month)
                : riskMoney(cell.at_horizon);
            const better =
              metric === "date"
                ? cell.fi_month !== null &&
                  (base.fi_month === null || cell.fi_month < base.fi_month)
                : cell.at_horizon > base.at_horizon;
            return (
              <span
                role="cell"
                className={`mp-risk-cell${current ? " mp-risk-current" : ""}${cell.failed ? " mp-risk-gap" : better ? " mp-risk-better" : ""}`}
                key={j}
              >
                <strong>{label}</strong>
                <small>
                  {current ? t('当前 · ') : ""}
                  {cell.failed
                    ? t('存在缺口')
                    : cell.at_horizon <= 0
                      ? t('没有余量')
                      : t('有余量')}
                </small>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
