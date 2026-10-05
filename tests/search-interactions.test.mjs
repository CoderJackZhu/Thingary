import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const src = ts.createSourceFile('SearchPanel.tsx', readFileSync(root + '/src/SearchPanel.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const fn = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'SearchPanel');
const script = ts.transpileModule(fn.getText(src) + '\nmodule.exports=SearchPanel;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function runtime(keyword, invoke) {
  let cursor=0, session={keyword,typeFilter:'all',offset:0,scrollTop:0,revision:null,open:true}, calls=[], effects=[], slots=[], timers=[], opened=0, generation='fictional-generation', modulesOn=()=>true;
  const context={module:{exports:{}},exports:{},require,
    useState(value){const i=cursor++;if(!slots[i])slots[i]={value};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v}];},
    useRef(value){const i=cursor++;if(!slots[i])slots[i]={value:{current:value}};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++;const previous=slots[i];if(!previous||!deps||deps.length!==previous.deps.length||deps.some((v,n)=>!Object.is(v,previous.deps[n]))){effects.push(()=>{previous?.cleanup?.();const cleanup=fn();slots[i]={deps,cleanup};});}},
    document:{activeElement:{isConnected:true,focus(){}}},requestAnimationFrame:fn=>fn(),HTMLInputElement:class {},CloseButton(){},
    window:{setTimeout(fn){const timer={fn,active:true};timers.push(timer);return timer;},clearTimeout(timer){timer.active=false;}},
    searchDebounceMs:200,searchPageSize:30,searchScopeText:'scope',searchKindLabel:v=>v,searchKindOrder:['asset','wish','account'],searchFilterList:()=>[],errorMessage:String,
    async invoke(command,args){calls.push({command,args});const value=await invoke(command,args);return command==='search_all'?{revision:'fictional-revision',offset:args.input.offset,...value}:value;},
  };
  vm.runInNewContext(script,context);
  function render(){
    cursor=0;const tree=context.module.exports({session,onSessionChange:s=>{session=s},onClose(){session={...session,open:false}},generation,modulesOn,onOpenSource(){opened++;}});
    const nodes=[];function walk(n){if(!n||typeof n!=='object')return;if(Array.isArray(n)){n.forEach(walk);return;}if(n.props){if(n.props.ref&&!n.props.ref.current)n.props.ref.current={scrollTop:0,children:[],focus(){},scrollIntoView(){}};nodes.push(n);walk(n.props.children);}}walk(tree);
    const pending=effects;effects=[];pending.forEach(fn=>fn());return nodes;
  }
  return {render,calls,change(value){session={...session,...value};},generation(value){generation=value;},modules(fn){modulesOn=fn;},unmount(){slots.forEach(s=>s?.cleanup?.());},fire(){for(const t of timers.splice(0))if(t.active)t.fn();},get opened(){return opened;},get session(){return session;}};
}
const tick=()=>new Promise(setImmediate);
test('native_search_command_is_registered',()=>{
  assert.equal(/pub async fn search_all\b/.test(readFileSync(root+'/src-tauri/src/commands.rs','utf8')),true,'Native search command wrapper is missing');
  assert.equal(/commands::search_all\b/.test(readFileSync(root+'/src-tauri/src/lib.rs','utf8')),true,'Native search command registration is missing');
});
test('retry_reissues_same_keyword_on_first_page',async()=>{
  const ui=runtime('camera',async()=>{throw new Error('fictional read failure')});
  ui.render();ui.fire();await tick();
  const retry=ui.render().find(n=>n.type==='button'&&n.props.children==='重新搜索');
  assert.ok(retry);retry.props.onClick();ui.render();ui.fire();await tick();
  assert.equal(ui.calls.length,2,'Retry should issue a second search for the same keyword');
});
test('ime_completion_queries_committed_keyword',async()=>{
  const ui=runtime('',async()=>({total:0,items:[],type_counts:[]}));
  let input=ui.render().find(n=>n.type==='input');input.props.onCompositionStart();
  input.props.onChange({target:{value:'中'}});
  input=ui.render().find(n=>n.type==='input');input.props.onCompositionEnd({currentTarget:{value:'中'}});
  ui.render();ui.fire();await tick();
  assert.equal(ui.calls.length,1,'Finishing composition must schedule the search');
});
test('result_enter_opens_once',async()=>{
  const item={id:'asset:fictional-id',kind:'asset',title:'fictional asset',target:{kind:'asset',id:'fictional-id'},matched_field:'名称',context:'fictional asset'};
  const ui=runtime('asset',async c=>c==='search_all'?{total:1,items:[item],type_counts:[]}:undefined);
  ui.render();ui.fire();await tick();let nodes=ui.render();
  nodes.find(n=>n.props.className?.startsWith('global-search-item')).props.onFocus();nodes=ui.render();
  const event={key:'Enter',nativeEvent:{},preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
  nodes.find(n=>n.props.className?.startsWith('global-search-item')).props.onKeyDown(event);
  if(!event.stopped) nodes.find(n=>n.type==='ul').props.onKeyDown(event); // Respect DOM propagation.
  await tick();assert.equal(ui.opened,1,'One Enter must open its source once');
  assert.equal(ui.calls.filter(c=>c.command==='validate_source').length,1);
});
test('closing_panel_cancels_inflight_source_open',async()=>{
  const item={id:'asset:fictional-id',kind:'asset',title:'fictional asset',target:{kind:'asset',id:'fictional-id'},matched_field:'名称',context:'fictional asset'};
  let resolve;
  const ui=runtime('asset',async c=>c==='search_all'?{total:1,items:[item],type_counts:[]}:new Promise(r=>{resolve=r;}));
  ui.render();ui.fire();await tick();const nodes=ui.render();
  nodes.find(n=>n.props.className?.startsWith('global-search-item')).props.onClick();
  nodes.find(n=>n.props['aria-label']==='关闭搜索').props.onClick();ui.unmount();
  resolve();await tick();assert.equal(ui.opened,0,'Closed/unmounted panel must not navigate on a late validation');
});

const item={id:'asset:fictional-id',kind:'asset',title:'fictional asset',target:{kind:'asset',id:'fictional-id'},matched_field:'名称',context:'fictional asset'};
const result={total:1,items:[item],type_counts:[]};
async function loaded(invoke){const ui=runtime('asset',invoke);ui.render();ui.fire();await tick();return ui;}
function row(ui){return ui.render().find(n=>n.props.className?.startsWith('global-search-item'));}

test('source open lock rejects rapid clicks',async()=>{
  let resolve;
  const ui=await loaded(async c=>c==='search_all'?result:new Promise(r=>{resolve=r;}));
  const button=row(ui);button.props.onClick();button.props.onClick();
  assert.equal(ui.calls.filter(c=>c.command==='validate_source').length,1);
  resolve();await tick();assert.equal(ui.opened,1);
});

for(const boundary of ['keyword','generation','modules']) test(`late validation cannot open after ${boundary} changes`,async()=>{
  let resolve;
  const ui=await loaded(async c=>c==='search_all'?result:new Promise(r=>{resolve=r;}));
  row(ui).props.onClick();
  if(boundary==='keyword') ui.change({keyword:'changed'});
  if(boundary==='generation') ui.generation('new-generation');
  if(boundary==='modules') ui.modules(kind=>kind==='asset');
  ui.render();resolve();await tick();assert.equal(ui.opened,0);
});

test('invalid source resets the visible page and refreshes without hiding results',async()=>{
  const ui=runtime('asset',async c=>{if(c==='validate_source')throw new Error('记录已删除');return result;});
  ui.change({offset:30});ui.render();ui.fire();await tick();row(ui).props.onClick();await tick();
  assert.equal(ui.session.offset,0);
  ui.render();ui.fire();await tick();const nodes=ui.render();
  assert.equal(ui.calls.filter(c=>c.command==='search_all').at(-1).args.input.offset,0);
  assert.ok(nodes.some(n=>n.type==='ul'));
  assert.ok(nodes.some(n=>n.props.role==='alert'));
});

test('stale search response cannot overwrite a newer query',async()=>{
  const pending=[];
  const ui=runtime('first',()=>new Promise(r=>pending.push(r)));
  ui.render();ui.fire();ui.change({keyword:'second'});ui.render();ui.fire();
  pending[1]({total:1,items:[{...item,title:'second'}],type_counts:[]});await tick();
  pending[0](result);await tick();
  assert.equal(row(ui).props.children[1].props.children[0],'second');
});

test('composition start cancels a pending query and IME Enter cannot open',async()=>{
  const ui=await loaded(async c=>c==='search_all'?result:undefined);
  const input=ui.render().find(n=>n.type==='input');
  input.props.onCompositionStart();
  input.props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){throw new Error('IME consumed');}});
  ui.render();ui.fire();await tick();
  assert.equal(ui.calls.filter(c=>c.command==='validate_source').length,0);
  const committed=ui.render().find(n=>n.type==='input');
  committed.props.onCompositionEnd({currentTarget:{value:'asset'}});ui.render();ui.fire();await tick();
  assert.equal(ui.calls.filter(c=>c.command==='search_all').length,2);
});

