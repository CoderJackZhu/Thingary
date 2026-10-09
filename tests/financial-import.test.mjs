import test from 'node:test';
import assert from 'node:assert/strict';
import { csvHeaders, replaceFile, selectAction, receiptMetadata, importMoney, previewPageCount, mappingCandidates, receiptPage, sourceRowsLabel, preserveImportReceipt, receiptAvailability } from '../src/financial-import.ts';
test('header mapping handles BOM, quotes, commas and Chinese without parsing amounts',()=>{
 assert.deepEqual(csvHeaders('\ufeff"账户,编号",名称,"备\n注"\r\na,b,c'),['账户,编号','名称','备\n注']);
 assert.throws(()=>csvHeaders('"broken'),/引号/);
});
test('file replacement does not keep stale mapping or action decisions',()=>{
 const b={files:[{kind:'accounts',csv_text:'old'}],mappings:{a:{id:'id',expected_revision:1}},actions:{'snapshot:s':{action:'correct',expected_revision:3}},page:2};
 const n=replaceFile(b,{kind:'accounts',csv_text:'new'});assert.equal(n.files.length,1);assert.equal(n.files[0].csv_text,'new');assert.deepEqual(n.actions,{});assert.equal(n.page,0);assert.equal(b.files[0].csv_text,'old');
});
test('selection always targets whole object with loaded revision, pagination includes final partial page',()=>{
 assert.deepEqual(selectAction({}, {key:'snapshot:k',expected_revision:4},'correct'),{'snapshot:k':{action:'correct',expected_revision:4}});
 assert.equal(previewPageCount(51),2);assert.equal(previewPageCount(0),1);
});
test('unknown is not zero and unresolved receipt stores metadata only',()=>{
 assert.equal(importMoney(null),'金额未知');assert.match(importMoney('0'),/0.00/);
 const input={request_id:'request',batch:{generation:'generation',files:[{csv_text:'private'}]}};
 assert.deepEqual(receiptMetadata(input),{command:'financial_import_commit',input:{request_id:'request',generation:'generation'},label:'金融历史导入'});
 assert.doesNotMatch(JSON.stringify(receiptMetadata(input)),/private|csv_text/);
});

test('large mapping search retains selected ID and receipt pagination is bounded',()=>{
 const accounts=Array.from({length:150},(_,i)=>({id:`id-${i}`,fields:{name:`虚构${i}`,institution:'虚构平台'}}));
 const rows=mappingCandidates(accounts,'','id-149');assert.equal(rows.length,100);assert.equal(rows[0].id,'id-149');
 assert.deepEqual(mappingCandidates(accounts,'虚构149','id-149').map(a=>a.id),['id-149']);
 assert.equal(receiptPage(accounts,2).length,50);assert.equal(receiptPage(accounts,3).length,0);
});

test('large source row labels preserve every row in bounded ranges',()=>{
 assert.equal(sourceRowsLabel([2,3,4,8,9,12]),'2–4、8–9、12');
 assert.equal(sourceRowsLabel(Array.from({length:50000},(_,i)=>i+2)),'2–50001');
 assert.equal(sourceRowsLabel([2,5,8,11,14,17,20,23,26]),'2、5、8、11、14、17、20、23等 9 行');
});

test('restore retains unresolved financial receipt metadata without retaining ordinary drafts',()=>{
 const metadata=receiptMetadata({request_id:'request',batch:{generation:'old-generation'}});
 assert.equal(preserveImportReceipt(JSON.stringify(metadata)),true);
 assert.equal(preserveImportReceipt(JSON.stringify({command:'wealth_account_save',input:{request_id:'request',generation:'old'}})),false);
 assert.equal(preserveImportReceipt('broken'),false);
 assert.equal(preserveImportReceipt(null),false);
});

test('expired receipts show the original date, missing objects and actionable next steps',()=>{
 const receipt={created_at:'2026-10-08T08:00:00Z',unavailable_objects:2};
 assert.match(receiptAvailability(receipt),/2026-10-08.*2 个对象已被删除或清除/);
 assert.match(receiptAvailability(receipt),/最近删除恢复/);
 assert.match(receiptAvailability(receipt),/更换映射集合/);
 assert.match(receiptAvailability(receipt),/同批指纹相同不会再次写入/);
 assert.equal(receiptAvailability({created_at:receipt.created_at}), '');
 assert.equal(receiptAvailability({...receipt,unavailable_objects:0}), '');
});
