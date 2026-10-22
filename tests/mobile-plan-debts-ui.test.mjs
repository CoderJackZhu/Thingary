import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import { basicFixtureSources, basicInputFixtures } from "../src/plan-basic-fixtures.ts";
import * as format from "../src/mobile/format.ts";

function mount({ saveResult = { revision: 9 } } = {}) {
  const sources = basicFixtureSources(basicInputFixtures.prediction),
    saved = sources.profile.value.saved,
    calls = [],
    done = [];
  sources.snapshot = {
    status: "ready",
    value: { id: "s1", date: "2026-09-30", notes: "", revision: 1, missing: [], entries: [{ account_id: "loan-1", state: "entered", amount_cents: "50000000", side: "liability", kind: "loan", counted: true, currency: "CNY" }] },
  };
  sources.accounts = { status: "ready", value: [{ id: "loan-1", fields: { name: "虚构房贷", side: "liability", kind: "loan", counted: true }, position: 0, revision: 1, latest: null }] };
  saved.profile.retire.core.debt_repayments = [];
  const saver = { busy: false, stuck: false, notice: "", async save(input, revision) { calls.push({ input: structuredClone(input), revision }); return saveResult; } };
  const h = runtime(
    "mobile/plan/Debts",
    { sources, saved, today: sources.today, reload() {}, onDone: () => done.push(true) },
    undefined,
    undefined,
    {
      exportName: "DebtEditor",
      components: [],
      modules: {
        "./mobile/format": format,
        "./mobile/plan/data": { usePlanSaver: () => saver },
        "./mobile/nav-context": { useNav: () => ({ pop() {}, push() {} }) },
      },
    },
  );
  return { h, calls, done, saved };
}

test("loan page opens straight in the editor; nothing saves until a repayment is stated, unknowns stay unknown", async () => {
  const { h, calls, done } = mount();
  assert.ok(h.find("FormGroup", (p) => p.title === "虚构房贷"));
  h.find("Button", (p) => p.children === "保存还款安排").props.onClick();
  await h.settle();
  assert.equal(calls.length, 0);
  assert.ok(h.find("Notice", (p) => p.tone === "danger"));
  assert.equal(done.length, 0);
  for (const phase of ["退休前", "退休后"])
    h.find("SelectField", (p) => p.label === `虚构房贷${phase}还款方式`).props.onChange("included");
  h.render();
  h.find("Button", (p) => p.children === "保存还款安排").props.onClick();
  await h.settle();
  assert.equal(calls[0].input.section, "debt_repayments");
  assert.equal(calls[0].input.fields.updates[0].before, "included");
  assert.equal(calls[0].input.fields.updates[0].monthly_cents, null);
  assert.equal(done.length, 1);
});

test("a refused save keeps the loan editor open", async () => {
  const { h, done } = mount({ saveResult: null });
  h.find("SelectField", (p) => p.label === "虚构房贷退休前还款方式").props.onChange("excluded");
  h.render();
  h.find("Button", (p) => p.children === "保存还款安排").props.onClick();
  await h.settle();
  assert.equal(done.length, 0);
  assert.ok(h.find("Button", (p) => p.children === "保存还款安排"));
});
