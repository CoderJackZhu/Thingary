import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as annotations from '../src/plan-annotations.ts';
import * as actions from '../src/plan-occurrence-actions.ts';
import * as flow from '../src/planning-first-run.ts';
import * as defaults from '../src/planning-basic-defaults.ts';
import * as debt from '../src/plan-debt.ts';
import { buildBasicCapabilities, prepareBasicPlan } from '../src/plan-basic.ts';
import { overlayPlanningDrafts } from '../src/planning-draft.ts';
import { debtFixture } from '../src/planning-debt-fixture.ts';
import { savingsOf, startPaymentsOf, nominalFactor, project } from '../src/plan-ledger.ts';
const ts = createRequire(import.meta.url)('typescript');
const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json',import.meta.url),'utf8'));
const today=raw.today, unknownCapabilityFixture=buildBasicCapabilities(raw);
const fixture = (scenario='normal') => debtFixture(raw,scenario);
const core = s => s.profile.value.saved.profile.retire.core;
const saved = s => s.profile.value.saved;
const rows = s => debt.debtReview(s.snapshot.value, core(s), saved(s).profile.retire.life_events).rows;
const cards = s => flow.refinementCards(saved(s),buildBasicCapabilities(s),s.today);
const plan = s => {const p=prepareBasicPlan(s);assert.equal(p.plan.status,'ready');return p.plan.value.compile(100000);};
const record=(s,id,mode='scheduled')=>({account_id:id,recorded_on:s.today,as_of:s.snapshot.value.date,balance_cents:rows(s).find(r=>r.entry.account_id===id).entry.amount_cents,start_month:debt.debtFirstMonth(s.snapshot.value.date),last_month:'2028-10',monthly_cents:'200000',before:mode,after:mode});
const update = (s,updates,remove=[]) => overlayPlanningDrafts(s,[{section:'debt_repayments',fields:{updates,remove}}]);
function runtime(file, props, save = async () => ({ revision: 5 }), caps = unknownCapabilityFixture) {
  const slots = new Map(), calls = [], closes = [];
  let path = 'root', cursor = 0;
  let effects = [], dirty = false;
  const focuses = [];
  const hooks = {
    useState(initial) {
      const key = `${path}:${cursor++}`;
      if (!slots.has(key)) slots.set(key, typeof initial === 'function' ? initial() : initial);
      return [slots.get(key), next => { slots.set(key, typeof next === 'function' ? next(slots.get(key)) : next); dirty = true; }];
    },
    useRef(initial) { const key = `${path}:${cursor++}`; if (!slots.has(key)) slots.set(key, { current: initial }); return slots.get(key); },
    useEffect(fn, deps) { const key = `${path}:${cursor++}`, prev = slots.get(key); if (!prev || deps.some((v, i) => !Object.is(v, prev[i]))) { slots.set(key, deps); effects.push(fn); } }, useMemo: fn => fn(),
  };
  const saver = { busy: false, stuck: false, notice: '', async save(input) {
    calls.push(structuredClone(input));
    try { return await save(input); } catch (e) { saver.notice = e.message; return null; }
  } };
  const leaf = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    './plan-debt': debt, './plan-annotations': annotations, './plan-occurrence-actions': actions, './wealth': { kindLabel: v => v }, './asset': { money: c => `¥${c}` }, './review': { ready: r => r?.status === 'ready' ? r.value : null },
    './planning-first-run': flow, './planning-basic-defaults': defaults,
    './planning-basic-data': { useSectionSaver: () => saver, useCapabilities: () => ({ status: 'ready', caps: typeof caps === 'function' ? caps() : caps }) },
    './planning-basic-view': { needsContribution: () => true, requirementLine: () => ({ text: '每月 ¥4700', tone: '' }), SAVE_CONTRIBUTION_HINT: '待估计' },
    './plan-retire-calc': { buildRetireCalc: () => null },
  };
  const module = { exports: {} };
  const script = ts.transpileModule(readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(script, { module, exports: module.exports, require: id => modules[id] ?? leaf, crypto: globalThis.crypto, structuredClone, Error, console, document: {getElementById:()=>({isConnected:true,focus(){}})}, requestAnimationFrame: fn=>fn() });
  const component = module.exports[file === 'CoverageNote' ? 'CoverageNote' : file === 'PlanningDebtDialog' ? 'PlanningDebtDialog' : file === 'PlanningSetup' ? 'PlanningSetupDialog' : file === 'PlanningOccurrenceDialog' ? 'PlanningOccurrenceDialog' : 'PlanningBasicGoals'];
  const finalProps = { today, snapshot: null, accounts: [], reload() {}, onPending() {}, onPension() {}, onEditingChange() {}, onFocusDone() {}, onClose: v => closes.push(v), ...props };
  let tree;
  function expand(node, key) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n, i) => expand(n, `${key}:${i}`));
    if (typeof node.type === 'function') { path = key; cursor = 0; return expand(node.type(node.props), `${key}:child`); }
    return { ...node, props: { ...node.props, children: expand(node.props?.children, `${key}:children`) } };
  }
  function render() {
    for (let round = 0; round < 5; round++) {
      dirty = false; effects = []; path = 'root'; cursor = 0; tree = expand(component(finalProps), 'tree');
      for (const n of nodes()) if (n.props?.ref) n.props.ref.current = {
        showModal() {}, close() {}, focus: () => focuses.push(n.props['aria-label'] ?? n.props.id),
        querySelector(selector) {
          if (selector === '.planning-setup-body') return { scrollTo() {} };
          const label = selector.match(/aria-label="(.*)"/)?.[1];
          return nodes().some(x => x.props?.['aria-label'] === label || x.props?.label === label) ? { focus: () => focuses.push(label) } : null;
        },
      };
      effects.forEach(fn => fn()); if (!dirty) break;
    }
    return tree;
  }
  const nodes = () => { const out = []; const visit = n => { if (Array.isArray(n)) n.forEach(visit); else if (n && typeof n === 'object') { out.push(n); visit(n.props?.children); } }; visit(tree); return out; };
  const text = n => Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.props?.children) : n == null || n === false ? '' : String(n);
  const find = (type, predicate = () => true) => nodes().find(n => n.type === type && predicate(n.props, n));
  const button = label => nodes().find(n => (n.type === 'button' || n.type === 'CloseButton') && (n.props['aria-label'] === label || text(n) === label));
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { render, nodes, text, find, button, calls, closes, saver, settle, focuses, props: finalProps };
}

