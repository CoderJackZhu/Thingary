import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as periods from '../src/finance-contract.ts';
import * as navigation from '../src/finance-navigation.ts';
import * as plan from '../src/plan.ts';
import { allModules } from '../src/modules.ts';
const ts = createRequire(import.meta.url)('typescript');
const modules = { ...allModules, incomes: true, movements: true, planning: false, finance_status: 'ready', finance_revision: 1 };
const income = (id, date = '2026-10-12', hpf = null) => ({ id, revision: 1, fields: { date, net_cents: '1000', hpf_cents: hpf, notes: id } });
const ready = value => ({ status: 'ready', value });
const snapshot = (period = { kind: 'all' }, prefs = modules, extra = {}) => ({ generation: 'g', write_version: 1, today: '2026-10-12', period, modules: prefs, incomes: ready([income('i')]), accounts: ready([]), expenses: ready({ generation: 'g', period, lines: [], undated: [] }), ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
/** Real page, aggregate hook/session, and source orchestration with deterministic IPC and leaf controls. */
function harness(options = {}) {
  const calls = [], bars = [], routes = [], searches = [], sourceDone = [], editingChanges = [];
  const receipt = { pending: null, busy: false, notice: '', ...options.receipt };
  let cursor = 0, path = 'root', tree, dirty = false, effects = [], destroyed = false;
  const slots = new Map(), cleanups = new Map(), touched = new Set();
  const hooks = {
    useState(initial) { const key = `${path}/${cursor++}`; touched.add(key); if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial); return [slots.get(key), value => { slots.set(key, typeof value === 'function' ? value(slots.get(key)) : value); dirty = true; }]; },
    useRef(initial) { const key = `${path}/${cursor++}`; touched.add(key); if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect(fn, deps) { const key = `${path}/${cursor++}`; touched.add(key); const before = slots.get(key); if (!before || deps.some((v,i) => !Object.is(v,before[i]))) { slots.set(key,deps); effects.push(() => { cleanups.get(key)?.(); cleanups.set(key,fn()); }); } },
  };
  const leaves = new Proxy({}, { get: (_,key) => key });
  const stub = {
    react: hooks, 'react/jsx-runtime': { jsx: (type,props,key) => ({type,props,key}), jsxs: (type,props,key) => ({type,props,key}) },
    'asset': { errorMessage: e => e.message ?? String(e), money: value => value },
    'finance-contract': periods, 'finance-navigation': navigation, plan,
    'WealthPage': { usePendingReceipt: reload => ({ ...receipt, setPending: p => { receipt.pending=p; }, verify: async () => { if (options.verify) await options.verify(receipt); else receipt.pending=null; reload(); } }) },
    wealth: { storedPending: () => receipt.pending }, undo: { useRestored() {} },
    topbar: { usePageBar: (owner,bar) => bars.push({owner,bar}) }, 'topbar-model': { refocusHeading() {} },
    'planning-followup-port': { nativePlanningFollowupPortV1: () => options.port ?? {} },
    'planning-followup-ui/model': { formatCents: c => c, endpointText: e => e.label ?? e.account_id, purposeLabel: {}, sourceStatusText: {} },
    '@tauri-apps/api/core': { invoke: async (command,args) => { calls.push({ command,args }); if (options.invoke) return options.invoke(command,args); if (command === 'finance_sources') return snapshot(args.period, props.modules, options.extra); if (command === 'plan_income_list') return { generation: 'g', rows: [income('latest','2026-10-12','999')] }; if (command === 'validate_source') return true; throw Error(command); } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file,exports);
    const js = ts.transpileModule(readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    vm.runInNewContext(js,{ exports, module:{exports}, crypto:globalThis.crypto, Error, console, document:{ activeElement:{isConnected:true,focus(){}}, getElementById:()=>null, querySelector:()=>null }, requestAnimationFrame: fn=>fn(), require: id => {
      if (id.endsWith('.css')) return {};
      if (!id.startsWith('.')) return stub[id] ?? leaves;
      const rel = posix.normalize(posix.join(posix.dirname(file),id)).replace(/\.(tsx?|jsx?)$/,'');
      if (stub[rel]) return stub[rel];
      if (['finance-data','finance-service','useSource','source'].includes(rel)) return load(`${rel}.ts`);
      if (rel === 'planning-followup-ui/MovementsList' && options.realMovements) return load(`${rel}.tsx`);
      return leaves;
    }});
    return exports;
  }
  const props = { generation:'g', today:'2026-10-12', modules, route:{page:'records',tab:'income'}, search:'', onSearch:s=>searches.push(s), onRouteChange:r=>routes.push(r), onEditingChange:b=>editingChanges.push(b), onOpenAsset(){},onOpenSource(){},onNewAccount(){},onSourceDone:m=>sourceDone.push(m),...options.props };
  const Page = load('FinanceRecordsPage.tsx').FinanceRecordsPage;
  function expand(node,key) {
    if (Array.isArray(node)) return node.map((n,i)=>expand(n,`${key}/${i}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') { path=`${key}/${node.key ?? ''}`; cursor=0; return expand(node.type(node.props),`${path}/child`); }
    return {...node,props:{...node.props,children:expand(node.props?.children,`${key}/children`)}};
  }
  function render() {
    if(destroyed) return;
    for(let round=0;round<8;round++) { dirty=false;effects=[];touched.clear();path='root';cursor=0;tree=expand(Page(props),'root');for(const [key,cleanup] of cleanups) if(!touched.has(key)){cleanup?.();cleanups.delete(key);slots.delete(key);}effects.forEach(f=>f());if(!dirty)break; }
  }
  const nodes=()=>{const all=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object'){all.push(n);walk(n.props?.children);}};walk(tree);return all;};
  const text=n=>Array.isArray(n)?n.map(text).join(''):n&&typeof n==='object'?text(n.props?.children):n==null||n===false?'':String(n);
  const find=(type,p=()=>true)=>nodes().find(n=>n.type===type&&p(n.props));
  const settle=async()=>{for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));render();}};
  render();
  return {props,calls,bars,routes,searches,sourceDone,editingChanges,receipt,render,settle,find,nodes,text,unmount(){destroyed=true;for(const cleanup of cleanups.values())cleanup?.();},bar:()=>bars.at(-1).bar};
}

test('independent income needs no goal or wealth, with one bar and no import/export',async()=>{
  const r=harness({props:{modules:{...modules,wealth:false,movements:false,expenses:false}}});await r.settle();
  assert.ok(r.find('IncomeRecords'));assert.equal(r.find('MovementsList'),undefined);assert.equal(r.bar().primary.label,'记一笔收入');assert.equal(r.bar().search.key,'finance-records');assert.equal(r.bar().menu,undefined);
  assert.equal(new Set(r.bars.map(x=>x.owner)).size,1);assert.equal(r.bars[0].owner,'finance-records');
});
test('ordinary disabled preference falls back; explicit disabled source fails without another tab',async()=>{
  const prefs={...modules,incomes:false};const r=harness({props:{modules:prefs}});await r.settle();assert.equal(r.routes.at(-1).tab,'expenses');
  const explicit=harness({props:{modules:prefs,route:{page:'records',tab:'income',source:{kind:'income',id:'i'}}}});await explicit.settle();assert.equal(explicit.find('ExpensesPage'),undefined);assert.match(explicit.text(explicit.nodes()[0]),/模块已关闭/);assert.equal(explicit.sourceDone.length,1);assert.equal(explicit.calls.some(c=>c.command==='plan_income_list'),false);
});
test('period replacement hides old data synchronously and ignores an older late read',async()=>{
  const first=deferred(),second=deferred();let n=0;
  const r=harness({invoke:(c)=>{if(c==='finance_sources')return (++n===1?first:second).promise;return true;}});
  r.props.route={page:'records',tab:'income',period:{kind:'month',month:'2026-09'}};r.render();assert.equal(r.find('IncomeRecords'),undefined);
  second.resolve(snapshot(r.props.route.period));await r.settle();assert.equal(r.find('IncomeRecords').props.period.month,'2026-09');
  first.resolve(snapshot());await r.settle();assert.equal(r.find('IncomeRecords').props.period.month,'2026-09');
});
test('reload hides the old aggregate and errors remain local to their source',async()=>{
  const r=harness({extra:{incomes:{status:'error',code:'READ',message:'income failure'}}});await r.settle();assert.match(r.text(r.nodes()[0]),/income failure/);assert.equal(r.find('IncomeRecords'),undefined);
  r.props.route={page:'records',tab:'expenses'};r.render();await r.settle();assert.equal(r.find('ExpensesPage').props.controlledView.generation,'g');assert.equal(r.find('ExpensesPage').props.embedded,true);
});
test('new default comes from all incomes, save keeps period and offers explicit outside viewing',async()=>{
  const r=harness({props:{route:{page:'records',tab:'income',period:{kind:'month',month:'2026-09'}}}});await r.settle();await r.bar().primary.run();await r.settle();
  const dialog=r.find('IncomeDialog');assert.equal(dialog.props.hpfDefault,'999');dialog.props.onSavedIncome(income('saved'));dialog.props.onClose(true);r.render();assert.equal(r.routes.length,0);assert.match(r.text(r.nodes()[0]),/不在当前期间/);const button=r.nodes().find(n=>n.type==='button'&&r.text(n)==='查看全部收入');button.props.onClick();assert.equal(r.routes.at(-1).period.kind,'all');
});
test('tab switch preserves period and delegates tab search memory to its controlled host',async()=>{
  const r=harness({props:{search:'salary',route:{page:'records',tab:'income',period:{kind:'year',year:2026}}}});await r.settle();const tab=r.nodes().find(n=>n.type==='button'&&r.text(n)==='重要支出');tab.props.onClick();assert.equal(r.routes.at(-1).period.year,2026);assert.equal(r.searches.length,0);
  r.props.route=r.routes.at(-1);r.props.search='trip';r.render();const back=r.nodes().find(n=>n.type==='button'&&r.text(n)==='收入');back.props.onClick();assert.equal(r.searches.length,0);assert.equal(r.routes.at(-1).tab,'income');
});
test('unknown receipts block writes; import receipt goes to settings and verify failure does not unlock',async()=>{
  const pending={command:'financial_import_commit',label:'import',input:{request_id:'same'}};const r=harness({receipt:{pending}});await r.settle();assert.equal(r.bar().primary.disabled,true);assert.match(r.text(r.nodes()[0]),/设置的数据管理/);assert.equal(r.nodes().some(n=>n.type==='button'&&r.text(n)==='核对结果'),false);
  const uncertain=harness({receipt:{pending:{...pending,command:'movement_save'}},verify:async()=>{}});await uncertain.settle();uncertain.nodes().find(n=>n.type==='button'&&uncertain.text(n)==='核对结果').props.onClick();await uncertain.settle();assert.equal(uncertain.bar().primary.disabled,true);assert.equal(uncertain.receipt.pending.input.request_id,'same');
});
test('income source rereads by stable id, preserves period and cannot substitute a same-name record',async()=>{
  const focused=harness({props:{source:{generation:'g',token:1,target:{kind:'income',id:'target'}},route:{page:'records',tab:'income',period:{kind:'month',month:'2026-09'}}},invoke:(c,a)=>c==='plan_income_list'?{generation:'g',rows:[income('other'),income('target')]}:c==='finance_sources'?snapshot(a.period):true});await focused.settle();assert.equal(focused.find('IncomeDialog').props.income.id,'target');assert.equal(focused.routes.length,0);assert.deepEqual(focused.sourceDone,[undefined]);
  const missing=harness({props:{source:{generation:'g',token:1,target:{kind:'income',id:'missing'}}}});await missing.settle();assert.equal(missing.find('IncomeDialog'),undefined);assert.match(missing.sourceDone[0],/删除或失效/);
});
test('income source late completion after module change or superseding focus cannot open',async()=>{
  const late=deferred();const r=harness({props:{source:{generation:'g',token:1,target:{kind:'income',id:'i'}}},invoke:(c,a)=>c==='plan_income_list'?late.promise:c==='finance_sources'?snapshot(a.period,r.props.modules):true});await r.settle();r.props.modules={...modules,incomes:false};r.render();late.resolve({generation:'g',rows:[income('i')]});await r.settle();assert.equal(r.find('IncomeDialog'),undefined);
});
test('movement source traverses fresh unfiltered pages and rejects deleted or stale records',async()=>{
  const rec={id:'m',revision:2,deleted:false,source_status:'unlinked',fields:{date:'2026-10-12',amount_cents:'20',from:{kind:'account',account_id:'a'},to:{kind:'external',label:'outside'},purpose:'own_transfer',source:null,notes:''}};
  const requests=[];const port={listAccounts:async()=>ready({generation:'g',accounts:[{id:'a',name:'A',selectable:true}]}),listMovements:async(q)=>{requests.push(q);return ready({generation:'g',records:q.from_date?[]:q.cursor?[rec]:[],next_cursor:q.from_date||q.cursor?null:'next'});}};
  const r=harness({realMovements:true,port,props:{route:{page:'records',tab:'movements',period:{kind:'month',month:'2026-09'}},source:{generation:'g',token:1,target:{kind:'movement',id:'m'}}}});await r.settle();assert.equal(r.find('MovementForm').props.record.id,'m');assert.ok(requests.some(q=>q.cursor==='next'&&q.from_date===null));assert.equal(r.routes.length,0);
  const missing=harness({realMovements:true,port:{...port,listMovements:async()=>ready({generation:'g',records:[{...rec,deleted:true}],next_cursor:null})},props:{route:{page:'records',tab:'movements'},source:{generation:'g',token:1,target:{kind:'movement',id:'m'}}}});await missing.settle();assert.equal(missing.find('MovementForm'),undefined);assert.match(missing.sourceDone[0],/删除或失效/);
});

test('capability combinations render only their eligible facts and keep explicit sources unavailable', async () => {
  for(const incomes of [false,true]) for(const expenses of [false,true]) for(const wealth of [false,true]) {
    const prefs={...modules,incomes,expenses,wealth};const r=harness({props:{modules:prefs}});await r.settle();
    const expected=incomes?'income':expenses?'expenses':wealth?'movements':null;
    assert.equal(r.bar().primary?.label,expected===null?undefined:expected==='income'?'记一笔收入':expected==='expenses'?'记一笔支出':'记一笔资金流动');
    if(expected==='movements')assert.ok(r.find('MovementsList'));if(expected===null)assert.match(r.text(r.nodes()[0]),/模块已关闭/);
    r.unmount();
  }
});
test('saved refresh immediately removes old aggregate and leaves a subsequent failure visible',async()=>{
  const later=deferred();let n=0;
  const r=harness({invoke:(c,a)=>c==='finance_sources'?(++n===1?snapshot(a.period):later.promise):c==='plan_income_list'?{generation:'g',rows:[]}:true});await r.settle();
  r.find('IncomeRecords').props.onOpen(income('i'));r.render();r.find('IncomeDialog').props.onClose(true);r.render();assert.equal(r.find('IncomeRecords'),undefined);
  later.reject(Error('reload failure'));await r.settle();assert.match(r.text(r.nodes()[0]),/reload failure/);assert.equal(r.find('IncomeRecords'),undefined);
});
test('stale source generation never reads income and successful verification alone advances receipt epoch',async()=>{
  const stale=harness({props:{source:{generation:'old',token:1,target:{kind:'income',id:'i'}}}});await stale.settle();assert.equal(stale.calls.some(c=>c.command==='plan_income_list'),false);assert.match(stale.sourceDone[0],/删除或失效/);
  const r=harness({props:{route:{page:'records',tab:'movements'}},receipt:{pending:{command:'movement_save',label:'movement',input:{request_id:'same'}}}});await r.settle();assert.equal(r.find('MovementsList').props.receiptResolutionVersion,0);
  r.nodes().find(n=>n.type==='button'&&r.text(n)==='核对结果').props.onClick();await r.settle();assert.equal(r.find('MovementsList').props.receiptResolutionVersion,1);r.find('MovementsList').props.onSaved();r.render();assert.equal(r.find('MovementsList').props.receiptResolutionVersion,1);
});

test('explicit source tab wins over a remembered tab, including capability failure',async()=>{
  const r=harness({props:{route:{page:'records',tab:'expenses'},source:{generation:'g',token:1,target:{kind:'income',id:'latest'}}}});await r.settle();assert.equal(r.routes.at(-1).tab,'income');assert.equal(r.find('IncomeDialog').props.income.id,'latest');
  const closed=harness({props:{modules:{...modules,incomes:false},route:{page:'records',tab:'expenses'},source:{generation:'g',token:1,target:{kind:'income',id:'latest'}}}});await closed.settle();assert.equal(closed.find('ExpensesPage'),undefined);assert.match(closed.sourceDone[0],/模块已关闭/);
});

test('an income source read owns the editor lock until completion and cannot replace manual input', async () => {
 const late=deferred();
 const r=harness({props:{source:{generation:'g',token:1,target:{kind:'income',id:'source-a'}}},invoke:(c,a)=>c==='plan_income_list'?late.promise:c==='finance_sources'?snapshot(a.period):true});
 await r.settle();
 assert.equal(r.bar().primary.disabled,true);
 const rows=r.find('IncomeRecords'); assert.equal(rows.props.disabled,true);
 rows.props.onOpen(income('manual-b')); r.render(); assert.equal(r.find('IncomeDialog'),undefined);
 late.resolve({generation:'g',rows:[income('source-a')]}); await r.settle();
 assert.equal(r.find('IncomeDialog').props.income.id,'source-a');
});
test('movement source loading freezes ordinary row editing and new flow', async () => {
 const late=deferred();let hold=false;
 const record={id:'m',revision:1,deleted:false,source_status:'unlinked',fields:{date:'2026-10-12',amount_cents:'20',from:{kind:'account',account_id:'a'},to:{kind:'external',label:'outside'},purpose:'own_transfer',source:null,notes:''}};
 const port={listAccounts:async()=>ready({generation:'g',accounts:[{id:'a',name:'A',selectable:true}]}),listMovements:async()=>hold?late.promise:ready({generation:'g',records:[record],next_cursor:null})};
 const r=harness({realMovements:true,port,props:{route:{page:'records',tab:'movements'}}});await r.settle(); hold=true; r.props.source={generation:'g',token:1,target:{kind:'movement',id:'m'}}; r.render();await r.settle();
 const modify=r.nodes().find(n=>n.type==='button'&&r.text(n)==='修改');assert.equal(modify.props.disabled,true);modify.props.onClick();r.render();assert.equal(r.find('MovementForm'),undefined);
 late.resolve(ready({generation:'g',records:[record],next_cursor:null}));await r.settle();assert.equal(r.find('MovementForm').props.record.id,'m');
});
