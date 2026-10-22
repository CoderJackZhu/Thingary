import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import {
  basicFixtureSources,
  basicInputFixtures,
} from "../src/plan-basic-fixtures.ts";
import * as model from "../src/mobile/plan/setup-model.ts";
function mount(section = "setup") {
  const sources = basicFixtureSources(basicInputFixtures.prediction),
    saved = sources.profile.value.saved,
    calls = [],
    expected = [];
  saved.profile.retire.simplified.household = {
    mode: "couple",
    partner: {
      birth_month: "1990-01",
      stop_age_months: 720,
      monthly_cents: "200000",
    },
  };
  const session = { navBlocked: false, settled: null };
  const saver = {
    busy: false,
    stuck: false,
    notice: "",
    async save(input, revision) {
      calls.push(structuredClone(input));
      expected.push(revision);
      return null;
    },
  };
  const h = runtime(
    "mobile/plan/Setup",
    { sources, saved, today: sources.today, reload() {}, section },
    undefined,
    undefined,
    {
      exportName: "Editor",
      components: [],
      document: { querySelector: () => null },
      modules: {
        "./mobile/plan/setup-model": model,
        "./mobile/session": { useSession: () => session },
        "./mobile/nav-context": { useNav: () => ({ pop() {} }) },
        "./mobile/plan/data": { usePlanSaver: () => saver },
      },
    },
  );
  return { h, calls, expected, saved, saver };
}
// 保存只在右上 NavBar（底部「保存，查看结果」已移除）；这里取它的 primary 当按钮用。
const saveButton = (h) => ({ props: h.find("NavBar").props.primary });
test("partner share edit commits together with household total instead of discarding partner field", async () => {
  const { h, calls } = mount("contribution");
  h.find("MoneyField", (p) => p.label === "其中伴侣每月存多少").props.onChange(
    "100000",
  );
  h.render();
  saveButton(h).props.onClick();
  await h.settle();
  assert.equal(calls[0].section, "setup");
  assert.equal(
    calls[0].fields.simplified.household.partner.monthly_cents,
    "100000",
  );
  assert.equal(
    calls[0].fields.basic.basic.contribution.monthly_cents,
    "500000",
  );
});
test("setup editor keeps original expected_revision and unresolved state disables save", async () => {
  const { h, saved, expected, saver } = mount("contribution"),
    initial = saved.revision;
  saved.revision += 3;
  h.render();
  saveButton(h).props.onClick();
  await h.settle();
  assert.equal(expected[0], initial);
  saver.stuck = true;
  h.render();
  assert.equal(
    saveButton(h).props.disabled,
    true,
  );
});
test("wizard shows one step and advancing or returning never submits the draft", () => {
  const { h, calls } = mount();
  assert.equal(
    h.find("MoneyField", (p) => p.label === "每月生活费总额"),
    undefined,
  );
  h.find("Button", (p) => p.children === "下一步").props.onClick();
  h.render();
  assert.ok(h.find("MoneyField", (p) => p.label === "每月生活费总额"));
  assert.equal(calls.length, 0);
  h.find("Button", (p) => p.children === "上一步").props.onClick();
  h.render();
  assert.equal(calls.length, 0);
});

test("later incomplete income never traps the user on an earlier wizard step", () => {
  const { h, saved, calls } = mount("setup");
  // Model a valid earlier step with an incomplete later form draft.
  h.find("Button", (p) => p.children === "下一步").props.onClick();
  h.render();
  h.find("Button", (p) => p.children === "下一步").props.onClick();
  h.render();
  h.find("Button", (p) => p.children === "下一步").props.onClick();
  h.render();
  h.find("Button", (p) => p.children === "添加未来收入").props.onClick();
  h.render();
  h.find("SelectField", (p) => p.label === "金额对应物价").props.onChange(
    "reference_month",
  );
  h.render();
  h.find("Button", (p) => p.children === "上一步").props.onClick();
  h.render();
  h.find("Button", (p) => p.children === "下一步").props.onClick();
  h.render();
  assert.ok(h.find("SelectField", (p) => p.label === "金额对应物价"));
  assert.equal(calls.length, 0);
});

test("switching partner to same stop date clears the now-hidden saving share", async () => {
  const { h, calls } = mount("time");
  h.find("SelectField", (p) => p.label === "伴侣打算何时停工").props.onChange(
    "same",
  );
  h.render();
  saveButton(h).props.onClick();
  await h.settle();
  assert.equal(
    calls[0].fields.simplified.household.partner.stop_age_months,
    null,
  );
  assert.equal(
    calls[0].fields.simplified.household.partner.monthly_cents,
    null,
  );
});
