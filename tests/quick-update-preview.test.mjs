import * as holdings from '../src/holdings.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as currency from '../src/currency.ts';
const source = readFileSync(new URL('../src/wealth-preview.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('wealth-preview.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ['latestBefore', 'view', 'summary', 'wealthPreview'];
const picked = file.statements.filter(n => (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['withLatest', 'hundredths'].includes(d.name.getText())))).map(n => n.getText()).join('\n').replaceAll('export function ', 'function ');
const initialization = file.statements.find(n => ts.isIfStatement(n) && n.expression.getText().includes("'quick-new-day'")).getText();
function fixture(query = '', withToday = false) {
  const accounts = ['cash', 'fund', 'card', 'unknown'].map((id, i) => ({ id, fields: { name: `虚构${id}`, side: id === 'card' ? 'liability' : 'asset', kind: id === 'card' ? 'credit_card' : 'cash', counted: true, opened_on: '2026-01-01', closed_on: null } }));
  const snapshots = [{ id: 'before', date: '2026-10-01', notes: '虚构原备注', revision: 1, entries: accounts.slice(0, 3).map((a, i) => ({ account_id: a.id, amount_cents: ['10000', '5000', '3000'][i], state: 'entered', side: a.fields.side, kind: a.fields.kind, counted: true })) }];
  if (withToday) snapshots.push({ ...structuredClone(snapshots[0]), id: 'today-existing', date: '2026-10-17' });
  const context = { ...holdings, ...currency, accounts, snapshots, params: new URLSearchParams(query), generation: '虚构资料', now: new Date('2026-10-17T12:00:00Z'), iso: date => date.toISOString().slice(0, 10), receipts: new Map(), quickFingerprints: new Map(), quickStaleShown: false, crypto,
    due: (a, d) => a.fields.opened_on <= d && (!a.fields.closed_on || d < a.fields.closed_on), known: e => e.amount_cents !== null, financialImportPreview: () => null, planFail: () => false };
  const code = ts.transpileModule(picked + '\n' + initialization + '\nglobalThis.run=wealthPreview;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, context);
  const call = (command, args) => JSON.parse(JSON.stringify(context.run(command, args).value));
  const update = (changes, date = '2026-10-10', note = '', request_id = crypto.randomUUID()) => call('wealth_quick_update', { input: { request_id, generation: '虚构资料', date, note, changes } });
  return { context, call, update };
}
test('虚构预览快速更新：新建沿用与未知、同日更正保留A22金额及历史计入', () => {
  const f = fixture(), first = f.update([{ account_id: 'fund', amount_cents: '6000' }], undefined, '虚构调整');
  assert.deepEqual(first.entries.map(e => [e.account_id, e.state, e.amount_cents]), [['cash', 'unchanged', '10000'], ['fund', 'entered', '6000'], ['card', 'unchanged', '3000'], ['unknown', 'missing', null]]);
  f.context.snapshots[0].entries[0].amount_cents = '99900';
  f.context.snapshots[1].entries[0].counted = false;
  const second = f.update([{ account_id: 'card', amount_cents: '0', expected_previous: '3000' }], undefined, '虚构还款');
  assert.equal(second.id, first.id); assert.equal(second.revision, first.revision + 1);
  assert.equal(second.entries[0].amount_cents, '10000'); assert.equal(second.entries[0].counted, false);
  assert.equal(second.notes, '虚构fund：虚构调整\n虚构card：虚构还款');
  assert.deepEqual(second.missing, ['unknown']);
});
test('虚构预览转账、请求重放与冲突、陈旧金额及日期拒绝均不留半写', () => {
  const f = fixture(), change = [{ account_id: 'cash', amount_cents: '9000', expected_previous: '10000' }, { account_id: 'card', amount_cents: '2000', expected_previous: '3000' }];
  const first = f.update(change, undefined, '', '虚构请求');
  assert.deepEqual(f.update(change, undefined, '', '虚构请求'), first);
  assert.throws(() => f.update([{ account_id: 'cash', amount_cents: '1' }], undefined, '', '虚构请求'), e => e.code === 'REQUEST_CONFLICT');
  for (const [changes, date, code] of [[change, '2026-10-10', 'QUICK_STALE'], [[{ account_id: 'cash', amount_cents: '1' }], '2026-10-09', 'QUICK_DATE'], [[{ account_id: 'cash', amount_cents: '1' }], '2026-10-18', 'SNAPSHOT_DATE'], [[{ account_id: 'cash', amount_cents: '8000', expected_previous: '9000' }, { account_id: 'card', amount_cents: '2000', expected_previous: '2000' }], '2026-10-11', 'QUICK_TRANSFER']]) assert.throws(() => f.update(changes, date), e => e.code === code);
  assert.equal(f.context.snapshots.length, 2); assert.equal(f.context.snapshots[1].revision, first.revision);
});
test('虚构预览同日未知不能用历史已知来通过陈旧金额检查', () => {
  const f = fixture(); f.context.snapshots[0].entries.push({ account_id: 'unknown', state: 'entered', amount_cents: '100', side: 'asset', kind: 'cash', counted: true });
  f.update([{ account_id: 'fund', amount_cents: '6000' }]);
  f.context.snapshots[1].entries.find(e => e.account_id === 'unknown').amount_cents = null;
  assert.throws(() => f.update([{ account_id: 'unknown', amount_cents: '200', expected_previous: '100' }]), e => e.code === 'QUICK_STALE');
});

test('虚构预览未知回执：已提交但响应丢失，只读核对失败而保存事实保留', () => {
  const f = fixture('quick=unknown');
  assert.throws(() => f.update([{ account_id: 'cash', amount_cents: '12345' }], undefined, '', '虚构未知'), /./);
  assert.equal(f.context.snapshots[1].entries.find(e => e.account_id === 'cash').amount_cents, '12345');
  assert.throws(() => f.call('wealth_request_result', { request: '虚构未知' }), /./);
  assert.equal(f.context.receipts.get('虚构未知'), f.context.snapshots[1].id);
});

test('虚构预览只读派生：沿用不刷新填写日期，含沿用且没有未知仍完整', () => {
  const f = fixture();
  f.update([{ account_id: 'unknown', amount_cents: '0' }]);
  const accounts = f.call('wealth_accounts', {});
  assert.equal(accounts.find(a => a.id === 'cash').last_entered_on, '2026-10-01');
  assert.equal(accounts.find(a => a.id === 'unknown').last_entered_on, '2026-10-10');
  const point = f.call('wealth_summary', {}).points.at(-1);
  assert.equal(point.has_unchanged, true); assert.equal(point.complete, true);
});

test('虚构quick-new-day夹具：只移除今天快照，新日更新留下沿用且不刷新其他账户填写日期', () => {
  const f = fixture('wealth-fixture=quick-new-day', true);
  assert.deepEqual(f.context.snapshots.map(s => s.date), ['2026-10-01']);
  const saved = f.update([{ account_id: 'fund', amount_cents: '6789' }], '2026-10-17');
  assert.notEqual(saved.id, 'today-existing'); assert.equal(saved.date, '2026-10-17');
  assert.equal(saved.entries.find(e => e.account_id === 'fund').state, 'entered');
  assert.equal(saved.entries.find(e => e.account_id === 'cash').state, 'unchanged');
  assert.equal(saved.entries.find(e => e.account_id === 'card').state, 'unchanged');
  const accounts = f.call('wealth_accounts', {});
  assert.equal(accounts.find(a => a.id === 'cash').last_entered_on, '2026-10-01');
  assert.equal(accounts.find(a => a.id === 'fund').last_entered_on, '2026-10-17');
  assert.equal(f.call('wealth_summary', {}).points.at(-1).has_unchanged, true);
});

test('虚构外币预览：真实同CNY原币变化仍陈旧，重读后保存不夹带expected字段并保留其他原币',()=>{
 const f=fixture();
 for(const id of ['cash','fund'])f.context.accounts.find(a=>a.id===id).fields.currency='USD';
 const cash=f.context.snapshots[0].entries[0],fund=f.context.snapshots[0].entries[1];
 Object.assign(cash,{amount_cents:'1',original_minor:'1',fx_rate_micro:'500000'});Object.assign(fund,{amount_cents:'700',original_minor:'100',fx_rate_micro:'7000000'});
 const old={account_id:'cash',amount_cents:'2',original_minor:'3',fx_rate_micro:'500000',expected_previous:'1',expected_original_minor:'1'};
 cash.original_minor='2'; // A real fictional concurrent edit; rounded CNY remains one cent.
 assert.throws(()=>f.update([old]),e=>e.code==='QUICK_STALE');assert.equal(f.context.snapshots.length,1);
 const result=f.update([{...old,original_minor:'4',expected_original_minor:'2'}]);
 const saved=result.entries.find(e=>e.account_id==='cash'),kept=result.entries.find(e=>e.account_id==='fund');
 assert.equal(saved.original_minor,'4');assert.equal(saved.fx_rate_micro,'500000');assert.ok(!('expected_previous' in saved));assert.ok(!('expected_original_minor' in saved));
 assert.equal(kept.state,'unchanged');assert.equal(kept.original_minor,'100');assert.equal(kept.fx_rate_micro,'7000000');
 const history=f.call('wealth_account_history',{account:'cash'});assert.equal(history.rows.at(-1).original_minor,'4');assert.equal(history.rows.at(-1).fx_rate_micro,'500000');
});
test('虚构预览停用账户仍贡献最近汇率建议，过滤未来并纳入当天记录',()=>{
 const f=fixture(),old=f.context.accounts[0];old.fields.currency='USD';old.fields.closed_on='2026-10-02';Object.assign(f.context.snapshots[0].entries[0],{amount_cents:'0',original_minor:'0',fx_rate_micro:'7000000'});
 const next={id:'new-usd',fields:{...old.fields,name:'虚构新美元',opened_on:'2026-10-03',closed_on:null}};f.context.accounts.push(next);
 f.context.snapshots.push({id:'future',date:'2026-10-09',notes:'虚构',revision:1,entries:[{account_id:next.id,state:'entered',amount_cents:'800',original_minor:'100',fx_rate_micro:'8000000',side:'asset',kind:'cash',counted:true}]});
 const before=f.call('wealth_snapshot_draft',{date:'2026-10-05'});assert.ok(!before.rows.some(r=>r.account.id===old.id));assert.deepEqual(before.rate_suggestions.USD,{rate:'7000000',date:'2026-10-01'});
 const same=f.call('wealth_snapshot_draft',{date:'2026-10-09'});assert.deepEqual(same.rate_suggestions.USD,{rate:'8000000',date:'2026-10-09'});
});

test('虚构预览持仓：新日沿用、A22、关闭模式后同日其他更新保留与真实数量陈旧',()=>{
 const f=fixture(),a=f.context.accounts.find(a=>a.id==='fund');a.fields.kind='fund';a.fields.holding_mode=true;
 const prior=f.context.snapshots[0].entries.find(e=>e.account_id==='fund');prior.quantity_e8='5000000000';prior.unit_price_e6='1000000';
 const carried=f.update([{account_id:'cash',amount_cents:'9000'}]);assert.equal(carried.entries.find(e=>e.account_id==='fund').quantity_e8,'5000000000');
 const changed=f.update([{account_id:'fund',amount_cents:'6000',quantity_e8:'6000000000',unit_price_e6:'1000000',expected_previous:'5000',expected_quantity_e8:'5000000000'}]);assert.equal(changed.entries.find(e=>e.account_id==='fund').unit_price_e6,'1000000');
 assert.throws(()=>f.update([{account_id:'fund',amount_cents:'6000',quantity_e8:'12000000000',unit_price_e6:'500000',expected_previous:'6000',expected_quantity_e8:'5000000000'}]),e=>e.code==='QUICK_STALE');
 a.fields.holding_mode=false;const kept=f.update([{account_id:'cash',amount_cents:'8000'}]);assert.equal(kept.entries.find(e=>e.account_id==='fund').quantity_e8,'6000000000');
 const history=f.call('wealth_account_history',{account:'fund'});assert.equal(history.rows.at(-1).quantity_e8,'6000000000');
});

test('虚构外币持仓preview真实保存：双向模式切换后只改备注保留整条原事实',()=>{
 for(const originalMode of [true,false]){const f=fixture(),a=f.context.accounts.find(a=>a.id==='fund');a.fields.kind='fund';a.fields.currency='USD';a.fields.holding_mode=originalMode;
 const old=f.context.snapshots[0].entries.find(e=>e.account_id==='fund');old.original_minor='5000';old.fx_rate_micro='1000000';if(originalMode){old.quantity_e8='5000000000';old.unit_price_e6='1000000';}
 const first=f.update([{account_id:'fund',amount_cents:'5000',original_minor:'5000',fx_rate_micro:'1000000',...(originalMode?{quantity_e8:'5000000000',unit_price_e6:'1000000'}:{})}]);a.fields.holding_mode=!originalMode;
 const input={request_id:crypto.randomUUID(),generation:'虚构资料',id:first.id,expected_revision:first.revision,date:first.date,notes:'虚构模式切换只改备注',entries:first.entries.map(e=>({...e,amount_cents:e.state==='unchanged'?null:e.amount_cents}))};
 const result=f.call('wealth_snapshot_save',{input}),saved=result.entries.find(e=>e.account_id==='fund');assert.equal(saved.original_minor,'5000');assert.equal(saved.fx_rate_micro,'1000000');assert.equal(saved.quantity_e8,originalMode?'5000000000':undefined);assert.equal(saved.unit_price_e6,originalMode?'1000000':undefined);assert.equal(result.notes,'虚构模式切换只改备注');
 }
});

test('虚构外币持仓preview实际完整盘点：新录入、更正、仅备注都校验完整五事实',()=>{
 const f=fixture(),a=f.context.accounts.find(a=>a.id==='fund');Object.assign(a.fields,{kind:'fund',currency:'USD',holding_mode:true});
 const entries=f.context.snapshots[0].entries.map(e=>e.account_id==='fund'?{...e,amount_cents:'14000',original_minor:'7000',fx_rate_micro:'2000000',quantity_e8:'7000000000',unit_price_e6:'1000000'}:{...e});entries.push({account_id:'unknown',state:'missing',amount_cents:null});
 const save=(old,entries,notes)=>f.call('wealth_snapshot_save',{input:{request_id:crypto.randomUUID(),generation:'虚构资料',id:old?.id??null,expected_revision:old?.revision??null,date:'2026-10-10',notes,entries}});
 let snapshot=save(null,entries,'虚构新盘点');assert.equal(snapshot.entries.find(e=>e.account_id==='fund').amount_cents,'14000');
 const corrected=snapshot.entries.map(e=>e.account_id==='fund'?{...e,amount_cents:'24000',original_minor:'12000',quantity_e8:'8000000000',unit_price_e6:'1500000'}:{...e});snapshot=save(snapshot,corrected,'虚构更正');assert.equal(snapshot.entries.find(e=>e.account_id==='fund').original_minor,'12000');
 a.fields.holding_mode=false;snapshot=save(snapshot,snapshot.entries,'虚构关闭模式只改备注');assert.equal(snapshot.entries.find(e=>e.account_id==='fund').quantity_e8,'8000000000');
 const invalid=snapshot.entries.map(e=>e.account_id==='fund'?{...e,original_minor:'24000',fx_rate_micro:'1000000',quantity_e8:'24000000000',unit_price_e6:'1000000'}:{...e});assert.throws(()=>save(snapshot,invalid,'虚构不能以同人民币绕过模式'),e=>e.code==='HOLDING_MISMATCH');
});
