import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { accountBalanceView, balanceComparison, accountGroupTotals, accountVisible } from '../src/wealth-display.ts';
const account={id:'fictional-bank',fields:{name:'虚构银行卡',kind:'cash',side:'asset',counted:true,opened_on:'2026-01-01',closed_on:null},latest:{amount_cents:'10000',date:'2026-10-01'},last_entered_on:'2026-10-01'};
const entry=(over={})=>({account_id:account.id,state:'entered',amount_cents:'12000',side:'asset',kind:'cash',counted:true,...over});
const points=[{snapshot_id:'before',date:'2026-10-01',complete:true,compared_to:null},{snapshot_id:'saved',date:'2026-10-19',complete:true,compared_to:'2026-10-01'}];
const summary={generation:'fictional',points,latest_entries:[entry()],structure_entries:[],structure:[],liabilities:[]};
test('one snapshot supplies both row facts and group totals; unknown never falls back to an older known balance',()=>{
 const missing=entry({state:'missing',amount_cents:null});
 const shown=accountBalanceView(account,'2026-10-19',[missing]);
 assert.equal(shown.fact.amount_cents,null);assert.equal(shown.date,'2026-10-19');assert.equal(shown.state,'unknown');assert.match(shown.label,/待填写/);
 assert.equal(accountGroupTotals([account],[],[missing],true)[0].partial,true);
 assert.equal(account.latest.amount_cents,'10000');
});
test('explicit zero, entered date and carried origin remain distinct without rounding money',()=>{
 for(const amount_cents of ['0','12000','99999999999']){
  const row=accountBalanceView(account,'2026-10-19',[entry({amount_cents})]);assert.equal(row.fact.amount_cents,amount_cents);assert.equal(row.state,'entered');assert.equal(row.label,'这次填写');
 }
 const carried=accountBalanceView(account,'2026-10-19',[entry({state:'unchanged'})]);assert.equal(carried.date,'2026-10-19');assert.match(carried.label,/沿用旧金额.*2026-10-01/);
 const unknownOrigin=accountBalanceView({...account,last_entered_on:null},'2026-10-19',[entry({state:'unchanged'})]);assert.match(unknownOrigin.label,/日期待核对/);
});
test('an account outside the latest check-in is marked as another date, not included in this subtotal',()=>{
 const row=accountBalanceView(account,'2026-10-19',[]);assert.equal(row.date,'2026-10-01');assert.match(row.label,/其他日期记录.*未列入这次小计/);
 const fresh=accountBalanceView({...account,latest:null},'2026-10-19',[]);assert.equal(fresh.fact,null);assert.equal(fresh.state,'unknown');
});
test('comparison uses the specified saved snapshot and its actual prior complete date',()=>{
 assert.deepEqual(balanceComparison(points,'saved'),{fromSnapshotId:'before',toSnapshotId:'saved'});
 assert.equal(balanceComparison(points,'deleted'),null);
 assert.equal(balanceComparison(points.map(p=>p.snapshot_id==='saved'?{...p,complete:false}:p),'saved'),null);
 assert.equal(balanceComparison(points.slice(1),'saved'),null);
 assert.equal(balanceComparison([points[0]],'before'),null);
});
const all=tree=>Array.isArray(tree)?tree.flatMap(all):tree&&typeof tree==='object'?[tree,...all(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null||typeof tree==='boolean'?'':String(tree);
const source=ts.createSourceFile('WealthPage.tsx',readFileSync(new URL('../src/WealthPage.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function compile(name){let fn;const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name)fn=n;ts.forEachChild(n,visit);};visit(source);assert.ok(fn);return ts.transpileModule(fn.getText(source)+'\nmodule.exports='+name,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
test('both grouped and flat account rows receive the same snapshot basis',()=>{
 const Accounts=()=>null,context={module:{exports:{}},exports:{},require:()=>jsx,Accounts,accountGroupTotals,groupAmountsHidden:()=>false,money:String,signedMoney:String};
 vm.runInNewContext(compile('AccountListing'),context);
 for(const mode of ['list','group']){
  const tree=context.module.exports({mode,accounts:[account],allAccounts:[account],groups:[],summary});
  const rows=all(tree).filter(n=>n.type===Accounts);assert.equal(rows.length,1);assert.equal(rows[0].props.basis,summary);
 }
});
function pageHost(initial={}){
 const values={summary,accounts:[account],tab:'overview',loadedRetry:1,retry:1,...initial};const refs=[],bars=[],calls=[];let cursor=0,refCursor=0;
 let fn;ts.forEachChild(source,node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='WealthPage')fn=node;});
 const names=[];const visit=n=>{if(ts.isVariableDeclaration(n)&&ts.isArrayBindingPattern(n.name)&&ts.isCallExpression(n.initializer)&&n.initializer.expression.getText(source)==='useState')names.push(n.name.elements[0].getText(source));ts.forEachChild(n,visit);};visit(fn);
 const context={module:{exports:{}},exports:{},require:()=>jsx,accountVisible,balanceComparison,
  useState(init){const name=names[cursor++];if(!(name in values))values[name]=typeof init==='function'?init():init;return[values[name],v=>{values[name]=typeof v==='function'?v(values[name]):v;}];},useEffect(){},useRef(v){return refs[refCursor++]??(refs[refCursor-1]={current:v});},useRestored(){},usePageBar:(_,bar)=>bars.push(bar),useSource:()=>'',storedPending:()=>null,
  usePendingReceipt:()=>({pending:values.pending??null,setPending(){},notice:'',busy:false,verify(){}}),quickAvailable:()=>true,refocusHeading(){},
  document:{querySelector:()=>null},AccountDialog:()=>null,HeaderSlot:()=>null,CloseButton:()=>null,Overview:()=>null,SavingsGoals:()=>null,CheckinReminderAsk:()=>null,CheckIn:()=>null,AccountListing:()=>null,WealthChanges:()=>null,
 };
 vm.runInNewContext(compile('WealthPage'),context);
 const props={today:'2026-10-19',search:'',onSearch(){},onEditingChange(){},onCompare:pair=>calls.push(pair),onAdjustPlan:()=>calls.push('plan')};
 return{values,bars,calls,context,render(){cursor=refCursor=0;return context.module.exports(props);}};
}
test('return visit starts today balance entry; a definite save returns to overview then compares the exact pair',()=>{
 const h=pageHost();h.render();assert.equal(h.bars.at(-1).primary.label,'更新今天的余额');h.bars.at(-1).primary.run();
 const editor=h.render();assert.equal(editor.type,h.context.CheckIn);assert.equal(editor.props.date,'2026-10-19');
 editor.props.onClose(true,{id:'saved',date:'2026-10-19',entries:[entry()],missing:[]});assert.equal(h.values.tab,'overview');
 const tree=h.render();assert.match(text(tree),/今天的余额已保存/);
 all(tree).find(n=>n.type==='button'&&text(n)==='看哪些账户变化了 →').props.onClick();assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{fromSnapshotId:'before',toSnapshotId:'saved'});
 all(tree).find(n=>n.type==='button'&&text(n)==='需要时调整计划 →').props.onClick();assert.equal(h.calls[1],'plan');
});
test('cancelling does not publish success; incomplete or vanished saved endpoints cannot offer a substitute comparison',()=>{
 const h=pageHost();h.render();h.bars.at(-1).primary.run();h.render().props.onClose(false);assert.equal(h.values.savedSnapshot,null);
 h.values.savedSnapshot={id:'vanished',date:'2026-10-19',entries:[],missing:[]};
 const button=all(h.render()).find(n=>n.type==='button'&&text(n)==='看哪些账户变化了 →');assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(h.calls.length,0);
});

test('adding an account from savings targets uses the shared editor and returns to that area after save or cancel',()=>{
 for(const saved of [false,true]){const h=pageHost();let tree=h.render();const goals=all(tree).find(n=>n.type===h.context.SavingsGoals);assert.ok(goals.props.onNewAccount);goals.props.onNewAccount();
  tree=h.render();const dialog=all(tree).find(n=>n.type===h.context.AccountDialog);assert.equal(dialog.props.account,null);assert.equal(dialog.props.generation,summary.generation);
  dialog.props.onClose(saved,saved?'虚构新账户':undefined);assert.equal(h.values.editing,null);assert.equal(h.values.savingsFocus,true);if(saved)assert.equal(h.values.createdAccount.name,'虚构新账户');else assert.equal(h.values.createdAccount,null);
 }
 const h=pageHost({pending:{label:'虚构待核对'}});const goals=all(h.render()).find(n=>n.type===h.context.SavingsGoals);goals.props.onNewAccount();assert.equal(h.values.editing,null);
});
