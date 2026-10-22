import { holdingSupported } from '../src/holdings.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { accountGroupTotals } from '../src/wealth-display.ts';
import { groupNameError, recallGroupViews, rememberGroupView } from '../src/account-groups.ts';
const group = (id, position = 0) => ({ id, name: `虚构${id}`, position, revision: 1, accounts: 0 });
const account = (id, group_id = null, changes = {}) => ({ id, fields: { name: `虚构${id}`, group_id, side: 'asset', counted: true, closed_on: null, ...changes }, latest: { date: '2020-01-01', amount_cents: '99999999' } });
const entry = (account_id, amount_cents, changes = {}) => ({ account_id, amount_cents, state: amount_cents === null ? 'missing' : 'entered', side: 'asset', counted: true, kind: 'cash', ...changes });
test('group totals use one snapshot historical counted/side facts, not account latest/current flags', () => {
  const accounts = [account('a', 'first', { counted: false, side: 'liability' }), account('b', 'second'), account('debt', 'first'), account('outside', 'first')];
  const entries = [entry('a', '10000'), entry('b', '30000'), entry('debt', '5000', { side: 'liability' }), entry('outside', '999999', { counted: false })];
  const rows = accountGroupTotals(accounts, [group('first'), group('second', 1)], entries);
  assert.equal(rows[0].assets_cents, '10000'); assert.equal(rows[0].liabilities_cents, '5000'); assert.equal(rows[0].net_cents, '5000'); assert.equal(rows[0].share_hundredths, 2500);
  assert.equal(rows[1].share_hundredths, 7500); assert.equal(rows.at(-1).id, '');
});
test('unknown and uncovered remain partial; no known fact yields no fake zero percentage', () => {
  const rows = accountGroupTotals([account('a', 'first'), account('new', 'second')], [group('first'), group('second', 1)], [entry('a', null)], true);
  assert.equal(rows[0].partial, true); assert.equal(rows[0].known, 0); assert.equal(rows[0].share_hundredths, null);
  assert.equal(rows[1].partial, true); assert.equal(rows[1].known, 0); assert.equal(rows[1].share_hundredths, null);
});
test('most recent incomplete list differs from prior complete structure without filling old known amount', () => {
  const accounts = [account('a', 'first'), account('b', 'second')], groups = [group('first'), group('second', 1)];
  const complete = accountGroupTotals(accounts, groups, [entry('a', '10000'), entry('b', '20000')]);
  const recent = accountGroupTotals(accounts, groups, [entry('a', null), entry('b', '50000')], true);
  assert.equal(complete[0].assets_cents, '10000'); assert.equal(complete[1].assets_cents, '20000');
  assert.equal(recent[0].partial, true); assert.equal(recent[0].share_hundredths, null); assert.equal(recent[1].assets_cents, '50000'); assert.equal(recent[1].share_hundredths, 10000);
});
test('closed accounts use snapshot facts, missing/deleted attribution becomes ungrouped, empty groups stay ordered', () => {
  const accounts = [account('closed', 'second', { closed_on: '2026-10-01' }), account('removed-group', 'gone')];
  const rows = accountGroupTotals(accounts, [group('second', 1), group('empty')], [entry('closed', '10000'), entry('removed-group', '20000'), entry('deleted-account', '30000')]);
  assert.equal(rows[0].id, 'empty'); assert.equal(rows[0].assets_cents, '0'); assert.equal(rows[0].accounts.length, 0);
  assert.equal(rows[1].assets_cents, '10000'); assert.equal(rows[2].id, ''); assert.equal(rows[2].assets_cents, '50000');
});
test('integer cents, negative net, explicit zero and zero denominator remain exact', () => {
  const rows = accountGroupTotals([account('a', 'first')], [group('first')], [entry('a', '99999999999', { side: 'liability' })]);
  assert.equal(rows[0].net_cents, '-99999999999'); assert.equal(rows[0].share_hundredths, null);
  const zero = accountGroupTotals([account('a', 'first')], [group('first')], [entry('a', '0')]);
  assert.equal(zero[0].known, 1); assert.equal(zero[0].partial, false); assert.equal(zero[0].share_hundredths, null);
});
test('group names trim and reject control characters/overlength, view memory resets on switching library', () => {
  assert.equal(groupNameError(' 虚构应急金 '), null);
  for (const name of ['', ' ', '虚'.repeat(41), '虚构\0组', '虚构\n组']) assert.ok(groupNameError(name));
  rememberGroupView('虚构甲', 'mode', 'group'); rememberGroupView('虚构甲', 'structure', 'group');
  assert.equal(recallGroupViews('虚构甲').mode, 'group'); assert.equal(recallGroupViews('虚构甲').structure, 'group');
  assert.equal(recallGroupViews('虚构乙').mode, 'list'); assert.equal(recallGroupViews('虚构甲').mode, 'list');
});
// Execute production manager handlers with a minimal React host; no native UI claim.
function managerRuntime(initial) {
  const source = readFileSync(new URL('../src/AccountGroupManager.tsx', import.meta.url), 'utf8'), slots = [];
  let cursor = 0, result, pending = null; const calls = [], handlers = {};
  const jsx = (type, props) => ({ type, props });
  const react = { useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; }, useEffect() { cursor++; } };
  const exports = {}, code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, crypto, require: id => id === 'react' ? react : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === '@tauri-apps/api/core' ? { invoke: async () => ({ generation: '虚构库', groups: initial }) } : id === './wealth' ? { storedPending: () => pending, submit: async input => { calls.push(JSON.parse(JSON.stringify(input))); if (handlers.write) return handlers.write(input); }, resolvePending: async () => { pending = null; return 'saved'; } } : id === './account-groups' ? { groupNameError } : id === './asset' ? { errorMessage: e => e.message } : {} });
  const props = { generation: '虚构库', onClose() {}, onChanged() {} };
  const render = () => { cursor = 0; result = exports.AccountGroupManager(props); return result; };
  const nodes = () => { const list = []; const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { list.push(n); walk(n.props?.children); } }; walk(result); return list; };
  render(); slots[2] = initial; render(); // groups state follows the two refs.
  return { render, nodes, slots, calls, handlers, setPending: value => { pending = value; } };
}
test('manager keyboard/drop reordering uses full ordered IDs; delete requires explicit count confirmation', async () => {
  const h = managerRuntime([group('a'), { ...group('b', 1), accounts: 3 }]);
  const handles = h.nodes().filter(n => typeof n.props?.onStep === 'function'); assert.equal(handles.length, 2);
  handles[0].props.onStep(1); await new Promise(r => setTimeout(r, 0)); assert.deepEqual(h.calls[0].input.ids, ['b', 'a']);
  h.render(); const buttons = h.nodes().filter(n => n.type === 'button' && n.props.children === '删除'); buttons[1].props.onClick(); h.render();
  assert.match(JSON.stringify(h.nodes().map(n => n.props?.children)), /3.*个账户会变成未分组/);
  assert.equal(h.calls.length, 1);
  h.nodes().find(n => n.type === 'button' && n.props.children === '确认删除').props.onClick(); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.calls[1].command, 'account_group_delete'); assert.equal(h.calls[1].input.expected_accounts, 3);
});
function previewRuntime(query = '') {
  const source = readFileSync(new URL('../src/wealth-preview.ts', import.meta.url), 'utf8'), file = ts.createSourceFile('preview.ts', source, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'wealthPreview').getText().replace('export function ', 'function ');
  const context = { params: new URLSearchParams(query), generation: '虚构预览', accountGroups: [], accounts: [], groupReceipts: new Map(), groupUnknownChecks: new Set(), receipts: new Map(), crypto, financialImportPreview: () => null };
  vm.runInNewContext(ts.transpileModule(fn + '\nglobalThis.run=wealthPreview;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, call: (command, input = {}) => context.run(command, { input }).value };
}
test('four group commands traverse the real preview router and retain request fingerprints', () => {
  const p = previewRuntime(); assert.equal(p.call('account_groups_list').groups.length, 0);
  const input = { request_id: crypto.randomUUID(), generation: '虚构预览', id: null, expected_revision: null, name: '虚构新组' };
  const g = p.call('account_group_save', input); assert.equal(p.call('account_group_save', input).id, g.id);
  assert.throws(() => p.call('account_group_save', { ...input, name: '虚构另一个' }), e => e.code === 'REQUEST_CONFLICT');
  p.call('account_groups_reorder', { request_id: crypto.randomUUID(), generation: input.generation, ids: [g.id] });
  const current = p.call('account_groups_list').groups[0];
  p.call('account_group_delete', { request_id: crypto.randomUUID(), generation: input.generation, id: g.id, expected_revision: current.revision, expected_accounts: 0 });
  assert.equal(p.call('account_groups_list').groups.length, 0);
  assert.equal(p.call('account_group_save', input).id, g.id);
});
test('preview save and read failures remain errors instead of empty success', () => {
  assert.throws(() => previewRuntime('groups=error').call('account_groups_list'), e => /虚构分组读取失败/.test(e.message));
  const p = previewRuntime('state=save-error'); assert.throws(() => p.call('account_group_save', { request_id: crypto.randomUUID(), generation: '虚构预览', id: null, expected_revision: null, name: '虚构' }), e => /虚构分组保存失败/.test(e.message));
  assert.equal(p.call('account_groups_list').groups.length, 0);
});
test('opening group management participates in the real wealth page editing aggregation', () => {
  const source = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('WealthPage.tsx', source, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WealthPage').getText().replace('export function ', 'function ');
  const slots = [], effects = []; let cursor = 0, seen = false;
  const context = { crypto, useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], v => { slots[i] = v; }]; }, useRef: value => ({ current: value }), useEffect: fn => effects.push(fn), useRestored() {}, usePageBar() {}, usePendingReceipt: () => ({ pending: null, setPending() {}, notice: '', busy: false, verify() {} }), useSource: () => '', storedPending: () => null, HeaderSlot: 'header', jsx_runtime_1: { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, exports: {}, require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }) };
  const compiled = ts.transpileModule(fn + '\nglobalThis.page=WealthPage;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, context);
  const props = { today: '2026-10-17', search: '', onSearch() {}, onEditingChange: value => { seen = value; } };
  context.page(props); const editEffect = () => effects.find(fn => fn.toString().includes('onEditingChange(')); editEffect()(); assert.equal(seen, false);
  // Locate the intended hook by name so display-only focus state cannot masquerade as an editor.
  const stateNames = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(file) === 'useState') stateNames.push(node.name.elements[0].getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'WealthPage'));
  const groupSlot = stateNames.indexOf('manageGroups'); assert.ok(groupSlot >= 0); assert.equal(slots[groupSlot], false);
  slots[groupSlot] = true; cursor = 0; effects.length = 0; context.page(props); editEffect()(); assert.equal(seen, true);
  slots[groupSlot] = false;
  const focusSlot = stateNames.indexOf('savingsFocus'); assert.ok(focusSlot >= 0); slots[focusSlot] = true;
  cursor = 0; effects.length = 0; context.page(props); editEffect()(); assert.equal(seen, false);
});

