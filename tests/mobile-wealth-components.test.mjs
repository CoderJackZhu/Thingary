import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as asset from '../src/asset.ts';
import * as wealth from '../src/wealth.ts';
import * as currency from '../src/currency.ts';
import * as holdings from '../src/holdings.ts';
import * as groups from '../src/account-groups.ts';
import * as display from '../src/wealth-display.ts';
import * as model from '../src/mobile/wealth/model.ts';
import * as format from '../src/mobile/format.ts';
const a={id:'fictional-cash',revision:2,fields:{name:'虚构储蓄卡',institution:'虚构银行',side:'asset',kind:'cash',currency:'CNY',counted:true,opened_on:'2026-01-01',closed_on:null,notes:''}}, b={id:'fictional-usd',revision:3,fields:{...a.fields,name:'虚构美元',currency:'USD'}};
function runtime(file,name,props) {
 let cursor=0,slots=[],error='',calls=[],pops=0,frozen=false;
 const session={today:'2026-10-21',data:{summary:{generation:'fictional',points:[]},accounts:[a,b]},reload(){},get navBlocked(){return frozen;}};
 const react={useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];}};
 const leaf=new Proxy({}, {get:(_,key)=>key}),jsx=(type,props)=>({type,props});
 const modules={'react':react,'react/jsx-runtime':{jsx,jsxs:jsx},'../../asset':asset,'../format':format,'../../wealth':wealth,'../../currency':currency,'../../holdings':holdings,'../../account-groups':groups,'../../wealth-display':display,'./QuickUpdate':{default:()=>null},'./model':model,'../ui':leaf,'../session':{useSession:()=>session},'../nav-context':{useNav:()=>({pop(){pops++;}})},'@tauri-apps/api/core':{invoke:async()=>null},'./shared':{factText:()=> '虚构原金额',useWrite:()=>({get error(){return error;},get frozen(){return frozen;},setError(v){error=v;},async write(input){if(!frozen)calls.push(input);}})}};
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL(`../src/mobile/wealth/${file}.tsx`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:id=>{if(!(id in modules))throw Error(id);return modules[id];},crypto:{randomUUID:()=>`fictional-request-${calls.length}`}});
 const nodes=x=>Array.isArray(x)?x.flatMap(nodes):x&&typeof x==='object'?[x,...nodes(x.props?.children)]:[];
 const render=()=>{cursor=0;return nodes(exports[name](props));};
 return {render,calls,get error(){return error;},setFrozen(value){frozen=value;},field(label,value){const node=render().find(n=>n.props?.label===label&&n.props?.onChange);assert.ok(node,label);node.props.onChange(value);},async save(){const node=render().find(n=>n.type==='NavBar');assert.ok(node?.props.primary,'NavBar 右上保存');assert.equal(node.props.primary.label,'保存');await node.props.primary.onClick();},async click(text){const node=render().find(n=>n.type==='Button'&&n.props.children===text);assert.ok(node,text);await node.props.onClick();},get pops(){return pops;}};
}
test('真实完整盘点处理器：缺项阻止任何写入，填齐后一条请求提交全部账户',async()=>{
 const draft={generation:'fictional',date:'2026-10-21',existing:null,rows:[a,b].map(account=>({account,previous:null}))};
 const h=runtime('CheckIn','Inventory',{draft,groups:[]});
 await h.click('保存本次盘点');assert.equal(h.calls.length,0);assert.match(h.error,/填齐/);
 h.field('虚构储蓄卡本次金额','0');h.field('虚构美元原币金额','10000');
 await h.click('保存本次盘点');assert.equal(h.calls.length,0);
 h.field('USD 本次汇率','7120000');
 await h.click('保存本次盘点');
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].command,'wealth_snapshot_save');
 assert.equal(h.calls[0].input.entries.length,2);assert.equal(h.calls[0].input.entries[1].amount_cents,'71200');
 assert.equal(h.calls[0].input.entries[0].amount_cents,'0');
 h.setFrozen(true);assert.equal(h.render().find(n=>n.type==='Button'&&n.props.children==='保存本次盘点').props.disabled,true);
 assert.equal(h.render().find(n=>n.type==='NavBar').props.primary.disabled,true);// 右上「保存」与底部同步禁用
 h.setFrozen(false);await h.save();assert.equal(h.calls.length,2);// 右上「保存」与底部「保存本次盘点」是同一个保存
});
test('真实账户编辑处理器：完整外币持仓字段与修订原样保存',async()=>{
 const h=runtime('AccountEdit','Editor',{account:a,groups:[],reloadGroups(){}});
 h.field('名称','虚构投资账户');h.field('类型','fund');h.field('按持仓记录',true);
 h.field('持仓单位','份');h.field('币种','USD');h.field('启用日期','2026-01-02');
 await h.save();assert.equal(h.calls.length,1);
 const input=h.calls[0].input;assert.equal(input.id,a.id);assert.equal(input.expected_revision,2);
 assert.equal(input.fields.currency,'USD');assert.equal(input.fields.holding_mode,true);assert.equal(input.fields.opened_on,'2026-01-02');
});
test('真实新增账户处理器：空名不保存，类型建议与显式计入选择保留',async()=>{
 const h=runtime('AccountEdit','Editor',{account:null,groups:[],reloadGroups(){}});
 await h.save();assert.equal(h.calls.length,0);assert.match(h.error,/名称/);
 h.field('名称','虚构车辆');h.field('类型','vehicle');
 assert.equal(h.render().find(n=>n.type==='Switch'&&n.props.label==='计入金融净资产').props.checked,false);
 h.field('计入金融净资产',true);h.field('类型','insurance');
 assert.equal(h.render().find(n=>n.type==='Switch'&&n.props.label==='计入金融净资产').props.checked,true);
 await h.save();assert.equal(h.calls[0].input.fields.counted,true);
});
test('真实单账户更新处理器使用 quick 命令，日期与代次保留',async()=>{
 const draft={generation:'fictional',date:'2026-10-21',existing:null,rows:[{account:a,previous:{amount_cents:'10000',date:'2026-10-01'}}]};
 const h=runtime('QuickUpdate','Update',{draft,id:a.id});
 h.field('新的余额或欠款','12345');await h.save();
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].command,'wealth_quick_update');
 assert.equal(h.calls[0].input.date,draft.date);assert.equal(h.calls[0].input.changes[0].amount_cents,'12345');
});
