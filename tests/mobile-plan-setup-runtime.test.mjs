import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import {
  basicFixtureSources,
  basicInputFixtures,
} from "../src/plan-basic-fixtures.ts";
import * as model from "../src/mobile/plan/setup-model.ts";
import * as eventModel from "../src/mobile/plan/events-model.ts";
import * as debtModel from "../src/mobile/plan/debts-model.ts";
import * as format from "../src/mobile/format.ts";
function mount(section = "setup", { spendItems = [], push = () => {}, loan = null, saveResult = null } = {}) {
  const sources = basicFixtureSources(basicInputFixtures.prediction),
    saved = sources.profile.value.saved,
    calls = [],
    expected = [];
  saved.profile.retire.spend_items = structuredClone(spendItems);
  if (loan) {
    sources.snapshot = { status: "ready", value: { id: "s1", date: "2026-09-30", notes: "", revision: 1, missing: [], entries: [{ account_id: "loan-1", state: "entered", amount_cents: "50000000", side: "liability", kind: "loan", counted: true, currency: "CNY" }] } };
    sources.accounts = { status: "ready", value: [{ id: "loan-1", fields: { name: "虚构房贷", side: "liability", kind: "loan", counted: true }, position: 0, revision: 1, latest: null }] };
    saved.profile.retire.core.debt_repayments = loan === "saved" ? [{ account_id: "loan-1", recorded_on: sources.today, as_of: "2026-09-30", balance_cents: "50000000", start_month: "2026-10", last_month: "2046-09", monthly_cents: "300000", before: "scheduled", after: "scheduled" }] : [];
  }
  saved.profile.retire.simplified.household = {
    mode: "couple",
    partner: {
      birth_month: "1990-01",
      stop_age_months: 720,
      monthly_cents: "200000",
    },
  };
  const session = { navBlocked: false, settled: null, reload() {} };
  const pops = [], assumptionSaves = [];
  const port = {
    readAssumptions: async () => ({ status: "ready", value: { generation: sources.generation, revision: 9, values: { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 }, confirmation: "unconfirmed", confirmed_values: null } }),
    saveAssumptions: async (values, confirm, context) => { assumptionSaves.push({ values, confirm, context }); return { status: "saved", id: "profile", revision: 11 }; },
  };
  const saver = {
    busy: false,
    stuck: false,
    notice: "",
    async save(input, revision) {
      calls.push(structuredClone(input));
      expected.push(revision);
      return saveResult ? saveResult(input, revision) : null;
    },
  };
  const h = runtime(
    "mobile/plan/Setup",
    { sources, saved, today: sources.today, reload() {}, section },
    undefined,
    undefined,
    {
      exportName: "Editor",
      components: ["mobile/plan/assumptions", "mobile/plan/StageCostGroup"],
      document: { querySelector: () => null },
      modules: {
        "./mobile/plan/setup-model": model,
        "./mobile/plan/events-model": eventModel,
        "./mobile/plan/debts-model": debtModel,
        "./mobile/format": format,
        "./mobile/session": { useSession: () => session },
        "./planning-followup-port": { nativePlanningFollowupPortV1: () => port },
        "./mobile/nav-context": { useNav: () => ({ pop: () => pops.push("closed"), push }) },
        "./mobile/plan/data": { usePlanSaver: () => saver },
      },
    },
  );
  return { h, calls, expected, saved, saver, pops, assumptionSaves };
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
  h.find("MoneyField", (p) => p.label === "你估计每月能存").props.onChange("123400");
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

test("flow: stepping never writes; 保存 writes the edited steps once, in order, then closes", async () => {
  const next = (h) => h.find("Button", (p) => p.children === "下一步").props.onClick();
  const clean = mount("setup");
  for (let i = 0; i < 4; i++) { next(clean.h); clean.h.render(); }
  next(clean.h); clean.h.render();
  await clean.h.settle();
  assert.equal(clean.calls.length, 0, "crossing into 假设 writes nothing");
  saveButton(clean.h).props.onClick();
  await clean.h.settle();
  assert.equal(clean.calls.length, 0, "nothing edited: 保存 just closes");
  assert.deepEqual(clean.pops, ["closed"]);
  const edited = mount("setup", { saveResult: (input, revision) => ({ revision: revision + 1, profile: { ...structuredClone(edited.saved.profile), retire: { ...structuredClone(edited.saved.profile.retire) } } }) });
  for (let i = 0; i < 4; i++) { next(edited.h); edited.h.render(); }
  edited.h.find("MoneyField", (p) => p.label === "你估计每月能存").props.onChange("123400");
  edited.h.render();
  next(edited.h); edited.h.render();
  await edited.h.settle();
  edited.h.find("TextField", (p) => p.label === "通胀（%）").props.onChange("3");
  edited.h.render();
  assert.equal(edited.calls.length, 0, "stepping with edits writes nothing");
  saveButton(edited.h).props.onClick();
  await edited.h.settle();
  assert.equal(edited.calls.length, 1);
  assert.equal(edited.calls[0].section, "setup");
  assert.equal(edited.calls[0].fields.basic.basic.contribution.monthly_cents, "123400");
  assert.equal(edited.assumptionSaves.length, 1, "the assumptions are written after the setup unit");
  assert.equal(edited.assumptionSaves[0].values.inflation_hundredths, 300);
  assert.equal(edited.assumptionSaves[0].context.expected_revision, 9);
  assert.deepEqual(edited.pops, ["closed"]);
});

test("step dots: tapping jumps straight to that step and keeps the draft", () => {
  const { h } = mount("setup");
  h.find("FlowSteps").props.onJump(4);
  h.render();
  h.find("MoneyField", (p) => p.label === "你估计每月能存").props.onChange("777");
  h.render();
  h.find("FlowSteps").props.onJump(1);
  h.render();
  assert.ok(h.find("MoneyField", (p) => p.label === "每月生活费总额"));
  assert.equal(h.find("FlowSteps").props.index, 1);
  h.find("FlowSteps").props.onJump(4);
  h.render();
  assert.equal(h.find("MoneyField", (p) => p.label === "你估计每月能存").props.value, "777");
});

test("保存 with a wrong value jumps to the first step with a problem and shows it at the field; blanks do not block", async () => {
  const { h, calls } = mount("setup");
  h.find("FlowSteps").props.onJump(1);
  h.render();
  h.find("TextField", (p) => p.label === "应急金月数").props.onChange("99");
  h.find("TextField", (p) => p.label === "应急金月数").props.onChange("99");
  h.render();
  assert.equal(h.find("FlowSteps").props.statuses[1], "done", "no error is shown before a save is refused");
  h.find("FlowSteps").props.onJump(4);
  h.render();
  saveButton(h).props.onClick();
  await h.settle();
  assert.equal(calls.length, 0);
  assert.equal(h.find("FlowSteps").props.index, 1);
  assert.equal(h.find("FlowSteps").props.statuses[1], "attention");
  assert.match(h.text(h.nodes()[0]), /应急金月数须是 0 到 36 的整数/);
  h.find("TextField", (p) => p.label === "应急金月数").props.onChange("");
  h.render();
  assert.match(h.text(h.nodes()[0]), /请填写应急金月数/);
});

test("the bottom bar holds only 上一步/下一步, and 保存 on the last step; the top bar has the one 取消/保存", () => {
  const { h } = mount("setup");
  assert.equal(h.find("NavBar").props.primary.label, "保存");
  assert.equal(h.find("Button", (p) => p.children === "完成"), undefined);
  assert.equal(h.find("Button", (p) => p.children === "保存"), undefined);
  h.find("FlowSteps").props.onJump(6);
  h.render();
  assert.equal(h.find("Button", (p) => p.children === "下一步"), undefined);
  assert.ok(h.find("Button", (p) => p.children === "上一步"));
  assert.ok(h.find("Button", (p) => p.children === "保存"));
});

test("取消 closes at once when nothing changed, and asks 放弃这次修改？ when there are edits", () => {
  const clean = mount("setup");
  clean.h.find("NavBar").props.onCancel();
  assert.deepEqual(clean.pops, ["closed"]);
  const { h, pops, calls } = mount("setup");
  h.find("FlowSteps").props.onJump(4);
  h.render();
  h.find("MoneyField", (p) => p.label === "你估计每月能存").props.onChange("555");
  h.render();
  h.find("NavBar").props.onCancel();
  h.render();
  assert.deepEqual(pops, []);
  const sheet = h.find("Sheet");
  assert.equal(sheet.props.title, "放弃这次修改？");
  assert.equal(sheet.props.cancelLabel, "继续编辑");
  h.find("Button", (p) => p.children === "放弃").props.onClick();
  assert.deepEqual(pops, ["closed"]);
  assert.equal(calls.length, 0, "放弃 writes nothing");
  assert.match(h.text(h.nodes()[0]), /取消不保存/);
});

test("opened for one step: shows that step with only the top 保存 and no bottom bar", () => {
  const { h } = mount("budget");
  assert.ok(h.find("MoneyField", (p) => p.label === "每月生活费总额"));
  assert.equal(h.find("Button", (p) => p.children === "完成"), undefined);
  assert.equal(h.find("ActionBar"), undefined);
  assert.equal(h.find("FlowSteps"), undefined);
  assert.equal(h.find("Button", (p) => p.children === "下一步"), undefined);
});

const stage = { id: "stage-1", label: "赡养父母", monthly_cents: "300000", start_month: null, end_month: "2050-12", inflation_hundredths: null, essential: true, time_unconfirmed: false };
const next = (h) => { h.find("Button", (p) => p.children === "下一步").props.onClick(); h.render(); };
const type = (h, label, v, kind = "TextField") => { h.find(kind, (p) => p.label === label).props.onChange(v); h.render(); };

test("budget step: stage costs sit under the budget fields, collapsed until used, no longer sent to the 大额支出 page", () => {
  const { h } = mount("setup");
  next(h);
  assert.ok(h.find("MoneyField", (p) => p.label === "每月生活费总额"));
  const header = h.nodes().find((n) => n.type === "button" && h.text(n).startsWith("退休后另有阶段性支出（选填）"));
  assert.equal(header.props["aria-expanded"], false);
  assert.equal(h.find("Button", (p) => p.children === "添加一笔阶段性支出"), undefined);
  const withItem = mount("setup", { spendItems: [stage] });
  next(withItem.h);
  const open = withItem.h.nodes().find((n) => n.type === "button" && h.text(n).startsWith("退休后另有阶段性支出"));
  assert.equal(open.props["aria-expanded"], true);
  assert.match(withItem.h.text(withItem.h.find("section", (p) => p["aria-label"] === "退休后的阶段性支出") ?? withItem.h.nodes()[0]), /赡养父母/);
  assert.ok(withItem.h.button("编辑赡养父母"));
  assert.ok(withItem.h.button("删除赡养父母"));
});

test("a stage cost added in the budget step is written by the flow's one 保存, with the draft, and is not lost", async () => {
  const { h, calls } = mount("setup");
  next(h);
  h.nodes().find((n) => n.type === "button" && h.text(n).startsWith("退休后另有阶段性支出")).props.onClick();
  h.render();
  h.find("Button", (p) => p.children === "添加一笔阶段性支出").props.onClick();
  h.render();
  type(h, "阶段性支出每月金额", "250000", "MoneyField");
  type(h, "支出结束月份", "2045-06", "MonthField");
  h.find("Button", (p) => p.children === "加入这笔支出").props.onClick();
  h.render();
  assert.equal(calls.length, 0, "nothing is written until the step flow saves");
  assert.match(h.text(h.nodes()[0]), /子女教育/);
  // Move on through the other setup steps, then leave the setup unit: the one save carries the item.
  for (let i = 0; i < 4; i++) next(h);
  assert.equal(calls.length, 0);
  saveButton(h).props.onClick();
  await h.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].section, "setup");
  const saved = calls[0].fields.budget.spend_items;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].label, "子女教育");
  assert.equal(saved[0].monthly_cents, "250000");
  assert.equal(saved[0].end_month, "2045-06");
  assert.equal(saved[0].start_month, null);
  assert.deepEqual(
    calls[0].fields.basic.basic.retirement_costs.filter((c) => c.source_id === `spend:${saved[0].id}`).map((c) => c.treatment),
    ["extra"],
  );
});

