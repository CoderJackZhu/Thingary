import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryRows, enteredRow, inventoryTotals, inventoryDelta, inventoryInput } from '../src/mobile/wealth/model.ts';
import { accountGroupTotals } from '../src/wealth-display.ts';
import { snapshotEntryInput, sortRows, canCloseInCheckIn } from '../src/wealth.ts';
const account=(id,fields={})=>({id,revision:1,position:0,latest:null,fields:{name:`虚构${id}`,institution:'虚构银行',kind:'cash',side:'asset',counted:true,currency:'CNY',opened_on:'2026-01-01',closed_on:null,notes:'',...fields}});
const a=account('cash'),b=account('debt',{side:'liability',kind:'loan'}),fx=account('usd',{currency:'USD'}),h=account('fund',{kind:'fund',holding_mode:true});
const draft=(accounts=[a,b])=>({generation:'fictional',date:'2026-10-21',existing:null,rows:accounts.map(account=>({account,previous:{amount_cents:'10000',date:'2026-09-30'}}))});
test('新盘点不预填上次余额，明确零可填，缺项不伪装成完整',()=>{
 const d=draft(),rows=inventoryRows(d);
 assert.equal(inventoryDelta(d,rows),null);
 assert.equal(rows.cash.cents,''); assert.equal(rows.cash.state,null);
 assert.equal(inventoryTotals(d,rows).missing,2);
 assert.throws(()=>inventoryInput(d,rows,'','r'),/填齐/);
 rows.cash=enteredRow(a,'0','','',''); rows.debt=enteredRow(b,'1000','','','');
 assert.deepEqual(inventoryTotals(d,rows),{assets:'0',liabilities:'1000',net:'-1000',missing:0});
 const input=inventoryInput(d,rows,'虚构盘点','one-request');
 assert.equal(input.entries.length,2); assert.equal(input.request_id,'one-request'); assert.equal(input.id,null);
 assert.equal(input.entries[0].amount_cents,'0');
});
test('外币与持仓复用整数换算，缺汇率、缺单价、超界全部阻断',()=>{
 assert.equal(enteredRow(fx,'10000','','','7120000').cents,'71200');
 assert.equal(enteredRow(fx,'10000','','','').cents,'');
 const position=enteredRow(h,'','200000000','1234567','');
 assert.equal(position.cents,'247'); assert.equal(position.quantity_e8,'200000000');
 assert.equal(enteredRow(h,'','0','1000000','').cents,'0');
 assert.equal(enteredRow(h,'','200000000','','').state,null);
 assert.equal(enteredRow(a,'100000000000','','','').state,null);
 assert.equal(enteredRow(a,'-1','','','').state,null);
 const foreignHolding=account('usd-fund',{kind:'fund',holding_mode:true,currency:'USD'});
 assert.equal(enteredRow(foreignHolding,'','200000000','1000000','7120000').cents,'1424');
});
test('更正保留同日原行与修订，沿用金额序列化为空但不丢持仓或原币事实',()=>{
 const d=draft([fx]);
 d.existing={id:'saved-id',revision:7,date:d.date,notes:'原备注',missing:[],entries:[{account_id:fx.id,state:'unchanged',side:'liability',kind:'loan',counted:false,amount_cents:'71200',original_minor:'10000',fx_rate_micro:'7120000'}]};
 const rows=inventoryRows(d),input=inventoryInput(d,rows,'原备注','correction');
 assert.equal(input.id,'saved-id');assert.equal(input.expected_revision,7);
 assert.equal(input.entries[0].amount_cents,null);assert.equal(input.entries[0].original_minor,'10000');
 assert.equal(inventoryTotals(d,rows).net,'0');
 assert.equal(inventoryDelta(d,rows),'0');
 rows.usd=enteredRow(fx,'20000','','','7120000');
 assert.equal(inventoryTotals(d,rows).net,'0');
 assert.equal(input.generation,'fictional');
 const holding={state:'unchanged',cents:'100',quantity_e8:'100000000',unit_price_e6:'1000000'};
 assert.equal(snapshotEntryInput('holding',holding).quantity_e8,'100000000');
});
test('部分录入只比较同批账户，未知上次金额仍为未知',()=>{
 const d=draft(),rows=inventoryRows(d);rows.cash=enteredRow(a,'15000','','','');
 assert.equal(inventoryDelta(d,rows),'5000');
 d.rows[0].previous=null;assert.equal(inventoryDelta(d,rows),null);
 assert.throws(()=>inventoryInput({...d,rows:[]},{},'','r'),/没有需要盘点/);
 rows.debt=enteredRow(b,'0','','','');assert.throws(()=>inventoryInput(d,rows,'\0','r'),/备注/);
});
test('分组结构不受账户显示范围影响，最近盘点未涵盖账户明确缺项',()=>{
 const groups=[{id:'g',name:'虚构投资',position:0}], accounts=[{...a,fields:{...a.fields,group_id:'g'}},b];
 const entries=[{account_id:a.id,side:'asset',counted:true,amount_cents:'10000'}];
 const all=accountGroupTotals(accounts,groups,entries,true);
 assert.equal(all[0].net_cents,'10000');assert.equal(all[1].partial,true);
 assert.equal(all[1].known,0);
});
test('比较复用影响与类型排序，未知影响排最后，债务符号由命令保留',()=>{
 const rows=[{account_id:'unknown',kind:'cash',effect_cents:null},{account_id:'debt',kind:'loan',effect_cents:'-5000'},{account_id:'cash',kind:'cash',effect_cents:'2000'}];
 assert.deepEqual(sortRows(rows,'impact').map(r=>r.account_id),['debt','cash','unknown']);
 assert.equal(sortRows(rows,'impact')[0].effect_cents,'-5000');
});

test('盘点里标已注销：不填金额，保存时带上停用账户，且仍算完整',()=>{
 const d=draft(),rows=inventoryRows(d),closing=new Set(['debt']);
 rows.cash=enteredRow(a,'500','','','');
 assert.equal(inventoryTotals(d,rows,closing).missing,0);
 assert.throws(()=>inventoryInput(d,rows,'','r'),/填齐/);
 const input=inventoryInput(d,rows,'','close-request',closing);
 assert.deepEqual(input.entries.map(e=>e.account_id),['cash']);
 assert.deepEqual(input.close_accounts,[{account_id:'debt',expected_revision:1}]);
 assert.equal(inventoryDelta(d,rows,closing),'-9500');
 assert.equal(inventoryInput(d,{...rows,debt:enteredRow(b,'0','','','')},'','r').close_accounts,undefined);
});
test('这次跳过记为未知；全部注销也能保存；只在可注销时提供入口',()=>{
 const d=draft(),rows=inventoryRows(d);
 rows.cash={state:'missing',cents:''}; rows.debt=enteredRow(b,'0','','','');
 const input=inventoryInput(d,rows,'','skip');
 assert.equal(input.entries[0].state,'missing'); assert.equal(input.entries[0].amount_cents,null);
 const all=inventoryInput(d,inventoryRows(d),'','all',new Set(['cash','debt']));
 assert.equal(all.entries.length,0); assert.equal(all.close_accounts.length,2);
 assert.equal(canCloseInCheckIn(d,a),true);
 assert.equal(canCloseInCheckIn(d,account('new',{opened_on:'2026-10-21'})),false);
 assert.equal(canCloseInCheckIn(d,account('old',{closed_on:'2026-05-01'})),false);
 assert.equal(canCloseInCheckIn({...d,existing:{entries:[{account_id:'cash'}]}},a),false);
});
