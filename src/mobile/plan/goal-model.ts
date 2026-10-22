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
        ? `预计 ${age === null ? stop : ageText(age)}可停工`
        : "规划终点前尚未达成"
      : pred.outcome.success
        ? "按当前投入，目标期间可覆盖"
        : "按当前投入，尚未满足完整目标"
    : "先看目标需求";
  const household = householdLines(h, pred?.household, stop);
  if (isCouple(h) && pred?.household && household.length < 2) {
    household.push(
      h.partner.stop_age_months === null
        ? "伴侣与你同时停工。"
        : pred.household.same_time_stop_month &&
            pred.household.same_time_stop_month === stop
          ? "与两人同时停工相比，你的停工月份相同。"
          : "当前条件下，暂时无法比较两人同时停工的时间。",
    );
  }
  return {
    headline,
    kind: `${isCouple(h) ? "两个人" : "一个人"} · ${r.mode === "fire" ? "财务自由" : "按计划退休"}`,
    stop,
    household,
    required: req && "monthly_cents" in req ? req.monthly_cents : null,
    requirement: req
      ? requirementLine(req, forecastMoneyText).text
      : "条件还需补充",
    verdict: req
      ? contributionVerdict(
          req,
          r.basic?.contribution.monthly_cents ?? null,
          forecastMoneyText,
        ).text
      : "请核对下方注意事项",
    subtitle: `希望 ${t.target_month ?? "尚未确定"} 停工，规划到 ${t.horizon_month ?? "尚未确定"}`,
    uncertain: (caps.annotations ?? []).some((a) => a.effect !== "none"),
  };
}
