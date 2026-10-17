import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnualReview as buildReview, annualCopyText, annualTrendSegments } from '../src/annual-review.ts';
import * as annual from '../src/annual-review.ts';
import { money } from '../src/asset.ts';
import * as periodControl from '../src/finance-period-control.ts';
import { normalizeFinancePeriod } from '../src/finance-contract.ts';
const buildAnnualReview = (s, y, today) => buildReview(s, typeof y === 'number' ? {kind:'year',year:y} : y, today);
import { runtime } from './planning-component-runtime.mjs';
const ready = value => ({ status: 'ready', value });
const disabled = { status: 'disabled', reason: '关闭来源' };
const modules = { wishlist:true,timeline:true,stats:true,wealth:true,expenses:true,recurring:true,virtual:true,planning:true,incomes:true,movements:true,finance_status:'ready',finance_revision:1 };
const point = (id, date, net = '10000', over = {}) => ({ snapshot_id:id,date,notes:'绝密盘点备注',assets_cents:net,liabilities_cents:'0',net_cents:net,complete:true,missing:0,compared_to:null,scope_changed:false,change_cents:null,hpf_change_cents:null,market_change_cents:null,change_rate_hundredths:null,...over });
const base = point('b','2025-12-31');
const end = point('e','2026-09-30','25000',{compared_to:base.date,change_cents:'15000'});
const planning = (id, date, over = {}) => ({ snapshot_id:id,date,recorded_on:'2026-10-01',point:{mode:'fire',target_month:'2045-08',available_cents:'98543210',required_monthly_cents:'876543',entered_monthly_cents:'100000',success:true,shortfall_at_goal_cents:null,predicted_retire_month:'2044-03',has_open_items:false,...over} });
const observation = (over={}) => ({account_id:'a',name:'绝密账户',kind:'cash',status:'known',amount_cents:'25000',reason:'绝密来源理由',...over});
const history = (date,over={}) => ({basis:{snapshot_id:date,date,revision:1},observations:[observation(over)]});
const goal = (over={}) => ({goal:{id:'goal-id',fields:{name:'绝密首付目标',target_cents:'50000',target_date:'2027-10-01',notes:'绝密目标备注'},account_ids:['a'],position:0,revision:1,created_on:'2025-01-01',created_at:'2025-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',deleted_at:null,...over},observations:[observation()],shared_account_ids:['a'],planning_overlap:true,history:[history('2025-12-31'),history('2026-09-30')]});
function sources(selection=2026) {
  const year=typeof selection==='number'?selection:Number(selection.to.slice(0,4));
  const period=typeof selection==='number'?{kind:'year',year}:selection;
  return {generation:'g',write_version:7,today:'2026-10-15',period,modules,record_years:ready([2026,2025,2010]),
    wealth:ready({generation:'g',points:[base,end],structure:[],liabilities:[],structure_date:end.date}),accounts:ready([]),
    incomes:ready([{id:'i',fields:{date:`${year}-05-01`,net_cents:'12345678',hpf_cents:null,notes:'绝密收入备注'},revision:1}]),
    expenses:ready({generation:'g',period,year,years:[year],lines:[{source:'expense',id:'x',date:`${year}-06-01`,title:'绝密支出',amount_cents:'2345678'}, {source:'refund',id:'r',date:`${year}-08-01`,title:'绝密退款',amount_cents:'345678'}],undated:[{title:'绝密无日期支出'}],months:[],annual_totals:[],spent_cents:'2345678',refund_cents:'345678',net_cents:'2000000',sale_cents:'0',undated_cents:'123',unknown_amount_count:0}),
    asset_review:disabled,history:disabled,
    annual:{year,range:normalizeFinancePeriod(period),years:ready([2026,2025,2010]),scope_changed:false,comparison:ready({from:{snapshot_id:base.snapshot_id,date:base.date,complete:true},to:{snapshot_id:end.snapshot_id,date:end.date,complete:true},reconciled:true,net_change_cents:'15000'}),savings:ready({generation:'g',write_version:7,today:'2026-10-15',year,years:[2025,2026],basis:history(end.date).basis,newer_incomplete:false,accounts:[],goals:[goal()]}),planning:ready([planning('p1','2026-01-31'),planning('p2','2026-09-30')])}};
}
test('a prior-year endpoint plus one current-year point is a real comparison, never a full-year claim',()=>{
  const m=buildAnnualReview(sources(),2026,'2026-10-15');
  assert.equal(m.net.completeCount,1);assert.equal(m.net.from.date,'2025-12-31');assert.equal(m.net.delta_cents,'15000');assert.equal(m.net.label,'自本区间首次盘点以来 8 个月变化');
  const s=sources();s.wealth.value.points=[point('old','2023-08-01'),end];s.annual.comparison.value.from.snapshot_id='old';
  const old=buildAnnualReview(s,2026,s.today);assert.equal(old.net.from.date,'2023-08-01');assert.doesNotMatch(old.net.note,/未覆盖完整自然年|不能作为/);
});
test('no complete snapshots still allows income, recorded zero, refunds and income-only years',()=>{
  const s=sources();s.wealth.value.points=[point('unknown','2026-09-30','0',{complete:false})];s.annual.comparison=ready(null);s.incomes.value[0].fields.net_cents='0';
  const m=buildAnnualReview(s,2026,s.today);assert.equal(m.net.status,'empty');assert.equal(m.net.incompleteCount,1);assert.equal(m.income.cents,'0');assert.equal(m.income.hpf_known_cents,null);assert.equal(m.income.hpf_unknown_count,1);assert.equal(m.expenses.cents,'2345678');assert.equal(m.expenses.refund_cents,'345678');assert.ok(m.years.includes(2010));
  s.incomes=ready([]);assert.equal(buildAnnualReview(s,2026,s.today).income.cents,null);
});
test('scope changes and mismatched or failed comparisons never produce a full delta or a false continuous line',()=>{
  const s=sources();s.annual.scope_changed=true;
  let m=buildAnnualReview(s,2026,s.today);assert.equal(m.net.delta_cents,null);assert.equal(m.net.segments.length,0);assert.match(m.net.note,/范围变化/);
  s.annual.scope_changed=false;s.annual.comparison={status:'error',code:'E',message:'绝密错误账户'};
  m=buildAnnualReview(s,2026,s.today);assert.equal(m.net.delta_cents,null);assert.match(m.net.note,/读取失败/);assert.equal(m.income.status,'ready');
  s.annual.comparison=ready({...sources().annual.comparison.value,from:{snapshot_id:'wrong'}});assert.equal(buildAnnualReview(s,2026,s.today).net.delta_cents,null);
  const p=[base,end,point('gap','2026-10-01','0',{complete:false}),point('c','2026-10-02','26000',{compared_to:end.date,change_cents:'1000'}),point('d','2026-10-03','27000',{compared_to:'2026-10-02',change_cents:'1000'}),point('changed','2026-10-04','28000',{scope_changed:true})];
  assert.deepEqual(annualTrendSegments(p).map(s=>s.map(p=>p.snapshot_id)),[['b','e'],['c','d'],['changed']]);
});
test('current goals use current observations regardless of selected year; unknown and version guards remain',()=>{
  const s=sources();const g=s.annual.savings.value.goals[0];g.goal.created_on='2026-06-01';
  let m=buildAnnualReview(s,2026,s.today);assert.equal(m.savings.goals[0].basisDate,'2026-09-30');assert.equal(m.savings.goals[0].progress.percent_hundredths,5000);
  g.observations=[observation({status:'missing',amount_cents:null})];m=buildAnnualReview(s,2026,s.today);assert.equal(m.savings.goals[0].progress.percent_hundredths,null);assert.equal(m.savings.goals[0].progress.gap_cents,null);
  g.goal.created_on='2027-01-01';assert.equal(buildAnnualReview(s,2026,s.today).savings.goals.length,0);
  s.annual.savings.value.write_version=6;m=buildAnnualReview(s,2026,s.today);assert.equal(m.savings.status,'error');
});
test('the annual source supplies all yearly planning entries, including beyond the legacy 24-row window',()=>{
  const s=sources();s.annual.planning=ready(Array.from({length:30},(_,i)=>planning(`p${i}`,`2026-${String(Math.floor(i/3)+1).padStart(2,'0')}-${String(i%3+1).padStart(2,'0')}`,i===15?{mode:'traditional',target_month:'2050-01',has_open_items:true}:{})));
  s.annual.planning.value[0].recorded_on='2027-01-01';
  const m=buildAnnualReview(s,2026,s.today);assert.equal(m.planning.count,30);assert.equal(m.planning.first.snapshot_id,'p0');assert.equal(m.planning.last.snapshot_id,'p29');assert.equal(m.planning.conditionsChanged,true);assert.equal(m.planning.laterRecorded,true);assert.equal(m.planning.openItems,true);
  // This tests consumption of the backend contract, not proof that its SQL is unbounded.
  s.annual.planning=ready([planning('only','2026-04-01')]);assert.equal(buildAnnualReview(s,2026,s.today).planning.count,1);
});
test('privacy copy uses controlled fields and aliases; even explicit amount copy never includes free text',()=>{
  const s=sources();const m=buildAnnualReview(s,2026,s.today),privateText=annualCopyText(m),full=annualCopyText(m,true);
  for(const text of [privateText,full]) assert.doesNotMatch(text,/绝密|goal-id|账户 a/);
  assert.doesNotMatch(privateText,/¥|%|2044-03|2045-08|预计/);assert.match(privateText,/隐私版/);assert.match(privateText,/存钱目标 1/);assert.match(full,/含金额版/);assert.match(full,/¥/);assert.match(full,/2044-03/);
  s.incomes={status:'error',code:'secret',message:'绝密源错误'};s.annual.savings=disabled;s.annual.planning={status:'error',code:'P',message:'绝密规划错误'};s.annual.years={status:'error',code:'Y',message:'绝密年份'};
  const partial=buildAnnualReview(s,2026,s.today);assert.equal(partial.net.status,'ready');assert.equal(partial.income.status,'error');assert.match(partial.yearsNote,/可能不全/);assert.doesNotMatch(annualCopyText(partial,true),/绝密/);
});
test('standard responses and stale years cannot build an annual copy model',()=>{
  const s=sources();delete s.annual;assert.equal(buildAnnualReview(s,2026,s.today),null);
  assert.equal(buildAnnualReview(sources(),2025,'2026-10-15'),null);
});
function mount(options={}) {
  const store=new Map([['thingary.hide-financial-amounts.v1','1']]),writes=[],requests=[];let current=sources(periodControl.recentTwelveMonths('2026-10-15'));
  const ui=runtime('AnnualReview',{generation:'g',today:'2026-10-15',modules,...(options.props||{})},undefined,undefined,{components:[],modules:{'./finance-period-control':periodControl,'./annual-review':annual,'./asset':{money},'./finance-data':{useFinanceSources:(g,p,m,view)=>{requests.push({g,p,m,view});return {load:current && current.generation===g && JSON.stringify(current.period)===JSON.stringify(p)?{status:'ready',sources:current}:{status:'loading'},reload(){}};} }},globals:{localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},navigator:{clipboard:{writeText:async text=>{if(options.fail)throw new Error('no clipboard');writes.push(text);}}}}});
  return {ui,writes,requests,setSource:s=>{current=s;ui.render();}};
}
test('actual component handler copies exactly its privacy preview and requires explicit amount disclosure',async()=>{
  const {ui,writes,requests}=mount();assert.ok(requests.every(r=>r.view==='annual'&&r.p.kind==='range'));assert.ok(ui.find('FinancePeriodControl'));
  const hidden=ui.text(ui.find('pre'));assert.doesNotMatch(hidden,/¥|2044-03/);
  ui.button('复制当前预览').props.onClick();await ui.settle();assert.equal(writes[0],hidden);assert.match(ui.text(ui.nodes()),/已复制预览中的摘要/);
  ui.button('在预览中显示金额').props.onClick();ui.render();const full=ui.text(ui.find('pre'));assert.match(full,/¥/);assert.doesNotMatch(full,/绝密/);
  ui.button('复制当前预览').props.onClick();await ui.settle();assert.equal(writes[1],full);
});
test('year and library changes invalidate old disclosure and old copy handlers; failed clipboard never claims success',async()=>{
  const {ui,writes,setSource}=mount();ui.button('在预览中显示金额').props.onClick();ui.render();const oldCopy=ui.button('复制当前预览').props.onClick;
  ui.find('FinancePeriodControl').props.onPresetChange(null);ui.find('FinancePeriodControl').props.onChange({kind:'year',year:2025});ui.render();oldCopy();await ui.settle();assert.equal(writes.length,0);assert.equal(ui.find('pre'),undefined);
  setSource(sources(2025));assert.doesNotMatch(ui.text(ui.find('pre')),/¥/);
  ui.props.generation='other';ui.render();oldCopy();await ui.settle();assert.equal(writes.length,0);assert.equal(ui.find('pre'),undefined);
  const failed=mount({fail:true});failed.ui.button('复制当前预览').props.onClick();await failed.ui.settle();assert.match(failed.ui.text(failed.ui.nodes()),/复制失败/);assert.doesNotMatch(failed.ui.text(failed.ui.nodes()),/已复制/);
});

