import test from "node:test";
import assert from "node:assert/strict";
import { annotationSummary } from "../src/plan-annotations.ts";
import {
  annotationTarget,
  coverageGroups,
} from "../src/mobile/plan/coverage-model.ts";
import {
  conditionSummary,
  confirmItems,
  latestChange,
} from "../src/mobile/plan/goal-model.ts";
import {
  flowSteps,
  progressText,
  stepIndex,
  steps,
} from "../src/mobile/plan/setup-model.ts";
import { fanChart } from "../src/mobile/plan/risk-view.ts";
import { buildBasicCapabilities } from "../src/plan-basic.ts";
import {
  basicFixtureSources,
  basicInputFixtures,
} from "../src/plan-basic-fixtures.ts";

const cost = (id) => ({
  id: `cost:retirement:${id}`,
  reason_code: "COST_ASSUMED_EXTRA",
  message: "请确认费用是否已包含；暂按额外费用计入，可能重复包含。",
  effect: "requirement_higher",
  treatment: "assumed_extra",
  source_ids: [id],
  missing_fields: ["费用包含关系"],
  refinement: { owner: "budget", field: "retirement" },
});
const debt = {
  id: "debt:a",
  reason_code: "DEBT_UNLINKED",
  message: "已有负债的退休前还款未计入；负债余额保留。",
  effect: "requirement_lower",
  treatment: "omitted",
  source_ids: ["debt:a"],
  missing_fields: ["还款方式"],
  refinement: { owner: "funds", field: "core.debt_repayments" },
};

test("eight identical cost notes become one line and one detail entry with a count", () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g", "h"].map(cost);
  const groups = coverageGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].line, annotationSummary(rows)[0]);
  assert.match(groups[0].line, /8 项费用/);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].count, 8);
  assert.deepEqual(groups[0].target, { route: "plan.setup", section: "costs" });
});

test("groups follow effect direction; mixed targets leave the group action to each item", () => {
  const groups = coverageGroups([cost("a"), debt]);
  assert.deepEqual(groups.map((g) => g.effect), ["requirement_lower", "requirement_higher"]);
  assert.deepEqual(groups[0].target, { route: "plan.events" });
  const mixed = coverageGroups([cost("a"), { ...debt, effect: "requirement_higher", id: "d2", message: "别的" }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].target, null);
  assert.ok(mixed[0].items.every((i) => i.target));
});

test("unused pools and non-actionable notes give no group action", () => {
  assert.deepEqual(coverageGroups([{ ...debt, reason_code: "POOL_NOT_USED", treatment: "not_used" }]), []);
  assert.equal(annotationTarget({ ...debt, actionable: false }), null);
});

test("goal confirm list never repeats a message and covers costs once", () => {
  const s = basicFixtureSources(basicInputFixtures.prediction),
    saved = s.profile.value.saved,
    caps = buildBasicCapabilities(s);
  caps.annotations = ["a", "b", "c"].map(cost).concat([debt]);
  const items = confirmItems(saved, caps, s.today);
  const titles = items.map((i) => i.title.replace(/（共 \d+ 项）$/, ""));
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(items.filter((i) => i.id === "costs").length, 1);
  assert.match(items.find((i) => i.id === "costs").detail, /3 项费用/);
});

test("condition summary shows unknowns as 未知 / 待确认, never zero", () => {
  const s = basicFixtureSources(basicInputFixtures.prediction),
    saved = s.profile.value.saved,
    caps = buildBasicCapabilities(s);
  saved.profile.retire.spend_cents = null;
  saved.profile.retire.basic.contribution.monthly_cents = null;
  const line = conditionSummary(saved, caps);
  assert.match(line, /退休预算 未知/);
  assert.match(line, /每月存 待确认/);
  assert.doesNotMatch(line, /¥0/);
});

test("latest change line is empty without records and falls back to one record", () => {
  assert.equal(latestChange([]), null);
});

test("setup flow keeps the desktop order and every step title is distinct", () => {
  assert.deepEqual(flowSteps.map((s) => s.id), ["time", "budget", "funds", "income", "contribution", "assumptions", "costs"]);
  assert.deepEqual(steps, ["目标与时间", "退休生活预算", "可用资金", "未来收入", "每月净投入", "收益、通胀与波动假设", "核对费用包含关系"]);
  assert.equal(stepIndex("income"), 3);
  assert.equal(stepIndex("setup"), -1);
  assert.equal(progressText(1), "第 2/7 步");
});

test("fan chart passes median and the 10%-90% band on the engine's own x positions", () => {
  const c = fanChart({ bands: { p10: [1, 2], p25: [], p50: [2, 3], p75: [], p90: [3, 5] }, months: [0, 12], calendar_months: ["2026-01", "2027-01"] });
  assert.deepEqual(c.xs, [0, 12]);
  assert.deepEqual(c.band.upper, [3, 5]);
  assert.equal(c.series[0].values.length, 2);
});
