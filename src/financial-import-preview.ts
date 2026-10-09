// Browser layout fixtures only. Rust owns parsing, validation and persistence.
import type { ImportBatch, ImportPreview, ImportReceipt } from './financial-import';
const receipts=new Map<string,ImportReceipt>();
export function financialImportPreview(command:string,args:Record<string,unknown>,generation:string):{value:unknown}|null {
 const mode=new URLSearchParams(location.search).get('import')??'normal';
 if(command==='financial_import_cancel')return {value:null};
 if(command==='financial_import_progress')return {value:{phase:'正在核对完整日期组',checkpoints:12,cancelled:false}};
 if(command==='financial_import_template')return {value:null};
 if(command==='financial_import_read_file' && new URLSearchParams(location.search).get('import-kind')==='incomes')return {value:{name:'虚构收入.csv',csv_text:'income_key,date,net_income,hpf_deposit,note\nu,2026-08-10,100.01,,虚构未知缴存\nz,2026-08-10,100.01,0,虚构零缴存\n'}};
 if(command==='financial_import_read_file')return {value:{name:'虚构历史.csv',csv_text:'account_key,name,kind,enabled_from,disabled_from,counted,platform,note\na,虚构历史账户,cash,2024-01-01,,true,虚构平台,\n'}};
 if(command==='financial_import_receipt')return {value:receipts.get(String(args.request))??null};
 if(command==='financial_import_commit') {
  const input=args.input as {request_id:string;batch:ImportBatch};
  const r:ImportReceipt={request_id:input.request_id,batch_fingerprint:'browser-layout-only',source_name:input.batch.source_name,mapping_set_id:input.batch.mapping_set_id,created_at:'2026-10-09T08:00:00Z',origin_before:null,origin_after:'fictional-snapshot',origin_changed:true,counts:{new_accounts:1,new_snapshots:1,same:0,conflicts:0,errors:0,created_accounts:1,created_snapshots:1,corrected:0,skipped:0},objects:[{kind:'account',external_key:'a',id:'fictional-account',action:'create',revision_before:null,revision_after:1},{kind:'snapshot',external_key:'s',id:'fictional-snapshot',action:'create',revision_before:null,revision_after:1}]};if(input.batch.files.some(f=>f.kind==='incomes')) {const p=incomeLayout(input.batch,generation,mode);r.objects=p.objects.map(o=>({kind:o.kind,external_key:o.external_key,id:o.id,action:'create',revision_before:null,revision_after:1}));r.counts={...p.counts,created_incomes:p.objects.length};r.origin_changed=false;r.origin_after=null;}receipts.set(input.request_id,r);return {value:r};
 }
 if(command!=='financial_import_preview')return null;
 const b=args.input as ImportBatch;
 if(b.files.some(f=>f.kind==='incomes')) return {value:incomeLayout(b,generation,mode)};
 const f={name:'虚构历史账户',institution:'虚构平台',side:'asset' as const,kind:'cash',counted:true,opened_on:'2024-01-01',closed_on:null,notes:''};
 const row={account_id:'fictional-account',state:'entered',amount_cents:'1234567',side:'asset',kind:'cash',counted:true};
 const objects:ImportPreview['objects']=mode==='empty'?[]:[{key:'account:a',kind:'account',external_key:'a',id:'fictional-account',source_rows:[2],status:'new',action:'create',expected_revision:null,before:null,after:f},{key:'snapshot:s',kind:'snapshot',external_key:'s',id:'fictional-snapshot',source_rows:[2,3],status:mode==='unknown'?'conflict':mode==='error'?'error':'new',action:b.actions['snapshot:s']?.action??(mode==='normal'?'create':'unresolved'),expected_revision:mode==='unknown'?2:null,before:mode==='unknown'?{date:'2024-01-31',notes:'旧不完整盘点',entries:[{...row,state:'missing',amount_cents:null}]}:null,after:{date:'2024-01-31',notes:'虚构历史',entries:[row]}}];
 const p:ImportPreview={generation,context_digest:'browser-context-only',normalized_digest:'browser-normalized-only',file_fingerprints:{accounts:'layout'},objects,total:objects.length,page:0,issues:mode==='error'?[{file:'虚构盘点.csv',code:'AMOUNT_REQUIRED',severity:'error',source_row:3,column:'amount',object_key:'snapshot:s',message:'盘点余额不能为空；明确零请写 0，未知请补录。',blocking:!b.actions['snapshot:s']}]:[],counts:{new_accounts:objects.length?1:0,new_snapshots:mode==='normal'?1:0,same:0,conflicts:mode==='unknown'?1:0,errors:mode==='error'?1:0,created_accounts:0,created_snapshots:0,corrected:0,skipped:0},can_commit:mode==='normal'||(objects.length>0&&!!b.actions['snapshot:s']),accounts:[{id:'fictional-account',fields:f,position:0,revision:2,latest:null}],external_keys:{a:'fictional-account'},referenced_keys:['a'],account_names:{'fictional-account':f.name},origin_before:null,prior_receipt:null};
 if(mode==='deleted'||mode==='purged') {
  p.can_commit=false;p.accounts=[];
  p.prior_receipt={unavailable_objects:1,request_id:'fictional-prior',batch_fingerprint:'browser-layout-only',source_name:b.source_name,mapping_set_id:b.mapping_set_id,created_at:'2026-10-08T08:00:00Z',origin_before:null,origin_after:null,origin_changed:false,counts:{...p.counts,created_accounts:1,created_snapshots:0},objects:[{kind:'account',external_key:'a',id:'fictional-account',action:'create',revision_before:null,revision_after:1}]};
 }
 return {value:p};
}

function incomeLayout(b:ImportBatch,generation:string,mode:string):ImportPreview {
 const after={date:'2026-08-10',net_cents:'10001',hpf_cents:mode==='unknown'?null:'0',notes:'虚构月度收入'};
 const objects:ImportPreview['objects']=mode==='empty'?[]:[{key:'income:u',kind:'income',external_key:'u',id:'fictional-income',source_rows:[2],status:mode==='error'?'error':'new',action:mode==='error'?'unresolved':'create',expected_revision:null,before:null,after}];
 return {generation,context_digest:'browser-context-only',normalized_digest:'browser-normalized-only',file_fingerprints:{incomes:'layout'},objects,total:objects.length,page:0,issues:mode==='error'?[{file:'虚构收入.csv',code:'AMOUNT_FORMAT',severity:'error',source_row:2,column:'net_income',object_key:null,message:'税后到账须为非负金额，最多两位小数；请修正原文件。',blocking:true}]:[],counts:{new_accounts:0,new_snapshots:0,new_incomes:mode==='error'?0:objects.length,same:0,conflicts:0,errors:mode==='error'?1:0,created_accounts:0,created_snapshots:0,created_incomes:0,corrected:0,skipped:0},can_commit:objects.length>0&&mode!=='error',accounts:[],external_keys:{},referenced_keys:[],account_names:{},origin_before:null,prior_receipt:null};
}