const event = () => ({preventDefault(){}});
const choose=(r,name,mode)=>{r.find('input',p=>p['aria-label']===`${name}：${mode}`).props.onChange();r.render();};
const submit=async r=>{r.find('form').props.onSubmit(event());await r.settle();};
function dialog(s,save){return runtime('PlanningDebtDialog',{sources:s,saved:saved(s),snapshot:s.snapshot.value,accounts:s.accounts.value,today:s.today},save);}

test('loan card opens the direct editor; production partial save reduces pending count and recomputes real summary',async()=>{
 let s=fixture();const before=buildBasicCapabilities(s),card=cards(s).find(c=>c.id==='debt-review');assert.equal(card.action,'debts');
 const goals=runtime('PlanningBasicGoals',{sources:s,saved:saved(s),snapshot:s.snapshot.value,accounts:s.accounts.value,onGoto(){throw Error('must not navigate');}},undefined,()=>buildBasicCapabilities(s));
 goals.find('PlanningRefinements',p=>p.cards.some(c=>c.id==='debt-review')).props.onAction(card,{isConnected:true,focus(){}});goals.render();assert.ok(goals.find('PlanningDebtDialog'));
 const note=runtime('PlanningBasicGoals',{sources:s,onGoto(){throw Error('loan note must not navigate');}},undefined,()=>buildBasicCapabilities(s));note.find('CoverageNote').props.onRefine(before.annotations.find(a=>a.reason_code==='DEBT_UNLINKED'));note.render();assert.ok(note.find('PlanningDebtDialog'));
 const r=dialog(s,async input=>{s=update(s,input.fields.updates,input.fields.remove);return saved(s);});
 choose(r,'虚构信用卡','每月还一笔固定金额，单独算上');r.find('CentInput',p=>p.label==='虚构信用卡每月还款').props.onChange('200000');r.render();
 r.find('MonthInput',p=>p.label==='虚构信用卡最后一期').props.onChange('2028-10');r.render();await submit(r);
 assert.equal(r.calls.length,1);assert.equal(core(s).debt_repayments.length,1);assert.equal(rows(s).filter(r=>r.pending.length).length,1);
 const after=buildBasicCapabilities(s);assert.equal(annotations.actionableAnnotations(after.annotations).length,1);assert.notEqual(after.requirement.value.set.monthly_cents,before.requirement.value.set.monthly_cents);assert.equal(cards(s).find(c=>c.id==='debt-review').action,'debts');
 const rest=dialog(s,async input=>{s=update(s,input.fields.updates);return saved(s);});choose(rest,'虚构房贷','这笔还款已经含在我的每月开销里');await submit(rest);assert.ok(!cards(s).some(c=>c.id==='debt-review'));assert.equal(annotations.actionableAnnotations(buildBasicCapabilities(s).annotations).length,0);
});

