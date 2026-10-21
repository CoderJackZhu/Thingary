import test from "node:test";
import assert from "node:assert/strict";
import {
  contributionReturnMatrix,
  sorr,
  stressTests,
  largestRisk,
} from "../src/plan-risk.ts";
import {
  compactMatrix,
  riskPlot,
  fanPlot,
  riskMoney,
  sequenceConclusion,
  stressConclusion,
} from "../src/mobile/plan/risk-view.ts";
import * as view from "../src/mobile/plan/risk-view.ts";
import * as risk from "../src/plan-risk.ts";
import { runtime } from "./planning-component-runtime.mjs";

const plan = (over = {}) => ({
  now_months: 360,
  horizon_months: 1080,
  search_cap_months: 840,
  target_months: 480,
  mode: "fire",
  assets_cents: 5_000_000,
  saving_cents: 1500,
  saving_growth_hundredths: 0,
  r_before_hundredths: 200,
  r_after_hundredths: 100,
  inflation_hundredths: 200,
  volatility_hundredths: 0,
  items: [
    {
      id: "l",
      label: "虚构生活",
      monthly_cents: 1000,
      start_age: null,
      end_age: null,
      inflation_hundredths: null,
      essential: true,
    },
  ],
  incomes: [],
  spends: [],
  pension_at: () => ({
    monthly_cents: 300,
    lump_cents: 20_000,
    unlock_age_months: 756,
  }),
  ...over,
});

test("mobile three by three matrix keeps the engine baseline and exact cell references", () => {
  for (const saving of [0, 1500, -500]) {
    const source = contributionReturnMatrix(
        plan({ saving_cents: saving }),
        2026,
      ),
      compact = compactMatrix(source);
    assert.equal(compact.rows.length, Math.min(3, source.rows.length));
    assert.equal(compact.cols.length, Math.min(3, source.cols.length));
    assert.equal(
      compact.cells[compact.base_row][compact.base_col],
      source.cells[source.base_row][source.base_col],
    );
    for (const row of compact.cells)
      for (const cell of row)
        assert.ok(source.cells.some((original) => original.includes(cell)));
    assert.equal(compact.cols[compact.base_col], source.cols[source.base_col]);
  }
});

test("plot lines use one shared axis and zero values retain their meaning", () => {
  const [low, high] = riskPlot([
    [0, 50],
    [0, 100],
  ]);
  assert.equal(low.split(" L")[0], high.split(" L")[0]);
  assert.notEqual(low.split(" L")[1], high.split(" L")[1]);
  assert.match(riskPlot([[0, 0]])[0], /^M8\.00,120\.00 L292\.00,120\.00$/);
  const fan = fanPlot({
    p10: [0, 10],
    p25: [0, 20],
    p50: [0, 30],
    p75: [0, 40],
    p90: [0, 50],
  });
  assert.equal(
    fan.middle,
    riskPlot([
      [0, 10],
      [0, 30],
      [0, 50],
    ])[1],
  );
  assert.match(fan.area, / Z$/);
  assert.doesNotMatch(fan.area, /NaN|undefined/);
});

test("sequence conclusions describe real engine values and unavailable results explicitly", () => {
  assert.match(sequenceConclusion(null), /需要/);
  const paths = sorr(plan(), 2026);
  const conclusion = sequenceConclusion(paths);
  assert.ok(
    conclusion.includes(
      riskMoney(paths.find((path) => path.id === "early").final),
    ),
  );
  assert.ok(
    conclusion.includes(
      riskMoney(paths.find((path) => path.id === "late").final),
    ),
  );
});

test("stress summary reports the engine selected risk without fabricating a delay", () => {
  assert.equal(stressConclusion(null), "这些压力测试未实质性改变基础计划。");
  const top = largestRisk(stressTests(plan(), 2026));
  assert.ok(stressConclusion(top).includes(top.label));
  assert.doesNotMatch(
    stressConclusion({ ...top, fi_delay_months: null }),
    /推迟 null/,
  );
});

test("stopping and retrying market paths rejects a late result from the stopped request", async () => {
  const timers = [],
    requests = [],
    P = plan();
  const state = {
    capabilities: { prediction: { status: "ready", value: { plan: P } } },
    today: "2026-10-21",
    loading: false,
    error: "",
    reload() {},
  };
  const ui = new Proxy({}, { get: (_, name) => String(name) });
  const screen = runtime("mobile/plan/WhatIf", {}, undefined, undefined, {
    exportName: "default",
    components: [],
    globals: {
      AbortController,
      setTimeout: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
    },
    modules: {
      "./mobile/plan/data": { usePlan: () => state },
      "./mobile/nav-context": { useNav: () => ({ push() {} }) },
      "./mobile/ui": ui,
      "./plan-ledger": { timeLabel: (_, month) => `month-${month}` },
      "./mobile/plan/risk-view": view,
      "./plan-risk": {
        ...risk,
        monteCarlo: (_, n, opts) =>
          new Promise((resolve) => requests.push({ n, opts, resolve })),
      },
    },
  });
  timers.shift()();
  assert.equal(requests.length, 1);
  screen
    .find("Button", (props) => props.children === "停止计算")
    .props.onClick();
  screen.render();
  assert.equal(requests[0].opts.signal.aborted, true);
  screen
    .find("Button", (props) => props.children === "重新计算")
    .props.onClick();
  screen.render();
  timers.shift()();
  assert.equal(requests.length, 2);
  const result = {
    n: 1000,
    success_rate: 0.25,
    bands: { p10: [0], p25: [0], p50: [0], p75: [0], p90: [0] },
    final: { p10: 0, p50: 0, p90: 0 },
  };
  requests[0].resolve({ ...result, success_rate: 0.99 });
  await screen.settle();
  assert.doesNotMatch(screen.text(screen.render()), /99%/);
  requests[1].resolve(result);
  await screen.settle();
  assert.match(screen.text(screen.render()), /25%/);
  screen.unmount();
  assert.equal(requests[1].opts.signal.aborted, true);
});
