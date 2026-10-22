import test from "node:test";
import assert from "node:assert/strict";
import {
  childEndMonth,
  eventForKind,
  eventTemplate,
  eventTemplates,
  impactText,
  stageCost,
  validateEvent,
} from "../src/mobile/plan/events-model.ts";
import {
  basicFixtureSources,
  basicInputFixtures,
} from "../src/plan-basic-fixtures.ts";
import { buildBasicCapabilities } from "../src/plan-basic.ts";
import { eventImpact, totalImpact, offsetOf } from "../src/plan-events.ts";
import { toEvent } from "../src/plan-retire-calc.ts";
import { retractOccurrence } from "../src/plan-occurrence-actions.ts";

test("模板只构造界面默认条件，稳定ID与计入开关保留；第二套房默认不计入", () => {
  for (const template of eventTemplates) {
    const event = eventTemplate(
      template.id,
      "2026-10-21",
      `fictional-${template.id}`,
      false,
    );
    assert.equal(event.id, `fictional-${template.id}`);
    assert.equal(validateEvent(event), null);
    assert.equal(event.date.slice(5), "10");
  }
  assert.equal(
    eventTemplate("house", "2026-10-21", "second", true).included,
    false,
  );
  assert.equal(eventTemplate("car", "2026-10-21", "car", true).included, true);
});
test("金额、月份与贷款表单拒绝未知和无效组合，明确零杂费保留", () => {
  const event = eventTemplate("car", "2026-10-21", "car", false);
  assert.ok(validateEvent({ ...event, down_cents: "" }));
  assert.ok(validateEvent({ ...event, price_cents: "0" }));
  assert.ok(validateEvent({ ...event, down_cents: "999999999" }));
  assert.ok(validateEvent({ ...event, date: "2026-13" }));
  assert.ok(validateEvent({ ...event, cycle_years: 0 }));
  assert.ok(validateEvent({ ...event, until_month: "2026-01" }));
  assert.equal(validateEvent({ ...event, extra_cents: "0" }), null);
});
test("子女年龄沿用桌面纯函数，换算到明确月份，不改变生日资料", () => {
  assert.equal(childEndMonth("2020-02", "22"), "2042-02");
  assert.equal(childEndMonth("", "22"), null);
  assert.equal(childEndMonth("2020-02", "0"), null);
  assert.equal(childEndMonth("2020-02", "41"), null);
  const cost = stageCost({
    id: "education",
    label: "子女教育",
    monthly: "300000",
    start: "",
    end: childEndMonth("2020-02", "22"),
    inflation: "",
    essential: true,
  });
  assert.deepEqual(cost, {
    id: "education",
    label: "子女教育",
    monthly_cents: "300000",
    start_month: null,
    end_month: "2042-02",
    inflation_hundredths: null,
    essential: true,
    time_unconfirmed: false,
  });
  assert.equal("birth_month" in cost, false);
});
test("阶段性支出不把空额当零；起止月与涨幅经过同一口径校验", () => {
  const fields = {
    id: "care",
    label: "医疗与护理",
    monthly: "10000",
    start: "2060-01",
    end: "",
    inflation: "3.5",
    essential: true,
  };
  assert.equal(stageCost(fields).inflation_hundredths, 350);
  for (const monthly of ["", "0", "-1"])
    assert.throws(() => stageCost({ ...fields, monthly }));
  assert.throws(() => stageCost({ ...fields, end: "2059-12" }));
  assert.throws(() => stageCost({ ...fields, inflation: "21" }));
});
test("每件与合计影响调用共用事件账本，关闭计入时不改变原始计划", () => {
  const sources = basicFixtureSources(basicInputFixtures.prediction),
    caps = buildBasicCapabilities(sources);
  assert.equal(caps.prediction.status, "ready");
  const { plan0, plan } = caps.prediction.value;
  const base = {
    ...plan0,
    anchor_date: plan.anchor_date,
    core: plan.core,
    basis_factor: plan.basis_factor,
    first_month_fraction: plan.first_month_fraction,
  };
  const event = toEvent(
    eventTemplate("car", sources.today, "fictional-car", false),
  );
  const before = JSON.stringify(base);
  const impact = eventImpact(
    base,
    event,
    offsetOf(event.date, plan.anchor_date ?? sources.today),
    0,
  );
  const total = totalImpact(base, [
    {
      e: event,
      offset: offsetOf(event.date, plan.anchor_date ?? sources.today),
    },
  ]);
  assert.equal(total.with_fi, impact.with_fi);
  assert.equal(JSON.stringify(base), before);
  assert.equal(
    typeof impactText(impact.delay_months, impact.base_fi, impact.with_fi),
    "string",
  );
});
test("发生核对只能撤回没有实际事实的记录，明确零付款仍保护", () => {
  const empty = {
    id: "occurrence",
    event_id: "event",
    status: "occurred",
    actual_date: "2026-10-21",
    payments_complete: false,
    payments: [],
    loan: null,
  };
  assert.deepEqual(retractOccurrence([empty], empty.id), []);
  const withZero = {
    ...empty,
    payments: [
      {
        id: "payment",
        date: "2026-10-21",
        amount_cents: "0",
        account_id: null,
        absorbed_snapshot_id: null,
        absorbed_revision: null,
        source_kind: null,
        source_id: null,
      },
    ],
  };
  assert.throws(() => retractOccurrence([withZero], withZero.id));
});

test("更换类型时移除隐藏的周期、回收与房租字段，避免旧条件继续计算", () => {
  const car = eventTemplate("car", "2026-10-21", "car", false);
  const house = eventForKind({
    ...car,
    kind: "house",
    rent_saved_cents: "10000",
  });
  assert.equal(house.cycle_years, null);
  assert.equal(house.resale_cents, "0");
  assert.equal(house.rent_saved_cents, "10000");
  const other = eventForKind({ ...house, kind: "other" });
  assert.equal(other.rent_saved_cents, "0");
});
