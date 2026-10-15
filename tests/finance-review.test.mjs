import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewInterval,incomeMetric,expenseMetric} from '../src/finance-review-model.ts';
const p=(id,date,complete=true)=>({snapshot_id:id,date,complete});
const i=(id,from,to,status='ok')=>({snapshot_id:id,from,to,status,delta_nw_cents:status==='ok'?'1200':null});
test('review selects latest domain adjacent complete interval, preserves explicit closing endpoint and scope reason',()=>{
 const points=[p('a','2026-01-01'),p('incomplete','2026-01-15',false),p('b','2026-02-01'),p('c','2026-03-01')];
 const intervals=[i('b','2026-01-01','2026-02-01'),i('c','2026-02-01','2026-03-01','scope_changed')];
 assert.equal(reviewInterval(intervals,points).interval.status,'scope_changed');
 assert.deepEqual(reviewInterval(intervals,points,'b').pair,{fromSnapshotId:'a',toSnapshotId:'b'});
 assert.equal(reviewInterval(intervals,points,'missing'),null);
 assert.equal(reviewInterval(intervals,points.filter(p=>p.snapshot_id!=='a'),'b'),null);
 assert.equal(reviewInterval(intervals,points,'c','a'),null);
});
test('income integer fact sum retains large cents; empty disabled and errors never become zero',()=>{
 assert.equal(incomeMetric({status:'ready',value:[{fields:{net_cents:'9007199254740993'}},{fields:{net_cents:'7'}}]}).cents,'9007199254741000');
 assert.equal(incomeMetric({status:'ready',value:[]}).cents,null);
 assert.equal(incomeMetric({status:'disabled',reason:'closed'}).note,'closed');
 assert.equal(incomeMetric({status:'error',message:'retry'}).cents,null);
});
test('expense uses domain refund-before amount, unknown parts, no records and recovery-only never mean zero spending',()=>{
 const read=lines=>({status:'ready',value:{lines,spent_cents:'800000',refund_cents:'100000',sale_cents:'200000'}});
 assert.equal(expenseMetric(read([{source:'expense',amount_cents:'800000'},{source:'refund',amount_cents:'100000'}])).cents,'800000');
 assert.equal(expenseMetric(read([{source:'expense',amount_cents:null}])).cents,null);
 assert.match(expenseMetric(read([{source:'expense',amount_cents:'800000'},{source:'purchase',amount_cents:null}])).note,/仅已知部分/);
 assert.equal(expenseMetric(read([{source:'sale',amount_cents:'200000'}])).cents,null);
 assert.equal(expenseMetric(read([])).cents,null);
});

