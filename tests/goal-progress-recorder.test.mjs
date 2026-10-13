import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

function mount(invoke) {
  const sources = fixture();
  const r = runtime('PlanningBasicGoals', { sources, view: 'goals', openSetup() {}, onGoto() {} }, undefined, buildBasicCapabilities(sources), { modules: { '@tauri-apps/api/core': { invoke } } });
  return { r, sources };
}
const entry = id => ({ snapshot_id: id, date: '2026-09-13', recorded_on: '2026-09-13', point: { mode: 'traditional', target_month: '2050-06', available_cents: '1', required_monthly_cents: '2', entered_monthly_cents: '3', success: false, shortfall_at_goal_cents: '4', predicted_retire_month: null, has_open_items: false } });

test('opening the goal page records the first look at a check-in, then reads the history', async () => {
  const calls = [];
  let stored = [];
  const { r, sources } = mount(async (name, args) => {
    calls.push([name, args]);
    if (name === 'goal_progress_record') { stored = [entry(args.input.snapshot_id)]; return null; }
    return stored;
  });
  await r.settle();
  assert.deepEqual(calls.map(c => c[0]), ['goal_progress_list', 'goal_progress_record', 'goal_progress_list']);
  const input = calls[1][1].input, snapshot = sources.snapshot.value;
  assert.equal(input.generation, sources.generation);
  assert.equal(input.snapshot_id, snapshot.id);
  assert.equal(input.snapshot_revision, snapshot.revision);
  assert.equal(input.point.required_monthly_cents, '448031');
  assert.equal(input.point.entered_monthly_cents, '100000');
});

test('an already kept day is never written again', async () => {
  const calls = [];
  const { r, sources } = mount(async name => { calls.push(name); return [entry(sources.snapshot.value.id)]; });
  await r.settle();
  assert.deepEqual(calls, ['goal_progress_list']);
});

test('a failing history never breaks the goal page', async () => {
  const { r } = mount(async () => { throw Error('存储忙'); });
  await r.settle();
  assert.ok(r.find('GoalOverview') || r.nodes().length > 0);
  assert.equal(r.find('GoalProgress')?.props.entries.length, 0);
});
