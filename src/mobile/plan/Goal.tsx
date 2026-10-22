import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { moneyText } from "../format";
import { forecastMoneyText } from "../format";
import { nativePlanningFollowupPortV1 } from "../../planning-followup-port";
import { goalProgressVerdict, goalProgressPoint } from "../../goal-progress";
import type { GoalProgressEntry } from "../../goal-progress";
import { useNav } from "../nav-context";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  HeroCard,
  LargeTitle,
  LineChart,
  ListGroup,
  ListRow,
  Loading,
  Notice,
  Sheet,
} from "../ui";
import { usePlan } from "./data";
import {
  conditionSummary,
  confirmItems,
  goalView,
  latestChange,
  planCountText,
} from "./goal-model";
import type { ConfirmItem } from "./goal-model";
import { fundsChart } from "./detail-model";
import Report from "./Report";
import "./plan.css";
import { t } from '../../i18n.ts';
export default function Goal() {
  const p = usePlan(),
    nav = useNav(),
    [report, setReport] = useState(false),
    [progress, setProgress] = useState<GoalProgressEntry[]>([]),
    [progressError, setProgressError] = useState(""),
    [assumptionStatus, setAssumptionStatus] = useState("正在读取假设状态");
  useEffect(() => {
    let live = true;
    if (!p.sources) return;
    const source = p.sources;
    (async () => {
      try {
        let list = await invoke<GoalProgressEntry[]>("goal_progress_list");
        const snap =
          source.snapshot.status === "ready" ? source.snapshot.value : null;
        const point =
          p.saved?.profile.retire.basic && p.capabilities
            ? goalProgressPoint(
                p.capabilities,
                p.saved.profile.retire.mode,
                p.saved.profile.retire.simplified.time.target_month,
                p.saved.profile.retire.basic.contribution.monthly_cents,
              )
            : null;
        if (snap && point && !list.some((e) => e.snapshot_id === snap.id)) {
          await invoke("goal_progress_record", {
            input: {
              generation: source.generation,
              snapshot_id: snap.id,
              snapshot_revision: snap.revision,
              point,
            },
          });
          list = await invoke<GoalProgressEntry[]>("goal_progress_list");
        }
        if (live) {
          setProgress(list);
          setProgressError("");
        }
      } catch {
        if (live) setProgressError("盘点以来的变化读取失败，请重新读取。");
      }
    })();
    return () => {
      live = false;
    };
  }, [p.sources]);
  useEffect(() => {
    let live = true;
    if (!p.sources) return;
    const generation = p.sources.generation;
    setAssumptionStatus("正在读取假设状态");
    void nativePlanningFollowupPortV1()
      .readAssumptions(generation)
      .then((read) => {
        if (!live) return;
        setAssumptionStatus(
          read.status !== "ready"
            ? "假设核对状态读取失败，请打开重试"
            : read.value.generation !== generation
              ? "资料库已变化，请重新读取"
              : read.value.confirmation === "confirmed"
                ? "已核对"
                : read.value.confirmation === "needs_review"
                  ? "条件已变化，请重新核对"
                  : "程序试算值，尚未核对",
        );
      });
    return () => {
      live = false;
    };
  }, [p.sources]);
  const [sheet, setSheet] = useState<"confirm" | "history" | null>(null);
  const edit = (section: string) => nav.push("plan.setup", { section });
  if (p.loading)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('规划')} />
        <Loading />
      </div>
    );
  if (p.error || !p.sources)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('规划')} />
        <ErrorState message={p.error} onRetry={p.reload} />
      </div>
    );
  if (!p.saved?.profile.retire.basic || !p.capabilities)
    return (
      <div className="m-page mp-page">
        <LargeTitle title={t('规划')} />
        <EmptyState
          icon="chart"
          title={t('想知道：要攒多少钱才够？')}
          message={t('回答 5 个问题，估算从目标月份起使用资金，每月需要存多少钱。一个人、两个人都能算；没想好的可留空。')}
          action={
            <Button variant="primary" onClick={() => edit("setup")}>
              {t('设置条件')}
            </Button>
          }
        />
        <Notice>{t('随时可以退出，不保存未提交的填写。')}</Notice>
      </div>
    );
  const { saved, capabilities: caps, sources, today, reload } = p,
    r = saved.profile.retire,
    v = goalView(saved, caps),
    items = confirmItems(saved, caps, today),
    pred = caps.prediction.status === "ready" ? caps.prediction.value : null,
    eventCount = r.life_events.length,
    change = latestChange(progress);
  if (report)
    return (
      <Report sources={sources} caps={caps} onClose={() => setReport(false)} />
    );
  const run = (item: ConfirmItem) => {
    setSheet(null);
    if (item.action === "reload") reload();
    else if (item.action?.route === "plan.setup") edit(item.action.section);
    else if (item.action) nav.push(item.action.route);
  };
  return (
    <div className="m-page mp-page">
      <LargeTitle title={t('规划')} />
      <HeroCard
        eyebrow={`${v.kind}${v.uncertain ? " · 暂算结果" : ""}`}
        action={t('测算详情')}
        onClick={() => nav.setSegment("plan.detail")}
        title={v.headline}
        subtitle={v.subtitle}
        tags={
          items.length
            ? undefined
            : [
                {
                  text: pred?.outcome.success
                    ? t('所选期间可覆盖')
                    : t('按当前条件估算'),
                },
              ]
        }
        footnote={
          v.stop
            ? t('预计停工月份 {stop}', { stop: v.stop })
            : t('填好每月能存的钱后，可查看预计停工时间')
        }
      >
        {pred && (
          <LineChart
            compact
            height={112}
            {...fundsChart(pred).chart}
            shade={undefined}
            summary={t('预计资金变化预览。{headline}{v2}。点按查看测算详情。', { headline: v.headline, v2: v.stop ? `，预计停工月份 ${v.stop}` : "" })}
          />
        )}
        <span className="mp-result-verdict">{v.verdict}</span>
      </HeroCard>
      {v.household.length > 0 && (
        <Card label={t('两人停工安排')}>
          {v.household.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Card>
      )}
      {items.length > 0 && (
        <ListGroup>
          <ListRow
            icon="warning"
            tone="warn"
            title={t('待你确认 {length} 项', { length: items.length })}
            subtitle={items
              .slice(0, 2)
              .map((i) => i.title)
              .join("；")}
            onClick={() => setSheet("confirm")}
          />
        </ListGroup>
      )}
      <ListGroup title={t('改条件')}>
        <ListRow
          icon="gear"
          title={t('计算条件')}
          subtitle={
            <>
              {conditionSummary(saved, caps)}
              <br />
              {t('收益与通胀假设：{assumptionStatus}', { assumptionStatus })}
            </>
          }
          onClick={() => edit("setup")}
        />
        <ListRow
          icon="calendar"
          title={t('大额支出')}
          value={planCountText(eventCount)}
          onClick={() => nav.push("plan.events")}
        />
      </ListGroup>
      <ListGroup title={t('看结果')}>
        <ListRow
          icon="chart"
          tone="positive"
          title={t('假设分析')}
          subtitle={t('压力测试、市场路径与敏感性')}
          onClick={() => nav.push("plan.whatif")}
        />
        <ListRow
          icon="clock"
          tone="positive"
          title={t('盘点以来的变化')}
          subtitle={
            progressError
              ? t('读取失败，点此重新读取')
              : (change ?? t('还没有可比较的规划记录'))
          }
          onClick={
            progressError
              ? reload
              : progress.length
                ? () => setSheet("history")
                : undefined
          }
        />
        <ListRow icon="doc" tone="positive" title={t('查看当前报告')} onClick={() => setReport(true)} />
      </ListGroup>
      {sheet === "confirm" && (
        <Sheet title={t('待你确认')} onClose={() => setSheet(null)}>
          <ul className="mp-confirm" aria-label={t('待确认事项')}>
            {items.map((item) => (
              <li key={item.id}>
                <span className="mp-confirm-text">
                  <strong>{item.title}</strong>
                  {item.detail && <small>{item.detail}</small>}
                </span>
                {item.action && (
                  <button
                    type="button"
                    className="mp-coverage-go"
                    aria-label={t('去处理：{title}', { title: item.title })}
                    onClick={() => run(item)}
                  >
                    {t('去处理')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {sheet === "history" && (
        <Sheet title={t('盘点以来的变化')} onClose={() => setSheet(null)}>
          <p className="mp-muted">
            {t('变化不只来自资产涨跌，条件和待核对项也会影响结果。')}
          </p>
          {[...progress]
            .reverse()
            .slice(0, 6)
            .map((e) => (
              <div className="mp-subcard" key={e.snapshot_id}>
                <strong>{e.date}</strong>
                <p>
                  {goalProgressVerdict(e.point, forecastMoneyText)}
                  {e.point.has_open_items ? t('（当时有待确认事项）') : ""}
                </p>
                <p className="mp-muted">
                  {t('可用资金')}{" "}
                  {e.point.available_cents === null
                    ? t('未知')
                    : moneyText(e.point.available_cents)}{" "}
                  {t('· 每月需存')}{" "}
                  {e.point.required_monthly_cents === null
                    ? t('未知')
                    : forecastMoneyText(e.point.required_monthly_cents)}
                </p>
              </div>
            ))}
        </Sheet>
      )}
      <p className="mp-muted">
        {t('按填写的条件估算，不保证未来一定够用。收入、支出和假设变化后需重新核算。')}
      </p>
    </div>
  );
}
