import { setupFields } from "../../planning-first-run.ts";
import {
  basicInput,
  fundsInput,
  costsInput,
  contributionSources,
  retirementSources,
} from "../../planning-basic-forms.ts";
import type { Draft } from "../../planning-basic-forms.ts";
import { defaultRetire } from "../../plan.ts";
import type { ProfileState } from "../../plan.ts";
import { validateSimplifiedPlanningV1 } from "../../plan-simplified.ts";
import { householdIssues } from "../../planning-simplified-ui/household-view.ts";
import { t } from '../../i18n.ts';
/**
 * The setup flow in desktop order. `unit` is what one save writes: steps 1–5 share the setup draft,
 * 假设 and 费用包含关系 have their own transactions, so crossing between units saves first.
 */
export const flowSteps = [
  { id: "time", title: t('目标与时间'), unit: "setup" },
  { id: "budget", title: t('退休生活预算'), unit: "setup" },
  { id: "funds", title: t('可用资金'), unit: "setup" },
  { id: "income", title: t('未来收入'), unit: "setup" },
  { id: "contribution", title: t('每月净投入'), unit: "setup" },
  { id: "assumptions", title: t('收益、通胀与波动假设'), unit: "assumptions" },
  { id: "costs", title: t('核对费用包含关系'), unit: "costs" },
] as const;
export type FlowStep = (typeof flowSteps)[number];
export const steps = flowSteps.map((s) => s.title);
/** Index of a step id; -1 for "setup" (the whole flow) and anything unknown. */
export const stepIndex = (section: string) =>
  flowSteps.findIndex((s) => s.id === section);
export const progressText = (index: number) =>
  `第 ${index + 1} / ${flowSteps.length} 步`;
export function editorInput(
  d: Draft,
  saved: ProfileState["saved"],
  today: string,
  live: boolean,
  section: string,
) {
  if (
    d.start === "live" &&
    live &&
    d.funds.some(
      (f) =>
        !Number.isInteger(f.share_hundredths) ||
        f.share_hundredths < 0 ||
        f.share_hundredths > 10000,
    )
  )
    throw new Error(
      t('账户计入比例请填写 0 到 100 的百分数；留空不会按 0 保存。'),
    );
  const problems = householdIssues(d.simplified, today);
  const issues = validateSimplifiedPlanningV1(d.simplified, today);
  if (problems.length || issues.length)
    throw new Error((problems[0] ?? issues[0]).message);
  if (
    section === "funds" &&
    d.start === saved?.profile.retire.basic?.start.kind
  )
    return d.start === "live"
      ? fundsInput(d, saved, today)
      : basicInput(d, saved, today);
  if (section === "income")
    return {
      section: "simplified" as const,
      fields: structuredClone(d.simplified),
    };
  if (
    section === "contribution" &&
    JSON.stringify(d.simplified.household) ===
      JSON.stringify(saved?.profile.retire.simplified.household)
  )
    return basicInput(d, saved, today);
  if (section === "costs" && saved) return costsInput(d, saved);
  return {
    section: "setup" as const,
    fields: setupFields(d, saved, today, live),
  };
}

/** A problem the person can fix: which step it belongs to and which field shows it (`""` = the step as a whole). */
export type StepIssue = { step: number; field: string; message: string };
const SHARE_MESSAGE = "账户计入比例请填写 0 到 100 的百分数；留空不会按 0 保存。";
const at = (id: string) => flowSteps.findIndex((s) => s.id === id);

/** The field a simplified-plan path belongs to (`future_incomes.<id>.x` points at the whole income). */
function pathTarget(path: string): { step: number; field: string } {
  if (path === "time.target_month") return { step: at("time"), field: "target_month" };
  if (path === "time.horizon_month") return { step: at("time"), field: "horizon_month" };
  if (path.startsWith("time")) return { step: at("time"), field: "birth" };
  if (path === "household.partner.birth_month") return { step: at("time"), field: "partner_birth" };
  if (path === "household.partner.stop_age_months") return { step: at("time"), field: "partner_stop" };
  if (path.startsWith("household.partner.monthly_cents")) return { step: at("contribution"), field: "partner_monthly" };
  if (path.startsWith("household")) return { step: at("time"), field: "" };
  if (path === "income_mode" || path === "future_incomes") return { step: at("income"), field: "income_mode" };
  const income = /^future_incomes\.([^.]+)/.exec(path);
  if (income) return { step: at("income"), field: `income:${income[1]}` };
  return { step: at("time"), field: "" };
}

/**
 * What stops a save: only values that are wrong, never ones left blank (blank means unknown), plus the one
 * required number 应急金月数. Ordered by step so the first entry is where to jump.
 */
export function setupIssues(d: Draft, saved: ProfileState["saved"], today: string, live: boolean): StepIssue[] {
  const out: StepIssue[] = [];
  for (const i of validateSimplifiedPlanningV1(d.simplified, today)) {
    const household = householdIssues(d.simplified, today).find((h) => h.path === i.path && h.code === i.code);
    out.push({ ...pathTarget(i.path), message: (household ?? i).message });
  }
  const months = d.emergency.trim();
  if (months === "") out.push({ step: at("budget"), field: "emergency", message: t('请填写应急金月数。') });
  else if (!Number.isInteger(Number(months)) || Number(months) < 0 || Number(months) > 36)
    out.push({ step: at("budget"), field: "emergency", message: t('应急金月数须是 0 到 36 的整数。') });
  if (d.start === "live" && live)
    for (const f of d.funds)
      if (!Number.isInteger(f.share_hundredths) || f.share_hundredths < 0 || f.share_hundredths > 10000)
        out.push({ step: at("funds"), field: `share:${f.account_id}`, message: SHARE_MESSAGE });
  for (const [key, rows] of costRows(d, saved)) for (const row of rows)
    if (d[key][row.id]?.treatment === "included" && d[key][row.id].ref === "")
      out.push({ step: at("costs"), field: `scope:${key}:${row.id}`, message: t('「{label}」已含在预算里时，请填写含多少。', { label: row.label }) });
  return out.sort((a, b) => a.step - b.step);
}

/** The two lists on the 费用包含关系 step. Retirement costs include stage costs added in this draft. */
export function costRows(d: Draft, saved: ProfileState["saved"]) {
  const r = saved?.profile.retire ?? defaultRetire;
  return [
    ["conScopes", contributionSources(r)],
    ["retScopes", retirementSources({ ...r, spend_items: d.spendItems })],
  ] as const;
}

export type StepStatus = "done" | "attention" | "todo";
/**
 * Per-step state for the indicator. attention: a wrong value, or fee relations still 待确认 on a saved plan.
 * done: the step has what it needs. Everything else is untouched.
 */
export function stepStatuses({ d, saved, issues, visited, assumptionsEdited }: { d: Draft; saved: ProfileState["saved"]; issues: StepIssue[]; visited: ReadonlySet<number>; assumptionsEdited: boolean }): StepStatus[] {
  const pending = costRows(d, saved).some(([key, rows]) => rows.some((row) => !d[key][row.id]?.treatment));
  const filled = [
    d.simplified.time.target_month !== null,
    d.budget !== "",
    d.start === "live" || d.simAmount !== "",
    d.simplified.income_mode !== "unconfirmed",
    d.contribution !== "",
    visited.has(at("assumptions")) || assumptionsEdited,
    visited.has(at("costs")) && !pending,
  ];
  return flowSteps.map((_, i) =>
    issues.some((x) => x.step === i) || (i === at("costs") && pending && !!saved?.profile.retire.basic) ? "attention" : filled[i] ? "done" : "todo");
}
