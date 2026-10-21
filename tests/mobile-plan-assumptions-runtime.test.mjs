import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import { basicFixtureSources } from "../src/plan-basic-fixtures.ts";

test("assumption receipt confirmed after an unknown reply closes the stale-revision form", async () => {
  const sources = basicFixtureSources(),
    session = {
      settled: null,
      navBlocked: false,
      pending: null,
      setBusy() {},
      refreshPending() {},
      reload() {},
    },
    pops = [];
  const values = {
    real_return_before_hundredths: 0,
    real_return_after_hundredths: 0,
    inflation_hundredths: 200,
    volatility_hundredths: 500,
  };
  const calls = [],
    port = {
      readAssumptions: async () => ({
        status: "ready",
        value: {
          generation: sources.generation,
          revision: 7,
          values,
          confirmation: "unconfirmed",
          confirmed_values: null,
        },
      }),
      saveAssumptions: async (v, confirm, context) => {
        calls.push({ v, confirm, context });
        return { status: "unresolved", request_id: context.request_id };
      },
    };
  const h = runtime(
    "mobile/plan/assumptions",
    { sources, reload() {} },
    undefined,
    undefined,
    {
      exportName: "Assumptions",
      components: [],
      modules: {
        "./planning-followup-port": {
          nativePlanningFollowupPortV1: () => port,
        },
        "./mobile/session": { useSession: () => session },
        "./mobile/nav-context": {
          useNav: () => ({ pop: () => pops.push("closed") }),
        },
      },
    },
  );
  await h.settle();
  h.find("Button", (p) => p.children === "保存假设").props.onClick();
  await h.settle();
  assert.equal(calls[0].context.expected_revision, 7);
  assert.equal(pops.length, 0);
  session.settled = {
    command: "plan_assumptions_save",
    input: {
      generation: sources.generation,
      request_id: calls[0].context.request_id,
    },
  };
  h.render();
  assert.ok(pops.length > 0);
});
