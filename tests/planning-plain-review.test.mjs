import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import { fixture } from './planning-ui-fixture.mjs';
import * as chartView from '../src/plan-view.ts';
import { spacedLabels } from '../src/chart-labels.ts';

function emptySources() {
  const sources = fixture();
  const saved = sources.profile.value.saved;
  saved.profile.retire.life_events = [];
  saved.profile.retire.core.occurrences = [];
  saved.reference_issues = [];
  return sources;
}
const content = r => r.nodes().map(n => r.text(n)).join(' ');
const occurrenceView = (sources, props = {}) => runtime('PlanningGoalOccurrences', { sources, ...props }, undefined, undefined, { components: [] });

test('reliably empty occurrence review is absent, including a profile with no saved plan', () => {
  for (const saved of [true, false]) {
    const sources = emptySources();
    if (!saved) sources.profile.value.saved = null;
    assert.equal(occurrenceView(sources).nodes().length, 0);
  }
});

test('unknown profile, unresolved work and reference issues keep occurrence review visible', () => {
  const failed = emptySources();
  failed.profile = { status: 'error', value: { message: '虚构读取失败' } };
  assert.match(content(occurrenceView(failed)), /目标资料暂不可用/);
  assert.ok(occurrenceView(emptySources(), { blocked: true }).nodes().length);
  const referenced = emptySources();
  referenced.profile.value.saved.reference_issues = ['虚构来源待核对'];
  assert.ok(occurrenceView(referenced).nodes().length);
  for (const pending of [{ busy: true }, { stuck: true }, { notice: '虚构保存失败' }]) {
    const view = occurrenceView(emptySources());
    Object.assign(view.saver, pending); view.render();
    assert.ok(view.nodes().length);
    if (pending.notice) assert.match(content(view), /虚构保存失败/);
  }
});

test('orphaned historical occurrences retain their identity and explanation without inventing a plan', () => {
  const sources = emptySources(), original = { id: 'fictional-occurrence', event_id: 'missing-fictional-plan', status: 'occurred', actual_date: '2026-10-01', payments_complete: false, payments: [], loan: null };
  sources.profile.value.saved.profile.retire.core.occurrences = [original];
  let reads = 0;
  const view = occurrenceView(sources, { reload: () => reads++ });
  assert.match(content(view), /历史发生记录找不到对应计划/);
  assert.match(content(view), /missing-fictional-plan.*已发生.*2026-10-01/);
  view.button('重新读取计划资料').props.onClick();
  assert.equal(reads, 1);
  assert.deepEqual(sources.profile.value.saved.profile.retire.core.occurrences, [original]);
  assert.equal(view.find('PlanningOccurrenceDialog'), undefined);
});

const chartOptions = exportName => ({ components: [], exportName, modules: {
  './plan-view': chartView, './chart-labels': { spacedLabels }, './chart-width': { useChartScale: () => 1 },
} });
function hover(view, x) {
  const svg = view.find('svg');
  svg.props.ref.current = { getBoundingClientRect: () => ({ left: 0, width: 720 }) };
  svg.props.onPointerMove({ clientX: x }); view.render();
}
test('trajectory explains the wage-independent date and annual cash flows with the original amounts', () => {
  const view = runtime('RetireCharts', {
    points: [{ month: 0, label: '2026-10', projected: 100000, required: 90000, phase: 'accumulation' }, { month: 12, label: '2027-10', projected: 120000, required: 80000, phase: 'retired' }],
    rows: [{ phase: 'accumulation', contribution: 12000, end: 112000 }, { phase: 'retired', income: 15000, withdrawal: 20000, end: 110000 }],
    goalMonth: 12, fiMonth: 6, retireMonth: 12, tone: 'good', fmt: String, valueLabel: '今天的钱', timeLabel: month => String(month),
  }, undefined, undefined, chartOptions('TrajectoryChart'));
  assert.match(content(view), /预计不靠工资/);
  hover(view, 66);
  assert.match(content(view), /每年投入12000/);
  hover(view, 702);
  assert.match(content(view), /每年从已有资金中取用20000/);
  assert.match(content(view), /期末资金110000/);
  assert.doesNotMatch(content(view), /供款|投资组合提取|FI ·/);
});

test('coverage legend and tooltip use the same plain withdrawal label, while insufficient data remains explicit', () => {
  const series = { keys: [{ key: 'portfolio', kind: 'portfolio', label: '投资组合提取' }], points: [{ month: 0, label: '2026', spend: 10000, values: { portfolio: 10000 } }, { month: 12, label: '2027', spend: 11000, values: { portfolio: 11000 } }] };
  const view = runtime('RetireCharts', { series, fmt: String, valueLabel: '今天的钱' }, undefined, undefined, chartOptions('CoverageChart'));
  hover(view, 66);
  assert.match(content(view), /从已有资金中取用\/年10000/);
  assert.doesNotMatch(content(view), /投资组合提取/);
  const empty = runtime('RetireCharts', { series: { ...series, points: [] }, fmt: String, valueLabel: '今天的钱' }, undefined, undefined, chartOptions('CoverageChart'));
  assert.match(content(empty), /资料不足/);
});
