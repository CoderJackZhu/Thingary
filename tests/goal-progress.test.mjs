import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { runtime } from './planning-component-runtime.mjs';
import { buildBasicCapabilities } from '../src/plan-basic.ts';
import * as model from '../src/goal-progress.ts';
import * as format from '../src/plan-format.ts';

const point = (extra = {}) => ({ mode: 'traditional', target_month: '2046-10', available_cents: '10000000', required_monthly_cents: '580000', entered_monthly_cents: '500000', success: false, shortfall_at_goal_cents: '18900000', predicted_retire_month: null, has_open_items: false, ...extra });
const entry = (date, extra = {}) => ({ snapshot_id: 'snap-' + date, date, recorded_on: date, point: point(extra) });
const yuan = c => '¥' + (Number(c) / 100);

test('the saved goal becomes a point from a live check-in; unknowns stay null', () => {
  const sources = fixture(), saved = sources.profile.value.saved, caps = buildBasicCapabilities(sources);
  const retire = saved.profile.retire;
  const p = model.goalProgressPoint(caps, retire.mode, retire.simplified.time.target_month, retire.basic.contribution.monthly_cents);
  assert.equal(p.mode, 'traditional');
  assert.equal(p.available_cents, '10000000');
  assert.equal(p.required_monthly_cents, '448031');
  assert.equal(p.entered_monthly_cents, '100000');
  assert.equal(p.success, false);
  assert.match(p.shortfall_at_goal_cents, /^\d+$/);
  assert.equal(p.predicted_retire_month, null);
  assert.equal(p.has_open_items, true);
  const noEstimate = model.goalProgressPoint(caps, retire.mode, null, null);
  assert.equal(noEstimate.entered_monthly_cents, null);
  assert.equal(noEstimate.target_month, null);
});

test('nothing is recorded without a live check-in or without any calculation', () => {
  const sources = fixture(), caps = buildBasicCapabilities(sources);
  const simulated = { ...caps, funds: { ...caps.funds, value: { ...caps.funds.value, kind: 'simulation' } } };
  assert.equal(model.goalProgressPoint(simulated, 'traditional', '2046-10', '100000'), null);
  const blocked = { ...caps, requirement: { status: 'blocked', missing: [] }, prediction: { status: 'blocked', missing: [] } };
  assert.equal(model.goalProgressPoint(blocked, 'traditional', '2046-10', null), null);
  const noFunds = { ...caps, funds: { status: 'blocked', missing: [] } };
  assert.equal(model.goalProgressPoint(noFunds, 'traditional', '2046-10', '100000'), null);
});

test('verdict wording follows what was known that day', () => {
  assert.match(model.goalProgressVerdict(point({ success: null }), yuan), /没有每月能存的估计/);
  assert.match(model.goalProgressVerdict(point({ success: true }), yuan), /目标期间可覆盖/);
  assert.equal(model.goalProgressVerdict(point(), yuan), '按当时投入，目标年龄时还差 ¥189000');
  assert.match(model.goalProgressVerdict(point({ shortfall_at_goal_cents: null }), yuan), /尚未满足完整目标/);
  assert.equal(model.goalProgressVerdict(point({ mode: 'fire', predicted_retire_month: '2044-03' }), yuan), '预计 2044-03 退休');
  assert.match(model.goalProgressVerdict(point({ mode: 'fire', predicted_retire_month: null }), yuan), /规划终点前尚未达成/);
});

test('change between two days only uses figures known on both', () => {
  const a = entry('2026-09-13'), b = entry('2026-10-13', { required_monthly_cents: '520000', available_cents: '10300000' });
  assert.equal(model.goalProgressChange(a, b, yuan), '较上次盘点（2026-09-13）：需要每月存少了 ¥600，可用资金增加 ¥3000。');
  assert.equal(model.goalProgressChange(b, a, yuan), '较上次盘点（2026-10-13）：需要每月存多了 ¥600，可用资金减少 ¥3000。');
  const unknown = entry('2026-10-13', { required_monthly_cents: null, available_cents: null });
  assert.equal(model.goalProgressChange(a, unknown, yuan), '较上次盘点（2026-09-13）没有可比的变化。');
  assert.equal(model.goalProgressChange(a, entry('2026-10-13'), yuan), '较上次盘点（2026-09-13）没有可比的变化。');
});

function card(entries) {
  return runtime('GoalProgress', { entries }, undefined, undefined, { components: [], modules: { './asset': { money: c => '¥' + Number(c) / 100 }, './plan-format': format, './goal-progress': model } });
}

test('the card needs two days, lists the newest first and flags open items', () => {
  assert.equal(card([entry('2026-10-13')]).nodes().length, 0, 'one day is not a change');
  const r = card([entry('2026-08-13', { has_open_items: true }), entry('2026-09-13'), entry('2026-10-13', { required_monthly_cents: null, entered_monthly_cents: null, available_cents: null, success: null })]);
  const text = r.text(r.nodes()[0]);
  assert.match(text, /盘点以来的变化/);
  assert.match(text, /较上次盘点（2026-09-13）没有可比的变化/);
  assert.match(text, /之后修改目标不会改写这里/);
  const dates = r.nodes().filter(n => n.type === 'tr').slice(1).map(row => r.text(row).slice(0, 10));
  assert.deepEqual(dates, ['2026-10-13', '2026-09-13', '2026-08-13']);
  assert.match(text, /2026-08-13 \*/);
  assert.match(text, /未知/); assert.match(text, /未算出/); assert.match(text, /未填写/);
});

test('twelve rows at most', () => {
  const entries = Array.from({ length: 15 }, (_, i) => entry(`2025-${String(i % 12 + 1).padStart(2, '0')}-${String(i + 10)}`));
  const r = card(entries);
  const rows = r.nodes().filter(n => n.type === 'tr');
  assert.equal(rows.length, 12 + 1);
});
