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
const questionProps = sources => ({ realSummary: true, saved: sources.profile.value.saved, caps: buildBasicCapabilities(sources), onSetup: noop, onDetail: noop, onRunway: noop });

test('three real question buttons reuse setup, detail, and independent runway without writing', () => {
  for (const blank of [false, true]) {
    const sources = fixture(), moves = [], setups = [];
    if (blank) sources.profile.value.saved = null;
    const r = runtime('PlanningBasicGoals', { sources, onGoto: noop, openSetup: (...args) => setups.push(args), onViewChange: (...args) => moves.push(args) }, undefined, buildBasicCapabilities(sources), { components: ['PlanningQuestions'] });
    const from = { isConnected: true };
    r.button(blank ? '先设置目标：每月要存多少' : '查看每月要存多少').props.onClick({ currentTarget: from });
    r.button(blank ? '先设置目标：什么时候能不靠工资' : '查看什么时候能不靠工资').props.onClick({ currentTarget: from });
    r.button('试算资金能撑多久').props.onClick();
    assert.deepEqual(moves, blank ? [['trial', 'plan-runway-heading']] : [['detail', 'plan-requirement-result'], ['detail', 'plan-prediction-result'], ['trial', 'plan-runway-heading']]);
    assert.deepEqual(setups, blank ? [[0, from], [0, from]] : []);
    assert.equal(r.calls.length, 0);
  }
});

test('question summaries preserve requirement, prediction, unknowns, all missing reasons, and impact directions', () => {
  const sources = fixture(), props = questionProps(sources), caps = props.caps;
  const show = () => runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  let r = show(); assert.match(r.text(r.nodes()), /按固定目标月份反求，不是未来预测/);
  const missing = [{ code: 'CONTRIBUTION_UNKNOWN', kind: 'fact', capability: 'prediction', owner: 'basic', field: 'basic.contribution', message: '未填投入' }, { code: 'SOURCE_ERROR', kind: 'read_error', capability: 'prediction', owner: 'service', field: 'snapshot', message: '虚构资金读取失败' }];
  caps.prediction = { status: 'blocked', missing };
  caps.requirement = { status: 'blocked', missing: [{ ...missing[1], capability: 'requirement' }] };
  r = show(); assert.match(r.text(r.nodes()), /还没估计每月能存多少钱/); assert.match(r.text(r.nodes()), /虚构资金读取失败/);
  assert.doesNotMatch(r.text(r.nodes()), /每月约\s*¥?0(?:\D|$)|预计 \d{4}-\d{2} 退休/);
  caps.annotations = ['requirement_lower', 'requirement_higher', 'uncertain'].map((effect, i) => ({ id: String(i), effect, treatment: 'omitted', source_ids: [String(i)], reason_code: 'PAYMENT_PENDING', message: '虚构付款未确认', missing_fields: ['付款金额'], refinement: { owner: 'events' } }));
  r = show(); assert.match(r.text(r.nodes()), /可能偏低/); assert.match(r.text(r.nodes()), /可能偏高/); assert.match(r.text(r.nodes()), /方向尚不确定/);
});

test('requirement summaries retain explicit zero and unsolved constraints from the existing capability', () => {
  const sources = fixture(), props = questionProps(sources);
  props.caps.requirement.value.set = { status: 'no_positive_contribution', monthly_cents: '0' };
  let r = runtime('PlanningQuestions', props, undefined, props.caps, { components: [] }); assert.match(r.text(r.nodes()), /不用再额外存钱/);
  props.caps.requirement.value.set = { status: 'payment_constraint', message: '虚构付款约束仍不满足' };
  r = runtime('PlanningQuestions', props, undefined, props.caps, { components: [] }); assert.match(r.text(r.nodes()), /虚构付款约束仍不满足/);
});

test('fixed retirement is never advertised as predicted independence, and failed FIRE retains its failed-goal warning', () => {
  const sources = fixture(), props = questionProps(sources), caps = props.caps;
  props.saved.profile.retire.mode = 'traditional';
  let r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.match(r.text(r.nodes()), /按所选目标月份检查/); assert.doesNotMatch(r.text(r.nodes()), /预计 \d{4}-\d{2} 退休/);
  caps.prediction.value.outcome.success = false;
  r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.match(r.text(r.nodes()), /尚未满足完整目标/, 'target-month funding does not imply the whole plan succeeds');
  props.saved.profile.retire.mode = 'fire';
  r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.match(r.text(r.nodes()), /尚未满足完整目标/);
  caps.prediction.value.projection.retire_month = null;
  r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.match(r.text(r.nodes()), /规划终点前尚未达成/);
  caps.prediction.value.projection.retire_month = 12; caps.prediction.value.plan.anchor_date = undefined;
  r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.match(r.text(r.nodes()), /预计退休月份尚不能确定/); assert.doesNotMatch(r.text(r.nodes()), /预计 \d{4}-\d{2} 退休/);
  caps.prediction.value.outcome.success = true; caps.prediction.value.terminal = 'no_margin';
  r = runtime('PlanningQuestions', props, undefined, caps, { components: [] }); assert.match(r.text(r.nodes()), /终点没有余量/);
  props.blocked = true; r = runtime('PlanningQuestions', props, undefined, caps, { components: [] });
  assert.ok(r.nodes().filter(n => n.type === 'button').every(n => n.props.disabled));
});

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
