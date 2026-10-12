import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import * as planView from '../src/plan-view.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

test('detail reports its nesting state on entry, return and unmount', () => {
  const sources = fixture(), changes = [];
  const r = runtime('PlanningBasicGoals', { sources, openSetup() {}, onGoto() {}, onDetailChange: value => changes.push(value) }, undefined, buildBasicCapabilities(sources));
  assert.equal(changes.at(-1), false);
  r.button('查看计算详情与图表').props.onClick(); r.render();
  assert.equal(changes.at(-1), true);
  r.find('PlanningBasicDetail').props.onBack(); r.render();
  assert.equal(changes.at(-1), false);
  r.button('查看计算详情与图表').props.onClick(); r.render(); r.unmount();
  assert.equal(changes.at(-1), false);
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
