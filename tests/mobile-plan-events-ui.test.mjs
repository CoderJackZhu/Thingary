import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import * as eventModel from "../src/mobile/plan/events-model.ts";
import { basicFixtureSources } from "../src/plan-basic-fixtures.ts";
import { unknownCapabilityFixture } from "../src/plan-basic-fixtures.ts";
import * as format from "../src/mobile/format.ts";
const element = (type, props) => ({ type, props });
const UI = Object.fromEntries(
  ["Card", "Section", "FormGroup", "FormRow", "Notice"].map((name) => [
    name,
    (props) => element("section", props),
  ]),
);
UI.Button = ({ children, onClick, disabled }) =>
  element("button", { children, onClick, disabled });
UI.Switch = (props) => element("Switch", props);
UI.EmptyState = (props) => element("EmptyState", props);
UI.TextField = (props) => element("TextField", props);
UI.MoneyField = (props) => element("MoneyField", props);
UI.SelectField = (props) => element("SelectField", props);
UI.DateField = (props) => element("DateField", props);
function harness({ save = async () => ({ revision: 2 }), stuck = false } = {}) {
  const sources = basicFixtureSources(),
    saved = sources.profile.value.saved;
  const event = eventModel.eventTemplate(
    "car",
    sources.today,
    "fictional-car",
    false,
  );
  saved.profile.retire.life_events = [event];
  const calls = [],
    expected = [];
  const saver = {
    busy: false,
    stuck,
    notice: "",
    async save(input, revision) {
      calls.push(structuredClone(input));
      expected.push(revision);
      return save(input);
    },
  };
  const page = runtime(
    "mobile/plan/Events",
    { sources, saved, today: sources.today, reload() {} },
    undefined,
    unknownCapabilityFixture,
    {
      exportName: "default",
      components: [],
      modules: {
        "./mobile/ui": UI,
        "./mobile/format": format,
        "./mobile/plan/data": { usePlanSaver: () => saver },
        "./mobile/plan/events-model": eventModel,
        "./plan-basic": {
          buildBasicCapabilities: () => unknownCapabilityFixture,
        },
      },
    },
  );
  return { page, calls, event, saved, expected };
}
test("计入开关只提交 events 分区并保留现有发生事实，原输入不被修改", async () => {
  const { page, calls, event, saved } = harness();
  const occurred = {
    id: "other-occurrence",
    event_id: event.id,
    status: "cancelled",
    actual_date: "2026-10-01",
    payments_complete: false,
    payments: [],
    loan: null,
  };
  saved.profile.retire.core.occurrences = [occurred];
  page.render();
  const toggle = page.find("Switch", (p) => p.label === "计入买车");
  toggle.props.onChange(false);
  await page.settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].section, "events");
  assert.equal(calls[0].fields.life_events[0].included, false);
  assert.deepEqual(calls[0].fields.occurrences, [occurred]);
  assert.equal(event.included, true);
});
test("已有真实发生时锁住计入开关和删除，未知回执锁住新的写入入口", () => {
  const { page, saved, event } = harness();
  saved.profile.retire.core.occurrences = [
    {
      id: "occurred",
      event_id: event.id,
      status: "occurred",
      actual_date: "2026-10-01",
      payments_complete: false,
      payments: [],
      loan: null,
    },
  ];
  page.render();
  assert.equal(
    page.find("Switch", (p) => p.label === "计入买车").props.disabled,
    true,
  );
  assert.equal(page.button("删除").props.disabled, true);
  const locked = harness({ stuck: true });
  assert.equal(locked.page.button("编辑").props.disabled, true);
  assert.equal(
    locked.page.find("Switch", (p) => p.label === "计入买车").props.disabled,
    true,
  );
});
test("取消普通大额计划表单不写入，保存被拒绝时保留表单", async () => {
  const { page, calls } = harness({ save: async () => null });
  page.button("编辑").props.onClick();
  page.render();
  page
    .find("TextField", (p) => p.label === "计划名称")
    .props.onChange("虚构试改");
  page.render();
  page.button("取消本次修改").props.onClick();
  page.render();
  assert.equal(calls.length, 0);
  page.button("编辑").props.onClick();
  page.render();
  page.button("保存大额计划").props.onClick();
  await page.settle();
  assert.equal(calls.length, 1);
  assert.ok(page.button("取消本次修改"));
});
test("删除必须明确确认，取消删除不改变已保存条件", async () => {
  const { page, calls, event } = harness();
  page.button("删除").props.onClick();
  page.render();
  assert.equal(calls.length, 0);
  page.button("取消删除").props.onClick();
  page.render();
  assert.equal(calls.length, 0);
  page.button("删除").props.onClick();
  page.render();
  page.button("确认删除").props.onClick();
  await page.settle();
  assert.deepEqual(calls[0].fields.life_events, []);
  assert.equal(event.included, true);
});

test("编辑期间来源刷新仍使用打开表单时的 revision，让后端拒绝过期草稿", async () => {
  const { page, saved, expected } = harness({ save: async () => null });
  page.button("编辑").props.onClick();
  page.render();
  const initial = saved.revision;
  saved.revision += 1;
  page.render();
  page.button("保存大额计划").props.onClick();
  await page.settle();
  assert.equal(expected[0], initial);
  assert.ok(page.button("取消本次修改"));
});

test("大额支出页只有大额计划：没有阶段性支出和贷款区块，说明只作页脚", () => {
  const { page } = harness();
  const all = page.text(page.nodes()[0]);
  assert.doesNotMatch(all, /阶段性支出|已有贷款|还款安排|核对贷款/);
  assert.equal(page.find("section", (p) => p.title === "大额计划"), undefined);
  const last = page.nodes().filter((n) => n.type === "p").at(-1);
  assert.equal(page.text(last), "这些是设想，计入后会重算，不扣实际余额。");
});

test("没有大额计划时给一句友好说明和从模板添加的入口，不再显示说明页脚", () => {
  const { page, saved } = harness();
  saved.profile.retire.life_events = [];
  let opened = false;
  page.props.onPicker = (v) => (opened = v);
  page.render();
  const empty = page.find("EmptyState");
  assert.equal(empty.props.title, "还没有大额计划");
  empty.props.action.props.onClick();
  assert.equal(opened, true);
  assert.doesNotMatch(page.text(page.nodes()[0]), /这些是设想/);
});
