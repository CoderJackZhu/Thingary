import type { Account, Pending } from './wealth.ts';
export type FileKind = 'accounts' | 'snapshots';
export type ImportFile = { kind:FileKind; name:string; csv_text:string; column_mapping:Record<string,string> };
export type ImportAction = { action:'keep'|'correct'|'exclude'; expected_revision:number|null };
export type ImportBatch = { generation:string; source_name:string; mapping_set_id:string; files:ImportFile[]; mappings:Record<string,{id:string;expected_revision:number}>; actions:Record<string,ImportAction>; page:number };
export type ImportObject = { key:string;kind:'account'|'snapshot';external_key:string;id:string;source_rows:number[];status:'new'|'same'|'conflict'|'error';action:string;expected_revision:number|null;before:Record<string,unknown>|null;after:Record<string,unknown> };
export type ImportIssue = { file:string;code:string;severity:string;source_row:number|null;column:string|null;object_key:string|null;message:string;blocking:boolean };
export type ImportCounts = { new_accounts:number;new_snapshots:number;same:number;conflicts:number;errors:number;created_accounts:number;created_snapshots:number;corrected:number;skipped:number };
export type ImportReceipt = { request_id:string;batch_fingerprint:string;source_name:string;mapping_set_id:string;objects:{kind:string;external_key:string;id:string;action:string;revision_before:number|null;revision_after:number|null}[];counts:ImportCounts;created_at:string;origin_before:string|null;origin_after:string|null;origin_changed:boolean };
export type ImportPreview = { generation:string;context_digest:string;normalized_digest:string;file_fingerprints:Record<string,string>;objects:ImportObject[];total:number;page:number;issues:ImportIssue[];counts:ImportCounts;can_commit:boolean;accounts:Account[];external_keys:Record<string,string>;referenced_keys:string[];account_names:Record<string,string>;origin_before:string|null;prior_receipt:ImportReceipt|null };
export type ImportCommit = { request_id:string;batch:ImportBatch;context_digest:string;normalized_digest:string;file_fingerprints:Record<string,string> };
export const columns:Record<FileKind,string[]> = {
 accounts:['account_key','name','kind','enabled_from','disabled_from','counted','platform','note'],
 snapshots:['snapshot_key','date','account_key','amount','note','kind_at_date','counted_at_date'],
};
/** Read only the first logical record for the mapping UI; all data validation remains Rust-owned. */
export function csvHeaders(text:string):string[] {
 const result:string[]=[];let value='',quoted=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){result.push(value);value='';}
  else if((c==='\r'||c==='\n')&&!quoted){result.push(value);return result;}
  else value+=c;
 }
 if(quoted)throw new Error('表头引号未闭合，请修正 CSV。');
 return text.length?[...result,value]:[];
}
export function replaceFile<T extends Pick<ImportBatch,'files'|'actions'|'page'>>(batch:T,file:ImportFile):T {
 return {...batch,files:[...batch.files.filter(f=>f.kind!==file.kind),file],actions:{},page:0};
}
export function selectAction(actions:Record<string,ImportAction>,object:Pick<ImportObject,'key'|'expected_revision'>,action:ImportAction['action']):Record<string,ImportAction> {
 return {...actions,[object.key]:{action,expected_revision:object.expected_revision}};
}
export const previewPageCount=(total:number)=>Math.max(1,Math.ceil(total/50));
/** Integer formatting avoids binary floating point even at the maximum supported cents. */
export function importMoney(cents:string|null):string {
 if(cents===null)return '金额未知';
 const value=BigInt(cents),abs=value<0n?-value:value;
 return `${value<0n?'−':''}¥${(abs/100n).toLocaleString('zh-CN')}.${(abs%100n).toString().padStart(2,'0')}`;
}
export function receiptMetadata(input:Pick<ImportCommit,'request_id'|'batch'>):Pending {
 return {command:'financial_import_commit',input:{request_id:input.request_id,generation:input.batch.generation},label:'金融历史导入'};
}
/** Keep the selected stable ID visible even when it is outside the first search page. */
export function mappingCandidates(accounts:Account[],search:string,selectedId:string|undefined,limit=100):Account[] {
 const selected=accounts.find(a=>a.id===selectedId),result:Account[]=selected?[selected]:[];
 const word=search.trim().toLowerCase();
 for(const a of accounts){if(result.length>=limit)break;if(a.id!==selectedId&&[a.fields.name,a.fields.institution].some(t=>t.toLowerCase().includes(word)))result.push(a);}
 return result;
}
export function receiptPage<T>(objects:T[],page:number):T[] {return objects.slice(page*50,page*50+50);}

/** Physical source rows remain exact in the payload, with a bounded range label in the UI. */
export function sourceRowsLabel(rows:number[]):string {
 const ranges:string[]=[];
 for(let i=0;i<rows.length;i++){const start=rows[i];let end=start;while(i+1<rows.length&&rows[i+1]===end+1)end=rows[++i];ranges.push(start===end?String(start):`${start}–${end}`);}
 return ranges.slice(0,8).join('、')+(ranges.length>8?`等 ${rows.length} 行`:'');
}

/** Restore invalidates a preview, but must not erase an unknown submitted result. */
export function preserveImportReceipt(raw:string|null):boolean {
 try {const p=JSON.parse(raw??'null');return p?.command==='financial_import_commit'&&typeof p.input?.request_id==='string'&&typeof p.input?.generation==='string';}catch{return false;}
}