test("single-step budget editing saves stage cost edits and deletions with 保存; invalid input is refused with a message", async () => {
  const { h, calls } = mount("budget", { spendItems: [stage, { ...stage, id: "stage-2", label: "医疗与护理" }] });
  h.button("删除医疗与护理").props.onClick();
  h.render();
  h.button("编辑赡养父母").props.onClick();
  h.render();
  type(h, "阶段性支出每月金额", "0", "MoneyField");
  h.find("Button", (p) => p.children === "更新这笔支出").props.onClick();
  h.render();
  assert.ok(h.find("Notice", (p) => p.tone === "danger"), "zero monthly amount is rejected, not stored");
  type(h, "阶段性支出每月金额", "350000", "MoneyField");
  h.find("Button", (p) => p.children === "更新这笔支出").props.onClick();
  h.render();
  assert.equal(h.find("Notice", (p) => p.tone === "danger"), undefined);
  h.find("NavBar").props.primary.onClick();
  await h.settle();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].fields.budget.spend_items.map((i) => [i.id, i.monthly_cents]), [["stage-1", "350000"]]);
});

test("untouched stage costs add no budget write", async () => {
  const { h, calls } = mount("budget", { spendItems: [stage] });
  type(h, "每月生活费总额", "880000", "MoneyField");
  h.find("NavBar").props.primary.onClick();
  await h.settle();
  assert.equal(calls[0].fields.budget, null);
});

