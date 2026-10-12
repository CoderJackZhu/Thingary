import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellText, defaultRange, sortRows } from '../src/wealth.ts';

const point = (id, date, over = {}) => ({
  snapshot_id: id, date, assets_cents: '0', liabilities_cents: '0', net_cents: '0',
  complete: true, missing: 0, compared_to: null, scope_changed: false, change_cents: null,
  change_rate_hundredths: null, ...over,
});
const row = (over = {}) => ({
  account_id: 'a', name: 'A', institution: '', side: 'asset', kind: 'cash',
  from: { state: 'entered', amount_cents: '100', counted: true },
  to: { state: 'entered', amount_cents: '250', counted: true },
  change_cents: '150', effect_cents: '150', rate_hundredths: 15000,
  group: 'counted', tag: null, ...over,
});

test('defaultRange prefers the overview pair, then the last two check-ins, else null', () => {
  // 与概览「与上次比较」同一对：最近完整盘点与其上一次完整盘点。
  const points = [
    point('a', '2026-09-30'),
    point('b', '2026-10-15', { complete: false, missing: 1 }),
    point('c', '2026-10-31', { compared_to: '2026-09-30' }),
  ];
  assert.deepEqual(defaultRange(points), { from: 'a', to: 'c' });
  // 没有可比的完整对时用最后两次盘点（可以是不完整的）。
  const pair = [point('a', '2026-09-30'), point('b', '2026-10-31', { complete: false, missing: 2 })];
  assert.deepEqual(defaultRange(pair), { from: 'a', to: 'b' });
  // 只有一次盘点（或空）时不比较。
  assert.equal(defaultRange([point('a', '2026-09-30')]), null);
  assert.equal(defaultRange([]), null);
  // compared_to 指向的盘点已不存在时不再杜撰一对。
  assert.equal(defaultRange([point('c', '2026-10-31', { compared_to: '2026-09-30' })]), null);
});

test('sortRows orders by absolute effect with unknowns last, or by kind then position', () => {
  const big = row({ account_id: 'big', effect_cents: '30000' });
  const small = row({ account_id: 'small', effect_cents: '-10000' });
  const negativeBig = row({ account_id: 'neg', effect_cents: '-30000' });
  const unknown = row({ account_id: 'unk', effect_cents: null, change_cents: null });
  const tie = row({ account_id: 'tie', effect_cents: '30000' });
  assert.deepEqual(
    sortRows([small, unknown, big, tie, negativeBig], 'impact').map(r => r.account_id),
    ['big', 'tie', 'neg', 'small', 'unk'],
    '｜影响｜降序，同值保持账户位置，未知最后',
  );
  const investment = row({ account_id: 'i', kind: 'investment' });
  const card = row({ account_id: 'cc', kind: 'credit_card', side: 'liability' });
  const housing = row({ account_id: 'h', kind: 'housing_fund' });
  const cash = row({ account_id: 'c', kind: 'cash' });
  assert.deepEqual(
    sortRows([investment, card, housing, cash], 'kind').map(r => r.account_id),
    ['c', 'i', 'h', 'cc'],
    '先资产类型顺序再负债类型顺序，同类型保持账户位置',
  );
});

test('cellText renders amounts, liabilities and the three textual states', () => {
  const cell = (over = {}) => ({ state: 'entered', amount_cents: '123400', counted: true, ...over });
  assert.equal(cellText(cell(), 'asset'), '¥1,234');
  assert.equal(cellText(cell({ amount_cents: '500000' }), 'liability'), '欠 ¥5,000');
  assert.equal(cellText(cell({ state: 'not_open', amount_cents: null }), 'asset'), '未启用');
  assert.equal(cellText(cell({ state: 'closed', amount_cents: null }), 'liability'), '已停用');
  assert.equal(cellText(cell({ state: 'missing', amount_cents: null }), 'asset'), '未知');
  assert.equal(cellText(cell({ amount_cents: null }), 'asset'), '未知');
});

import { runtime } from './planning-component-runtime.mjs';
import * as wealth from '../src/wealth.ts';
import * as display from '../src/wealth-display.ts';
const accounts=[{id:'a',fields:{name:'虚构账户',side:'asset',kind:'cash',institution:'',closed_on:null}}];
const comparison = (from='a',to='b') => ({generation:'g',from:{snapshot_id:from,date:'2026-01-01',notes:'期初备注',complete:true,missing:0},to:{snapshot_id:to,date:'2026-02-01',notes:'期末备注',complete:true,missing:0},rows:[row()],structure:[],reconciled:true,net_change_cents:'150',assets_change_cents:'150',liabilities_change_cents:'0',net_rate_hundredths:15000,known_effect_cents:'150',missing_names:[]});
function compareRuntime(over={},invoke=async()=>comparison()) {
 return runtime('WealthChanges',{summary:{generation:'g',points:[point('a','2026-01-01'),point('b','2026-02-01'),point('c','2026-03-01',{complete:false})]},accounts,accountView:'all',today:'2026-03-01',onNewAccount(){},onCheckIn(){},...over},undefined,undefined,{components:[],modules:{'@tauri-apps/api/core':{invoke},'./wealth':wealth,'./wealth-display':display,'./asset':{money:v=>String(v),errorMessage:e=>e.message},'./WealthPage':{NetChart:()=>null}}});
}
test('embedded comparison uses exactly the host pair and hides endpoint selectors',async()=>{
 const calls=[];const r=compareRuntime({controlledRange:{from:'a',to:'c'},hideControls:true},async(command,args)=>{calls.push({command,args});return comparison('a','c');});await r.settle();
 assert.equal(calls[0].args.from,'a');assert.equal(calls[0].args.to,'c');assert.equal(r.nodes().filter(n=>n.type==='select').length,0);assert.ok(r.nodes().some(n=>n.type==='p'&&r.text(n).includes('期初备注')));
});
test('endpoint removal immediately masks old amounts and leaves an explicit retry',async()=>{
 const r=compareRuntime({controlledRange:{from:'a',to:'b'}});await r.settle();assert.ok(r.nodes().some(n=>n.type==='table'));
 r.props.summary={generation:'g',points:[point('a','2026-01-01')]};r.render();assert.equal(r.nodes().filter(n=>n.type==='table').length,0);assert.ok(r.button('重新读取'));assert.match(r.text(r.render()),/所选盘点已删除或失效/);
});
test('arbitrary incomplete comparison preserves chosen endpoints and browse state',async()=>{
 const changes=[],browse=[];const r=compareRuntime({initial:{from:'a',to:'c'},initialSort:'kind',onRangeChange:v=>changes.push(v),onBrowseStateChange:v=>browse.push(v)},async()=>comparison('a','c'));await r.settle();
 const to=r.find('select',p=>p['aria-label']==='终点盘点');assert.equal(to.props.value,'c');to.props.onChange({target:{value:'b'}});await r.settle();assert.equal(changes[0].to,'b');assert.equal(browse[0].sort,'kind');
});
