import type { BasicCapabilities, ProfileState } from "../../plan.ts";
import { timeLabel } from "../../plan-ledger.ts";
import {
  ageAtMonth,
  ageText,
} from "../../planning-simplified-ui/income-view.ts";
import {
  householdLines,
  householdOf,
  isCouple,
} from "../../planning-simplified-ui/household-view.ts";
import {
  contributionVerdict,
  requirementLine,
} from "../../planning-basic-view.ts";
import { forecastMoneyText } from "../format.ts";
import { refinementCards } from "../../planning-first-run.ts";
import type { Refinement } from "../../planning-first-run.ts";
import { goalProgressChange, goalProgressVerdict } from "../../goal-progress.ts";
import type { GoalProgressEntry } from "../../goal-progress.ts";
import { affectingAnnotations } from "../../plan-annotations.ts";
import { coverageItems } from "./coverage-model.ts";
import type { CoverageTarget } from "./coverage-model.ts";
import { t as tr } from '../../i18n.ts';
export function goalView(
  saved: NonNullable<ProfileState["saved"]>,
  caps: BasicCapabilities,
) {
  const r = saved.profile.retire,
    t = r.simplified.time,
    h = householdOf(r.simplified);
  const pred =
    caps.prediction.status === "ready" ? caps.prediction.value : null;
  const req =
    caps.requirement.status === "ready" ? caps.requirement.value.set : null;
  const myStop = pred
    ? r.mode === "fire"
      ? pred.projection.retire_month
      : pred.plan.target_months
    : null;
  const stop = pred && myStop !== null ? timeLabel(pred.plan, myStop) : null;
  const age = ageAtMonth(t.reference, stop);
  const headline = pred
    ? r.mode === "fire"
      ? stop
        ? tr('预计 {v1}可停工', { v1: age === null ? stop : ageText(age) })
        : tr('规划终点前尚未达成')
      : pred.outcome.success
        ? tr('按当前投入，目标期间可覆盖')
        : tr('按当前投入，尚未满足完整目标')
    : tr('先看目标需求');
  const household = householdLines(h, pred?.household, stop);
  if (isCouple(h) && pred?.household && household.length < 2) {
    household.push(
      h.partner.stop_age_months === null
        ? tr('伴侣与你同时停工。')
        : pred.household.same_time_stop_month &&
            pred.household.same_time_stop_month === stop
          ? tr('与两人同时停工相比，你的停工月份相同。')
          : tr('当前条件下，暂时无法比较两人同时停工的时间。'),
    );
  }
  return {
    headline,
    kind: `${isCouple(h) ? tr('两个人') : tr('一个人')} · ${r.mode === "fire" ? tr('财务自由') : tr('按计划退休')}`,
    stop,
    household,
    required: req && "monthly_cents" in req ? req.monthly_cents : null,
    requirement: req
      ? requirementLine(req, forecastMoneyText).text
      : tr('条件还需补充'),
    verdict: req
      ? contributionVerdict(
          req,
          r.basic?.contribution.monthly_cents ?? null,
          forecastMoneyText,
        ).text
      : tr('请核对下方注意事项'),
    subtitle: tr('希望 {v1} 停工，规划到 {v2}', { v1: t.target_month ?? tr('尚未确定'), v2: t.horizon_month ?? tr('尚未确定') }),
    uncertain: (caps.annotations ?? []).some((a) => a.effect !== "none"),
  };
}

/** Row value for 大额支出 on the goal page: big plans only (stage costs live in the budget step). */
export const planCountText = (count: number) => (count ? tr('{count} 项', { count }) : tr('暂无'));

/** One line for 计算条件. Unknown figures read 未知 / 待确认, never 0. */
export function conditionSummary(
  saved: NonNullable<ProfileState["saved"]>,
  caps: BasicCapabilities,
): string {
  const r = saved.profile.retire,
    saving = r.basic?.contribution.monthly_cents ?? null;
  return [
    tr('退休预算 {v1}', { v1: r.spend_cents === null ? "未知" : `${forecastMoneyText(r.spend_cents)}/月` }),
    tr('可用资金 {v1}', { v1: caps.funds.status === "ready" ? forecastMoneyText(caps.funds.value.available_cents) : "待确认" }),
    tr('每月存 {v1}', { v1: saving === null ? "待确认" : forecastMoneyText(saving) }),
  ].join(" · ");
}

