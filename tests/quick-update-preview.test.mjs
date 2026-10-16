import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/wealth-preview.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('wealth-preview.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['latestBefore', 'view', 'summary', 'wealthPreview'];
const picked = file.statements.filter(n => (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['withLatest', 'hundredths'].includes(d.name.getText())))).map(n => n.getText()).join('\n').replaceAll('export function ', 'function ');
const initialization = file.statements.find(n => ts.isIfStatement(n) && n.expression.getText().includes("'quick-new-day'")).getText();
function fixture(query = '', withToday = false) {
  const accounts = ['cash', 'fund', 'card', 'unknown'].map((id, i) => ({ id, fields: { name: `虚构${id}`, side: id === 'card' ? 'liability' : 'asset', kind: id === 'card' ? 'credit_card' : 'cash', counted: true, opened_on: '2026-01-01', closed_on: null } }));
  const snapshots = [{ id: 'before', date: '2026-10-01', notes: '虚构原备注', revision: 1, entries: accounts.slice(0, 3).map((a, i) => ({ account_id: a.id, amount_cents: ['10000', '5000', '3000'][i], state: 'entered', side: a.fields.side, kind: a.fields.kind, counted: true })) }];
  if (withToday) snapshots.push({ ...structuredClone(snapshots[0]), id: 'today-existing', date: '2026-10-17' });
  const context = { accounts, snapshots, params: new URLSearchParams(query), generation: '虚构资料', now: new Date('2026-10-17T12:00:00Z'), iso: date => date.toISOString().slice(0, 10), receipts: new Map(), quickFingerprints: new Map(), quickStaleShown: false, crypto,
    due: (a, d) => a.fields.opened_on <= d && (!a.fields.closed_on || d < a.fields.closed_on), known: e => e.amount_cents !== null, financialImportPreview: () => null, planFail: () => false };
  const code = ts.transpileModule(picked + '\n' + initialization + '\nglobalThis.run=wealthPreview;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, context);
  const call = (command, args) => JSON.parse(JSON.stringify(context.run(command, args).value));
  const update = (changes, date = '2026-10-10', note = '', request_id = crypto.randomUUID()) => call('wealth_quick_update', { input: { request_id, generation: '虚构资料', date, note, changes } });
  return { context, call, update };
}
test('虚构预览快速更新：新建沿用与未知、同日更正保留A22金额及历史计入', () => {
  const f = fixture(), first = f.update([{ account_id: 'fund', amount_cents: '6000' }], undefined, '虚构调整');
  assert.deepEqual(first.entries.map(e => [e.account_id, e.state, e.amount_cents]), [['cash', 'unchanged', '10000'], ['fund', 'entered', '6000'], ['card', 'unchanged', '3000'], ['unknown', 'missing', null]]);
  f.context.snapshots[0].entries[0].amount_cents = '99900';
  f.context.snapshots[1].entries[0].counted = false;
  const second = f.update([{ account_id: 'card', amount_cents: '0', expected_previous: '3000' }], undefined, '虚构还款');
  assert.equal(second.id, first.id); assert.equal(second.revision, first.revision + 1);
  assert.equal(second.entries[0].amount_cents, '10000'); assert.equal(second.entries[0].counted, false);
  assert.equal(second.notes, '虚构fund：虚构调整\n虚构card：虚构还款');
  assert.deepEqual(second.missing, ['unknown']);
});
test('虚构预览转账、请求重放与冲突、陈旧金额及日期拒绝均不留半写', () => {
  const f = fixture(), change = [{ account_id: 'cash', amount_cents: '9000', expected_previous: '10000' }, { account_id: 'card', amount_cents: '2000', expected_previous: '3000' }];
  const first = f.update(change, undefined, '', '虚构请求');
  assert.deepEqual(f.update(change, undefined, '', '虚构请求'), first);
  assert.throws(() => f.update([{ account_id: 'cash', amount_cents: '1' }], undefined, '', '虚构请求'), e => e.code === 'REQUEST_CONFLICT');
  for (const [changes, date, code] of [[change, '2026-10-10', 'QUICK_STALE'], [[{ account_id: 'cash', amount_cents: '1' }], '2026-10-09', 'QUICK_DATE'], [[{ account_id: 'cash', amount_cents: '1' }], '2026-10-18', 'SNAPSHOT_DATE'], [[{ account_id: 'cash', amount_cents: '8000', expected_previous: '9000' }, { account_id: 'card', amount_cents: '2000', expected_previous: '2000' }], '2026-10-11', 'QUICK_TRANSFER']]) assert.throws(() => f.update(changes, date), e => e.code === code);
  assert.equal(f.context.snapshots.length, 2); assert.equal(f.context.snapshots[1].revision, first.revision);
});
test('虚构预览同日未知不能用历史已知来通过陈旧金额检查', () => {
  const f = fixture(); f.context.snapshots[0].entries.push({ account_id: 'unknown', state: 'entered', amount_cents: '100', side: 'asset', kind: 'cash', counted: true });
  f.update([{ account_id: 'fund', amount_cents: '6000' }]);
  f.context.snapshots[1].entries.find(e => e.account_id === 'unknown').amount_cents = null;
  assert.throws(() => f.update([{ account_id: 'unknown', amount_cents: '200', expected_previous: '100' }]), e => e.code === 'QUICK_STALE');
});

test('虚构预览未知回执：已提交但响应丢失，只读核对失败而保存事实保留', () => {
  const f = fixture('quick=unknown');
  assert.throws(() => f.update([{ account_id: 'cash', amount_cents: '12345' }], undefined, '', '虚构未知'), /./);
  assert.equal(f.context.snapshots[1].entries.find(e => e.account_id === 'cash').amount_cents, '12345');
  assert.throws(() => f.call('wealth_request_result', { request: '虚构未知' }), /./);
  assert.equal(f.context.receipts.get('虚构未知'), f.context.snapshots[1].id);
});

test('虚构预览只读派生：沿用不刷新填写日期，含沿用且没有未知仍完整', () => {
  const f = fixture();
  f.update([{ account_id: 'unknown', amount_cents: '0' }]);
  const accounts = f.call('wealth_accounts', {});
  assert.equal(accounts.find(a => a.id === 'cash').last_entered_on, '2026-10-01');
  assert.equal(accounts.find(a => a.id === 'unknown').last_entered_on, '2026-10-10');
  const point = f.call('wealth_summary', {}).points.at(-1);
  assert.equal(point.has_unchanged, true); assert.equal(point.complete, true);
});

test('虚构quick-new-day夹具：只移除今天快照，新日更新留下沿用且不刷新其他账户填写日期', () => {
  const f = fixture('wealth-fixture=quick-new-day', true);
  assert.deepEqual(f.context.snapshots.map(s => s.date), ['2026-10-01']);
  const saved = f.update([{ account_id: 'fund', amount_cents: '6789' }], '2026-10-17');
  assert.notEqual(saved.id, 'today-existing'); assert.equal(saved.date, '2026-10-17');
  assert.equal(saved.entries.find(e => e.account_id === 'fund').state, 'entered');
  assert.equal(saved.entries.find(e => e.account_id === 'cash').state, 'unchanged');
  assert.equal(saved.entries.find(e => e.account_id === 'card').state, 'unchanged');
  const accounts = f.call('wealth_accounts', {});
  assert.equal(accounts.find(a => a.id === 'cash').last_entered_on, '2026-10-01');
  assert.equal(accounts.find(a => a.id === 'fund').last_entered_on, '2026-10-17');
  assert.equal(f.call('wealth_summary', {}).points.at(-1).has_unchanged, true);
});
