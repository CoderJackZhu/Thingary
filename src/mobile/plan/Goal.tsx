import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { money } from "../../asset";
import { forecastMoney } from "../../plan-format";
import { nativePlanningFollowupPortV1 } from "../../planning-followup-port";
import { refinementCards } from "../../planning-first-run";
import {
  goalProgressChange,
  goalProgressVerdict,
  goalProgressPoint,
} from "../../goal-progress";
import type { GoalProgressEntry } from "../../goal-progress";
import { useNav } from "../nav-context";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  HeroCard,
  LargeTitle,
  ListGroup,
  ListRow,
  Loading,
  Metric,
  MetricGrid,
  Notice,
  Section,
} from "../ui";
import { usePlan } from "./data";
import { goalView } from "./goal-model";
import Events from "./Events";
import Report from "./Report";
import "./plan.css";
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
  const edit = (section: string) => nav.push("plan.setup", { section });
  if (p.loading)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="规划" />
        <Loading />
      </div>
    );
  if (p.error || !p.sources)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="规划" />
        <ErrorState message={p.error} onRetry={p.reload} />
      </div>
    );
  if (!p.saved?.profile.retire.basic || !p.capabilities)
    return (
      <div className="m-page mp-page">
        <LargeTitle title="规划" />
        <EmptyState
          title="想知道：要攒多少钱才够？"
          message="回答 5 个问题，估算从目标月份起使用资金，每月需要存多少钱。一个人、两个人都能算；没想好的可留空。"
          action={
            <Button variant="primary" onClick={() => edit("setup")}>
              开始设置目标
            </Button>
          }
        />
        <Notice>随时可以退出，不保存未提交的填写。</Notice>
      </div>
    );
  const { saved, capabilities: caps, sources, today, reload } = p,
    r = saved.profile.retire,
    v = goalView(saved, caps),
    cards = refinementCards(saved, caps, today);
  if (report)
    return (
      <Report sources={sources} caps={caps} onClose={() => setReport(false)} />
    );
  const go = (action: string, step?: number) =>
    action === "reload"
      ? reload()
      : action === "costs"
        ? edit("costs")
        : action === "contribution"
          ? edit("contribution")
          : action === "events" || action === "event" || action === "debts"
            ? document
                .getElementById("mp-events")
                ?.scrollIntoView({ behavior: "smooth" })
            : edit(
                [
                  "time",
                  "budget",
                  "funds",
                  "income",
                  "contribution",
                  "assumptions",
                ][step ?? 0],
              );
  return (
    <div className="m-page mp-page">
      <LargeTitle
        title="规划"
        actions={
          <Button variant="plain" onClick={() => edit("setup")}>
            调整条件
          </Button>
        }
      />
      <HeroCard
        eyebrow={`${v.kind}${v.uncertain ? " · 暂算结果" : ""}`}
        title={v.headline}
        subtitle={v.subtitle}
        tags={[
          {
            text: v.uncertain
              ? "仍有核算事项"
              : caps.prediction.status === "ready" &&
                  caps.prediction.value.outcome.success
                ? "所选期间可覆盖"
                : "按当前条件估算",
          },
        ]}
        footnote={
          v.stop
            ? `预计停工月份 ${v.stop}`
            : "填好每月能存的钱后，可查看预计停工时间"
        }
      />
      {v.household.length > 0 && (
        <Card label="两人停工安排">
          {v.household.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Card>
      )}
      <MetricGrid>
        <Metric
          label="为目标每月需存"
          value={v.required === null ? "待计算" : forecastMoney(v.required)}
          unknown={v.required === null}
          sub="按固定目标月份反求"
        />
        <Metric
          label="你估计每月能存"
          value={
            r.basic!.contribution.monthly_cents === null
              ? "尚未填写"
              : money(r.basic!.contribution.monthly_cents)
          }
          unknown={r.basic!.contribution.monthly_cents === null}
          onClick={() => edit("contribution")}
          sub="点此修改；未知不当作零"
        />
      </MetricGrid>
      <Card label="投入对比">
        <p>{v.verdict}</p>
        {caps.requirement.status === "ready" &&
          caps.requirement.value.set.status !== "found" && (
            <p>{v.requirement}</p>
          )}
        <p className="mp-muted">
          所需投入按固定目标反求，预测按你保存的投入推演，两者口径不同。
          {r.simplified.household?.mode === "couple"
            ? "两人金额是家庭合计，包含伴侣那一份。"
            : ""}
        </p>
      </Card>
      <Section title="核算注意事项">
        {cards.filter((c) => c.required || c.impacts || c.condition).length ===
        0 ? (
          <Card>
            <p>当前没有待补充的核算事项。</p>
          </Card>
        ) : (
          <ListGroup>
            {cards
              .filter((c) => c.required || c.impacts || c.condition)
              .map((c) => (
                <ListRow
                  key={c.id}
                  title={c.title}
                  subtitle={c.benefit}
                  onClick={() => go(c.action, c.step)}
                />
              ))}
          </ListGroup>
        )}
        {(caps.annotations ?? [])
          .filter((a) => a.effect !== "none")
          .map((a) => (
            <Notice key={a.id}>{a.message}</Notice>
          ))}
        {caps.requirement.status === "blocked" &&
          caps.requirement.missing.map((m) => (
            <Notice key={m.code + m.field}>{m.message}</Notice>
          ))}
      </Section>
      <ListGroup title="计算条件">
        <ListRow
          title="目标与时间"
          value={r.mode === "fire" ? "财务自由" : "按计划退休"}
          subtitle={v.subtitle}
          onClick={() => edit("time")}
        />
        <ListRow
          title="退休生活预算"
          value={r.spend_cents === null ? "未知" : `${money(r.spend_cents)}/月`}
          onClick={() => edit("budget")}
        />
        <ListRow
          title="可用资金"
          value={
            caps.funds.status === "ready"
              ? money(caps.funds.value.available_cents)
              : "待确认"
          }
          onClick={() => edit("funds")}
        />
        <ListRow
          title="未来收入"
          value={
            r.simplified.income_mode === "excluded"
              ? "本次不计"
              : r.simplified.income_mode === "manual"
                ? "计入手填收入"
                : "待确认"
          }
          onClick={() => edit("income")}
        />
        <ListRow title="每月净投入" onClick={() => edit("contribution")} />
        <ListRow
          title="收益、通胀与波动假设"
          subtitle={assumptionStatus}
          onClick={() => edit("assumptions")}
        />
        <ListRow title="核对费用包含关系" onClick={() => edit("costs")} />
      </ListGroup>
      <div id="mp-events">
        <Events sources={sources} saved={saved} today={today} reload={reload} />
      </div>
      <Section title="盘点以来的变化">
        {progressError ? (
          <ErrorState message={progressError} onRetry={reload} />
        ) : progress.length === 0 ? (
          <Card>
            <p>
              还没有可比较的规划记录。使用真实盘点起点并保存规划后，后续盘点可记录变化。
            </p>
          </Card>
        ) : (
          <Card>
            {progress.length > 1 && (
              <p>
                {goalProgressChange(
                  progress.at(-2)!,
                  progress.at(-1)!,
                  forecastMoney,
                )}
              </p>
            )}
            <p className="mp-muted">
              变化不只来自资产涨跌，条件和待核对项也会影响结果。
            </p>
            {[...progress]
              .reverse()
              .slice(0, 6)
              .map((e) => (
                <div className="mp-subcard" key={e.snapshot_id}>
                  <strong>{e.date}</strong>
                  <p>
                    {goalProgressVerdict(e.point, forecastMoney)}
                    {e.point.has_open_items ? "（当时有待确认事项）" : ""}
                  </p>
                  <p className="mp-muted">
                    可用资金{" "}
                    {e.point.available_cents === null
                      ? "未知"
                      : money(e.point.available_cents)}{" "}
                    · 每月需存{" "}
                    {e.point.required_monthly_cents === null
                      ? "未知"
                      : forecastMoney(e.point.required_monthly_cents)}
                  </p>
                </div>
              ))}
          </Card>
        )}
      </Section>
      <Button onClick={() => setReport(true)}>查看当前报告</Button>
      <Button onClick={() => nav.setSegment("plan.detail")}>
        查看测算详情与图表
      </Button>
      <p className="mp-muted">
        按填写的条件估算，不保证未来一定够用。收入、支出和假设变化后需重新核算。
      </p>
    </div>
  );
}
