import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import { basicFixtureSources, basicInputFixtures } from '../src/plan-basic-fixtures.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import * as view from '../src/plan-view.ts';
import * as ledger from '../src/plan-ledger.ts';
import * as risk from '../src/plan-risk.ts';

const fixture = () => basicFixtureSources(basicInputFixtures.prediction);
const noop = () => {};
test('details retain the parent disclosure state through overview/lab switches', () => {
  const sources = fixture(), caps = buildBasicCapabilities(sources), changes = [];
  const r = runtime('PlanningBasicDetail', { sources, saved: sources.profile.value.saved, openSetup: noop, onEvents: noop, onBack: noop, advancedOpen: true, onAdvancedOpenChange: open => changes.push(open) }, undefined, caps, { modules: { './plan-view': view } });
  const lab = () => r.nodes().find(n => n.type === 'button' && r.text(n).startsWith('假设分析'));
  lab().props.onClick(); r.render();
  assert.equal(r.find('RiskLab').props.advancedOpen, true);
  r.find('RiskLab').props.onAdvancedOpenChange(false); assert.deepEqual(changes, [false]);
  r.nodes().find(n => n.type === 'button' && r.text(n).startsWith('概览')).props.onClick(); r.render();
  lab().props.onClick(); r.render(); assert.equal(r.find('RiskLab').props.advancedOpen, true);
});

function riskRuntime() {
  const sources = fixture(), caps = buildBasicCapabilities(sources), plan = caps.prediction.value.plan;
  const requests = [], timers = [];
  const r = runtime('RiskLab', { calc: { plan, assets: plan.assets_cents }, today: sources.today, advancedOpen: false, onAdvancedOpenChange(open) { r.props.advancedOpen = open; } }, undefined, caps, {
    components: [], modules: { './plan-view': view, './plan-ledger': ledger, './plan-risk': { ...risk, monteCarlo(P, n, options) { return new Promise((resolve, reject) => requests.push({ P, n, ...options, resolve, reject })); } }, './RetireOverview': { yuan: n => String(n) } },
    globals: { AbortController, setTimeout(fn) { const timer = { fn }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cancelled = true; } },
  });
  return { r, requests, timers, start() { const timer = timers.find(t => !t.cancelled && !t.started); timer.started = true; timer.fn(); } };
}
const mc = rate => ({ n: 1000, success_rate: rate, median_fi_month: null, final: { p10: 1, p50: 2, p90: 3 }, months: [], bands: [] });

test('native advanced disclosure retains all six stresses and mounted analyses while closed; errors remain outside', async () => {
  const x = riskRuntime(), { r } = x;
  const outer = () => r.nodes().find(n => n.type === 'details' && r.text(n.props.children[0]).includes('深入分析'));
  assert.equal(outer().props.open, false); assert.equal(outer().props.onKeyDown, undefined, 'native summary owns keyboard behavior');
  assert.match(r.text(r.nodes()), /压力测试 · 6 个情景/);
  assert.ok(r.find('article', p => p['aria-label'] === '市场路径'));
  assert.ok(r.find('details', p => p['aria-label'] === '决策矩阵'));
  assert.ok(r.find('details', p => p['aria-label'] === '收益顺序检查'));
  assert.doesNotMatch(r.text(outer()), /压力测试 · 6 个情景/);
  x.start(); assert.equal(x.requests[0].n, 1000, 'closing does not defer automatic market simulation');
  outer().props.onToggle({ currentTarget: { open: true } }); r.render(); assert.equal(outer().props.open, true);
  outer().props.onToggle({ currentTarget: { open: false } }); r.render(); assert.equal(x.requests[0].signal.aborted, false);
  x.requests[0].reject(Error('虚构模拟失败')); await r.settle();
  assert.match(r.text(r.nodes()), /虚构模拟失败/); assert.doesNotMatch(r.text(outer()), /虚构模拟失败/);
  r.button('查看与重试市场路径').props.onClick(); r.render(); assert.equal(outer().props.open, true);
  r.unmount();
});

test('plan changes and unmount still abort market work and discard late results', async () => {
  const x = riskRuntime(), { r } = x; x.start(); const old = x.requests[0];
  r.props.calc = { ...r.props.calc, plan: { ...r.props.calc.plan } }; r.render();
  assert.equal(old.signal.aborted, true); x.start();
  old.resolve(mc(.25)); await r.settle(); assert.doesNotMatch(r.text(r.nodes()), /25%/);
  x.requests[1].resolve(mc(.75)); await r.settle(); assert.match(r.text(r.nodes()), /75%/);
  r.button('重新计算 1,000 条').props.onClick(); r.render(); x.start(); const active = x.requests[2];
  r.unmount(); assert.equal(active.signal.aborted, true); active.resolve(mc(.5)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.nodes().length, 0);
});