/** 盘点以来的变化 folded to its latest line; null when there is nothing to compare yet. */
export function latestChange(progress: readonly GoalProgressEntry[]): string | null {
  const latest = progress.at(-1);
  if (!latest) return null;
  return progress.length > 1
    ? goalProgressChange(progress.at(-2)!, latest, forecastMoneyText)
    : `${latest.date}：${goalProgressVerdict(latest.point, forecastMoneyText)}`;
}

export type ConfirmItem = {
  id: string;
  title: string;
  detail?: string;
  /** Where 去处理 leads; "reload" re-reads the sources. Null: information only. */
  action: CoverageTarget | "reload" | null;
  required: boolean;
};
const SETUP_SECTIONS = ["time", "budget", "funds", "income", "contribution", "assumptions"];
export function refinementAction(c: Pick<Refinement, "action" | "step">): ConfirmItem["action"] {
  if (c.action === "reload") return "reload";
  if (c.action === "events" || c.action === "event") return { route: "plan.events" };
  if (c.action === "debts") return { route: "plan.debts" };
  if (c.action === "costs" || c.action === "contribution") return { route: "plan.setup", section: c.action };
  return { route: "plan.setup", section: SETUP_SECTIONS[c.step ?? 0] ?? "time" };
}
const BLOCKED_TARGET: Record<string, string> = {
  PROFILE_UNKNOWN: "time",
  BUDGET_UNKNOWN: "budget",
  START_UNKNOWN: "funds",
  CONTRIBUTION_UNKNOWN: "contribution",
};
/** Missing-input codes already explained by a refinement card. */
const CARD_CODES = new Set([
  "COST_SCOPE_UNKNOWN", "COST_SCOPE_INVALID", "OCCURRENCE_UNCONFIRMED", "HORIZON_INVALID", "TIME_UNCONFIRMED",
  "INCOME_UNCONFIRMED", "FUNDS_UNCONFIRMED", "SOURCE_ERROR", "SOURCE_STALE",
]);

/**
 * Everything the goal page still waits on, once each: the refinement cards, calculation notes no card
 * covers, and blocked-requirement messages. Several annotations with the same message become one entry.
 */
export function confirmItems(
  saved: NonNullable<ProfileState["saved"]>,
  caps: BasicCapabilities,
  today: string,
): ConfirmItem[] {
  const annotations = affectingAnnotations(caps.annotations ?? []),
    cards = refinementCards(saved, caps, today).filter((c) => c.required || c.impacts || c.condition),
    out: ConfirmItem[] = cards.map((c) => {
      const extra = new Set(annotations.filter((a) => a.treatment === "assumed_extra").flatMap((a) => a.source_ids)).size;
      return {
        id: c.id,
        title: c.title,
        detail: c.id === "costs" && !c.required && extra ? tr('{extra} 项费用暂按额外费用计入，可能重复包含。', { extra }) : c.benefit,
        action: refinementAction(c),
        required: c.required,
      };
    });
  const covered = (a: (typeof annotations)[number]) =>
    (a.reason_code.startsWith("COST_") && cards.some((c) => c.id === "costs")) ||
    (!!a.refinement.event_id && cards.some((c) => c.event?.id === a.refinement.event_id)) ||
    (a.reason_code === "REFERENCE_PENDING" && cards.some((c) => c.id === "references")) ||
    (a.reason_code.startsWith("DEBT_") && cards.some((c) => c.action === "debts"));
  for (const item of coverageItems(annotations.filter((a) => !covered(a))))
    out.push({
      id: `note:${item.key}`,
      title: item.count > 1 ? tr('{message}（共 {count} 项）', { message: item.message, count: item.count }) : item.message,
      detail: item.direction,
      action: item.target,
      required: false,
    });
  if (caps.requirement.status === "blocked")
    for (const m of caps.requirement.missing) {
      if (CARD_CODES.has(m.code) || (m.code === "INPUT_INVALID" && out.some((i) => i.required))) continue;
      const section = BLOCKED_TARGET[m.code];
      out.push({
        id: `missing:${m.code}:${m.field}`,
        title: m.message,
        action: section ? { route: "plan.setup", section } : null,
        required: true,
      });
    }
  const seen = new Set<string>();
  return out.filter((i) => {
    const text = i.title.replace(/（共 \d+ 项）$/, "");
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}
