import { useMemo, useState } from "react";
import { forecastMoneyText } from "../format";
import { trajectory, snapshotRows, coverage } from "../../plan-view";
import { timeLabel } from "../../plan-ledger";
import { terminalText } from "../../planning-basic-view";
import { useNav } from "../nav-context";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LargeTitle,
  ListGroup,
  ListRow,
  Loading,
  Notice,
  Section,
  SegmentedControl,
  HBarChart,
  LineChart,
} from "../ui";
import { usePlan } from "./data";
import { budgetComparisons } from "./detail-model";
import "./plan.css";
export default function Detail() {
  const p = usePlan(),
    nav = useNav();
  if (p.loading)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="测算详情" />
        <Loading />
      </div>
    );
  if (p.error)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="测算详情" />
        <ErrorState message={p.error} onRetry={p.reload} />
      </div>
    );
  if (!p.saved?.profile.retire.basic)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="测算详情" />
        <EmptyState
          icon="chart"
          title="先设置一个目标"
          action={
            <Button onClick={() => nav.push("plan.setup")}>设置条件</Button>
          }
        />
      </div>
    );
  if (p.capabilities?.prediction.status !== "ready")
    return (
      <div className="m-page mp-page">
        <LargeTitle title="测算详情" />
        <EmptyState
          icon="chart"
          title="还不能展示预测"
          message={
            p.capabilities?.prediction.status === "blocked"
              ? p.capabilities.prediction.missing
                  .map((m) => m.message)
                  .join("；")
              : "规划条件未就绪"
          }
          action={
            <Button
              onClick={() =>
                nav.push("plan.setup", { section: "contribution" })
              }
            >
              补充条件
            </Button>
          }
        />
      </div>
    );
  return <Ready pred={p.capabilities.prediction.value} today={p.today} />;
}
function Ready({
  pred,
  today,
}: {
  pred: Extract<
    NonNullable<ReturnType<typeof usePlan>["capabilities"]>["prediction"],
    { status: "ready" }
  >["value"];
  today: string;
}) {
  const nav = useNav(),
    [mode, setMode] = useState<"today" | "nominal">("today");
  const points = useMemo(
      () => trajectory(pred.plan, pred.projection, mode),
      [pred, mode],
    ),
    rows = useMemo(
      () => snapshotRows(pred.plan, pred.projection, mode),
      [pred, mode],
    );
  const comparisons = useMemo(
    () => budgetComparisons(pred, Number(today.slice(0, 4))),
    [pred, today],
  );
  const [selected, setSelected] = useState(
    pred.projection.retire_month ?? pred.plan.target_months,
  );
  const cover = coverage(pred.plan, pred.projection, selected, mode);
  const retireMonth = pred.projection.retire_month, retireAt = retireMonth === null ? null : points.findIndex((p) => p.month >= retireMonth);
  const conclusion = `${terminalText[pred.terminal]}；${timeLabel(pred.plan, pred.plan.horizon_months - 1)} 时预计资金（按今天购买力）${forecastMoneyText(pred.outcome.at_horizon)}。`;
  return (
    <div className="m-page mp-page">
      <LargeTitle
        title="测算详情"
        actions={
          <Button variant="primary" onClick={() => nav.push("plan.setup")}>
            调整条件
          </Button>
        }
      />
      <SegmentedControl
        label="金额显示方式"
        value={mode}
        onChange={setMode}
        items={[
          { id: "today", label: "按今天物价" },
          { id: "nominal", label: "未来账面金额" },
        ]}
      />
      <Card label="预计资金变化">
        <h2>预计资金变化</h2>
        <p>{conclusion}</p>
        <LineChart
          height={210}
          summary={`预计资金实线，所需资金虚线。${conclusion}`}
          labels={points.map((p) => p.label)}
          xs={points.map((p) => p.month)}
          series={[
            { name: "预计资金", values: points.map((p) => p.projected) },
            { name: "所需资金", values: points.map((p) => p.required), color: "var(--muted)", dashed: true, area: false },
          ]}
          marker={retireAt === null ? undefined : { at: retireAt, label: "预计停工" }}
          shade={pred.projection.failure_month === null ? undefined : { from: pred.projection.failure_month, to: pred.plan.horizon_months, label: "资金耗尽" }}
          tip={(i) => ({ title: points[i].label, rows: [{ name: "预计资金", value: forecastMoneyText(points[i].projected), color: "var(--accent)" }, { name: "所需资金", value: forecastMoneyText(points[i].required), color: "var(--muted)" }] })}
        />
        <p className="mp-muted">
          实线：预计资金 ·
          虚线：此时停止工作所需资金。假设推演，不是证券行情或历史收益。
        </p>
      </Card>
      <Section title="不同生活预算比较">
        <ListGroup footer="均沿用已保存的收益及收入；停止追加存钱只取消正向投入，取用存款仍保留。">
          {comparisons.map((c) => (
            <ListRow
              key={c.label}
              title={c.label}
              subtitle={
                c.stop
                  ? `预计停工 ${c.stop} · ${c.success ? "所选期间可覆盖" : "尚未满足完整目标"}`
                  : "规划终点前尚未达成"
              }
              value={forecastMoneyText(c.required)}
              valueSub="停止工作所需资金"
            />
          ))}
        </ListGroup>
      </Section>
      <Card>
        <details>
          <summary>逐年表（共 {rows.length} 行）</summary>
          <p className="mp-muted">可左右滑动。支出含大额付款，缺口单列。</p>
          <div
            className="mp-table-scroll"
            role="region"
            aria-label="逐年表，可左右滑动"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {[
                    "期间",
                    "年龄",
                    "存入",
                    "收入与解锁",
                    "支出",
                    "期末资金",
                    "缺口",
                  ].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <th scope="row">
                      {r.period ?? r.year}
                      {r.marks.length > 0 ? ` · ${r.marks.join("/")}` : ""}
                    </th>
                    <td>{r.age ?? "未知"}</td>
                    <td>{forecastMoneyText(r.contribution)}</td>
                    <td>{forecastMoneyText(r.income + r.unlock)}</td>
                    <td>{forecastMoneyText(r.spend + r.oneoff)}</td>
                    <td>{forecastMoneyText(r.end)}</td>
                    <td>{forecastMoneyText(r.unfunded)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
      <Card>
        <h2>退休生活费由什么覆盖</h2>
        <label className="mp-muted" htmlFor="mp-coverage-month">
          查看月份：{timeLabel(pred.plan, selected)}
        </label>
        <input
          id="mp-coverage-month"
          aria-label="查看生活费覆盖月份"
          type="range"
          min={pred.projection.retire_month ?? pred.plan.target_months}
          max={pred.plan.horizon_months - 1}
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          style={{ width: "100%", minHeight: 44 }}
        />
        <p>
          {cover.calendar_month}，每月生活费 {forecastMoneyText(cover.spend)}
          ，其中无资金支持{" "}
          {forecastMoneyText(
            cover.segments.find((s) => s.kind === "unfunded")?.monthly ?? 0,
          )}
          。
        </p>
        <HBarChart
          summary="生活费由收入、组合提取和无资金部分构成"
          rows={cover.segments.map((s) => ({
            label: s.label,
            value: s.monthly,
            display: forecastMoneyText(s.monthly),
          }))}
        />
      </Card>
      <Button onClick={() => nav.push("plan.whatif")}>
        假设分析：压力测试、市场路径与敏感性
      </Button>
      <Notice>预测取决于填写的条件和假设，实际结果可能不同。</Notice>
    </div>
  );
}