test('three treatments use actual monthly cash once; balance never deducted again; ignored remains explanation only',()=>{
 const s=fixture(),id=rows(s)[0].entry.account_id,baseline=plan(s);
 for(const mode of ['scheduled','included','excluded']){
  const next=update(s,[record(s,id,mode),record(s,rows(s)[1].entry.account_id,'included')]),p=plan(next);
  assert.equal(p.assets_cents,baseline.assets_cents);assert.deepEqual(p.spends,baseline.spends);assert.ok(!cards(next).some(c=>c.id==='debt-review'));
  const a=savingsOf(p),b=savingsOf(baseline),due=startPaymentsOf(p);assert.equal(due[0],0);
  for(let t=1;t<=24;t++){const x=mode==='scheduled'?200000/nominalFactor(p,p.now_months+t):0;assert.ok(Math.abs((b[t]-a[t])-x)<1e-7);assert.ok(Math.abs(due[t]-x)<1e-7);}
  assert.equal(due[25],0);
  if(mode==='excluded'){const note=buildBasicCapabilities(next).annotations.find(a=>a.reason_code==='DEBT_EXCLUDED');assert.equal(note.actionable,false);assert.match(note.message,/可能偏低/);}
 }
 // A zero return/inflation ledger independently equals the monthly payment times 24, not twice.
 const zero=fixture();saved(zero).profile.assumptions.inflation_hundredths=0;saved(zero).profile.retire.real_return_before_hundredths=0;
 const a=plan(zero),b=plan(update(zero,[record(zero,id)]));let total=0;for(let t=0;t<25;t++)total+=savingsOf(a)[t]-savingsOf(b)[t];assert.equal(total,200000*24);
 const pa=project(a,2026),pb=project(b,2026);assert.ok(pa.rows.length&&pb.rows.length);
});

test('unknown payment remains null, save remains pending; cancel/escape have no draft or request',async()=>{
 let s=fixture();const r=dialog(s,async input=>{s=update(s,input.fields.updates);return saved(s);});choose(r,'虚构信用卡','每月还一笔固定金额，单独算上');await submit(r);
 assert.equal(core(s).debt_repayments[0].monthly_cents,null);assert.equal(core(s).debt_repayments[0].last_month,null);assert.equal(rows(s).filter(r=>r.pending.length).length,2);assert.ok(!plan(s).saving_flows.some(f=>f.source_id?.startsWith('debt:')));
 for(const exit of ['cancel','escape']){const d=dialog(fixture());choose(d,'虚构信用卡','这次先不考虑');if(exit==='cancel')d.button('取消').props.onClick();else d.find('dialog').props.onCancel(event());assert.equal(d.calls.length,0);assert.equal(dialog(fixture()).find('input',p=>p['aria-label']==='虚构信用卡：这次先不考虑').props.checked,false);}
});

test('default included covers both phases; advanced single phase stays pending only in an applicable phase',async()=>{
 let s=fixture();const r=dialog(s,async input=>{s=update(s,input.fields.updates);return saved(s);});choose(r,'虚构信用卡','这笔还款已经含在我的每月开销里');r.find('select',p=>p['aria-label']==='虚构信用卡退休后').props.onChange({target:{value:''}});r.render();await submit(r);
 assert.equal(core(s).debt_repayments[0].before,'included');assert.equal(core(s).debt_repayments[0].after,null);assert.deepEqual(rows(s)[0].pending,['退休后']);
 const c=record(s,rows(s)[0].entry.account_id);c.after=null;const endedBeforeRetirement=update(s,[c]);assert.equal(buildBasicCapabilities(endedBeforeRetirement).annotations.some(a=>a.id===`debt:${c.account_id}`),false);
 // A schedule spanning retirement uses pre/post independent signs but pays once per phase.
 saved(s).profile.retire.target_age=37;const next=update(s,[record(s,c.account_id)]),p=plan(next);assert.equal(p.saving_flows.filter(f=>f.source_id===`debt:${c.account_id}`).length,1);assert.equal(p.spend_flows.filter(f=>f.source_id===`debt:${c.account_id}`).length,1);
});

