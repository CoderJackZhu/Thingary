import { setupFields } from "../../planning-first-run.ts";
import {
  basicInput,
  fundsInput,
  costsInput,
} from "../../planning-basic-forms.ts";
import type { Draft } from "../../planning-basic-forms.ts";
import type { ProfileState } from "../../plan.ts";
import { validateSimplifiedPlanningV1 } from "../../plan-simplified.ts";
import { householdIssues } from "../../planning-simplified-ui/household-view.ts";
export const steps = [
  "目标与时间",
  "每月生活费",
  "可用资金",
  "未来收入",
  "每月净投入",
] as const;
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
      "账户计入比例请填写 0 到 100 的百分数；留空不会按 0 保存。",
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