test('the page uses the overview presets with 近 1 年 by default and a compact sparkline only',()=>{
  const entry=[];const {ui,setSource}=mount({props:{onViewTrend:selection=>entry.push(selection)}});
  const control=ui.find('FinancePeriodControl');
  assert.equal(control.props.activePreset,'1y');
  assert.deepEqual(control.props.presets.map(p=>p.label),['近 30 天','近 6 个月','近 1 年','今年以来','全部']);
  assert.equal(JSON.stringify(control.props.options),JSON.stringify([{value:'range',label:'自定义'}]));
  assert.equal(control.props.yearQuickPick,true);
  assert.ok(control.props.presets.every(p=>p.period.kind==='range'&&p.period.includeFrom===true));
  assert.ok(ui.nodes().filter(n=>n.type==='Sparkline').every(n=>n.props.hero!==true),'only the compact sparkline, never the hero curve');
  ui.button('查看这段走势 →').props.onClick();
  assert.equal(JSON.stringify(entry),JSON.stringify([{range:'1y'}]));
  const custom={kind:'range',from:'2026-02-01',to:'2026-10-15',includeFrom:true};
  control.props.onPresetChange(null);control.props.onChange(custom);setSource(sources(custom));ui.render();
  ui.button('查看这段走势 →').props.onClick();
  assert.equal(JSON.stringify(entry.at(-1)),JSON.stringify({range:'custom',custom:{from:'2026-02-01',to:'2026-10-15'}}));
});
test('a single endpoint keeps its date and amount but never renders a change amount',()=>{
  const {ui,setSource}=mount();
  const s=sources(periodControl.recentTwelveMonths('2026-10-15'));
  s.wealth.value.points=[point('only','2026-08-01')];s.annual.comparison=ready(null);setSource(s);
  const metrics=ui.nodes().filter(n=>n.props?.className==='ui-metrics')[0];
  assert.ok(metrics);const text=ui.text(metrics);
  assert.match(text,/实际盘点 2026-08-01/);
  assert.equal(metrics.props.children.filter(child=>child&&child.type==='article').length,1,'只有端点，没有变化卡片');
  assert.doesNotMatch(text,/区间变化|暂无完整金额/);
});
test('hidden page and partial read failures remain safe; changing modules revokes previous copy disclosure',async()=>{
  const {ui,writes,setSource}=mount();assert.doesNotMatch(ui.text(ui.nodes()),/绝密|2044-03|2045-08|¥/);
  ui.button('在预览中显示金额').props.onClick();ui.render();const oldCopy=ui.button('复制当前预览').props.onClick;
  ui.props.modules={...modules,planning:false,finance_revision:2};
  const s=sources(periodControl.recentTwelveMonths('2026-10-15'));s.modules=ui.props.modules;s.annual.planning=disabled;s.incomes={status:'error',code:'private',message:'绝密读取错误'};setSource(s);
  oldCopy();await ui.settle();assert.equal(writes.length,0);assert.doesNotMatch(ui.text(ui.find('pre')),/¥|绝密|2044-03/);assert.match(ui.text(ui.nodes()),/收入读取失败/);assert.match(ui.text(ui.nodes()),/退休规划结论来源已关闭/);assert.ok(ui.button('复制当前预览'));
});
test('a preset label is used only when the first endpoint reaches back to the window start',()=>{
  const win={kind:'range',from:'2025-10-15',to:'2026-10-15',includeFrom:true};
  const short=buildReview(sources(win),win,'2026-10-15','1y');
  assert.match(short.net.label,/^自本区间首次盘点以来 \d+ 个月变化$/);
  const wide={kind:'range',from:'2025-12-31',to:'2026-10-15',includeFrom:true};
  assert.equal(buildReview(sources(wide),wide,'2026-10-15','1y').net.label,'近 1 年变化');
});
