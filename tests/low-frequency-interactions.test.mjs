import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { snapshotEntryInput } from '../src/wealth.ts';
import { verifyAssetPatch } from '../src/wishlist.ts';

// Run the production event handlers with controlled hooks/IPC. These verify
// requests and async behavior, rather than merely matching source strings.
const require = createRequire(import.meta.url);
const ts = require('typescript');
function source(file) {
  return ts.createSourceFile(file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function compile(code) {
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
const wishes = source('WishDetail.tsx');
const detail = wishes.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'WishDetail');
const wishHandlers = ['openVerify', 'verify'].map(name => detail.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name).getText(wishes));
// The paged candidate search moved to the shared picker module (C-phase);
// its function body only references `invoke`, which the runtime provides.
const pickerSource = source('asset-picker.ts');
const picker = pickerSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'loadAssetCandidates');
const effect = detail.body.statements.find(n => ts.isExpressionStatement(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(wishes) === 'useEffect' && n.expression.arguments[0].getText(wishes).includes('linkCandidates'));
const more = detail.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'moreLinks');
const wishScript = compile(`${picker.getText(pickerSource)}\nconst linkCandidates = loadAssetCandidates;\n${wishHandlers.join('\n')}\n${more.getText(wishes)}\nconst runLinkEffect = ${effect.expression.arguments[0].getText(wishes)};\nmodule.exports = {openVerify, verify, linkCandidates, moreLinks, runLinkEffect};`);
function wishRuntime(invoke) {
  const seen = { open: false, busy: false, notice: '', requests: [] };
  const context = { module: { exports: {} }, exports: {},
    item: { id: 'fictional-wish', revision: 1, legacy_generated_asset: { id: 'fictional-asset' } },
    linkRun: { current: 0 }, linkOpen: true, linkQuery: '', linkOffset: null, linkLoading: false, candidates: null,
    setLinkError: v => { seen.linkError = v; }, setLinkOffset: v => { context.linkOffset = v; },
    setLinkLoading: v => { context.linkLoading = v; }, setCandidates: v => { context.candidates = typeof v === 'function' ? v(context.candidates) : v; },
    lock: { current: false }, verifyBase: { current: null }, generation: 'fictional-generation',
    verifyPrice: '', verifyDate: '', verifyNote: '', verifyKey: 'fictional-test',
    crypto: { randomUUID: () => 'fictional-request' }, localStorage: { removeItem() {} },
    verifyAssetPatch, errorMessage: e => String(e), storePending: () => true,
    setVerifyPrice: v => { context.verifyPrice = v; }, setVerifyDate: v => { context.verifyDate = v; },
    setVerifyOpen: v => { seen.open = v; }, setVerifyNote() {}, setBusy: v => { seen.busy = v; },
    setNotice: v => { seen.notice = v; }, setVerifyPending() {}, setItem() {}, onChange() {},
    invoke: async (command, args) => { seen.requests.push({ command, args }); return invoke(command, args); },
  };
  vm.runInNewContext(wishScript, context);
  return { context, seen, ...context.module.exports };
}
const record = { asset: { id: 'fictional-asset', revision: 3, price_cents: '50000', purchase_date: '2026-01-10' } };

test('verify waits for prefill and untouched fields produce no asset patch', async () => {
  let resolve;
  const read = new Promise(r => { resolve = r; });
  let submitted;
  const runtime = wishRuntime(async (command, args) => {
    if (command === 'read_asset') return read;
    if (command === 'verify_legacy_wish') { submitted = args.input; return runtime.context.item; }
    throw new Error(command);
  });
  const opening = runtime.openVerify();
  assert.equal(runtime.seen.open, false);
  assert.equal(runtime.seen.busy, true);
  await runtime.verify('purchased');
  assert.equal(submitted, undefined); // confirm cannot run during the read
  resolve(record);
  await opening;
  assert.equal(runtime.seen.open, true);
  assert.equal(runtime.seen.busy, false);
  assert.equal(runtime.context.verifyPrice, '500');
  assert.equal(runtime.context.verifyDate, '2026-01-10');
  await runtime.verify('purchased');
  assert.equal(submitted.asset_patch, null);
  assert.equal(runtime.seen.requests.filter(r => r.command === 'read_asset').length, 1);
});

