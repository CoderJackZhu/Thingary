import test from 'node:test';
import assert from 'node:assert/strict';
import { financeCapabilities } from '../src/finance-contract.ts';
import { defaultFinanceRecordTab, financeRouteAvailable, financeSourceRoute, legacyFinanceRoute, validFinanceReturn } from '../src/finance-navigation.ts';
import { sourcePage, openSourceRequest } from '../src/source.ts';
const modules = { wealth: true, expenses: true, planning: false, incomes: true, movements: true };
test('financial entry points work with goals off and explicit sources preserve their owner', () => {
 const capabilities = financeCapabilities(modules);
 const current = { page: 'records', tab: 'expenses', period: { kind: 'month', month: '2026-10' }, movementAccountIds: ['a'] };
 for (const [kind, tab] of [['income', 'income'], ['expense', 'expenses'], ['movement', 'movements']]) {
  const target = { kind, id: 'stable-id' };
  const route = financeSourceRoute(target, current);
  assert.equal(sourcePage(target), 'finance-records');
  assert.equal(route.tab, tab); assert.deepEqual(route.period, current.period); assert.equal(route.source.id, target.id);
  assert.equal(financeRouteAvailable(route, capabilities), true);
 }
 assert.equal(financeRouteAvailable({ page: 'review', view: 'period' }, capabilities), true);
 assert.equal(financeRouteAvailable({ page: 'goals' }, capabilities), false);
});
test('closed source cannot silently use a different available tab; session preference may fall back', () => {
 const capabilities = financeCapabilities({ ...modules, incomes: false });
 const route = financeSourceRoute({ kind: 'income', id: 'i' });
 assert.equal(financeRouteAvailable(route, capabilities), false);
 assert.equal(defaultFinanceRecordTab(capabilities, 'income'), 'expenses');
});
test('records and review roundtrips preserve scopes and invalidate generation or capability changes', () => {
 const capabilities = financeCapabilities(modules);
 for (const route of [{ page: 'records', tab: 'movements', period: { kind: 'range', from: '2026-10-01', to: '2026-10-12', includeFrom: false }, movementAccountIds: ['a'] }, { page: 'review', view: 'compare', pair: { fromSnapshotId: 's1', toSnapshotId: 's2' }, investmentAccountIds: ['a'] }]) {
  const context = { generation: 'g1', route, search: '工资', scroll: 410, sort: 'impact', expandedIds: ['a'], accountView: 'closed' };
  assert.equal(validFinanceReturn(context, 'g1', capabilities), context);
  assert.equal(validFinanceReturn(context, 'g2', capabilities), null);
  assert.equal(validFinanceReturn(context, 'g1', financeCapabilities({ ...modules, wealth: false })), null);
 }
});
test('legacy entry adapters retain the requested year and snapshot', () => {
 assert.deepEqual(legacyFinanceRoute({ kind: 'expenses', year: 2025 }), { page: 'records', tab: 'expenses', period: { kind: 'year', year: 2025 } });
 assert.deepEqual(legacyFinanceRoute({ kind: 'planning-review', toSnapshotId: 's2' }), { page: 'review', view: 'period', toSnapshotId: 's2' });
 assert.deepEqual(legacyFinanceRoute({ kind: 'financial-import' }), { page: 'data-management', importKind: 'finance' });
});
test('stable financial sources cannot apply after a generation or active token changes', async () => {
 for (const kind of ['income', 'movement']) {
  let resolved = false;
  const focus = { target: { kind, id: 'same-name-id' }, generation: 'g1', token: 1 };
  assert.equal((await openSourceRequest(focus, 'g2', async () => {}, () => { resolved = true; return true; }, () => true)).state, 'failed');
  assert.equal((await openSourceRequest(focus, 'g1', async () => {}, () => { resolved = true; return true; }, () => false)).state, 'late');
  assert.equal(resolved, false);
 }
});
