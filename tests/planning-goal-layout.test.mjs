// 目标页宽屏版式：左列逐项条件，右列精简结论加一张主资产轨迹（sticky）；窄窗上下排列并保留精简结果栏。
// 轨迹复用 plan-view 的展示模型与 RetireCharts 组件，逐年表、压力测试仍只在测算详情。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import * as view from '../src/plan-view.ts';
import * as ledger from '../src/plan-ledger.ts';

const noop = () => {};
const goalCss = readFileSync(new URL('../src/planning-goal/goal.css', import.meta.url), 'utf8');

function render() {
  const sources = fixture(), caps = buildBasicCapabilities(sources);
  const r = runtime('planning-goal/Overview', { saved: sources.profile.value.saved, caps, today: sources.today, cards: [], onEdit: noop, onRefine: noop, onDetail: noop }, undefined, caps, {
    components: ['planning-goal/Trajectory', 'planning-goal/Overview'],
    modules: {
      './plan-view': view,
      './plan-ledger': ledger,
      './RetireCharts': { TrajectoryChart: props => ({ type: 'TrajectoryChart', props }) },
      './RetireOverview': { useValueMode: () => ['today', noop], valueModeLabel: { today: '按今天物价', nominal: '未来账面金额' } },
    },
  });
  return { sources, caps, r };
}

test('the conclusion and its single trajectory sit in the right column before the conditions in DOM order', () => {
  const { r, caps } = render();
  const side = r.nodes().find(n => n.props?.className === 'goal-side');
  assert.ok(side, '右侧结论栏是一个容器');
  const inside = r.text(side);
  assert.match(inside, /为目标每月需存/);
  assert.match(r.text(r.nodes().find(n => n.props?.['aria-label'] === '资产轨迹')), /资产轨迹/);
  assert.doesNotMatch(inside, /你的计划/, '计算条件不在右栏内');
  const order = r.nodes().map(n => n.props?.['aria-label']).filter(Boolean);
  const at = label => order.indexOf(label);
  assert.ok(at('退休目标') >= 0 && at('退休目标') < at('资产轨迹') && at('资产轨迹') < at('依据与提醒') && at('依据与提醒') < at('计算条件'), '结论 → 轨迹 → 依据 → 条件，宽屏靠网格分列而不是重排 DOM');
  assert.ok(!r.nodes().some(n => ['Snapshot', 'RiskLab', 'CoverageChart'].includes(n.type)), '逐年表与压力测试只在测算详情');
  assert.doesNotMatch(r.text(r.nodes()), /逐年快照（/);
  assert.doesNotMatch(r.text(r.nodes()), /压力测试 · 6 个情景/);
  const chart = r.nodes().find(n => n.type === 'TrajectoryChart');
  assert.ok(chart, '复用现有轨迹图组件');
  assert.equal(chart.props.goalMonth, caps.prediction.value.plan.target_months, '目标月份沿用已保存的预测，不另算');
  assert.ok(chart.props.points.length > 1 && chart.props.rows.length > 0);
});

test('wide layout keeps the right column sticky while the narrow layout stacks with the result bar first', () => {
  assert.match(goalCss, /\.goal-layout\{[^}]*grid-template-areas:"conditions side"/, '宽屏左条件右结论');
  assert.match(goalCss, /\.goal-side\{[^}]*position:sticky/, '右栏随页面滚动保持可见');
  const narrow = goalCss.slice(goalCss.indexOf('@media (max-width: 1050px)'));
  assert.match(narrow, /grid-template-areas:"summary" "next" "conditions" "chart" "evidence"/, '窄窗上下排列，结论栏在最前');
  assert.doesNotMatch(goalCss, /grid-template-areas:[^;]*plans/, '大额计划在吸附网格之外，右栏不会盖住它');
  assert.match(narrow, /\.goal-side\{display:contents\}/);
  assert.match(narrow, /\.goal-answer\{grid-area:summary/, '窄窗保留精简结果栏');
  assert.match(narrow, /\.goal-chart\{grid-area:chart/, '图表排在条件之后');
});

test('the chart card explains that yearly tables and stress tests remain in the detail view', () => {
  const { r } = render();
  const card = r.nodes().find(n => n.props?.['aria-label'] === '资产轨迹');
  assert.match(r.text(card), /逐年快照、压力测试与市场模拟在「测算详情」/);
  assert.doesNotMatch(r.text(card), /逐年快照（/);
});