test("funds step: the loan row says whether repayment is confirmed, opens the loan page, and saves open edits first", async () => {
  const pushed = [];
  const none = mount("setup");
  next(none.h); next(none.h);
  assert.equal(none.h.find("ListRow", (p) => String(p.title).startsWith("已有贷款")), undefined, "no loans, no row");
  const pending = mount("setup", { loan: "pending", push: (r) => pushed.push(r) });
  next(pending.h); next(pending.h);
  assert.equal(pending.h.find("ListRow", (p) => String(p.title).startsWith("已有贷款")).props.title, "已有贷款 1 笔 · 还款待确认");
  const { h, calls } = mount("setup", { loan: "saved", push: (r) => pushed.push(r) });
  next(h); next(h);
  const row = () => h.find("ListRow", (p) => String(p.title).startsWith("已有贷款"));
  assert.equal(row().props.title, "已有贷款 1 笔 · 还款已确认");
  row().props.onClick();
  await h.settle();
  assert.deepEqual(pushed, ["plan.debts"]);
  assert.equal(calls.length, 0, "an untouched draft is not written");
  // With an open edit, the setup draft is written first (the loan page saves separately and the draft would otherwise be lost).
  const edited = mount("setup", { loan: "saved", push: (r) => pushed.push(r) });
  edited.h.find("Button", (p) => p.children === "下一步").props.onClick(); edited.h.render();
  type(edited.h, "每月生活费总额", "770000", "MoneyField");
  next(edited.h);
  edited.h.find("ListRow", (p) => String(p.title).startsWith("已有贷款")).props.onClick();
  await edited.h.settle();
  assert.equal(edited.calls.length, 1, "the open edit is written first");
  assert.equal(edited.calls[0].section, "setup");
  assert.equal(edited.calls[0].fields.basic.spend_cents, "770000");
  assert.equal(pushed.length, 1, "this mount's save is refused, so it does not navigate away from the unsaved draft");
});
