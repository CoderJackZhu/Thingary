// Phone presentation adapters. The existing runway, career and wish engines own all calculations.
import type { PlanningSources } from "../../plan-basic-contract.ts";
import type { CareerDraft } from "../../plan-career-contract.ts";
import type { IncomeDraft } from "../../career-preview/income-scope.ts";
import { prepareIncomeScope } from "../../career-preview/income-scope.ts";
import {
  ageMonthsAt,
  maxGap,
  minWindow,
  missingItems,
} from "../../plan-career-map.ts";
import { evaluateCareerScenario } from "../../plan-career.ts";
import {
  sayLower,
  sayRest,
  saySwitch,
} from "../../career-preview/guided-model.ts";
import type { Say } from "../../career-preview/guided-model.ts";
import { runway } from "../../plan-runway.ts";
import { runwayLines } from "../../planning-basic-view.ts";
import { moneyText } from "../format.ts";
import { t } from '../../i18n.ts';
export type CareerQuestion = "rest" | "switch" | "lower";
export const trialDateValid = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
export function runwayTrial(input: {
  start: string | null;
  date: string;
  today: string;
  income: string;
  noIncome: boolean;
  spend: string;
  floor: string;
  months: number;
}) {
  const { start, date, today, income, noIncome, spend, floor, months } = input;
  if (start === null || start === "")
    return { status: "missing" as const, message: t('请提供可用资金起点。') };
  if (!trialDateValid(date) || date > today)
    return {
      status: "missing" as const,
      message: t('请选择有效的截至日，不能晚于今天。'),
    };
  if (!noIncome && income === "")
    return {
      status: "missing" as const,
      message: t('请填写每月可靠到账，或明确选择目前没有可靠到账。'),
    };
  if (spend === "")
    return { status: "missing" as const, message: t('请填写每月必要开销。') };
  const result = runway({
    start_cents: Number(start),
    income_cents: noIncome ? 0 : Number(income),
    spend_cents: Number(spend),
    floor_cents: floor === "" ? null : Number(floor),
    months,
  });
  return {
    status: "calculated" as const,
    result,
    lines: runwayLines(result, { set: floor !== "", cents: floor }, moneyText),
  };
}

export type CareerTrialResult = {
  message: string | null;
  answer: Say | null;
  rows: { level: string; say: Say }[] | null;
};
/** Keep unknown amounts unknown; only the question-specific engine decides feasibility. */
export function careerTrial(
  sources: PlanningSources,
  draft: CareerDraft,
  income: IncomeDraft,
  question: CareerQuestion,
  lowerGap: number | null,
): CareerTrialResult {
  const scope = prepareIncomeScope(sources, draft, income);
  if (scope.status !== "ready" || !scope.sources)
    return { message: scope.issues.join(" "), answer: null, rows: null };
  const checked =
    question === "lower"
      ? { ...scope.draft, gap_months: lowerGap }
      : scope.draft;
  const missing = missingItems(checked, question === "rest");
  if (question === "rest" || checked.gap_months !== 0) {
    if (checked.gap.spend_cents === null || checked.gap.spend_cents === "")
      missing.unshift({ label: t('不工作期间每月总共花多少'), assumable: false });
    if (checked.gap.income_cents === null || checked.gap.income_cents === "")
      missing.unshift({
        label: t('不工作期间每月还有多少收入'),
        assumable: false,
      });
  }
  if (missing.length)
    return {
      message: `还差：${missing.map((m) => m.label).join("、")}。`,
      answer: null,
      rows: null,
    };
  const p =
    scope.sources.profile.status === "ready"
      ? scope.sources.profile.value.saved?.profile
      : null;
  const target = p?.retire.simplified.time.target_month;
  const age = target ? ageMonthsAt(scope.sources, target) : null;
  if (question === "rest")
    return {
      message: null,
      answer: sayRest(
        maxGap(scope.sources, checked),
        age === null ? null : Math.floor(age / 12),
      ),
      rows: null,
    };
  if (question === "switch")
    return {
      message: null,
      answer: saySwitch(
        evaluateCareerScenario(scope.sources, checked),
        checked.recovery.monthly_cents,
      ),
      rows: null,
    };
  const current = p?.retire.basic?.contribution.monthly_cents ?? null;
  const levels =
    current !== null && /^-?\d+$/.test(current)
      ? [0, 0.25, 0.5, 0.75].map((f) => String(Math.round(Number(current) * f)))
      : ["0"];
  return {
    message: null,
    answer: null,
    rows: levels.map((level) => {
      const d = structuredClone(checked);
      d.recovery.monthly_cents = level;
      return {
        level,
        say: sayLower(minWindow(scope.sources!, d), scope.sources!),
      };
    }),
  };
}
