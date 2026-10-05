import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('WishEditor.tsx', readFileSync(new URL('../src/WishEditor.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'WishlistEditor');
const code = ts.transpileModule(`${fn.getText(source)}\nmodule.exports = WishlistEditor;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tick = () => new Promise(setImmediate);
function runtime({item, panelInitial, read = async () => null, load = async () => ({items:[],nextOffset:null})} = {}) {
  const states = [], refs = [], effects = [], calls = []; let si, ri, ei, request;
  const context = { module:{exports:{}}, exports:{}, require,
    useState(initial) {const i=si++; if(!(i in states)) states[i]=initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}];},
    useRef(initial) {const i=ri++; return refs[i]??(refs[i]={current:initial});},
    useEffect(fn,deps) {const i=ei++; const old=effects[i]; if(!old||deps.some((v,j)=>v!==old.deps[j])) effects[i]={fn,deps,dirty:true,cleanup:old?.cleanup};},
    localDay:()=> '2026-10-05', defaultWishPreferences:()=>({}), persistSubmission(){},wishlistDraftKey:'test',
    crypto:{randomUUID:()=> 'test-request'},localStorage:{removeItem(){}},validateWishlist:()=>({}),inputMoney:()=>null,
    invoke:async(command,args)=>{if(command==='read_asset')return read(args.id);if(command==='save_wish_plan'){request=args.input;return {id:'saved'};}throw new Error(command);},
    loadAssetCandidates:async(...args)=>{calls.push(args);return load(...args);}, assetStateLabel:v=>v,errorMessage:String,
    CloseButton(){}, DefaultAssetIcon(){}, PhotoView(){}, FormRow(){}, Switch(){}, ChoiceField(){}, AddImageButton(){}, DateInput(){}, ReminderPermissionHelp(){}, DeleteButton(){},IconPicker(){},
  };
  const initial={generation:'test-generation',item,fields:{name:'Fictional wish',estimated_price:'',external_link:'',notes:'',target_date:''},cover:null,photos:[],preferences:{},pending:null};
  if(panelInitial)Object.assign(initial,panelInitial);
  vm.runInNewContext(code,context);
  const nodes = tree=>{const result=[];function walk(e){if(!e||typeof e!=='object')return;if(Array.isArray(e)){e.forEach(walk);return;}if(e.props){result.push(e);walk(e.props.children)}}walk(tree);return result;};
  function render(){si=ri=ei=0;const tree=context.module.exports({initial,closeIntent:null,onKeep(){},onClose(){},onSaved(){}});for(const e of effects){if(e.dirty){e.dirty=false;e.cleanup?.();e.cleanup=e.fn();}}return nodes(tree);}
  const button=text=>render().find(n=>n.type==='button'&&n.props.children===text);
  const search=()=>render().find(n=>n.type==='input'&&n.props['aria-label']==='搜索物品');
  return {render,button,search,calls,async open(){button('选择物品…').props.onClick();render();await tick();render();},async save(){render().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await tick();return request;}};
}
const candidate=id=>({id,name:`虚构${id}`,purchase_date:null,state:'active',revision:1});
test('clearing an existing replacement sends null and explicit removal', async()=>{
  const ui=runtime({item:{id:'wish',revision:1,replacement_asset:{id:'old',name:'旧物'},replacement_asset_name:''}});
  ui.button('清除').props.onClick();
  const request=await ui.save();
  assert.equal(request.replacement_asset_id,null);
  assert.equal(request.clear_replacement,true);
});
test('purged replacement history is visible and can be explicitly cleared',async()=>{
  const ui=runtime({item:{id:'wish',revision:1,replacement_asset:null,replacement_asset_name:'旧物'}});
  assert.ok(ui.button('清除'));
  ui.button('清除').props.onClick();
  assert.equal((await ui.save()).clear_replacement,true);
});
test('search fetches first page for every query, including after an empty result',async()=>{
  const ui=runtime({load:async(_,query)=>({items:query?[candidate(query)]:[],nextOffset:null})});
  await ui.open();
  ui.search().props.onChange({target:{value:'远处'}});ui.render();await tick();
  assert.equal(ui.calls.at(-1)[1],'远处');
  assert.ok(JSON.stringify(ui.render()).includes('虚构远处'));
});
test('search and pagination discard older responses after query or close',async()=>{
  const pending=[];
  const ui=runtime({load:(...args)=>new Promise(resolve=>pending.push({args,resolve}))});
  await ui.open();
  ui.search().props.onChange({target:{value:'新'}});ui.render();
  assert.equal(pending.length,2);
  pending[1].resolve({items:[candidate('new')],nextOffset:100});await tick();ui.render();
  pending[0].resolve({items:[candidate('old')],nextOffset:100});await tick();
  assert.ok(!JSON.stringify(ui.render()).includes('虚构old'));
  ui.button('加载更多').props.onClick();
  ui.button('收起').props.onClick();ui.render();
  pending[2].resolve({items:[candidate('late')],nextOffset:null});await tick();
  await ui.open();pending[3].resolve({items:[candidate('fresh')],nextOffset:null});await tick();
  assert.ok(!JSON.stringify(ui.render()).includes('虚构late'));
});
test('search failure offers an enabled retry and an empty result is explicit',async()=>{
  let fail=true;
  const ui=runtime({load:async()=>{if(fail)throw new Error('read failed');return {items:[],nextOffset:null}}});
  await ui.open();
  const retry=ui.button('重试');assert.ok(retry);assert.equal(retry.props.disabled,false);
  fail=false;retry.props.onClick();ui.render();await tick();
  assert.ok(JSON.stringify(ui.render()).includes('没有匹配的物品'));
});

test('replacement read errors are visible and retry reads the same stable ID',async()=>{
  let fail=true, calls=[];
  const ui=runtime({item:{id:'wish',revision:1,replacement_asset:{id:'old',name:'旧物'},replacement_asset_name:''},read:async id=>{calls.push(id);if(fail)throw new Error('read failed');return {asset:{id,name:'旧物',purchase_date:null},lifecycle:{state:'retired'}}}});
  ui.render();await tick();
  assert.ok(JSON.stringify(ui.render()).includes('read failed'));
  fail=false;ui.button('重新读取物品').props.onClick();ui.render();await tick();
  assert.deepEqual(calls,['old','old']);
  assert.ok(!JSON.stringify(ui.render()).includes('read failed'));
});

test('detail read failure is explicit and replaced relation discards the old response',async()=>{
  const src=ts.createSourceFile('WishDetail.tsx',readFileSync(new URL('../src/WishDetail.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const detail=src.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='WishDetail');
  const effect=detail.body.statements.find(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(src)==='useEffect'&&n.expression.arguments[0].getText(src).includes('setReplacementRecord'));
  const script=ts.transpileModule(`module.exports=${effect.expression.arguments[0].getText(src)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const pending=[];let error,record;
  const context={module:{exports:{}},item:{replacement_asset:{id:'old'}},invoke:(_,args)=>new Promise((resolve,reject)=>pending.push({args,resolve,reject})),setReplacementRecord:r=>{record=r},setReplacementError:e=>{error=e},errorMessage:String};
  vm.runInNewContext(script,context);
  const cleanup=context.module.exports();pending[0].reject(new Error('failed'));await tick();assert.match(error,/failed/);
  cleanup();context.item.replacement_asset.id='new';const next=context.module.exports();
  assert.equal(error,'');assert.equal(record,null);
  pending[1].resolve({asset:{id:'new'}});await tick();assert.equal(record.asset.id,'new');
  next();const cancel=context.module.exports();cancel();pending[2].reject(new Error('late'));await tick();assert.equal(error,'');
});

// Exercise the actual panel -> editor handoff; an absent target is not a user
// removal and must not submit clear_replacement or hide purge history.
test('ordinary edit from the real panel preserves purged replacement history',async()=>{
  const panelSource=ts.createSourceFile('WishlistPanel.tsx',readFileSync(new URL('../src/WishlistPanel.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let edit;function find(n){if(ts.isJsxAttribute(n)&&n.name.text==='onEdit')edit=n.initializer.expression;ts.forEachChild(n,find);}find(panelSource);
  assert.ok(edit);
  const script=ts.transpileModule(`module.exports=${edit.getText(panelSource)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  let panelInitial;const context={module:{exports:{}},page:{generation:'test-generation'},defaultWishPreferences:()=>({}),persistSubmission(){},wishlistDraftKey:'test',setDetail(){},setEditor:d=>{panelInitial=d;}};
  vm.runInNewContext(script,context);
  const item={id:'wish',revision:2,replacement_asset:null,replacement_asset_name:'虚构失效旧物',fields:{name:'Fictional wish',estimated_price_cents:null,target_date:null,external_link:'',notes:'原理由'},cover:null};
  context.module.exports(item);
  assert.equal(panelInitial.replacementAssetId,undefined);
  const ui=runtime({item,panelInitial});
  assert.ok(ui.button('清除'),'purge history remains visible on entry');
  const textarea=ui.render().find(n=>n.type==='textarea');textarea.props.onChange({target:{value:'仅更正理由'}});
  const request=await ui.save();
  assert.equal(request.fields.notes,'仅更正理由');
  assert.equal(request.replacement_asset_id,null);
  assert.notEqual(request.clear_replacement,true,'ordinary save preserves history');
  const removal=runtime({item,panelInitial});
  removal.button('清除').props.onClick();
  assert.equal((await removal.save()).clear_replacement,true,'explicit removal still clears history');
});