test('verify submits only changed fields with the displayed revision, including invalid-input recovery', async () => {
  let submitted;
  const runtime = wishRuntime(async (command, args) => {
    if (command === 'read_asset') return record;
    submitted = args.input; return runtime.context.item;
  });
  await runtime.openVerify();
  runtime.context.verifyPrice = 'bad';
  await runtime.verify('purchased');
  assert.equal(submitted, undefined);
  assert.equal(runtime.seen.busy, false);
  assert.equal(runtime.context.lock.current, false);
  runtime.context.verifyPrice = '600';
  await runtime.verify('purchased');
  assert.deepEqual(JSON.parse(JSON.stringify(submitted.asset_patch)), {
    asset_id: record.asset.id, expected_revision: 3, price_cents: '60000', purchase_date: null,
  });
  assert.equal(runtime.seen.requests.filter(r => r.command === 'read_asset').length, 1);
});

test('failed verify prefill leaves the form closed and can be retried', async () => {
  let fail = true;
  const runtime = wishRuntime(async () => { if (fail) throw new Error('read failed'); return record; });
  await runtime.openVerify();
  assert.equal(runtime.seen.open, false);
  assert.equal(runtime.context.verifyBase.current, null);
  assert.equal(runtime.seen.busy, false);
  assert.match(runtime.seen.notice, /read failed/);
  fail = false;
  await runtime.openVerify();
  assert.equal(runtime.seen.open, true);
  assert.equal(runtime.context.verifyBase.current.revision, 3);
});

