import test from "node:test";
import assert from "node:assert/strict";
import {
  basicFixtureSources,
  basicInputFixtures,
} from "../src/plan-basic-fixtures.ts";
import { buildBasicCapabilities } from "../src/plan-basic.ts";
import { setupDraft } from "../src/planning-first-run.ts";
import { editorInput } from "../src/mobile/plan/setup-model.ts";
import { goalView } from "../src/mobile/plan/goal-model.ts";
import { budgetComparisons } from "../src/mobile/plan/detail-model.ts";
import { overlayPlanningDrafts } from "../src/planning-draft.ts";
import { currentReportInput } from "../src/planning-report/current-adapter.ts";
import { copyText, printableHtml } from "../src/planning-report/model.ts";
import { householdLines } from "../src/planning-simplified-ui/household-view.ts";
const source = () => basicFixtureSources(basicInputFixtures.prediction);
const savedOf = (s) => s.profile.value.saved;
test("mobile unknown contributions stay unknown, explicit zero remains zero; scoped saving preserves facts", () => {
  const s = source(),
    saved = savedOf(s),
    snapshot = s.snapshot.status === "ready" ? s.snapshot.value : null;
  const d = setupDraft(saved, snapshot, true),
    before = structuredClone(saved);
  d.contribution = "";
  const input = editorInput(d, saved, s.today, true, "contribution");
  assert.equal(input.section, "basic");
  assert.equal(input.fields.basic.contribution.monthly_cents, null);
  const caps = buildBasicCapabilities(overlayPlanningDrafts(s, [input]));
  assert.equal(caps.prediction.status, "blocked");
  assert.ok(
    caps.prediction.missing.some((m) => m.code === "CONTRIBUTION_UNKNOWN"),
  );
  d.contribution = "0";
  assert.equal(
    editorInput(d, saved, s.today, true, "contribution").fields.basic
      .contribution.monthly_cents,
    "0",
  );
  assert.deepEqual(saved, before);
});
test("five-step setup commits existing setup DTO atomically and partner saving is a share, not extra funds", () => {
  const s = source(),
    saved = savedOf(s),
    d = setupDraft(saved, null, true);
  d.simplified.household = {
    mode: "couple",
    partner: {
      birth_month: "1990-01",
      stop_age_months: 60 * 12,
      monthly_cents: null,
    },
  };
  const input = editorInput(d, saved, s.today, true, "setup");
  assert.equal(input.section, "setup");
  assert.equal(input.fields.simplified.household.partner.monthly_cents, null);
  assert.equal(
    input.fields.basic.basic.contribution.monthly_cents,
    d.contribution,
  );
  d.simplified.household.partner.stop_age_months = -1;
  assert.throws(
    () => editorInput(d, saved, s.today, true, "setup"),
    /伴侣停工年龄/,
  );
});
test("income and funds editors use their own partitions without rewriting future contribution", () => {
  const s = source(),
    saved = savedOf(s),
    d = setupDraft(saved, s.snapshot.value, true);
  assert.equal(
    editorInput(d, saved, s.today, true, "income").section,
    "simplified",
  );
  d.start = "live";
  assert.equal(editorInput(d, saved, s.today, true, "funds").section, "setup");
  saved.profile.retire.basic.start = { kind: "live" };
  assert.equal(editorInput(d, saved, s.today, true, "funds").section, "funds");
});
test("mobile goal conclusion carries shared household comparison and never invents a predicted month", () => {
  const s = source(),
    saved = savedOf(s),
    caps = buildBasicCapabilities(s),
    view = goalView(saved, caps);
  assert.match(view.kind, /一个人/);
  assert.equal(typeof view.verdict, "string");
  const h = {
    mode: "couple",
    partner: {
      birth_month: "1990-01",
      stop_age_months: 720,
      monthly_cents: "200000",
    },
  };
  saved.profile.retire.simplified.household = h;
  caps.prediction.value.household = {
    both_stop_month: "2050-01",
    same_time_stop_month: "2052-01",
    partner_stop_month: "2050-01",
  };
  const v = goalView(saved, caps);
  assert.match(v.kind, /两个人/);
  assert.deepEqual(
    v.household,
    householdLines(h, caps.prediction.value.household, v.stop),
  );
  const unknown = overlayPlanningDrafts(s, [
    {
      section: "basic",
      fields: editorInput(
        { ...setupDraft(saved, null, true), contribution: "" },
        saved,
        s.today,
        true,
        "contribution",
      ).fields,
    },
  ]);
  assert.equal(goalView(saved, buildBasicCapabilities(unknown)).stop, null);
});
test("budget alternatives use shared engine and report exports honor the same privacy projection", () => {
  const s = source(),
    saved = savedOf(s),
    caps = buildBasicCapabilities(s),
    pred = caps.prediction.value;
  const before = pred.plan.items.map((x) => ({ ...x }));
  const rows = budgetComparisons(pred, 2026);
  assert.equal(rows.length, 4);
  assert.deepEqual(pred.plan.items, before);
  const report = currentReportInput(s, caps, s.today),
    privateText = copyText(report, true),
    html = printableHtml(report, { privacy: true });
  assert.ok(privateText.includes("隐藏"));
  assert.ok(
    !privateText.includes(
      saved.profile.retire.basic.contribution.monthly_cents,
    ),
  );
  assert.ok(html.includes("<html"));
  assert.ok(!html.includes("¥5,000"));
});

test("a cleared fund participation percentage stays invalid while explicit zero is saved as zero", () => {
  const s = source(),
    saved = savedOf(s),
    d = setupDraft(saved, null, true);
  d.start = "live";
  saved.profile.retire.basic.start = { kind: "live" };
  d.funds = [
    {
      account_id: "fictional-cash",
      availability: "available",
      share_hundredths: NaN,
    },
  ];
  assert.throws(
    () => editorInput(d, saved, s.today, true, "funds"),
    /留空不会按 0/,
  );
  d.funds[0].share_hundredths = 0;
  assert.equal(
    editorInput(d, saved, s.today, true, "funds").fields.fund_rules[0]
      .share_hundredths,
    0,
  );
});
