import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import * as planView from '../src/plan-view.ts';
import * as basicView from '../src/planning-basic-view.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

test('controlled detail returns to goals and focuses the heading', () => {
  const sources = fixture(), changes = [];
  const r = runtime('PlanningBasicGoals', { sources, view: 'detail', openSetup() {}, onGoto() {}, onViewChange: value => changes.push(value) }, undefined, buildBasicCapabilities(sources));
  assert.equal(r.button('查看计算详情与图表'), undefined);
  r.find('PlanningBasicDetail').props.onBack(); r.render();
  assert.equal(changes.at(-1), 'goals');
  assert.equal(r.focuses.at(-1), 'page-heading');
  r.props.view = 'goals'; r.render();
  assert.equal(r.find('PlanningBasicDetail'), undefined);
  assert.equal(r.find('PlanningWishes'), undefined);
});

test('birth reference shows birth month; legacy nonzero ages keep months; unknown stays unknown', () => {
  for (const [reference, expected] of [[{month:'1998-09', age_months:0}, '出生年月1998-09'], [{month:'2026-09', age_months:337}, '年龄参考2026-09 时 28 岁 1 个月'], [null, '年龄参考未填写（可选）']]) {
    const sources=fixture(), saved=sources.profile.value.saved;
    saved.profile.retire.simplified.time.reference=reference;
    const r=runtime('PlanningBasicDetail',{sources,saved,openSetup(){},onEvents(){},onBack(){}},undefined,buildBasicCapabilities(sources),{modules:{'./plan-view':planView}});
    const card=r.nodes().find(n=>n.type==='article' && n.props['aria-label']==='目标与预算');
    assert.ok(r.text(card).includes(expected), r.text(card));
    assert.ok(!r.text(card).includes('· 0 岁'));
    assert.ok(r.text(card).includes('应急金参考线'));
    const more=r.nodes().find(n=>n.type==='article' && n.props['aria-label']==='更多假设');
    assert.ok(!r.text(more).includes('应急金'));
  }
});


test('goals and trials mount distinct capabilities; blank trial retains independent runway and dependency hints', () => {
  const sources = fixture();
  const r = runtime('PlanningBasicGoals', { sources, view: 'goals', openSetup() {}, onGoto() {} }, undefined, buildBasicCapabilities(sources));
  assert.equal(r.find('PlanningWishes'), undefined);
  assert.equal(r.find('PlanningCareerCard'), undefined);
  assert.equal(r.find('RunwayCard'), undefined);
  assert.ok(r.find('PlanningEvents'));
  r.props.view = 'trial'; r.render();
  assert.ok(r.find('PlanningWishes')); assert.ok(r.find('PlanningCareerCard')); assert.ok(r.find('RunwayCard'));
  assert.equal(r.find('PlanningEvents'), undefined);
  assert.equal(r.button('查看当前报告'), undefined);
  const blank = fixture(); blank.profile.value.saved = null;
  const empty = runtime('PlanningBasicGoals', { sources: blank, view: 'trial', openSetup() {}, onGoto() {} }, undefined, buildBasicCapabilities(blank), { modules: { './planning-basic-view': basicView } });
  assert.ok(empty.find('RunwayCard')); assert.equal(empty.find('PlanningCareerCard'), undefined);
  assert.equal(empty.find('PlanningWishes').props.calc, null);
  assert.equal(empty.find('PlanningWishes').props.hint, '退休资料待补齐');
  assert.match(empty.text(empty.nodes()), /职业变化试算.*退休资料待补齐/);
});

test('detail event correction returns to goals with the original event focus; trial missing owner opens the corresponding goal setup', () => {
  const sources = fixture(), changes = [], setups = [];
  const r = runtime('PlanningBasicGoals', { sources, view: 'detail', onViewChange: v => changes.push(v), openSetup: (...args) => setups.push(args), onGoto() {} }, undefined, buildBasicCapabilities(sources));
  r.find('PlanningBasicDetail').props.onEvents(); r.render();
  assert.equal(changes.at(-1), 'goals'); assert.equal(r.focuses.at(-1), 'plan-events-section');
  r.props.view = 'trial'; r.render();
  r.find('RunwayCard').props.onOwner('funds'); r.render();
  assert.equal(changes.at(-1), 'goals'); assert.equal(setups.at(-1)[0], 2);
  r.find('PlanningWishes').props.onContribution(); r.render();
  assert.equal(changes.at(-1), 'goals'); assert.equal(setups.at(-1)[0], 4);
});