function asset(index) { return { asset: { id: `fictional-${index}`, name: `Fictional asset ${index}`, revision: 1, purchase_date: null }, deleted: false }; }
test('link search reaches item 2001 through backend search and pagination without a cap', async () => {
  const calls = [];
  const runtime = wishRuntime(async (command, args) => {
    assert.equal(command, 'list_assets');
    calls.push(args.query);
    const offset = args.query.offset;
    if (args.query.search === 'Fictional asset 2000') return { total: 1, items: [asset(2000)] };
    return { total: 2001, items: Array.from({ length: Math.min(100, 2001 - offset) }, (_, i) => asset(offset + i)) };
  });
  const matched = await runtime.linkCandidates(null, 'Fictional asset 2000');
  assert.equal(matched.items[0].id, 'fictional-2000');
  assert.equal(matched.nextOffset, null);
  const ids = [];
  let offset = 0;
  do {
    const page = await runtime.linkCandidates(null, '', offset);
    ids.push(...page.items.map(i => i.id));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(ids.length, 2001);
  assert.equal(new Set(ids).size, 2001);
  assert.equal(ids.at(-1), 'fictional-2000');
  assert.equal(calls[0].search, 'Fictional asset 2000');
  assert.equal(calls.at(-1).offset, 2000);
});

test('original wish item is independently read, while deleted candidates require restoration', async () => {
  let deleted = false;
  const runtime = wishRuntime(async (command) => command === 'list_assets' ? { total: 1, items: [asset(0)] } : { ...asset(2000), deleted });
  const page = await runtime.linkCandidates('fictional-2000', '');
  assert.equal(page.items[0].id, 'fictional-2000');
  assert.equal(page.items[0].own, true);
  assert.equal(page.nextOffset, null);
  deleted = true;
  const next = await runtime.linkCandidates('fictional-2000', '');
  assert.deepEqual(Array.from(next.items, i => i.id), ['fictional-0']);
});

const wealth = source('WealthPage.tsx');
const checkIn = wealth.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'CheckIn');
const checkInScript = compile(`${checkIn.getText(wealth)}\nmodule.exports = CheckIn;`);
function checkInRuntime() {
  const entry = { account_id: 'fictional-account', state: 'unchanged', amount_cents: '10000', side: 'asset', counted: true };
  const draft = { generation: 'fictional-generation', existing: { id: 'fictional-snapshot', revision: 2, notes: 'saved', entries: [entry] }, rows: [{ account: { id: entry.account_id, fields: { name: 'Fictional', side: 'asset', kind: 'cash', counted: true } }, previous: { amount_cents: '20000', date: '2026-07-01' } }] };
  const states = ['2026-08-01', undefined, draft, '', 'saved', false, { [entry.account_id]: { state: 'unchanged', cents: '10000' } }, false, '', false, null];
  let cursor = 0, request;
  const context = { module: { exports: {} }, exports: {}, require,
    useState() { const slot = cursor++; return [states[slot], v => { states[slot] = typeof v === 'function' ? v(states[slot]) : v; }]; },
    useEffect() {}, useRef: v => ({ current: v }),
    snapshotEntryInput, previewTotals: () => ({ assets: '0', liabilities: '0', net: '0', missing: 0 }),
    money: v => v, signedMoney: v => v, kindLabel: v => v, changeText: v => v,
    Icon() {}, DateInput() {}, CentInput() {}, DeleteButton() {}, Unresolved: class extends Error {},
    crypto: { randomUUID: () => 'fictional-request' }, errorMessage: e => String(e),
    submit: async p => { request = p.input; return {}; },
  };
  vm.runInNewContext(checkInScript, context);
  function render() {
    cursor = 0;
    const tree = context.module.exports({ date: states[0], today: '2026-10-05', onClose() {} });
    const nodes = [];
    function walk(e) { if (!e || typeof e !== 'object') return; if (Array.isArray(e)) { e.forEach(walk); return; } if (e.props) { nodes.push(e); walk(e.props.children); } }
    walk(tree); return nodes;
  }
  const button = text => render().find(n => n.type === 'button' && n.props.children === text);
  return { states, context, render, button, async save() { button('保存更正').props.onClick(); await new Promise(setImmediate); return request; } };
}
test('notes correction preserves historical amounts while typed amounts always submit entered', async () => {
  const ui = checkInRuntime();
  ui.render().find(n => n.type === 'textarea').props.onChange({ target: { value: 'only notes' } });
  const request = await ui.save();
  assert.equal(request.notes, 'only notes');
  assert.equal(request.entries[0].state, 'unchanged');
  assert.equal(request.entries[0].amount_cents, null);
  ui.render().find(n => n.type === ui.context.CentInput).props.onChange('20000');
  const typed = await ui.save();
  assert.equal(typed.entries[0].state, 'entered');
  assert.equal(typed.entries[0].amount_cents, '20000');
});

test('date-switch confirmation is requested explicitly and cancel retains notes and date', () => {
  const ui = checkInRuntime();
  ui.render().find(n => n.type === 'textarea').props.onChange({ target: { value: 'unsaved notes' } });
  assert.equal(ui.render().some(n => n.props.className === 'check-in-date-switch'), false);
  ui.render().find(n => n.type === ui.context.DateInput).props.onChange('2026-07-01');
  assert.equal(ui.states[0], '2026-08-01');
  ui.button('取消').props.onClick();
  assert.equal(ui.states[0], '2026-08-01');
  assert.equal(ui.states[4], 'unsaved notes');
  assert.equal(ui.states[10], null);
});


