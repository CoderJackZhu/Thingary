import { useMemo, useState } from "react";
import { forecastMoneyText } from "../format";
import { snapshotRows, coverage } from "../../plan-view";
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
import { budgetComparisons, fundsChart, stepMonth, yearCard } from "./detail-model";
import "./plan.css";
import { t } from '../../i18n.ts';
export default function Detail() {
  const p = usePlan(),
    nav = useNav();
  if (p.loading)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('测算详情')} />
        <Loading />
      </div>
    );
  if (p.error)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('测算详情')} />
        <ErrorState message={p.error} onRetry={p.reload} />
      </div>
    );
  if (!p.saved?.profile.retire.basic)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('测算详情')} />
        <EmptyState
          icon="chart"
          title={t('先设置一个目标')}
          action={
            <Button onClick={() => nav.push("plan.setup")}>{t('设置条件')}</Button>
          }
        />
      </div>
    );
  if (p.capabilities?.prediction.status !== "ready")
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('测算详情')} />
        <EmptyState
          icon="chart"
          title={t('还不能展示预测')}
          message={
            p.capabilities?.prediction.status === "blocked"
              ? p.capabilities.prediction.missing
                  .map((m) => m.message)
                  .join("；")
              : t('规划条件未就绪')
          }
          action={
            <Button
              onClick={() =>
                nav.push("plan.setup", { section: "contribution" })
              }
            >
              {t('补充条件')}
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
  const { points, chart } = useMemo(() => fundsChart(pred, mode), [pred, mode]),
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
  const minMonth = pred.projection.retire_month ?? pred.plan.target_months,
    maxMonth = pred.plan.horizon_months - 1;
  const cover = coverage(pred.plan, pred.projection, selected, mode);
  const conclusion = `${terminalText[pred.terminal]}；${timeLabel(pred.plan, pred.plan.horizon_months - 1)} 时预计资金（按今天购买力）${forecastMoneyText(pred.outcome.at_horizon)}。`;
  return (
    <div className="m-page mp-page">
      <LargeTitle
        title={t('测算详情')}
        actions={
          <Button variant="primary" onClick={() => nav.push("plan.setup")}>
            {t('调整条件')}
          </Button>
        }
      />
      <ListGroup>
        <ListRow
          icon="chart"
          tone="positive"
          title={t('假设分析')}
          subtitle={t('压力测试、市场路径与敏感性')}
          onClick={() => nav.push("plan.whatif")}
        />
      </ListGroup>
      <SegmentedControl
        label={t('金额显示方式')}
        value={mode}
        onChange={setMode}
        items={[
          { id: "today", label: t('按今天物价') },
          { id: "nominal", label: t('未来账面金额') },
        ]}
      />
      <Card label={t('预计资金变化')}>
        <h2>{t('预计资金变化')}</h2>
        <p>{conclusion}</p>
        <LineChart
          height={210}
          summary={t('预计资金实线，所需资金虚线。{conclusion}', { conclusion })}
          {...chart}
          tip={(i) => ({ title: points[i].label, rows: [{ name: "预计资金", value: forecastMoneyText(points[i].projected), color: "var(--accent)" }, { name: "所需资金", value: forecastMoneyText(points[i].required), color: "var(--muted)" }] })}
        />
        <p className="mp-muted">
          {t('实线：预计资金 · 虚线：此时停止工作所需资金。假设推演，不是证券行情或历史收益。')}
        </p>
      </Card>
      <Section title={t('不同生活预算比较')}>
        <ListGroup footer={t('均沿用已保存的收益及收入；停止追加存钱只取消正向投入，取用存款仍保留。')}>
          {comparisons.map((c) => (
            <ListRow
              key={c.label}
              title={c.label}
              subtitle={
                c.stop
                  ? t('预计停工 {stop} · {v2}', { stop: c.stop, v2: c.success ? "所选期间可覆盖" : "尚未满足完整目标" })
                  : t('规划终点前尚未达成')
              }
              value={forecastMoneyText(c.required)}
              valueSub={t('停止工作所需资金')}
            />
          ))}
        </ListGroup>
      </Section>
      <Card>
        <details>
          <summary>{t('逐年表（共 {length} 行）', { length: rows.length })}</summary>
          <p className="mp-muted">{t('点一年可看全部字段。支出含大额付款，缺口单列。')}</p>
          <ul className="mp-years">
            {rows.map((r, i) => {
              const y = yearCard(r);
              return (
                <li key={i}>
                  <details className="mp-year">
                    <summary>
                      <span className="mp-year-main">
                      <span className="mp-year-head">
                        <strong>{y.title}</strong>
                        {y.age && <small>{y.age}</small>}
                      </span>
                      <span className="mp-year-nums">
                        <span>{t('期末资金')} <b>{forecastMoneyText(y.end)}</b></span>
                        {y.hasGap && <span className="mp-year-gap">{t('缺口')} <b>{forecastMoneyText(y.unfunded)}</b></span>}
                      </span>
                      </span>
                    </summary>
                    <dl className="mp-year-more">
                      {y.details.map((d) => (
                        <div key={d.label}>
                          <dt>{d.label}</dt>
                          <dd>{forecastMoneyText(d.value)}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>{t('缺口')}</dt>
                        <dd>{forecastMoneyText(y.unfunded)}</dd>
                      </div>
                    </dl>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      </Card>
      <Card>
        <h2>{t('退休生活费由什么覆盖')}</h2>
        <div className="mp-month-picker">
          <p className="mp-month-label" id="mp-coverage-month-label" aria-live="polite">
            {timeLabel(pred.plan, selected)}
          </p>
          <div className="mp-month-steps" role="group" aria-label={t('调整查看月份')}>
            {([["−1年", -12], ["−1月", -1], ["+1月", 1], ["+1年", 12]] as const).map(([label, delta]) => (
              <button
                key={label}
                type="button"
                disabled={stepMonth(selected, delta, minMonth, maxMonth) === selected}
                aria-label={delta % 12 === 0 ? t('{v1}一年', { v1: delta < 0 ? "前移" : "后移" }) : t('{v1}一个月', { v1: delta < 0 ? "前移" : "后移" })}
                onClick={() => setSelected(stepMonth(selected, delta, minMonth, maxMonth))}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            id="mp-coverage-month"
            aria-labelledby="mp-coverage-month-label"
            type="range"
            min={minMonth}
            max={maxMonth}
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            style={{ width: "100%", minHeight: 44 }}
          />
        </div>
        <p>
          {t('{calendar_month}，每月生活费 {v2}，其中无资金支持', { calendar_month: cover.calendar_month, v2: forecastMoneyText(cover.spend) })}{" "}
          {forecastMoneyText(
            cover.segments.find((s) => s.kind === "unfunded")?.monthly ?? 0,
          )}
          。
        </p>
        <HBarChart
          summary={t('生活费由收入、组合提取和无资金部分构成')}
          rows={cover.segments.map((s) => ({
            label: s.label,
            value: s.monthly,
            display: forecastMoneyText(s.monthly),
          }))}
        />
      </Card>
      <Notice>{t('预测取决于填写的条件和假设，实际结果可能不同。')}</Notice>
    </div>
  );
}