test('keyword length counts Unicode characters and pasted input is never truncated',async()=>{
  const ui=runtime('',async()=>({total:0,items:[],type_counts:[]}));
  const input=ui.render().find(n=>n.type==='input');assert.equal(input.props.maxLength,undefined);
  input.props.onChange({target:{value:'😀'.repeat(200)}});ui.render();ui.fire();await tick();
  assert.equal(ui.calls.length,1);
  const long='😀'.repeat(201);
  ui.render().find(n=>n.type==='input').props.onChange({target:{value:long}});ui.render();ui.fire();await tick();
  assert.equal(ui.session.keyword,long);assert.equal(ui.calls.length,1);
  assert.ok(ui.render().some(n=>n.props.role==='alert'));
});

test('scroll position persists in the lifted session and resets on a new query',async()=>{
  const ui=await loaded(async()=>result);
  ui.render().find(n=>n.type==='ul').props.onScroll({currentTarget:{scrollTop:175}});
  assert.equal(ui.session.scrollTop,175);
  const reopened=runtime('asset',async()=>result);reopened.change(ui.session);reopened.render();reopened.fire();await tick();
  assert.equal(reopened.render().find(n=>n.type==='ul').props.ref.current.scrollTop,175);
  ui.render().find(n=>n.type==='input').props.onChange({target:{value:'new'}});
  assert.equal(ui.session.scrollTop,0);
});