test('link search discards stale pages after a new query, including load-more responses', async () => {
  const pending = [];
  const runtime = wishRuntime(async (command, args) => new Promise(resolve => pending.push({ command, args, resolve })));
  runtime.context.item.legacy_generated_asset = null;
  const cleanup = runtime.runLinkEffect();
  runtime.context.linkQuery = 'new query';
  cleanup(); runtime.runLinkEffect();
  pending[1].resolve({ items: [asset(100)], total: 101 });
  await new Promise(setImmediate);
  assert.equal(runtime.context.candidates[0].id, 'fictional-100');
  pending[0].resolve({ items: [asset(0)], total: 1 });
  await new Promise(setImmediate);
  assert.equal(runtime.context.candidates[0].id, 'fictional-100');
  const loading = runtime.moreLinks();
  assert.equal(pending[2].args.query.search, 'new query');
  runtime.context.linkQuery = 'another query'; runtime.runLinkEffect();
  pending[3].resolve({ items: [asset(200)], total: 1 });
  await new Promise(setImmediate);
  pending[2].resolve({ items: [asset(101)], total: 101 });
  await loading;
  assert.deepEqual(Array.from(runtime.context.candidates, i => i.id), ['fictional-200']);
  assert.equal(runtime.context.linkLoading, false);
});

test('link read failure stops loading and the same search can be retried', async () => {
  let fail = true;
  const runtime = wishRuntime(async () => { if (fail) throw new Error('candidate read failed'); return { items: [], total: 0 }; });
  runtime.context.item.legacy_generated_asset = null;
  runtime.runLinkEffect(); await new Promise(setImmediate);
  assert.match(runtime.seen.linkError, /candidate read failed/);
  assert.equal(runtime.context.linkLoading, false);
  fail = false;
  runtime.runLinkEffect(); await new Promise(setImmediate);
  assert.equal(runtime.seen.linkError, '');
  assert.equal(runtime.context.candidates.length, 0);
  assert.equal(runtime.context.linkLoading, false);
});


// Normal check-ins require an explicit number for every account (§7.2).
function twoRowRuntime() {
  const rows = [
    { account: { id: 'acc-a', fields: { name: '虚构甲', side: 'asset', kind: 'cash', counted: true } }, previous: { amount_cents: '10000', date: '2026-07-01' } },
    { account: { id: 'acc-b', fields: { name: '虚构乙', side: 'liability', kind: 'loan', counted: true } }, previous: { amount_cents: '5000', date: '2026-06-15' } },
  ];
  const draft = { generation: 'fictional-generation', existing: null, rows };
  const states = ['2026-08-01', undefined, draft, '', 'saved', false, {}, false, '', false, null];
  let cursor = 0, request;
  const context = { module: { exports: {} }, exports: {}, require,
    useState() { const slot = cursor++; return [states[slot], v => { states[slot] = typeof v === 'function' ? v(states[slot]) : v; }]; },
    useEffect() {}, useRef: v => ({ current: v }),
    snapshotEntryInput, previewTotals: () => ({ assets: '0', liabilities: '0', net: '0', missing: 0 }),
    money: v => v, signedMoney: v => v, kindLabel: v => v, changeText: v => v,
    Icon() {}, DateInput() {}, CentInput() {}, DeleteButton() {}, Unresolved: class extends Error {},
    crypto: { randomUUID: () => 'fictional-request' }, errorMessage: e => String(e),
    submit: async p => { request = p.input; return {}; },
  };
  vm.runInNewContext(checkInScript, context);
  function render() {
    cursor = 0;
    const tree = context.module.exports({ date: states[0], today: '2026-10-05', onClose() {} });
    const nodes = [];
    function walk(e) { if (!e || typeof e !== 'object') return; if (Array.isArray(e)) { e.forEach(walk); return; } if (e.props) { nodes.push(e); walk(e.props.children); } }
    walk(tree); return nodes;
  }
  const button = text => render().find(n => n.type === 'button' && n.props.children === text);
  return { states, context, render, button, async save() { button('保存盘点').props.onClick(); await new Promise(setImmediate); return request; } };
}

function amounts(ui) { return ui.render().filter(n => n.type === ui.context.CentInput); }

