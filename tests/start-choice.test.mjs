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
const all = tree => Array.isArray(tree) ? tree.flatMap(all) : tree && typeof tree === 'object' ? [tree, ...all(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || typeof tree === 'boolean' ? '' : String(tree);
function compileFunction(file, name) {
  const source = ts.createSourceFile(file, readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let fn; const find = n => { if (ts.isFunctionDeclaration(n) && n.name?.text === name) fn = n; ts.forEachChild(n, find); }; find(source);
  assert.ok(fn, name);
  return ts.transpileModule(fn.getText(source) + '\nmodule.exports=' + name, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
function hooks(file, name, extra = {}) {
  const states=[], refs=[], effects=[]; let si=0,ri=0,ei=0;
  const context={module:{exports:{}},exports:{},require:()=>jsx,Error,...choice,
    useState(init){const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
    useRef(value){return refs[ri++]??(refs[ri-1]={current:value});},
    useEffect(fn,deps){const i=ei++;if(!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j]))effects[i]={deps,fn,dirty:true};},...extra};
  if(name==='StartChoice') context.purposes=[{key:'money',title:'盘一盘我的钱',icon:'wallet'},{key:'physical',title:'整理我的物品',icon:'items'},{key:'planning',title:'为以后做计划',icon:'plan'}];
  vm.runInNewContext(compileFunction(file,name),context);
  return{context,render(props){si=ri=ei=0;const tree=context.module.exports(props);for(const effect of effects)if(effect.dirty){effect.dirty=false;effect.fn();}return tree;}};
}
const tick=()=>new Promise(setImmediate);
test('all seven purpose combinations keep all details enabled inside the retained purposes',()=>{
  for(let bits=1;bits<8;bits++){
    const selection={money:!!(bits&1),physical:!!(bits&2),planning:!!(bits&4)},before=structuredClone(modules);
    const payload=choice.usageModules({...modules,incomes:true},true,selection);
    assert.equal(payload.modules.wealth,selection.money);assert.equal(payload.modules.physical,selection.physical);assert.equal(payload.modules.planning,selection.planning);
    for(const key of ['wishlist','stats'])assert.equal(payload.modules[key],selection.physical);
    for(const key of ['expenses','recurring','virtual'])assert.equal(payload.modules[key],selection.money);
    assert.equal(payload.modules.timeline,true);assert.equal(payload.incomes,selection.money);assert.equal(payload.movements,selection.money);assert.deepEqual(modules,before);
  }
  assert.equal(choice.usageModules(modules,true,{money:false,physical:false,planning:false}),null);
});
test('unreliable preferences never produce a settings write',()=>{
  const selected={money:true,physical:true,planning:true};
  assert.equal(choice.usageModules(modules,false,selected),null);
  for(const finance_status of ['legacy_corrupt','finance_corrupt','unsupported_version','read_error','write_error'])assert.equal(choice.usageModules({...modules,finance_status},true,selected),null);
  for(const finance_revision of [0,null,NaN])assert.equal(choice.usageModules({...modules,finance_revision},true,selected),null);
});
test('reconfiguration preserves detailed choices inside selected purposes and disables only unchecked groups',()=>{
  const all={money:true,physical:true,planning:true};
  assert.deepEqual(choice.selectedUsage(modules),all);
  const payload=choice.usageModules(modules,true,all);assert.deepEqual(payload,{modules,incomes:modules.incomes,movements:modules.movements});
  const off=choice.usageModules(modules,true,{...all,money:false});
  for(const key of ['wealth','expenses','recurring','virtual'])assert.equal(off.modules[key],false);
  const incomeOnly={...modules,wealth:false,expenses:false,recurring:false,virtual:false,incomes:true,movements:false};
  const kept=choice.usageModules(incomeOnly,true,{money:true,physical:true,planning:true});assert.equal(kept.modules.wealth,false);assert.equal(kept.incomes,true);
  assert.equal(off.incomes,false);assert.equal(off.movements,false);assert.equal(off.modules.wishlist,true);assert.equal(off.modules.timeline,true);
});
test('picker supports multiple checks, cancellation, validation and duplicate-submit protection',async()=>{
  let release;const applied=[],skipped=[];
  const h=hooks('StartChoice.tsx','StartChoice',{Icon:()=>null,LogoMark:()=>null});
  const props={initial:{money:false,physical:false,planning:false},ready:true,onApply:value=>{applied.push(value);return new Promise(resolve=>{release=resolve})},onSkip:()=>skipped.push(true),onReload(){}};
  const tree=()=>h.render(props),button=label=>all(tree()).find(n=>n.type==='button'&&text(n)===label);
  assert.equal(button('保存选择').props.disabled,true);
  all(tree()).find(n=>n.type==='input').props.onChange({target:{checked:true}});
  all(tree()).filter(n=>n.type==='input')[2].props.onChange({target:{checked:true}});
  button('保存选择').props.onClick();button('正在应用…').props.onClick();
  assert.equal(applied.length,1);assert.deepEqual(JSON.parse(JSON.stringify(applied[0])),{money:true,physical:false,planning:true});assert.equal(button('取消').props.disabled,true);
  release();await tick();button('取消').props.onClick();assert.equal(skipped.length,1);
  props.ready=false;assert.equal(button('保存选择').props.disabled,true);
});
test('picker keeps selections and exposes retryable errors; cancel does not submit',async()=>{
  let calls=0;const h=hooks('StartChoice.tsx','StartChoice',{Icon:()=>null,LogoMark:()=>null});
  const props={initial:{money:true,physical:true,planning:false},ready:true,onApply:async()=>{calls++;throw Error('fictional save failure')},onSkip(){},onReload(){}};
  all(h.render(props)).find(n=>n.type==='button'&&text(n)==='取消').props.onClick();assert.equal(calls,0);
  all(h.render(props)).find(n=>n.type==='button'&&text(n)==='保存选择').props.onClick();await tick();
  const tree=h.render(props);assert.match(text(tree),/fictional save failure/);assert.equal(all(tree).filter(n=>n.type==='input'&&n.props.checked).length,2);
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
test('openEditor reports success only after the draft is prepared, and guards or failed setup stay unsuccessful', async () => {
  const base = { module: { exports: {} }, exports: {}, require: () => jsx,
    modules, durablePending: false, featureEditing: false, dataBusy: false, wishlistEditing: false,
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

test('preview startup and module failure fixtures stay within the existing in-memory adapter', async () => {
  const preview = ts.createSourceFile('wealth-preview.ts', readFileSync(new URL('../src/wealth-preview.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const branches = []; const find = n => { if (ts.isIfStatement(n) && /^command === 'modules_(get|set)'$/.test(n.expression.getText(preview))) branches.push(n.getText(preview)); ts.forEachChild(n, find); }; find(preview);
  assert.equal(branches.length, 2);
  const moduleCode = ts.transpileModule('module.exports=function(command,args){' + branches.join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const mem = { module: { exports: {} }, exports: {}, previewModules: { ...modules } }; vm.runInNewContext(moduleCode, mem);
  const context = { module: { exports: {} }, exports: {}, require: () => jsx, params: new URLSearchParams('started=first-use'), previewStarted: false,
    wealthPreview: mem.module.exports, searchPreview: () => null,
  };
  vm.runInNewContext(compileFunction('preview-ipc.ts', 'handle'), context);
  const handle = context.module.exports;
  assert.equal((await handle('demo_status', {})).started, false);
  const payload = choice.usageModules({ ...modules, incomes: true }, true, { money: true, physical: true, planning: true }); const changed = await handle('modules_set', payload);
  assert.equal(changed.recurring, true); assert.equal(changed.virtual, true); assert.equal(changed.incomes, true); assert.equal(changed.movements, true);
  assert.equal((await handle('modules_get', {})).finance_revision, modules.finance_revision + 1);
  context.params.set('module-write-error', '1');
  const before = JSON.stringify(mem.previewModules);
  await assert.rejects(handle('modules_set', { modules: allModules }), error => /虚构模块写入失败/.test(error.message)); assert.equal(JSON.stringify(mem.previewModules), before);
  context.params.set('module-read-error', '1'); await assert.rejects(handle('modules_get', {}), error => /虚构模块读取失败/.test(error.message));
});
test('planning-only review does not show disabled physical or timeline errors and keeps manual planning reachable',()=>{
  const disabled={status:'error',value:{code:'MODULE_DISABLED',message:'模块已关闭，本次未读取'}};
  const data={generation:'fictional',today:'2026-10-19',year:null,physical:disabled,wealth:disabled,expenses:disabled,recurring:disabled,virtual_assets:disabled,recent:disabled};
  const selected={...allModules,physical:false,wealth:false,wishlist:false,stats:false,incomes:false,movements:false,expenses:false,recurring:false,virtual:false,timeline:false,planning:true};
  let cursor=0;const context={module:{exports:{}},exports:{},require:()=>jsx,allModules,
    useState:initial=>[cursor++===1?data:typeof initial==='function'?initial():initial,()=>{}],useEffect(){},useRef:value=>({current:value}),
    requestGate:()=>({}),useTrendSelection:()=>({}),useRestored(){},ready:value=>value?.status==='ready'?value.value:undefined,
    latestComplete:()=>null,attention:()=>[],hiddenKinds:()=>new Set(),labels:{},attentionSourcesReady:()=>true,Info:()=>null,
  };
  vm.runInNewContext(compileFunction('ReviewView.tsx','ReviewView'),context);
  const calls=[],tree=context.module.exports({generation:'fictional',today:data.today,year:null,modules:selected,onGotoPlanning:value=>calls.push(value)});
  assert.doesNotMatch(text(tree),/模块已关闭|持有物品|近期记录/);assert.match(text(tree),/可以先手动填写资金和收支/);
  all(tree).find(n=>n.type==='button'&&text(n)==='设置计划 →').props.onClick();assert.deepEqual(calls,['goals']);
});

test('physical-only overview hides optional wishes and timeline while retaining unknown values',()=>{
  const data={generation:'fictional',today:'2026-10-19',categories:[],held_count:1,active_count:1,retired_count:0,sold_count:0,held_known_cents:'0',held_unknown_price_count:1,history_known_cents:'0',history_unknown_price_count:1,average_holding_days:null,held_unknown_date_count:1,considering_wishes:4,legacy_wishes:0,recent:[]};
  let cursor=0;const context={module:{exports:{}},exports:{},require:()=>jsx,allModules,useState:initial=>[cursor++===2?data:typeof initial==='function'?initial():initial,()=>{}],useEffect(){},useRestored(){},sortByShare:rows=>rows,money:value=>String(value),DailyCostMetric:()=>null,Info:()=>null};
  vm.runInNewContext(compileFunction('Overview.tsx','PhysicalOverview'),context);
  const tree=context.module.exports({modules:{...allModules,wishlist:false,timeline:false},today:data.today});
  assert.doesNotMatch(text(tree),/考虑中心愿|最近事件/);assert.match(text(tree),/金额未知|购入日期未知/);assert.match(text(tree),/—/);
});

test('a disabled physical module does not leak its list error into the home workspace',()=>{
  const source=ts.createSourceFile('main.tsx',readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression;const visit=node=>{if(ts.isJsxExpression(node)&&node.expression?.getText(source).startsWith('modules.physical && loadError &&'))expression=node.expression.getText(source);ts.forEachChild(node,visit);};visit(source);assert.ok(expression);
  const code=ts.transpileModule('module.exports=(modules,loadError)=>('+expression+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const context={module:{exports:{}},exports:{},require:()=>jsx,loading:false};vm.runInNewContext(code,context);
  assert.equal(context.module.exports({physical:false},'fictional asset read failure'),false);
  assert.match(text(context.module.exports({physical:true},'fictional asset read failure')),/fictional asset read failure/);
});

