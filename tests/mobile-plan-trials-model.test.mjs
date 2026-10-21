import test from "node:test";
import assert from "node:assert/strict";
import {
  careerTrial,
  runwayTrial,
  trialDateValid,
} from "../src/mobile/plan/trial-model.ts";
import { careerSources } from "../src/career-preview/fixtures.ts";
import {
  realGuidedDefaults,
  confirmGuidedCashCosts,
  saySwitch,
} from "../src/career-preview/guided-model.ts";
import { evaluateCareerScenario } from "../src/plan-career.ts";
import { prepareIncomeScope } from "../src/career-preview/income-scope.ts";
import { runway } from "../src/plan-runway.ts";

const base = {
  start: "1000000",
  date: "2026-10-01",
  today: "2026-10-21",
  income: "",
  noIncome: false,
  spend: "100000",
  floor: "",
  months: 12,
};
test("runway keeps missing income and funds unknown, while explicit zero calculates", () => {
  assert.equal(runwayTrial(base).status, "missing");
  assert.equal(
    runwayTrial({ ...base, start: null, noIncome: true }).status,
    "missing",
  );
  const out = runwayTrial({ ...base, noIncome: true });
  assert.equal(out.status, "calculated");
  assert.deepEqual(
    out.result,
    runway({
      start_cents: 1000000,
      income_cents: 0,
      spend_cents: 100000,
      floor_cents: null,
      months: 12,
    }),
  );
  assert.equal(out.result.covered_months, 10);
});
test("runway rejects invalid/future dates and discloses invalid money", () => {
  assert.equal(trialDateValid("2026-02-30"), false);
  assert.equal(
    runwayTrial({ ...base, noIncome: true, date: "2026-11-01" }).status,
    "missing",
  );
  const out = runwayTrial({ ...base, noIncome: true, start: "0.25" });
  assert.equal(out.result.status, "invalid");
});
test("career missing cash facts never become zero or a successful answer", () => {
  const sources = careerSources(),
    defaults = realGuidedDefaults(sources, "2026-10-21");
  const before = JSON.stringify(sources);
  const result = careerTrial(
    sources,
    defaults.draft,
    defaults.income,
    "rest",
    0,
  );
  assert.equal(result.answer, null);
  assert.match(result.message, /还差/);
  assert.equal(JSON.stringify(sources), before);
});
test("career switch uses the same scoped engine result without changing saved facts", () => {
  const sources = careerSources(),
    defaults = realGuidedDefaults(sources, sources.today);
  let draft = confirmGuidedCashCosts(defaults.draft, true);
  draft.gap_months = 0;
  const input = { ...defaults.income, mode: "excluded", excludePools: true };
  const scope = prepareIncomeScope(sources, draft, input),
    before = JSON.stringify(sources);
  const result = careerTrial(sources, draft, input, "switch", 0);
  assert.equal(result.message, null);
  assert.deepEqual(
    result.answer,
    saySwitch(
      evaluateCareerScenario(scope.sources, scope.draft),
      draft.recovery.monthly_cents,
    ),
  );
  assert.equal(JSON.stringify(sources), before);
});
test("career blocked profile returns a reason and no answer", () => {
  const sources = careerSources(),
    defaults = realGuidedDefaults(sources, sources.today);
  sources.profile.value.saved = null;
  const result = careerTrial(
    sources,
    defaults.draft,
    defaults.income,
    "switch",
    0,
  );
  assert.equal(result.answer, null);
  assert.match(result.message, /未就绪/);
});