test('new check-in has blank numeric fields and no state choices or batch controls', () => {
  const ui = twoRowRuntime();
  assert.deepEqual(amounts(ui).map(n => n.props.value), ['', '']);
  assert.equal(ui.render().filter(n => n.type === 'th').length, 4);
  assert.equal(ui.render().some(n => n.type === 'input' && n.props.type === 'checkbox'), false);
  for (const label of ['未变', '未知', '确认未变']) assert.equal(ui.button(label), undefined);
  assert.equal(ui.render().some(n => n.props.className === 'check-in-batch'), false);
});

test('blank account blocks saving; explicit zero and amount equal to previous save as entered', async () => {
  const ui = twoRowRuntime();
  assert.equal(await ui.save(), undefined);
  assert.match(ui.states[8], /2 个账户未填写/);
  amounts(ui)[0].props.onChange('10000');
  assert.equal(await ui.save(), undefined);
  assert.match(ui.states[8], /1 个账户未填写/);
  amounts(ui)[1].props.onChange('0');
  assert.equal(ui.states[8], '', 'editing clears the outdated validation message');
  const request = await ui.save();
  assert.deepEqual(Array.from(request.entries, e => [e.account_id, e.state, e.amount_cents]), [
    ['acc-a', 'entered', '10000'], ['acc-b', 'entered', '0'],
  ]);
});

test('account without previous amount still requires its own number', async () => {
  const ui = twoRowRuntime();
  ui.states[2].rows[1].previous = null;
  amounts(ui)[0].props.onChange('12000');
  assert.equal(await ui.save(), undefined);
  amounts(ui)[1].props.onChange('5000');
  assert.equal((await ui.save()).entries[1].amount_cents, '5000');
});

test('legacy missing row stays editable and must be filled before saving a correction', async () => {
  const ui = checkInRuntime();
  ui.states[2].existing.entries[0] = { ...ui.states[2].existing.entries[0], state: 'missing', amount_cents: null };
  ui.states[6]['fictional-account'] = { state: 'missing', cents: '' };
  assert.equal(amounts(ui)[0].props.value, '');
  assert.equal(await ui.save(), undefined);
  assert.match(ui.states[8], /1 个账户未填写/);
  amounts(ui)[0].props.onChange('0');
  const request = await ui.save();
  assert.equal(request.entries[0].state, 'entered');
  assert.equal(request.entries[0].amount_cents, '0');
});

test('clearing an amount blocks save and cancelling date switch retains amounts and notes', async () => {
  const ui = twoRowRuntime();
  amounts(ui)[0].props.onChange('10000');
  amounts(ui)[1].props.onChange('5000');
  amounts(ui)[1].props.onChange('');
  assert.equal(await ui.save(), undefined);
  ui.render().find(n => n.type === 'textarea').props.onChange({ target: { value: 'notes' } });
  ui.render().find(n => n.type === ui.context.DateInput).props.onChange('2026-07-01');
  ui.button('取消').props.onClick();
  assert.equal(ui.states[0], '2026-08-01');
  assert.equal(ui.states[4], 'notes');
  assert.deepEqual(amounts(ui).map(n => n.props.value), ['10000', '']);
});

test('failed save retains all typed amounts and notes for retry', async () => {
  const ui = twoRowRuntime();
  amounts(ui)[0].props.onChange('12000');
  amounts(ui)[1].props.onChange('0');
  ui.render().find(n => n.type === 'textarea').props.onChange({ target: { value: 'monthly numbers' } });
  ui.context.submit = async () => { throw new Error('fictional save failed'); };
  await ui.save();
  assert.equal(ui.states[7], false);
  assert.match(ui.states[8], /save failed/);
  assert.deepEqual(amounts(ui).map(n => n.props.value), ['12000', '0']);
  assert.equal(ui.states[4], 'monthly numbers');
  let input;
  ui.context.submit = async request => { input = request.input; return {}; };
  await ui.save();
  assert.deepEqual(Array.from(input.entries, e => e.amount_cents), ['12000', '0']);
  assert.equal(input.notes, 'monthly numbers');
});
