import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as asset from '../src/asset.ts';
import * as plan from '../src/plan.ts';
import * as summary from '../src/plan-summary.ts';
import * as view from '../src/planning-basic-view.ts';
import * as calc from '../src/plan-retire-calc.ts';
import * as wishes from '../src/plan-wishes.ts';
import * as data from '../src/plan-data.ts';
import * as review from '../src/review.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import { defaultAssumptions, noOverrides } from '../src/plan-params.ts';
import { unknownBasicUpdate } from '../src/plan-basic-fixtures.ts';

// Execute the production TSX with real React rendering and real pure calculation.
// UI-only leaves are replaced; any unexpected IPC/read dependency fails the test.
function component(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return jsx;
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected consumer dependency: ${name}`);
  } });
  return exports;
}
const noOp = () => {};
const form = { Info: () => null };
const requirement = component('PlanningRequirement.tsx', { './asset': asset, './FormControls': form, './planning-basic-view': view });
const home = component('ReviewPlanSummary.tsx', { react: React, './asset': asset, './FormControls': form, './plan': plan, './plan-summary': summary, './PlanningRequirement': requirement, './planning-basic-view': view });
const renderHome = sources => renderToStaticMarkup(React.createElement(home.ReviewPlanSummary, {
  data: homeSources(sources), today: sources.today, onReload: noOp, onNavigate: noOp, onGotoPlanning: noOp,
}));
const ready = value => ({ status: 'ready', value });
const unavailable = { status: 'error', value: { code: 'MODULE_DISABLED', message: '虚构关闭的财富来源' } };
function sources(contribution = null) {
  const f = structuredClone(unknownBasicUpdate.fields);
  f.basic.contribution.monthly_cents = contribution;
  const profile = { birth_month: f.birth_month, worker: null, region: null, paid_months: null, account_balance_cents: null,
    base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null, marginal_tax_hundredths: null,
    assumptions: { ...defaultAssumptions, inflation_hundredths: 0 }, overrides: noOverrides,
    retire: { ...structuredClone(plan.defaultRetire), spend_cents: f.spend_cents, target_age: f.target_age,
      horizon_age: f.horizon_age, mode: f.mode, real_return_before_hundredths: f.real_return_before_hundredths,
      real_return_after_hundredths: f.real_return_after_hundredths, volatility_hundredths: f.volatility_hundredths,
      emergency_months: f.emergency_months, basic: f.basic,
      core: { contract_version: 1, monetary_basis_date: f.monetary_basis_date, fund_rules: [], hpf_monthly_cents: null, costs: [], occurrences: [] } } };
  return { generation: 'fictional-consumers', write_version: 1, today: '2026-10-07', modules: { planning: true, wealth: false },
    profile: ready({ generation: 'fictional-consumers', saved: { revision: 1, updated_at: '2026-10-07', profile } }),
    snapshot: unavailable, accounts: unavailable, review: unavailable, incomes: unavailable };
}
function homeSources(s) {
  return { ...s, writeVersion: s.write_version, snapshotId: null, snapshotDate: null };
}
const profile = s => s.profile.value.saved.profile;
const context = s => ({ sources: s, profile: s.profile.value, snapshot: null, review: null, incomes: [] });
const wish = (over = {}) => ({ id: 'fictional-wish', decision_state: 'considering', fields: {
  name: '虚构旅行', estimated_price_cents: '1000000', target_date: '2027-06-01', ...over } });
const expectedImpact = (s, item) => {
  const c = calc.buildRetireCalc(s.profile.value.saved, null, null, [], s.today, s);
  const [spend] = wishes.classifyWishes([data.wishLike(item)], s.today);
  assert.equal(wishes.isReady(c), true);
  return wishes.impactSentence(spend, wishes.impactOf(c, [spend]), c.r.emergency_months, c => asset.money(String(Math.round(c))));
};
function wishRuntime(load) {
  const effects = [], seen = { text: '', reads: 0 };
  const runtime = component('WishPlanLine.tsx', { react: {
    useState: () => ['', value => { seen.text = value; }], useEffect: effect => effects.push(effect),
  }, './asset': asset, './plan-data': { ...data, loadPlanContext: async () => { seen.reads++; return load(); } },
  './plan-retire-calc': calc, './plan-wishes': wishes, './planning-basic-view': view });
  runtime.WishPlanLine({ item: wish(), today: '2026-10-07' });
  return { seen, run: effects[0] };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('home renders requirements from its current batch, without a second read or unknown-contribution prediction', () => {
  const s = sources(), before = structuredClone(s), first = renderHome(s);
  const required = buildBasicCapabilities(s).requirement.value.set.monthly_cents;
  assert.ok(first.includes(asset.money(required)));
  assert.ok(first.includes('2050 年 6 月'));
  assert.ok(first.includes('预计投入未填写'));
  assert.ok(!first.includes('预计还需'));
  assert.ok(!first.includes('当前可支配资产／今天退休所需'));
  const next = structuredClone(s); next.write_version++; profile(next).retire.spend_cents = '500000';
  const newRequired = buildBasicCapabilities(next).requirement.value.set.monthly_cents;
  assert.notEqual(newRequired, required);
  const refreshed = renderHome(next);
  assert.ok(refreshed.includes(asset.money(newRequired)));
  assert.ok(!refreshed.includes(asset.money(required)));
  assert.deepEqual(s, before);
});

test('home uses the saved prediction headline and stays unchanged after a temporary trial', () => {
  for (const contribution of ['0', '1000000', '-100000']) {
    const s = sources(contribution), result = summary.summaryRetire(homeSources(s), s.today), html = renderHome(s);
    assert.equal(result.kind, 'ready');
    assert.ok(html.includes(result.headline.main));
    assert.ok(!html.includes('预计投入未填写'));
  }
  const unknown = sources(), before = renderHome(unknown);
  assert.equal(buildBasicCapabilities(unknown, '1000000').prediction.value.source, 'temporary');
  assert.equal(renderHome(unknown), before);
  assert.equal(profile(unknown).retire.basic.contribution.monthly_cents, null);
});

test('goals pass a real saved calculation to wishes, and no calculation while contribution is unknown', () => {
  let received;
  const leaf = () => null;
  const goals = component('PlanningBasicGoals.tsx', { react: React, './asset': asset,
    './PlanningRequirement': requirement, './PlanningFunds': { FundsCard: leaf }, './PlanningBasicDetail': { PlanningBasicDetail: leaf },
    './PlanningEvents': { PlanningEvents: leaf }, './PlanningWishes': { PlanningWishes: ({ calc }) => { received = calc; return null; } },
    './plan-retire-calc': calc, './review': review, './planning-basic-forms': {}, './planning-basic-view': view,
    './planning-basic-data': { useCapabilities: s => ({ status: 'ready', caps: buildBasicCapabilities(s) }),
      useSectionSaver: () => ({ busy: false, stuck: false, notice: '', save: noOp }) }, './planning.css': {},
  });
  for (const contribution of [null, '0', '1000000', '-100000']) {
    const s = sources(contribution), before = structuredClone(s);
    renderToStaticMarkup(React.createElement(goals.PlanningBasicGoals, { sources: s, mode: 'basic', today: s.today,
      reload: noOp, onPending: noOp, onEditingChange: noOp, onGoto: noOp, openSetup: noOp, onFocusDone: noOp }));
    if (contribution === null) assert.equal(received, null);
    else {
      assert.equal(wishes.isReady(received), true);
      assert.equal(received.capabilities.prediction.value.source, 'saved');
      assert.equal(received.capabilities.prediction.value.contribution_cents, contribution);
      assert.equal(received.capabilities.context.generation, s.generation);
    }
    assert.deepEqual(s, before);
  }
});

test('wish detail reads one committed batch and restores impact for positive, zero and negative saved contribution', async () => {
  for (const contribution of ['0', '1000000', '-100000']) {
    const s = sources(contribution), run = wishRuntime(() => context(s)); run.run(); await settled();
    assert.equal(run.seen.reads, 1);
    assert.equal(run.seen.text, expectedImpact(s, wish()));
  }
  const s = sources(), run = wishRuntime(() => context(s)); run.run(); await settled();
  assert.match(run.seen.text, /保存预计投入后可查看/);
  assert.ok(!run.seen.text.includes('可支配资产约'));
  assert.equal(run.seen.reads, 1);
});

test('wish detail does not render results from closed planning, failed dependencies or a late response', async () => {
  const closed = sources('1000000'); closed.modules.planning = false;
  const off = wishRuntime(() => context(closed)); off.run(); await settled(); assert.equal(off.seen.text, '');
  const missing = sources('1000000'); profile(missing).retire.basic.start.available_cents = null;
  const blocked = wishRuntime(() => context(missing)); blocked.run(); await settled(); assert.equal(blocked.seen.text, '');
  let resolve; const pending = new Promise(r => { resolve = r; });
  const late = wishRuntime(() => pending), cleanup = late.run(); cleanup();
  resolve(context(sources('1000000'))); await settled(); assert.equal(late.seen.text, '');
});