test('balance-review card closes on reconfirmation; dates fixed across snapshots, zero stops; hidden/unincluded debt inactive',async()=>{
 let s=fixture('changed');assert.ok(cards(s).some(c=>c.id==='debt-balance'));const id=core(s).debt_repayments[0].account_id,start=core(s).debt_repayments[0].start_month;const r=dialog(s,async input=>{s=update(s,input.fields.updates);return saved(s);});r.button('确认这份安排仍适用').props.onClick();r.render();await submit(r);assert.ok(!cards(s).some(c=>c.id==='debt-balance'));assert.equal(core(s).debt_repayments.find(d=>d.account_id===id).start_month,start);assert.equal(core(s).debt_repayments.find(d=>d.account_id===id).recorded_on,today);
 const z=fixture('zero'),p=plan(z);assert.ok(!p.saving_flows.some(f=>f.source_id===`debt:${core(z).debt_repayments[0].account_id}`));assert.match(dialog(z).text(dialog(z).find('dialog')),/归零/);
 const e=fixture('empty');assert.equal(rows(e).length,0);assert.ok(!plan(e).saving_flows.some(f=>f.source_id?.startsWith('debt:')));
 assert.equal(debt.debtBalanceChanged(record(fixture(),rows(fixture())[0].entry.account_id),'499999'),false);
});

test('save failures preserve controls, unresolved receipt locks mutation; invalid months/amounts/remove rejected',async()=>{
 const r=dialog(fixture(),async()=>{throw Error('虚构保存失败');});choose(r,'虚构信用卡','这次先不考虑');await submit(r);assert.deepEqual(r.closes,[]);assert.match(r.text(r.find('dialog')),/虚构保存失败/);assert.equal(r.find('input',p=>p['aria-label']==='虚构信用卡：这次先不考虑').props.checked,true);
 r.saver.stuck=true;r.render();assert.equal(r.button('保存，查看结果').props.disabled,true);
 const s=fixture(),d=record(s,rows(s)[0].entry.account_id);for(const patch of [{monthly_cents:'-1'},{as_of:'2026-02-30'},{last_month:'2026-10'},{last_month:'2066-11'},{before:'bogus'},{monthly_cents:'01'}])assert.throws(()=>debt.validateDebtRepayment({...d,...patch}));assert.throws(()=>update(s,[d,d]));assert.throws(()=>update(s,[d],[d.account_id]));assert.throws(()=>update(s,[],[d.account_id,d.account_id]));
});

test('occurred loan has precedence over an independent arrangement, without losing incomplete occurrence warnings',()=>{
 const s=fixture(),r=saved(s).profile.retire,id=rows(s)[0].entry.account_id;
 r.life_events=[{id:'existing-car',label:'虚构原购车',kind:'other',date:'2026-01',included:false,price_cents:'1500000',down_cents:'1000000',extra_cents:'0',loan_rate_hundredths:0,loan_years:1,holding_cents:'0',rent_saved_cents:'0',cycle_years:null,until_age:null,resale_cents:'0'}];
 r.core.occurrences=[{id:'occurred-car',event_id:'existing-car',status:'occurred',actual_date:'2026-01-01',payments_complete:true,payments:[],loan:{account_id:id,as_of:s.snapshot.value.date,principal_cents:rows(s)[0].entry.amount_cents,remaining_months:12}}];
 r.basic.contribution_costs=[{source_id:'event:existing-car:loan',treatment:'extra',reference_cents:null}];r.basic.retirement_costs=structuredClone(r.basic.contribution_costs);
 const before=buildBasicCapabilities(s),p=plan(s),next=update(s,[record(s,id)]),q=plan(next);assert.deepEqual(buildBasicCapabilities(next).requirement,before.requirement);assert.deepEqual(savingsOf(q),savingsOf(p));assert.equal(q.loans.length,1);assert.ok(!q.saving_flows.some(f=>f.source_id===`debt:${id}`));assert.equal(rows(next)[0].pending.length,0);
 core(next).occurrences[0].loan.as_of='2026-09-10';assert.ok(buildBasicCapabilities(next).annotations.some(a=>a.refinement.event_id==='existing-car'));assert.ok(!plan(next).saving_flows.some(f=>f.source_id===`debt:${id}`));
 const paused=fixture('saved');paused.modules.wealth=false;assert.equal(prepareBasicPlan(paused).plan.status,'blocked');assert.ok(!buildBasicCapabilities(paused).annotations.some(a=>a.source_ids[0]?.startsWith('debt:')));
});

