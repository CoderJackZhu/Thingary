import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './planning-ui-fixture.mjs';
import { draftOf, fundsInput } from '../src/planning-basic-forms.ts';
import { fundScopeSummary } from '../src/planning-fund-scope.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

const entry = (id, kind, amount, counted = true) => ({ account_id: id, kind, amount_cents: amount, side: 'asset', counted, state: 'entered' });
test('cash and investments are draft suggestions only; saved restrictions and participation survive', () => {
  const s = fixture(), saved = s.profile.value.saved, r = saved.profile.retire;
  r.basic.start = { kind: 'live' };
  r.core.fund_rules = [{ account_id: 'locked', availability: 'restricted', share_hundredths: 6000 }];
  s.snapshot.value.entries = [entry('cash', 'cash', '10000'), entry('fund', 'fund', '20000'), entry('stock', 'investment', '30000'), entry('bond', 'bond', '5000'), entry('mixed', 'mixed', '6000'), entry('locked', 'fund', '7000'), entry('hpf', 'housing_fund', '8000'), entry('other', 'other_asset', '9000')];
  s.snapshot.value.missing = [];
  const original = structuredClone(s), draft = draftOf(saved, s.snapshot.value);
  assert.deepEqual(draft.funds.find(f => f.account_id === 'locked'), r.core.fund_rules[0]);
  for (const id of ['cash', 'fund', 'stock', 'bond', 'mixed']) assert.equal(draft.funds.find(f => f.account_id === id).availability, 'available');
  for (const id of ['hpf', 'other']) assert.equal(draft.funds.find(f => f.account_id === id).availability, 'restricted');
  assert.equal(buildBasicCapabilities(s).funds.status, 'blocked');
  const confirmed = overlayPlanningDrafts(s, [fundsInput(draft, saved, s.today)]);
  assert.equal(buildBasicCapabilities(confirmed).funds.value.available_cents, '71000');
  assert.deepEqual(s, original);
});

test('visible scope totals use the calculation proportions and retain unknown investment balances', () => {
  const snapshot = { entries: [entry('cash', 'cash', '12345'), entry('fund', 'fund', '10001'), entry('locked', 'fund', '20000'), entry('out', 'investment', '50000'), entry('ignored', 'fund', '99999', false)] };
  const rules = [{ account_id: 'cash', availability: 'available', share_hundredths: 10000 }, { account_id: 'fund', availability: 'available', share_hundredths: 6000 }, { account_id: 'locked', availability: 'restricted', share_hundredths: 10000 }, { account_id: 'out', availability: 'excluded', share_hundredths: 10000 }];
  const accounts = snapshot.entries.map(e => ({ id: e.account_id, fields: { name: `虚构 ${e.account_id}` } }));
  const summary = fundScopeSummary(snapshot, rules, accounts);
  assert.deepEqual(summary.totals, { cash: '12345', investment: '6000', other: '0' });
  assert.deepEqual(summary.unavailable, ['虚构 locked（暂不能动用）', '虚构 out（不参与）']);
  snapshot.entries[1].amount_cents = null;
  assert.equal(fundScopeSummary(snapshot, rules, accounts).totals.investment, null);
});