import {readFileSync} from 'node:fs';
import {posix} from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import * as periods from '../src/finance-contract.ts';
import * as navigation from '../src/finance-navigation.ts';
import * as plan from '../src/plan.ts';
import {allModules} from '../src/modules.ts';
import * as reviewModel from '../src/finance-review-model.ts';
import * as expenseModel from '../src/expenses.ts';
import * as classification from '../src/income-classification.ts';
const ts = createRequire(import.meta.url)('typescript');
const modules = { ...allModules, incomes: true, movements: true, planning: false, finance_status: 'ready', finance_revision: 1 };
const income = (id, date = '2026-10-12', hpf = null) => ({ id, revision: 1, fields: { date, net_cents: '1000', hpf_cents: hpf, notes: id } });
const ready = value => ({ status: 'ready', value });
const snapshot = (period = { kind: 'all' }, prefs = modules, extra = {}) => ({ generation: 'g', write_version: 1, today: '2026-10-12', period, modules: prefs, incomes: ready([income('i')]), accounts: ready([]), expenses: ready({ generation: 'g', period, lines: [], undated: [],spent_cents:'0',refund_cents:'0',sale_cents:'0' }), wealth:ready({generation:'g',points:[{snapshot_id:'a',date:'2026-09-01',complete:true},{snapshot_id:'b',date:'2026-10-01',complete:true},{snapshot_id:'c',date:'2026-10-12',complete:true}]}), asset_review:ready({generation:'g',intervals:[{snapshot_id:'b',from:'2026-09-01',to:'2026-10-01',status:'ok',delta_nw_cents:'300'},{snapshot_id:'c',from:'2026-10-01',to:'2026-10-12',status:'ok',delta_nw_cents:'500'}]}),history:{status:'disabled',reason:'history unavailable'}, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
/** Real page, aggregate hook/session, and source orchestration with deterministic IPC and leaf controls. */
function harness(options = {}) {
  const calls = [], bars = [], routes = [], searches = [], sourceDone = [], editingChanges = [];
  const receipt = { pending: null, busy: false, notice: '', ...options.receipt };
  let cursor = 0, path = 'root', tree, dirty = false, effects = [], destroyed = false;
  const slots = new Map(), cleanups = new Map(), touched = new Set();
  const hooks = {
    useMemo(fn,deps) { const key = `${path}/${cursor++}`; touched.add(key); const before=slots.get(key); if (!before || deps.some((v,i)=>!Object.is(v,before.deps[i]))) slots.set(key,{deps,value:fn()}); return slots.get(key).value; },
    useCallback(fn,deps) { return hooks.useMemo(()=>fn,deps); },
    useState(initial) { const key = `${path}/${cursor++}`; touched.add(key); if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial); return [slots.get(key), value => { slots.set(key, typeof value === 'function' ? value(slots.get(key)) : value); dirty = true; }]; },
    useRef(initial) { const key = `${path}/${cursor++}`; touched.add(key); if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect(fn, deps) { const key = `${path}/${cursor++}`; touched.add(key); const before = slots.get(key); if (!before || deps.some((v,i) => !Object.is(v,before[i]))) { slots.set(key,deps); effects.push(() => { cleanups.get(key)?.(); cleanups.set(key,fn()); }); } },
  };
  const leaves = new Proxy({}, { get: (_,key) => key });
  const stub = {
    react: hooks, 'react/jsx-runtime': { jsx: (type,props,key) => ({type,props,key}), jsxs: (type,props,key) => ({type,props,key}) },
    'asset': { errorMessage: e => e.message ?? String(e), money: value => value },
    'finance-contract': periods, 'finance-navigation': navigation, plan, 'finance-review-model':reviewModel, expenses:expenseModel, 'income-classification':classification,
    'WealthPage': { usePendingReceipt: reload => ({ ...receipt, setPending: p => { receipt.pending=p; }, verify: async () => { if (options.verify) await options.verify(receipt); else receipt.pending=null; reload(); } }) },
    wealth: { storedPending: () => receipt.pending, changeText:v=>`signed ${v}` }, undo: { useRestored() {} },
    topbar: { usePageBar: (owner,bar) => bars.push({owner,bar}) }, 'topbar-model': { refocusHeading() {} },
    'planning-basic-defaults':{HISTORY_MIN_INTERVALS:3},
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
      if (rel === 'ListPagination') return load('ListPagination.tsx');
      if (rel === 'planning-followup-ui/MovementsList' && options.realMovements) return load(`${rel}.tsx`);
      return leaves;
    }});
    return exports;
  }
  const props = { generation:'g', today:'2026-10-12', modules, route:{page:'review',view:'period'}, onRecords:r=>routes.push(r),onGoals(){},onCheckIn(){}, search:'', onSearch:s=>searches.push(s), onRouteChange:r=>routes.push(r), onEditingChange:b=>editingChanges.push(b), onOpenAsset(){},onOpenSource(){},onNewAccount(){},onSourceDone:m=>sourceDone.push(m),...options.props };
  const Page = load('FinanceReviewPage.tsx').FinanceReviewPage;
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


test('real review page has one header, one date source and sends exact excluded-start range to records',async()=>{
 const r=harness();await r.settle();assert.equal(r.bars.at(-1).owner,'finance-review');assert.equal(r.bar().newRecord,undefined);
 const select=r.find('select',p=>p.value==='c');assert.ok(select);
 const tables=r.nodes().filter(n=>n.type==='WealthChanges');assert.equal(tables[0].props.hideControls,true);assert.equal(tables[0].props.controlledRange.from,'b');
 r.nodes().find(n=>n.type==='button'&&r.text(n)==='查看／补记本期收入').props.onClick();
 assert.equal(r.routes.at(-1).period.from,'2026-10-01');assert.equal(r.routes.at(-1).period.includeFrom,false);
 const host=r.find('InvestmentReviewHost');assert.equal(host.props.movementPresentation,'review');assert.equal(host.props.movementsEnabled,true);
 host.props.onViewAllMovements({kind:'range',from:'2026-10-01',to:'2026-10-12',includeFrom:false},['inv']);assert.equal(r.routes.at(-1).movementAccountIds[0],'inv');
 assert.equal(r.calls.some(c=>c.command.includes('profile')),false);
});
test('summary accepts only matching investment pair and clears previous period sources while loading',async()=>{
 const r=harness();await r.settle();let host=r.find('InvestmentReviewHost');
 host.props.onPreviewChange({fromSnapshotId:'a',toSnapshotId:'b',result:{status:'ready',value:{profit_cents:'9999'}}});r.render();assert.doesNotMatch(r.text(r.nodes()[0]),/9999/);
 host=r.find('InvestmentReviewHost');host.props.onPreviewChange({fromSnapshotId:'b',toSnapshotId:'c',result:{status:'ready',value:{profit_cents:'555'}}});r.render();assert.match(r.text(r.nodes()[0]),/signed 555/);
 r.props.route={page:'review',view:'period',toSnapshotId:'b'};r.render();assert.doesNotMatch(r.text(r.nodes()[0]),/signed 555/);assert.equal(r.find('InvestmentReviewHost'),undefined);
 await r.settle();assert.equal(r.find('InvestmentReviewHost').props.toSnapshotId,'b');
});
test('independent asset review works with income and history disabled; removed endpoint never keeps amount',async()=>{
 const r=harness({extra:{incomes:{status:'disabled',reason:'income closed'},history:{status:'error',message:'history failed'}}});await r.settle();assert.ok(r.find('InvestmentReviewHost'));assert.match(r.text(r.nodes()[0]),/income closed/);
 r.props.route={page:'review',view:'period',toSnapshotId:'deleted'};r.render();assert.equal(r.find('InvestmentReviewHost'),undefined);assert.match(r.text(r.nodes()[0]),/所选本期区间已失效/);
});
test('first complete snapshot review explains missing baseline while stale endpoints and explicit pairs remain invalid',async()=>{
 const extra={accounts:ready([{id:'account',fields:{name:'现金'}}]),wealth:ready({generation:'g',points:[p('first','2026-10-12'),p('draft','2026-10-01',false)]}),asset_review:ready({generation:'g',intervals:[]})};
 const first=harness({extra,props:{route:{page:'review',view:'period',toSnapshotId:'first'}}});await first.settle();
 assert.match(first.text(first.nodes()[0]),/完成两次完整盘点后开始复盘/);
 assert.match(first.text(first.nodes()[0]),/已完成第一期完整盘点。再完成一期不同日期的完整盘点/);
 assert.doesNotMatch(first.text(first.nodes()[0]),/所选本期区间已失效/);
 assert.equal(first.find('InvestmentReviewHost'),undefined);
 for(const route of [{page:'review',view:'period',toSnapshotId:'deleted'},{page:'review',view:'period',pair:{fromSnapshotId:'deleted',toSnapshotId:'first'}}]) {
  const stale=harness({extra,props:{route}});await stale.settle();assert.match(stale.text(stale.nodes()[0]),/所选本期区间已失效/);assert.doesNotMatch(stale.text(stale.nodes()[0]),/已完成第一期完整盘点/);
 }
});
test('pending original request resolves only after actual verification clears stored pending',async()=>{
 const r=harness({receipt:{pending:{request_id:'original',label:'投资核对',command:'review_save'}},verify:async()=>{}});await r.settle();
 r.nodes().find(n=>n.type==='button'&&r.text(n)==='核对结果').props.onClick();await r.settle();assert.equal(r.find('InvestmentReviewHost').props.receiptResolutionVersion,0);assert.equal(r.find('InvestmentReviewHost').props.pendingReceipt,true);
 const ok=harness({receipt:{pending:{request_id:'original',label:'投资核对',command:'review_save'}}});await ok.settle();ok.nodes().find(n=>n.type==='button'&&ok.text(n)==='核对结果').props.onClick();await ok.settle();assert.equal(ok.find('InvestmentReviewHost').props.receiptResolutionVersion,1);
});

