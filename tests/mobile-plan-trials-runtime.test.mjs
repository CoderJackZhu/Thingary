import test from "node:test";
import assert from "node:assert/strict";
import { runtime } from "./planning-component-runtime.mjs";
import * as trialModel from "../src/mobile/plan/trial-model.ts";
import * as guided from "../src/career-preview/guided-model.ts";
import * as scope from "../src/career-preview/income-scope.ts";
import * as wishes from "../src/plan-wishes.ts";
import { careerSources } from "../src/career-preview/fixtures.ts";
const modules = {
  "./mobile/plan/trial-model": trialModel,
  "./career-preview/guided-model": guided,
  "./career-preview/income-scope": scope,
  "./plan-wishes": wishes,
  "./mobile/nav-context": { useNav: () => ({ push() {} }) },
};
function mount(name, props, extra = {}) {
  return runtime("mobile/plan/Trials", props, undefined, undefined, {
    exportName: name,
    components: [],
    modules: { ...modules, ...extra },
  });
}
function set(h, type, label, value) {
  const control = h.find(type, (p) => p.label === label);
  assert.ok(control, label);
  control.props.onChange(value);
  h.render();
}

test("runway form computes only after explicit income choice and required spending", () => {
  const h = mount("MobileRunway", { capabilities: null, today: "2026-10-21" });
  set(h, "MoneyField", "当前可动用资金", "1000000");
  set(h, "MoneyField", "每月必要开销", "100000");
  assert.match(h.find("UnknownState").props.message, /可靠到账/);
  set(h, "Switch", "目前没有可靠到账", true);
  assert.equal(h.find("UnknownState"), undefined);
  assert.match(h.text(h.find("Notice")), /10/);
  set(h, "MoneyField", "当前可动用资金", "");
  assert.match(h.find("UnknownState").props.message, /资金起点/);
});

test("career form uses saved defaults, explicit calculation, and invalidates changed results", () => {
  const sources = careerSources(),
    h = mount("MobileCareer", { sources, today: sources.today });
  set(h, "SelectField", "想知道什么", "switch");
  const count = h.find("input", (p) => p["aria-label"] === "中间空窗月数");
  count.props.onChange({ target: { value: "0" } });
  h.render();
  set(h, "Switch", "上述金额包含全部自付社保、医保等费用", true);
  const run = h.find("Button", (p) => p.children === "计算本次职业变化");
  assert.ok(run);
  run.props.onClick();
  h.render();
  assert.ok(h.find("Notice"));
  set(h, "MoneyField", "找到新工作后每月能攒", "500000");
  assert.equal(h.find("Notice"), undefined);
});

test("wish read failure is distinct from empty and can retry", async () => {
  let fail = true;
  const h = mount(
    "MobileWishImpact",
    {
      saved: null,
      capabilities: null,
      today: "2026-10-21",
      sourceKey: "fixture:1",
    },
    {
      "./plan-data": {
        loadConsideringWishes: async () => {
          if (fail) throw new Error("虚构读取失败");
          return [];
        },
      },
    },
  );
  await h.settle();
  assert.match(h.find("ErrorState").props.message, /虚构读取失败/);
  fail = false;
  h.find("ErrorState").props.onRetry();
  h.render();
  await h.settle();
  assert.equal(h.find("ErrorState"), undefined);
  assert.equal(h.find("EmptyState").props.title, "还没有考虑中的心愿");
  h.unmount();
});