const recurringSource=ts.createSourceFile('RecurringPage.tsx',readFileSync(root+'/src/RecurringPage.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let resolveSource;
function discover(node){if(ts.isCallExpression(node)&&node.expression.getText(recurringSource)==='useSource')resolveSource=node.arguments[2];ts.forEachChild(node,discover);}
discover(recurringSource);
const recurringScript=ts.transpileModule('module.exports='+resolveSource.getText(recurringSource),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
test('skipped payment resolves by exact stable ID to its recorded period',async()=>{
  const payment={id:'fictional-payment',plan_id:'fictional-plan',due_date:'2026-09-01',state:'skipped'};
  let paying;
  const context={module:{exports:{}},pending:null,busy:false,data:{generation:'fictional-generation'},
    invoke:async()=>({generation:'fictional-generation',payments:[payment],plans:[{id:'fictional-plan',fields:{name:'fictional plan',amount_cents:'2500'}}]}),
    setData(){},setTab(){},setEditing(){},setPaying:v=>{paying=v;}};
  vm.runInNewContext(recurringScript,context);
  assert.equal(await context.module.exports({kind:'payment',id:payment.id,plan_id:payment.plan_id},()=>true),true);
  assert.equal(paying.record.state,'skipped');assert.equal(paying.due_date,'2026-09-01');
  paying=undefined;
  assert.equal(await context.module.exports({kind:'payment',id:payment.id,plan_id:'wrong-parent'},()=>true),false);
  assert.equal(paying,undefined);
});

test('new read revision resets the visible page to the returned first page',async()=>{
  const ui=runtime('asset',async()=>({...result,revision:'new-revision',offset:0}));
  ui.change({offset:30,revision:'old-revision',scrollTop:200});
  ui.render();ui.fire();await tick();
  assert.equal(ui.calls[0].args.input.revision,'old-revision');
  assert.equal(ui.session.offset,0);assert.equal(ui.session.scrollTop,0);
  assert.equal(ui.session.revision,'new-revision');
});