test('period facts use their own aggregate even when bootstrap has the same write version',async()=>{
 const r=harness({invoke:async(command,args)=>{
  const facts=snapshot(args.period,modules);
  if(args.period.kind==='range') facts.asset_review.value.intervals[1].delta_nw_cents='777';
  return facts;
 }});await r.settle();assert.match(r.text(r.nodes()[0]),/signed 777/);assert.doesNotMatch(r.text(r.nodes()[0]),/signed 500/);
});
test('changed period dates cannot keep old amounts and child false cannot unlock a pending original request',async()=>{
 const r=harness({invoke:async(command,args)=>{const facts=snapshot(args.period,modules);if(args.period.kind==='range') facts.asset_review.value.intervals[1].from='2026-10-02';return facts;}});await r.settle();assert.equal(r.find('InvestmentReviewHost'),undefined);assert.doesNotMatch(r.text(r.nodes()[0]),/signed 500/);assert.match(r.text(r.nodes()[0]),/盘点区间已变化/);
 const pending=harness({receipt:{pending:{request_id:'original',label:'核对',command:'review_save'}}});await pending.settle();pending.find('InvestmentReviewHost').props.onEditingChange(false);pending.render();assert.equal(pending.editingChanges.at(-1),true);
});

test('long period sources render fifty rows per list and changing interval starts at page one',async()=>{
 const manyIncomes=Array.from({length:125},(_,n)=>({...income(`income-${n}`),fields:{...income(`income-${n}`).fields,net_cents:String(1000+n)}}));
 const manyExpenses=Array.from({length:125},(_,n)=>({id:`expense-${n}`,source:'expense',date:'2026-10-11',title:`虚构支出 ${n}`,amount_cents:'100'}));
 const r=harness({extra:{incomes:ready(manyIncomes),expenses:ready({lines:manyExpenses,undated:[],spent_cents:'12500',refund_cents:'0',sale_cents:'0'})}});
 await r.settle();
 const visible=()=>r.nodes().filter(n=>n.type==='li');
 assert.equal(visible().length,100);
 const incomeNav=r.find('nav',p=>p['aria-label']==='本期收入分页');
 assert.ok(incomeNav);assert.match(r.text(incomeNav),/共 125 条/);
 r.nodes().find(n=>n.type==='button'&&r.text(n)==='下一页'&&n.props.disabled===false).props.onClick();r.render();
 assert.match(r.text(r.nodes()[0]),/1050/);
 r.props.route={page:'review',view:'period',toSnapshotId:'b'};r.render();await r.settle();
 assert.match(r.text(r.nodes()[0]),/1000/);
 assert.doesNotMatch(r.text(r.find('nav',p=>p['aria-label']==='本期收入分页')),/第 2/);
});
