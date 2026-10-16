import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currencies,convertCurrency,currencyDecimals,parseDecimal,currencyAmount,rateSuggestions,validateCurrencyFact} from '../src/currency.ts';
import {quickChanges,quickTransferPairs,snapshotEntryInput} from '../src/wealth.ts';
const cases=JSON.parse(readFileSync(new URL('./fixtures/currency-vectors.json',import.meta.url),'utf8'));
test('虚构原币换算共用Rust/TS样例与整数精度',()=>{
 for(const c of cases){if(c.result===null)assert.throws(()=>convertCurrency(c.code,c.original,c.rate));else assert.equal(convertCurrency(c.code,c.original,c.rate),c.result);}
 assert.equal(parseDecimal('1234.56',2),'123456');assert.equal(parseDecimal('7.123456',6),'7123456');assert.throws(()=>parseDecimal('7.1234567',6));assert.throws(()=>parseDecimal('1.1',0));
 const rust=readFileSync(new URL('../src-tauri/src/currency.rs',import.meta.url),'utf8');
 const table=[...rust.matchAll(/\("([A-Z]{3})",\s*"([^"]+)",\s*(\d)\)/g)].map(m=>[m[1],m[2],Number(m[3])]);assert.deepEqual(table,currencies);
 assert.equal(currencyDecimals('JPY'),0);assert.equal(currencyDecimals('ZZZ'),2);assert.equal(currencyAmount('JPY','12345'),'12,345 JPY');assert.equal(currencyAmount('USD','123456'),'1,234.56 USD');
 assert.throws(()=>validateCurrencyFact('CNY',{amount_cents:'1',original_minor:'1'}));
});
const account=(id,currency='USD')=>({id,fields:{name:`虚构${id}`,currency,side:'asset',counted:true}});
const observation=(minor,rate,date='2026-10-01')=>({amount_cents:convertCurrency('USD',minor,rate),original_minor:minor,fx_rate_micro:rate,date});
const draft=()=>({generation:'虚构',date:'2026-10-17',existing:null,rows:[{account:account('a'),previous:observation('10000','7000000')},{account:account('b'),previous:observation('10000','7000000')},{account:account('j','JPY'),previous:{amount_cents:'100'}}]});
test('虚构汇率建议按记录日期选择，历史不同率不改写且默认请求无新增键',()=>{
 const d=draft();d.rows[1].previous=observation('10000','8000000','2026-10-02');
 assert.deepEqual(rateSuggestions(d).USD,{rate:'8000000',date:'2026-10-02'});
 d.existing={date:'2026-10-17',entries:[{account_id:'a',state:'unchanged',...observation('1','500000')}]};
 assert.deepEqual(rateSuggestions(d).USD,{rate:'500000',date:'2026-10-17'});
 assert.deepEqual(snapshotEntryInput('a',{state:'unchanged',cents:'1',original_minor:'1',fx_rate_micro:'500000'}),{account_id:'a',state:'unchanged',amount_cents:null,original_minor:'1',fx_rate_micro:'500000'});
 assert.deepEqual(snapshotEntryInput('c',{state:'entered',cents:'0'}),{account_id:'c',state:'entered',amount_cents:'0'});
});
test('虚构原币增减/转账保留CNYexpected和原币expected；不同旧率及一分舍入拒绝',()=>{
 const d=draft();assert.ok(!quickTransferPairs(d).some(p=>p.to==='j'));
 const change=quickChanges(d,'a','delta','100','','','7000000')[0];assert.equal(change.original_minor,'10100');assert.equal(change.amount_cents,'70700');assert.equal(change.expected_previous,'70000');assert.equal(change.expected_original_minor,'10000');
 assert.deepEqual(quickChanges(d,'a','transfer','100','a','b','7000000').map(c=>c.amount_cents),['69300','70700']);
 d.rows[1].previous=observation('10000','8000000');assert.throws(()=>quickChanges(d,'a','transfer','1000','a','b','7200000'),/分别修改余额/);
 d.rows[0].previous=observation('1','500000');d.rows[1].previous=observation('1','500000');assert.throws(()=>quickChanges(d,'a','transfer','1','a','b','500000'),/分别修改余额/);
});
test('虚构停用账户的只读汇率建议：新账户可用，目标日未来不泄露，当天记录优先',()=>{
 const d={date:'2026-10-05',existing:null,rows:[{account:account('new'),previous:null}],rate_suggestions:{USD:{rate:'7000000',date:'2026-10-01'},JPY:{rate:'50000',date:'2026-10-09'}}};
 assert.deepEqual(rateSuggestions(d),{USD:{rate:'7000000',date:'2026-10-01'}});
 d.existing={date:d.date,entries:[{account_id:'new',...observation('100','8000000',d.date)}]};assert.equal(rateSuggestions(d).USD.rate,'8000000');assert.equal(rateSuggestions(d).USD.date,d.date);
});