function receiptRuntime(invoke) {
  const source = readFileSync(new URL('../src/wealth.ts', import.meta.url), 'utf8'), values = new Map(), exports = {};
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, localStorage, require: id => id === '@tauri-apps/api/core' ? { invoke } : { errorMessage: e => e.message } });
  return exports;
}
test('real group unknown preview and submit preserve exact request, block a second write, and verify once', async () => {
  for (const command of ['account_group_save', 'account_group_delete', 'account_groups_reorder']) {
    const p = previewRuntime('group-write=unknown'), request_id = crypto.randomUUID();
    // Seed normally so each operation reaches its commit branch.
    p.context.params.delete('group-write');
    const g = p.call('account_group_save', { request_id: crypto.randomUUID(), generation: '虚构预览', id: null, expected_revision: null, name: '虚构原组' });
    p.context.params.set('group-write', 'unknown');
    const input = command === 'account_group_save' ? { request_id, generation: '虚构预览', id: g.id, expected_revision: g.revision, name: '虚构保留名称' } : command === 'account_group_delete' ? { request_id, generation: '虚构预览', id: g.id, expected_revision: g.revision, expected_accounts: 0 } : { request_id, generation: '虚构预览', ids: [g.id] };
    const calls = [], api = receiptRuntime(async (cmd, args) => { calls.push(cmd); return p.context.run(cmd, args).value; });
    const pending = { command, input, label: '虚构分组操作' };
    await assert.rejects(api.submit(pending), /原请求已保留/);
    assert.deepEqual(JSON.parse(JSON.stringify(api.storedPending())), pending);
    assert.deepEqual(calls, [command, 'wealth_request_result']);
    await assert.rejects(api.submit({ ...pending, input: { ...input, request_id: crypto.randomUUID() } }), /请先核对/);
    assert.equal(calls.length, 2);
    assert.equal(await api.resolvePending(pending), 'saved'); assert.equal(api.storedPending(), null);
    assert.equal(p.context.groupReceipts.size, 2);
    if (command === 'account_group_save') assert.equal(p.call('account_groups_list').groups[0].name, '虚构保留名称');
  }
});
test('all group pending commands retain original metadata after switching library', async () => {
  for (const command of ['account_group_save', 'account_group_delete', 'account_groups_reorder']) {
    const api = receiptRuntime(async () => { throw { code: 'STALE_DATASET', message: '虚构切换资料库' }; });
    const pending = { command, input: { request_id: crypto.randomUUID(), generation: '虚构原库', name: '虚构输入' }, label: '虚构分组操作' };
    await assert.rejects(api.submit(pending), /原请求已保留/);
    assert.deepEqual(JSON.parse(JSON.stringify(api.storedPending())), pending);
    await assert.rejects(api.resolvePending(pending), /原请求元数据仍保留/);
    assert.deepEqual(JSON.parse(JSON.stringify(api.storedPending())), pending);
  }
});
test('manager unknown result preserves typed name and disables duplicate edits until verification', async () => {
  const h = managerRuntime([group('a')]);
  h.nodes().find(n => n.type === 'input').props.onChange({ target: { value: '虚构待核名称' } }); h.render();
  h.handlers.write = async pending => { h.setPending(pending); throw new Error('虚构结果未知'); };
  h.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  await new Promise(r => setTimeout(r, 0)); h.render();
  assert.equal(h.nodes().find(n => n.type === 'input').props.value, '虚构待核名称');
  assert.equal(h.nodes().find(n => n.type === 'input').props.disabled, true);
  h.nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await new Promise(r => setTimeout(r, 0));
  assert.equal(h.calls.length, 1);
  h.nodes().find(n => n.type === 'button' && n.props.children === '核对结果').props.onClick(); await new Promise(r => setTimeout(r, 0)); h.render();
  assert.equal(h.nodes().find(n => n.type === 'input').props.value, ''); assert.equal(h.nodes().find(n => n.type === 'input').props.disabled, false);
});
test('inline group recovery replays its exact receipt and retains unsaved account fields and selected stable ID', async () => {
  const p = previewRuntime('group-write=unknown'), calls = [];
  const api = receiptRuntime(async (command, args) => { calls.push({ command, args: JSON.parse(JSON.stringify(args)) }); return p.context.run(command, args).value; });
  const source = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('WealthPage.tsx', source, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AccountDialog').getText();
  const slots = []; let cursor = 0, result; const jsx = (type, props) => ({ type, props });
  const context = { ...api, crypto, groupNameError, holdingSupported, currencyCode: code => code ?? "CNY", validCurrency: code => /^[A-Z]{3}$/.test(code), currencies: [], errorMessage: e => e.message, blankAccount: today => ({ name: '', institution: '', side: 'asset', kind: 'cash', counted: true, opened_on: today, closed_on: null, notes: '' }), useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; }, useRef(value) { return slots[cursor++] ??= { current: value }; }, useEffect() {}, assetKinds: [], liabilityKinds: [], accountKindHint: () => '', defaultAccountCounted: () => true, require: () => ({ jsx, jsxs: jsx }), exports: {} };
  for (const type of ['CloseButton', 'DeleteButton', 'FormRow', 'Switch', 'DateInput', 'CentInput']) context[type] = type;
  vm.runInNewContext(ts.transpileModule(fn + '\nglobalThis.dialog=AccountDialog;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const render = () => { cursor = 0; result = context.dialog({ account: null, generation: '虚构预览', today: '2026-10-17', onClose() {}, onQuick() {} }); };
  const nodes = () => { const list = []; const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { list.push(n); walk(n.props?.children); } }; walk(result); return list; };
  const byLabel = label => nodes().find(n => n.props?.['aria-label'] === label), button = text => nodes().find(n => n.type === 'button' && n.props.children === text);
  render(); byLabel('账户名称').props.onChange({ target: { value: '虚构未保存账户' } }); byLabel('账户分组').props.onChange({ target: { value: '__new__' } }); render();
  byLabel('就地新建分组名称').props.onChange({ target: { value: '虚构待核新组' } }); render(); button('创建并选择').props.onClick(); await new Promise(r => setTimeout(r, 0)); render();
  assert.equal(byLabel('账户名称').props.value, '虚构未保存账户'); assert.equal(byLabel('就地新建分组名称').props.value, '虚构待核新组'); assert.equal(byLabel('账户名称').props.disabled, true);
  button('核对分组结果').props.onClick(); await new Promise(r => setTimeout(r, 0)); render();
  assert.equal(byLabel('账户名称').props.value, '虚构未保存账户'); assert.equal(byLabel('账户名称').props.disabled, false);
  assert.equal(byLabel('账户分组').props.value, p.call('account_groups_list').groups[0].id);
  const writes = calls.filter(c => c.command === 'account_group_save'); assert.equal(writes.length, 2); assert.deepEqual(writes[0].args, writes[1].args); assert.equal(api.storedPending(), null);
});
test('new group headers and group ShareBars honor the shared privacy preference without leaking percentages or bar widths', () => {
  const source = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('WealthPage.tsx', source, ts.ScriptTarget.Latest, true);
  const functions = ['groupAmountsHidden', 'AccountListing', 'ShareBars'].map(name => file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText()).join('\n');
  const jsx = (type, props) => ({ type, props }); let hidden = true;
  const context = { module: { exports: {} }, exports: {}, require: () => ({ jsx, jsxs: jsx }), accountGroupTotals, Accounts: 'Accounts', money: value => `¥${value}`, signedMoney: value => `¥${value}`, kindLabel: value => value, series: () => 'var(--series-1)', localStorage: { getItem: key => key === 'thingary.hide-financial-amounts.v1' && hidden ? '1' : '0' } };
  vm.runInNewContext(ts.transpileModule(functions + '\nglobalThis.list=AccountListing;globalThis.bars=ShareBars;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const accounts = [account('a', 'first')], groups = [group('first')], entries = [entry('a', '10000000')];
  const props = { mode: 'group', accounts, allAccounts: accounts, groups, summary: { points: [{ date: '2026-10-17' }], latest_entries: entries } };
  const nodes = tree => { const list = []; const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { list.push(n); walk(n.props?.children); } }; walk(tree); return list; };
  const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
  const headers = () => nodes(context.list(props)).filter(n => n.type === 'header');
  assert.ok(headers().every(n => text(n).includes('金融金额已隐藏')));
  assert.ok(headers().every(n => !/[¥%]/.test(text(n))));
  const bars = { rows: [{ kind: 'first', amount_cents: '10000000', share_hundredths: 10000 }], labels: { first: '虚构first' }, empty: '没有计入的资产。' };
  assert.equal(text(context.bars(bars)), '金融金额已隐藏');
  assert.equal(nodes(context.bars(bars)).some(n => n.props?.style?.width), false);
  hidden = false;
  assert.match(text(headers()), /¥10000000.*100\.00%/);
  assert.match(text(context.bars(bars)), /100\.0%.*¥10000000/);
  assert.ok(nodes(context.bars(bars)).some(n => n.props?.style?.width === '100%'));
});
import { groupAccountsText, groupDeleteText, movedGroupIds } from '../src/account-groups.ts';
test('iPhone group reorder moves one step and refuses to leave the list', () => {
  const groups = ['a', 'b', 'c'].map((id, i) => group(id, i));
  assert.deepEqual(movedGroupIds(groups, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(movedGroupIds(groups, 'b', 1), ['a', 'c', 'b']);
  assert.equal(movedGroupIds(groups, 'a', -1), null); assert.equal(movedGroupIds(groups, 'c', 1), null); assert.equal(movedGroupIds(groups, 'x', 1), null);
});
test('group delete wording is shared and says accounts stay, ungrouped', () => {
  const g = { ...group('a'), accounts: 3 };
  assert.equal(groupAccountsText(g), '3 个账户（含已停用和最近删除）');
  assert.match(groupDeleteText(g), /3 个账户会变成未分组，账户本身不会删除。此操作无法撤销/);
});
test('iPhone group manager and trash use the same commands and sheets as desktop', () => {
  const groups = readFileSync(new URL('../src/mobile/wealth/Groups.tsx', import.meta.url), 'utf8');
  for (const command of ['account_group_save', 'account_group_delete', 'account_groups_reorder']) assert.ok(groups.includes(`'${command}'`), command);
  assert.ok(groups.includes('expected_accounts: group.accounts') && groups.includes('<DeleteSheet') && groups.includes('recoverable={false}'));
  assert.ok(readFileSync(new URL('../src/mobile/wealth/AccountEdit.tsx', import.meta.url), 'utf8').includes("'wealth.groups'"));
  assert.ok(readFileSync(new URL('../src/mobile/wealth/Overview.tsx', import.meta.url), 'utf8').includes("'wealth.groups'"));
  const trash = readFileSync(new URL('../src/mobile/me/settings/Trash.tsx', import.meta.url), 'utf8'), link = readFileSync(new URL('../src/mobile/me/settings/TrashLink.tsx', import.meta.url), 'utf8');
  assert.ok(!trash.includes('桌面版'), 'no more desktop-only refusal');
  for (const text of ["'link_restore'", "'link_purge_preview'", "kind: 'link_group'", "'link_reconcile'", 'preview: p.preview']) assert.ok(link.includes(text), text);
  for (const text of ['GroupRestoreSheet', 'GroupPurgeSheet', 'RepairSheet']) assert.ok(trash.includes(text), text);
});