test('illegal persisted loan assumptions block calculation; unknown valid values remain readable and pension facts preserved',()=>{
 const original=fixture(),s=update(original,[record(original,rows(original)[0].entry.account_id)]);
 const {retire:beforeRetire,...beforeFacts}=saved(original).profile,{retire:afterRetire,...afterFacts}=saved(s).profile;assert.deepEqual(afterFacts,beforeFacts);assert.deepEqual(afterRetire.basic,beforeRetire.basic);
 const invalid=structuredClone(s);core(invalid).debt_repayments[0].monthly_cents='-1';const c=buildBasicCapabilities(invalid);assert.equal(c.requirement.status,'blocked');assert.ok(c.requirement.missing.some(m=>m.code==='INPUT_INVALID'));
 const duplicate=structuredClone(s);core(duplicate).debt_repayments.push(structuredClone(core(duplicate).debt_repayments[0]));assert.equal(buildBasicCapabilities(duplicate).requirement.status,'blocked');assert.equal(buildBasicCapabilities(fixture('unknown')).requirement.status,'ready');
});

test('ignored loans keep an explanation across compact consumers without a pending label or refine button',()=>{
 const s=fixture(),next=update(s,rows(s).map(r=>record(s,r.entry.account_id,'excluded'))),a=buildBasicCapabilities(next).annotations;
 const compact=runtime('CoverageNote',{annotations:a,compact:true});assert.match(compact.text(compact.render()),/未计入安排的说明/);assert.doesNotMatch(compact.text(compact.render()),/待核对/);
 const full=runtime('CoverageNote',{annotations:a,onRefine(){throw Error('ignored loans cannot prompt action');}});assert.equal(full.nodes().filter(n=>n.type==='button').length,0);assert.match(full.text(full.render()),/可能偏低/);
});


test('loan copy names one or several accounts naturally, limits long lists, and labels saved phases without repetition',()=>{
 const s=fixture(),caps=buildBasicCapabilities(s),ids=rows(s).map(r=>`debt:${r.entry.account_id}`);
 const labels={[ids[0]]:{name:'虚构信用卡',balance:'¥5,000'},[ids[1]]:{name:'虚构房贷',balance:'¥500,000'}};
 const benefit=c=>flow.refinementCards(saved(s),c,s.today,labels).find(c=>c.id==='debt-review').benefit;
 assert.equal(benefit(caps),'你有 2 笔贷款：虚构信用卡 ¥5,000、虚构房贷 ¥500,000。还没告诉我以后每月怎么还，所以这部分还款没算进去。填写后会算入还款，或按你的选择停止提醒。');
 const partial=update(s,[record(s,rows(s)[0].entry.account_id,'included')]);
 assert.match(benefit(buildBasicCapabilities(partial)),/^你有一笔贷款：虚构房贷 ¥500,000。/);
 const pending=caps.annotations.filter(a=>a.reason_code==='DEBT_UNLINKED');
 const many={...caps,annotations:[...pending,...[3,4,5].map(n=>({...pending[0],id:`extra-${n}`,source_ids:[`extra-${n}`]}))]};
 for(const n of [3,4,5])labels[`extra-${n}`]={name:`虚构贷款${n}`,balance:`¥${n},000`};
 const text=benefit(many);assert.match(text,/虚构信用卡 ¥5,000、虚构房贷 ¥500,000、虚构贷款3 ¥3,000等 5 笔/);assert.doesNotMatch(text,/虚构贷款4|虚构贷款5|退休前、退休后还款未计入/);
 const titles=d=>{const r=dialog(d);return r.nodes().filter(n=>n.type==='p').map(n=>r.text(n)).filter(t=>t.startsWith('按你 '));};
 for(const mode of ['scheduled','included','excluded']){
  const d=record(s,rows(s)[0].entry.account_id,mode);assert.deepEqual(titles(update(s,[d])),[`按你 2026-10 填写的安排 · ${debt.debtTreatmentLabel(mode)}`]);
 }
 const split=record(s,rows(s)[0].entry.account_id);split.after='included';
 assert.deepEqual(titles(update(s,[split])),['按你 2026-10 填写的安排 · 退休前：每月还款；退休后：已含在每月开销里']);
 split.after=null;assert.deepEqual(titles(update(s,[split])),['按你 2026-10 填写的安排 · 退休前：每月还款；退休后：尚未处理']);
});
