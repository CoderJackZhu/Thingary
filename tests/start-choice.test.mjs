import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as choice from '../src/start-choice.ts';
import { allModules } from '../src/modules.ts';

const modules = { ...allModules, incomes: false, movements: true, finance_status: 'ready', finance_revision: 3 };
const storage = () => { const saved = new Map(); return { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) }; };
test('starter payload changes only recurring and virtual and keeps independent switches explicit', () => {
  const before = structuredClone(modules), payload = choice.starterModules(modules, true);
  assert.deepEqual(payload, { modules: { ...modules, recurring: false, virtual: false }, incomes: false, movements: true });
  assert.deepEqual(modules, before);
  assert.equal(choice.starterModules(modules, false), null);
  for (const finance_status of ['legacy_corrupt', 'finance_corrupt', 'unsupported_version', 'read_error', 'write_error']) assert.equal(choice.starterModules({ ...modules, finance_status }, true), null);
  for (const finance_revision of [0, null, NaN]) assert.equal(choice.starterModules({ ...modules, finance_revision }, true), null);
});
test('dismissal stays separate for each generation and unavailable storage keeps the card visible', () => {
  const s = storage(); assert.equal(choice.startChoiceDismissed(s, 'g1'), false);
  assert.equal(choice.dismissStartChoice(s, 'g1'), true); assert.equal(choice.startChoiceDismissed(s, 'g1'), true); assert.equal(choice.startChoiceDismissed(s, 'g2'), false);
  choice.dismissStartChoice(s, 'g2'); assert.equal(choice.startChoiceDismissed(s, 'g1'), true);
  for (const failure of [null, { getItem() { throw Error('unavailable'); }, setItem() {} }, { getItem: () => null, setItem() { throw Error('readonly'); } }, { getItem: () => 'corrupt', setItem() {} }]) {
    assert.equal(choice.startChoiceDismissed(failure, 'g1'), false); assert.equal(choice.dismissStartChoice(failure, 'g1'), false);
    assert.doesNotThrow(() => choice.persistOverviewChoice(failure, 'physical'));
  }
});
const all = tree => Array.isArray(tree) ? tree.flatMap(all) : tree && typeof tree === 'object' ? [tree, ...all(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
function compileFunction(file, name) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn; const find = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) fn = n; ts.forEachChild(n, find); }; find(source);
  assert.ok(fn, name);
  return ts.transpileModule(fn.getText(source) + '\nmodule.exports=' + name, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
function runtime(over = {}, invoke = async command => command === 'modules_set' ? { ...modules, recurring: false, virtual: false } : modules, s = storage()) {
  const states = [], refs = [], calls = [], notices = [], starts = [], updates = [], busy = []; let si, ri;
  const context = { module: { exports: {} }, exports: {}, require: () => jsx, ...choice, choiceStorage: () => s,
    useState(initial) { const i = si++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(value) { const i = ri++; return refs[i] ?? (refs[i] = { current: value }); }, errorMessage: e => e.message,
    invoke: async (...args) => { calls.push(args); return invoke(...args); },
  };
  vm.runInNewContext(compileFunction('StartChoice.tsx', 'StartChoice'), context);
  const props = { generation: 'g1', active: false, started: false, modules, modulesLoaded: true, disabled: false, onNotice: message => notices.push(message), onBusyChange: value => busy.push(value), onModules: value => updates.push(value), onStart: value => { starts.push(value); }, ...over };
  const render = () => { si = ri = 0; return context.module.exports(props); };
  return { props, render, calls, starts, updates, busy, notices, s, button(label) { return all(render()).find(n => n.type === 'button' && text(n) === label); }, async click(label) { this.button(label).props.onClick(); await new Promise(setImmediate); } };
}
test('both start choices save exact module payload, invoke their path, and dismiss; unchecking never writes modules', async () => {
  for (const [label, expected] of [['先整理物品', 'physical'], ['先盘点账户', 'combined']]) {
    const ui = runtime(); await ui.click(label);
    assert.deepEqual(ui.calls[0], ['modules_set', choice.starterModules(modules, true)]);
    assert.deepEqual(ui.starts, [expected]); assert.deepEqual(ui.busy, [true, false]); assert.equal(ui.render(), null);
  }
  const unchecked = runtime(); all(unchecked.render()).find(n => n.type === 'input').props.onChange({ target: { checked: false } }); await unchecked.click('先整理物品');
  assert.deepEqual(unchecked.calls, []); assert.deepEqual(unchecked.starts, ['physical']);
});
test('skip and hidden/sample/started states never write settings or navigate', async () => {
  const skip = runtime(); await skip.click('跳过'); assert.equal(skip.render(), null); assert.deepEqual(skip.calls, []); assert.deepEqual(skip.starts, []);
  for (const props of [{ active: true }, { started: true }]) { const ui = runtime(props); assert.equal(ui.render(), null); assert.deepEqual(ui.calls, []); }
  const unavailable = runtime({}, undefined, { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }); await unavailable.click('跳过'); assert.equal(unavailable.render(), null);
});
test('write failure rereads switches, reports an error after navigation, and retains the card', async () => {
  const ui = runtime({}, async command => { if (command === 'modules_set') throw Error('fictional write failure'); return { ...modules, recurring: false }; });
  await ui.click('先盘点账户'); assert.deepEqual(ui.calls.map(([command]) => command), ['modules_set', 'modules_get']); assert.deepEqual(ui.starts, ['combined']);
  assert.equal(ui.updates.at(-1).recurring, false); assert.match(text(ui.render()), /fictional write failure/); assert.match(ui.notices.at(-1), /fictional write failure/); assert.equal(choice.startChoiceDismissed(ui.s, 'g1'), false);
  for (const props of [{ modulesLoaded: false }, { modules: { ...modules, finance_status: 'read_error' } }]) {
    const stale = runtime(props); await stale.click('先整理物品'); assert.deepEqual(stale.calls, []); assert.deepEqual(stale.starts, ['physical']); assert.ok(stale.render()); assert.match(stale.notices.at(-1), /尚未可靠读取/);
  }
});
test('storage failures allow primary actions and hide the card for this session', async () => {
  const ui = runtime({}, undefined, { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } }); await ui.click('先整理物品');
  assert.deepEqual(ui.starts, ['physical']); assert.equal(ui.render(), null);
});
test('empty accounts put the existing data-management import before manual creation', () => {
  const calls = [];
  const context = { module: { exports: {} }, exports: {}, require: () => jsx, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], recallGroupViews: () => ({ structure: 'kind' }), accountGroupTotals: () => [] };
  vm.runInNewContext(compileFunction('WealthPage.tsx', 'Overview'), context);
  const tree = context.module.exports({ summary: { generation: 'fictional-generation' }, groups: [], allAccounts: [], hasAccounts: false, onFinancialImport: () => calls.push('import'), onNewAccount: () => calls.push('manual') });
  const buttons = all(tree).filter(n => n.type === 'button'); assert.deepEqual(buttons.map(text), ['导入已有的资产表格', '手动添加第一个账户']);
  buttons[0].props.onClick(); buttons[1].props.onClick(); assert.deepEqual(calls, ['import', 'manual']);
  const main = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback; const visit = n => { if (ts.isJsxAttribute(n) && n.name.getText(main) === 'onFinancialImport') callback = n.initializer.expression.getText(main); ts.forEachChild(n, visit); }; visit(main); assert.ok(callback);
  const script = ts.transpileModule('module.exports=' + callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const route = []; vm.runInNewContext(script, { ...context, gotoFinance: r => route.push(r) }); context.module.exports();
  assert.deepEqual(JSON.parse(JSON.stringify(route)), [{ page: 'data-management', importKind: 'finance' }]);
});
test('the real start handler updates the current overview choice and routes even when view storage is unavailable', async () => {
  const code = compileFunction('main.tsx', 'startFromChoice');
  for (const selected of ['physical', 'combined']) {
    const calls = [], context = { module: { exports: {} }, exports: {}, require: () => jsx,
      modeBlocked: false, libraryGeneration: 'fictional-generation', modules,
      blockedNotice: () => 'blocked', setNotice: value => calls.push(['notice', value]),
      choiceStorage: () => ({ setItem() { throw Error('unavailable'); } }), persistOverviewChoice: choice.persistOverviewChoice,
      setOverviewChoice: update => calls.push(['view', update(null)]), openEditor: async value => { calls.push(['editor', value]); return true; },
      beginReturn: () => calls.push(['origin']), setReturnContext: value => calls.push(['return', value]), setWealthReviewFocus: value => calls.push(['focus', value]), setSection: value => calls.push(['page', value]), setDetailId: value => calls.push(['detail', value]),
    };
    vm.runInNewContext(code, context); assert.equal(await context.module.exports(selected), true);
    assert.equal(calls.find(([kind]) => kind === 'view')[1].view, selected);
    assert.equal(calls.find(([kind]) => kind === 'view')[1].generation, 'fictional-generation');
    assert.ok(calls.find(([kind, value]) => selected === 'physical' ? kind === 'editor' && value === null : kind === 'page' && value === 'wealth'));
    context.modeBlocked = true; const before = calls.length; assert.equal(await context.module.exports(selected), false); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1)[0], 'notice');
  }
});
test('the actual overview responds to a new choice token without undoing later manual switches', () => {
  const states = [], effects = []; let cursor = 0, effectCursor = 0;
  const PhysicalOverview = () => null, ReviewView = () => null, HeaderSlot = () => null;
  const props = { generation: 'fictional-generation', modules, viewChoice: null };
  const context = { module: { exports: {} }, exports: {}, require: () => jsx,
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = v; }]; },
    useEffect(fn, deps) { const i = effectCursor++; if (!effects[i] || deps.some((v, j) => v !== effects[i].deps[j])) effects[i] = { deps, fn, dirty: true }; },
    localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } },
    overviewView: value => value === 'physical' ? 'physical' : 'combined', financeOff: () => false, usePageBar() {}, PhysicalOverview, ReviewView, HeaderSlot,
  };
  vm.runInNewContext(compileFunction('Overview.tsx', 'OverviewPage'), context);
  function render() { cursor = effectCursor = 0; const tree = context.module.exports(props); for (const effect of effects) if (effect.dirty) { effect.dirty = false; effect.fn(); } return tree; }
  assert.ok(all(render()).some(n => n.type === ReviewView));
  props.viewChoice = { generation: props.generation, view: 'physical', version: 1 }; render(); assert.ok(all(render()).some(n => n.type === PhysicalOverview));
  all(render()).find(n => n.type === 'button' && text(n) === '综合').props.onClick(); assert.ok(all(render()).some(n => n.type === ReviewView));
  props.viewChoice = { ...props.viewChoice, version: 2 }; render(); assert.ok(all(render()).some(n => n.type === PhysicalOverview));
  props.viewChoice = { generation: 'other-generation', view: 'combined', version: 3 }; render(); assert.ok(all(render()).some(n => n.type === PhysicalOverview));
});
test('preview startup and module failure fixtures stay within the existing in-memory adapter', async () => {
  const preview = ts.createSourceFile('wealth-preview.ts', readFileSync(new URL('../src/wealth-preview.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const branches = []; const find = n => { if (ts.isIfStatement(n) && /^command === 'modules_(get|set)'$/.test(n.expression.getText(preview))) branches.push(n.getText(preview)); ts.forEachChild(n, find); }; find(preview);
  assert.equal(branches.length, 2);
  const moduleCode = ts.transpileModule('module.exports=function(command,args){' + branches.join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const mem = { module: { exports: {} }, exports: {}, previewModules: { ...modules } }; vm.runInNewContext(moduleCode, mem);
  const context = { module: { exports: {} }, exports: {}, require: () => jsx, params: new URLSearchParams('started=first-use'), previewStarted: false,
    wealthPreview: mem.module.exports, searchPreview: () => null,
  };
  vm.runInNewContext(compileFunction('visual-preview.ts', 'handle'), context);
  const handle = context.module.exports;
  assert.equal((await handle('demo_status', {})).started, false);
  const payload = choice.starterModules(modules, true); const changed = await handle('modules_set', payload);
  assert.equal(changed.recurring, false); assert.equal(changed.virtual, false); assert.equal(changed.incomes, modules.incomes); assert.equal(changed.movements, modules.movements);
  assert.equal((await handle('modules_get', {})).finance_revision, modules.finance_revision + 1);
  context.params.set('module-write-error', '1');
  const before = JSON.stringify(mem.previewModules);
  await assert.rejects(handle('modules_set', { modules: allModules }), error => /虚构模块写入失败/.test(error.message)); assert.equal(JSON.stringify(mem.previewModules), before);
  context.params.set('module-read-error', '1'); await assert.rejects(handle('modules_get', {}), error => /虚构模块读取失败/.test(error.message));
});
test('a failed or unavailable editor start never dismisses the first-use card', async () => {
  for (const result of [undefined, false]) {
    const context = { module: { exports: {} }, exports: {}, require: () => jsx, modeBlocked: false, libraryGeneration: 'fictional-generation', modules,
      setNotice() {}, blockedNotice: () => 'blocked', choiceStorage: () => storage(), persistOverviewChoice: choice.persistOverviewChoice,
      setOverviewChoice() {}, openEditor: async () => result,
    };
    vm.runInNewContext(compileFunction('main.tsx', 'startFromChoice'), context);
    assert.equal(await context.module.exports('physical'), false);
    const ui = runtime({ onStart: context.module.exports }); await ui.click('先整理物品');
    assert.ok(ui.render()); assert.equal(choice.startChoiceDismissed(ui.s, 'g1'), false);
  }
});
test('the last module failure is published again after the async editor path clears a page notice', async () => {
  const notices = [];
  const ui = runtime({ onNotice: message => notices.push(message), onStart: async () => { await new Promise(setImmediate); notices.push(''); return true; } }, async command => { throw Error(command === 'modules_set' ? 'fictional write failure' : 'fictional read failure'); });
  await ui.click('先整理物品'); await new Promise(setImmediate);
  const clearedAt = notices.lastIndexOf(''); assert.ok(clearedAt >= 0); assert.ok(clearedAt < notices.length - 1);
  assert.match(notices.at(-1), /fictional write failure.*fictional read failure/);
  assert.ok(ui.render()); assert.equal(choice.startChoiceDismissed(ui.s, 'g1'), false);
});
test('openEditor reports success only after the draft is prepared, and guards or failed setup stay unsuccessful', async () => {
  const base = { module: { exports: {} }, exports: {}, require: () => jsx,
    durablePending: false, featureEditing: false, dataBusy: false, wishlistEditing: false,
    demoStatus: { active: false }, page: { generation: 'fictional-generation' }, eventsReady: true,
    taxonomyGuard: false, taxonomy: { loading: false, loadError: null, snapshot: { generation: 'fictional-generation' } },
    opener: { current: null }, document: { activeElement: null }, detailId: null, listScroll: { current: 0 }, collectionRef: { current: null },
    emptyFields: { name: '', price: '', date: '', brand: '', model: '', serial_number: '', notes: '' },
    localDay: () => '2026-10-13', invoke: async () => undefined, errorMessage: error => error.message, setNotice() {}, setSection() {}, setCloseIntent() {},
  };
  for (const field of ['draft', 'trashAction', 'recordTrashAction', 'lifecycleDraft', 'lifecycleRecovery', 'saleDraft', 'saleRecovery', 'maintenanceDraft', 'maintenanceRecovery', 'warrantyDraft', 'warrantyRecovery', 'trashRecovery', 'recordTrashRecovery', 'recovered']) base[field] = null;
  let savedDraft;
  const context = { ...base, setDraft: next => { savedDraft = next; } };
  vm.runInNewContext(compileFunction('main.tsx', 'openEditor'), context);
  assert.equal(await context.module.exports(null), true); assert.ok(savedDraft); assert.equal(savedDraft.fields.date, '');
  context.eventsReady = false; savedDraft = null; assert.equal(await context.module.exports(null), undefined); assert.equal(savedDraft, null);
  context.eventsReady = true; context.invoke = async () => { throw Error('fictional editor setup failure'); };
  assert.equal(await context.module.exports(null), undefined); assert.equal(savedDraft, null);
});


test('consuming the start view token lets a later manual view survive leaving and remounting overview', () => {
  const stored = storage(), PhysicalOverview = () => null, ReviewView = () => null;
  stored.setItem(choice.overviewViewKey, 'physical');
  let consumed = 0;
  const props = { generation:'fictional-generation',modules,viewChoice:{generation:'fictional-generation',view:'physical',version:1},onViewChoiceDone:()=>{consumed++;props.viewChoice=null;} };
  function mount() {
    const states=[],effects=[];let cursor=0,effectCursor=0;
    const context={module:{exports:{}},exports:{},require:()=>jsx,
      useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],v=>{states[i]=v;}];},
      useEffect(fn,deps){const i=effectCursor++;if(!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j]))effects[i]={deps,fn,dirty:true};},
      localStorage:stored,overviewView:value=>value==='physical'?'physical':'combined',financeOff:()=>false,usePageBar(){},PhysicalOverview,ReviewView,HeaderSlot:()=>null,
    };
    vm.runInNewContext(compileFunction('Overview.tsx','OverviewPage'),context);
    const render=()=>{cursor=effectCursor=0;const tree=context.module.exports(props);for(const effect of effects)if(effect.dirty){effect.dirty=false;effect.fn();}return tree;};
    return{render};
  }
  const first=mount();assert.ok(all(first.render()).some(n=>n.type===PhysicalOverview));assert.equal(consumed,1);assert.equal(props.viewChoice,null);
  all(first.render()).find(n=>n.type==='button'&&text(n)==='综合').props.onClick();assert.ok(all(first.render()).some(n=>n.type===ReviewView));
  assert.equal(stored.getItem(choice.overviewViewKey),'combined');
  const reentered=mount();assert.ok(all(reentered.render()).some(n=>n.type===ReviewView));assert.equal(consumed,1);
});
