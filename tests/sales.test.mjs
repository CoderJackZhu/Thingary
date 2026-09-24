import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saleError,saleAction,settlement} from '../src/sales.ts';
const record={asset:{id:'a',name:'虚构',price_cents:'100000',purchase_date:'2026-09-01',revision:1},deleted:false,lifecycle:{state:'active',events:[]}};
const fields={date:'2026-09-10',price:'300',platform:'',buyer:'',notes:''};
const draft={record,generation:'test',mode:'sell',fields,original:fields,pending:null};
test('sale requires actual zero or positive price, valid ordered date and source state',()=>{
 assert.equal(saleError(draft,'2026-09-25'),'');
 for(const price of ['','-1','1e3','1.001'])assert.ok(saleError({...draft,fields:{...fields,price}},'2026-09-25'));
 assert.equal(saleAction({...draft,fields:{...fields,price:'0'}}).fields.price_cents,'0');
 for(const date of ['','2026-02-30','2026-08-31','2026-09-26'])assert.ok(saleError({...draft,fields:{...fields,date}},'2026-09-25'));
 assert.ok(saleError({...draft,record:{...record,deleted:true}},'2026-09-25'));
 assert.ok(saleError({...draft,record:{...record,lifecycle:{state:'sold',events:[]}}},'2026-09-25'));
 assert.ok(saleError({...draft,record:{...record,lifecycle:{state:'retired',events:[{date:'2026-09-11'}]}}},'2026-09-25'));
});
test('net daily cost fixes endpoint and rounds negative ratios away from zero',()=>{
 const sale=saleAction(draft).fields;
 assert.deepEqual(settlement(record,sale),{days:10,net:'70000',daily:'7000'});
 assert.deepEqual(settlement(record,{...sale,price_cents:'140000'}),{days:10,net:'-40000',daily:'-4000'});
 assert.deepEqual(settlement({...record,asset:{...record.asset,price_cents:null}},sale),{days:10,net:null,daily:null});
 assert.deepEqual(settlement({...record,asset:{...record.asset,purchase_date:null}},sale),{days:null,net:'70000',daily:null});
 assert.equal(settlement({...record,asset:{...record.asset,price_cents:'0'}},{...sale,date:'2026-09-02',price_cents:'1'}).daily,'-1');
});
test('correction targets the same sale and revoke does not invent settlement input',()=>{
 const sold={...record,lifecycle:{state:'sold',events:[]},sale:{id:'s',previous_state:'retired',fields:saleAction(draft).fields}};
 assert.equal(saleAction({...draft,record:sold,mode:'correct'}).sale_id,'s');
 assert.deepEqual(saleAction({...draft,record:sold,mode:'revoke'}),{type:'revoke',sale_id:'s'});
 assert.equal(saleError({...draft,record:sold,mode:'revoke',fields:{...fields,date:'',price:''}},'2026-09-25'),'');
});
