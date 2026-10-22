import { incomeCategories } from './income-classification';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CloseButton } from './CloseButton';
import { FormRow } from './FormControls';
import { errorMessage } from './asset';
import { kindLabel, pendingKey, storedPending, code } from './wealth';
import { columns, csvHeaders, selectAction, receiptMetadata, importMoney, previewPageCount, mappingCandidates, receiptPage, sourceRowsLabel } from './financial-import';
import type { ImportFile, ImportBatch, ImportCommit, ImportPreview, ImportReceipt, ImportObject, ImportAction } from './financial-import';
import './financial-import.css';
import { t } from './i18n.ts';
function receiptAvailability(receipt: Pick<ImportReceipt, 'created_at' | 'unavailable_objects'>): string {
 const count = receipt.unavailable_objects ?? 0;
 return count > 0 ? `这个文件已于 ${receipt.created_at.slice(0,10)} 导入，其中 ${count} 条记录已被删除或永久清除。可从最近删除找回尚未永久清除的记录；也可修改文件内容，重新核对表格编号或换用另一套账户对应方案后导入。已永久清除的记录在原方案中用过的表格编号不能再关联新记录。系统识别为同一批内容时不会重复写入。` : '';
}

export function FinancialImportDialog({ generation, onClose, mode = 'accounts', recoveryOnly = false, currentGeneration = generation, onViewFinance }: { mode?:'accounts'|'incomes'; generation:string; currentGeneration?:string|null; recoveryOnly?:boolean; onViewFinance?:(target:'income'|'accounts'|'snapshots')=>void; onClose:(saved:boolean)=>void }) {
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),job=useRef<string|null>(null),sequence=useRef(0),lastCommit=useRef<ImportCommit|null>(null);
 const initial=storedPending();
 const [issuePage,setIssuePage]=useState(0),[mappingPage,setMappingPage]=useState(0),[mappingSearch,setMappingSearch]=useState(''),[receiptPageIndex,setReceiptPageIndex]=useState(0);
 const [batch,setBatch]=useState<ImportBatch>({generation,source_name:'历史表格',mapping_set_id:mode==='incomes'?'收入映射':'账户映射',files:[],mappings:{},actions:{},page:0});
 const [step,setStep]=useState(recoveryOnly||initial?.command==='financial_import_commit'?4:1),[preview,setPreview]=useState<ImportPreview|null>(null),[dirty,setDirty]=useState(true);
 const [busy,setBusy]=useState(''),[progress,setProgress]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[receipt,setReceipt]=useState<ImportReceipt|null>(null);
 const [unresolved,setUnresolved]=useState(initial?.command==='financial_import_commit'?initial:null);
 const [backup,setBackup]=useState<string|null>(null),[withoutBackup,setWithoutBackup]=useState(false);
 useEffect(()=>{dialog.current?.showModal();return()=>{alive.current=false;sequence.current++;const id=job.current;if(id)void invoke('financial_import_cancel',{jobId:id}).catch(()=>{});dialog.current?.close();};},[]);
 useEffect(()=>{if(!busy||!job.current)return;const timer=window.setInterval(()=>{const id=job.current;if(id)void invoke<{phase:string}|null>('financial_import_progress',{jobId:id}).then(p=>{if(alive.current&&job.current===id)setProgress(p?.phase??'');}).catch(()=>{});},250);return()=>window.clearInterval(timer);},[busy]);
 function update(next:ImportBatch){sequence.current++;if(job.current)void invoke('financial_import_cancel',{jobId:job.current}).catch(()=>{});job.current=null;setBusy('');setBatch(next);setDirty(true);setError('');setWithoutBackup(false);lastCommit.current=null;}
 async function readPreview(next:ImportBatch,target:number){
  if(recoveryOnly||storedPending())return;
  const old=job.current;if(old)void invoke('financial_import_cancel',{jobId:old}).catch(()=>{});
  const id=crypto.randomUUID(),ticket=++sequence.current;job.current=id;setBusy('正在解析并核对整批资料');setProgress('');setError('');
  try{const result=await invoke<ImportPreview>('financial_import_preview',{input:next,jobId:id});if(!alive.current||ticket!==sequence.current)return;setPreview(result);setIssuePage(0);setDirty(false);setStep(target);setBatch({...next,page:result.page});if(result.prior_receipt)setNotice(receiptAvailability(result.prior_receipt)||'这批内容已经导入，可以查看上次的导入结果。');else setNotice('');}
  catch(e){if(alive.current&&ticket===sequence.current){setDirty(true);setError(code(e)==='CANCELLED'?'解析已取消，未提交任何资料。':errorMessage(e));}}
  finally{if(alive.current&&ticket===sequence.current){job.current=null;setBusy('');}}
 }
 async function choose(){
  if(recoveryOnly||storedPending())return;
  const ticket=++sequence.current;setBusy('正在读取 Excel 工作簿');setError('');
  try{const file=await invoke<{name:string;files:ImportFile[]}|null>('financial_import_read_workbook');if(!alive.current||ticket!==sequence.current)return;if(!file){setBusy('');return;}
   const next={...batch,files:file.files.map(f=>({...f,name:`${file.name} · ${f.name}`})),actions:{},mappings:{},page:0};setBatch(next);setDirty(true);setBackup(null);setWithoutBackup(false);lastCommit.current=null;await readPreview(next,1);
  }catch(e){if(alive.current&&ticket===sequence.current){setError(errorMessage(e));setBusy('');}}
 }
 async function template(sample:boolean){if(recoveryOnly||storedPending())return;setBusy('正在保存模板');try{const path=await invoke<string|null>('financial_import_template',{sample});if(alive.current)setNotice(path?'Excel 已保存。':'已取消保存。');}catch(e){if(alive.current)setError(errorMessage(e));}finally{if(alive.current)setBusy('');}}
 async function protect(){if(recoveryOnly||storedPending())return;setBusy('正在建立完整备份');setError('');setBackup(null);setWithoutBackup(false);try{const done=await invoke<{name:string;folder:string}|null>('create_backup');if(alive.current){if(done)setBackup(`${done.folder}/${done.name}`);else setError('备份已取消，本次尚未建立保护备份。');}}catch(e){if(alive.current)setError('备份失败，本次尚未建立保护备份。'+errorMessage(e));}finally{if(alive.current)setBusy('');}}
 // currentGeneration is only a read-only lookup target; the stored request is never rewritten.
 async function verify(currentDataset=false){
  if(!unresolved||(currentDataset&&!currentGeneration))return;setBusy('正在核对上次导入结果');setError('');
  try{const saved=await invoke<ImportReceipt|null>('financial_import_receipt',{request:unresolved.input.request_id,generation:currentDataset?currentGeneration:unresolved.input.generation});
   if(!saved&&currentDataset&&unresolved.input.generation!==currentGeneration){if(alive.current)setNotice('当前资料中没有这次导入的成功记录，不能据此判断原来的资料是否已导入。上次操作编号仍保留，请回到原来的资料中核对。');return;}
   localStorage.removeItem(pendingKey);if(saved){window.dispatchEvent(new Event('thingary-restored'));if(alive.current){setReceipt(saved);setNotice(receiptAvailability(saved)||'已确认整批提交成功。');}}else if(alive.current){setNotice('已确认这次没有导入。关闭后可从设置重新导入。');}
   if(alive.current)setUnresolved(null);
  }catch(e){if(alive.current){if(code(e)==='STALE_DATASET'){setNotice('已经切换资料，上次操作编号仍保留。请回到原来的资料核对，也可检查当前资料是否保留了同一次导入的成功记录；核对不会写入资料，不要在这里重复导入。');}else setError('暂时无法核对，上次操作编号已保留。'+errorMessage(e));}}
  finally{if(alive.current)setBusy('');}
 }
 async function commit(){
  if(recoveryOnly||!preview||dirty||!preview.can_commit||(!backup&&!withoutBackup)||storedPending())return;
  const input=lastCommit.current??{request_id:crypto.randomUUID(),batch:{...batch,page:0},context_digest:preview.context_digest,normalized_digest:preview.normalized_digest,file_fingerprints:preview.file_fingerprints};lastCommit.current=input;
  const metadata=receiptMetadata(input);
  try{localStorage.setItem(pendingKey,JSON.stringify(metadata));}catch{setError('无法保存这次操作的编号，尚未开始导入，请检查可用空间后重试。');return;}
  setUnresolved(metadata);setStep(4);setBusy('正在保存整批资料，关闭后仍需核对导入结果');setError('');
  try{const saved=await invoke<ImportReceipt>('financial_import_commit',{input});localStorage.removeItem(pendingKey);window.dispatchEvent(new Event('thingary-restored'));if(alive.current){setReceipt(saved);setUnresolved(null);setNotice(receiptAvailability(saved)||'整批导入已完成。');}}
  catch(e){
   try{const saved=await invoke<ImportReceipt|null>('financial_import_receipt',{request:input.request_id,generation:input.batch.generation});localStorage.removeItem(pendingKey);if(saved){window.dispatchEvent(new Event('thingary-restored'));if(alive.current){setReceipt(saved);setUnresolved(null);setNotice(receiptAvailability(saved)||'已确认上次导入成功。');}}else if(alive.current){setUnresolved(null);setStep(3);setError('已确认这次没有导入，整批资料都没有写入。'+errorMessage(e));}}
   catch(check){if(alive.current){setError('还不能确认是否导入成功；上次操作编号已保留，请核对导入结果，不要重复导入。'+errorMessage(check));setUnresolved(metadata);}}
  }finally{if(alive.current)setBusy('');}
 }
 function close(){sequence.current++;if(job.current)void invoke('financial_import_cancel',{jobId:job.current}).catch(()=>{});onClose(!!receipt);}
 function action(o:ImportObject,value:ImportAction['action']){const next={...batch,actions:selectAction(batch.actions,o,value),page:batch.page};setBatch(next);setDirty(true);lastCommit.current=null;void readPreview(next,3);}
 const disabled=recoveryOnly||!!busy||!!unresolved;
 return <dialog ref={dialog} className="editor financial-import-editor" aria-labelledby="financial-import-title" onCancel={e=>{e.preventDefault();close();}}>
  <form onSubmit={e=>e.preventDefault()}>
   <header><div><p className="eyebrow">{mode==='incomes'?t('月度收入'):t('账户与盘点')} {t('· 金融历史')}</p><h2 id="financial-import-title">{t('导入历史')}</h2><p className="muted">{t('账户、完整盘点与月度收入可以一起保存，全部成功才写入。金额单位元；欠款填正数；不会修改收益等假设或已保存的规划基准。')}</p></div><CloseButton type="button" aria-label={t('关闭历史导入')} onClick={close}/></header>
   <ol className="import-steps" aria-label={t('导入步骤')}>{['选择文件','对应账户与列','预览核对','确认与结果'].map((label,i)=><li key={label} aria-current={step===i+1?'step':undefined}>{i+1}. {label}</li>)}</ol>
   {error&&<p className="notice" role="alert">{error}</p>}{notice&&!(step===4&&receipt&&receiptAvailability(receipt))&&<p className="notice" role="status">{notice}</p>}
   {busy&&<div className="notice" role="status">{busy}…{job.current&&<><span>{progress&&` ${progress}。`}</span><progress aria-label={t('解析与核对进度')}/><button type="button" onClick={()=>{const id=job.current;if(id){sequence.current++;job.current=null;void invoke('financial_import_cancel',{jobId:id}).catch(()=>{});setBusy('');setDirty(true);setError('解析已取消，未提交任何资料。');}}}>{t('取消解析')}</button></>}</div>}
   {step===1&&<section className="form-block">
    <h3>{t('选择 Excel 工作簿')}</h3><p>{t('一个 .xlsx 文件，读取「账户」「完整盘点」「月度收入」工作表；空表不参加导入。每批内容最多 20 MiB、50000 数据行，解压后最多 64 MiB；每表最多 32 列。日期 YYYY-MM-DD，金额单位元、最多两位小数。空余额须补齐；收入缴存留空表示未知，0 表示明确没有。公式请先粘贴为值。')}</p>
    <div className="import-file-row"><div><strong>{t('账户、完整盘点与月度收入')}</strong><p className="muted">{batch.files.length?batch.files.map(f=>f.name).join('、'):t('尚未选择工作簿')}</p></div><button type="button" disabled={disabled} onClick={()=>void choose()}>{t('选择工作簿…')}</button><button type="button" disabled={disabled} onClick={()=>void template(false)}>{t('下载模板')}</button><button type="button" disabled={disabled} onClick={()=>void template(true)}>{t('虚构样例')}</button></div>
    <p className="muted">{t('只读取所选工作簿；关闭普通预览不保存草稿。金融历史导入不包含物品、图片或全部配置和关系，不能替代完整备份。')}</p>
    <FormRow label={t('来源名称')} hint={t('重新导入同一份历史时保持一致；不同表格请使用不同来源。')}><input aria-label={t('来源名称')} value={batch.source_name} maxLength={100} disabled={disabled} onChange={e=>update({...batch,source_name:e.target.value})}/></FormRow>
    <FormRow label={t('账户对应方案名称')} hint={t('保存表格编号与账户的对应关系；下次导入同一来源时沿用此名称，不按账户同名自动合并。')}><input aria-label={t('账户对应方案名称')} value={batch.mapping_set_id} maxLength={100} disabled={disabled} onChange={e=>update({...batch,mapping_set_id:e.target.value})}/></FormRow>
   </section>}
   {step===2&&<section className="form-block">
    <h3>{t('对应列')}</h3>{batch.files.map(file=>{let headers:string[]=[];try{headers=csvHeaders(file.csv_text);}catch{return <p key={file.kind} role="alert">{t('{name} 表头引号未闭合，请修正原文件。', { name: file.name })}</p>;}
     return <div key={file.kind}><h4>{file.name}</h4>{headers.map((header,i)=><FormRow key={`${header}-${i}`} label={header||t('空列名')}><select aria-label={t('{name} {header} 对应列', { name: file.name, header })} disabled={disabled} value={file.column_mapping[header]??(columns[file.kind].includes(header)?header:'')} onChange={e=>{const mapping={...file.column_mapping};if(e.target.value)mapping[header]=e.target.value;else delete mapping[header];update({...batch,files:batch.files.map(f=>f===file?{...f,column_mapping:mapping}:f)});}}><option value="">{t('不对应（多余列）')}</option>{columns[file.kind].map(c=><option key={c} value={c}>{c}</option>)}</select></FormRow>)}</div>;})}
    <h3>{t('对应账户')}</h3><p className="muted">{t('同名账户只作候选。账户文件中还没有对应账户的编号会创建新账户；盘点文件里的每个编号都必须对应实际账户。')}</p>
    <FormRow label={t('查找对应账户')} hint={t('按名称或平台搜索；每次最多展示 100 个候选。')}><input aria-label={t('查找对应账户')} value={mappingSearch} onChange={e=>setMappingSearch(e.target.value)}/></FormRow>
    {(preview?.referenced_keys??[]).slice(mappingPage*50,mappingPage*50+50).map(key=><FormRow key={key} label={key}><select aria-label={t('账户编号 {key}', { key })} disabled={disabled} value={batch.mappings[key]?.id??(preview?.accounts.some(a=>a.id===preview.external_keys[key])?preview.external_keys[key]:'')} onChange={e=>{const mappings={...batch.mappings};const a=preview?.accounts.find(a=>a.id===e.target.value);if(a)mappings[key]={id:a.id,expected_revision:a.revision};else delete mappings[key];update({...batch,mappings,actions:{},page:0});}}><option value="">{preview?.external_keys[key]?t('本批新账户'):t('选择对应账户／新账户需账户文件')}</option>{mappingCandidates(preview?.accounts??[],mappingSearch,batch.mappings[key]?.id??preview?.external_keys[key]).map(a=><option key={a.id} value={a.id}>{a.fields.name} · {kindLabel(a.fields.kind)} · {a.fields.institution||t('未填平台')}</option>)}</select></FormRow>)}
    <nav className="import-pagination" aria-label={t('账户对应关系分页')}><button type="button" disabled={disabled||mappingPage===0} onClick={()=>setMappingPage(p=>p-1)}>{t('上一批账户')}</button><span>{t('第')} {mappingPage+1} {t('/ {v1} 页', { v1: previewPageCount(preview?.referenced_keys.length??0) })}</span><button type="button" disabled={disabled||mappingPage+1>=previewPageCount(preview?.referenced_keys.length??0)} onClick={()=>setMappingPage(p=>p+1)}>{t('下一批账户')}</button></nav>
    <p className="muted">{t('历史账户类型（kind_at_date）与是否计入净资产（counted_at_date）表示当时的设置；留空使用账户现在的设置。历史类型须与账户的资产或负债方向一致，不改变账户现在的类型。')}</p>
   </section>}
   {step===3&&preview&&<section className="form-block">
    <h3>{t('整批核对')}</h3><p>{t('新增账户 {new_accounts} 个 · 新盘点 {new_snapshots} 次 · 新收入', { new_accounts: preview.counts.new_accounts, new_snapshots: preview.counts.new_snapshots })} {preview.counts.new_incomes??0} {t('条 · 相同 {same} 项 · 冲突 {conflicts} 项 · 错误提示', { same: preview.counts.same, conflicts: preview.counts.conflicts })} {preview.issues.filter(i=>i.blocking).length} {t('条')}</p>
    <p className="muted">{t('盘点按完整日期组处理；更正覆盖整组，不能逐行合并。相同表格编号且内容相同的记录会跳过；收入同日同额的不同编号不会合并。任何未处理冲突或所选集合错误都会阻止提交。')}</p>
    {!!preview.new_groups?.length&&<p className="notice" role="status">{t('将新建的分组：{v1}。仅在确认导入整批后保存。', { v1: preview.new_groups.join("、") })}</p>}
    {!preview.total&&<p className="empty">{t('没有可导入的账户、盘点或收入，请检查文件。')}</p>}
    {preview.objects.map(o=><article key={o.key} className="ui-card import-object"><div className="import-object-heading"><strong>{o.kind==='account'?t('账户'):o.kind==='income'?t('收入'):t('盘点')} · {o.external_key}</strong><span>{({new:'新增',same:'相同',conflict:'冲突',error:'错误'})[o.status]} · {o.action==='exclude'?t('已排除'):o.action==='correct'?t('整组更正'):o.action==='keep'?t('保留现有'):o.action==='unresolved'?t('待选择'):t('创建')}</span></div><p className="muted">{t('工作表行')} {sourceRowsLabel(o.source_rows.map(r=>batch.files.find(f=>f.kind===(o.kind==='account'?'accounts':o.kind==='income'?'incomes':'snapshots'))?.row_numbers?.[r]??r))} · {o.kind==='account'?String(o.after.name):String(o.after.date)}</p><ObjectDetails object={o} accounts={preview.accounts} names={preview.account_names}/>
     {(o.status==='conflict'||o.status==='error'||o.action==='exclude')&&<FormRow label={t('本项动作')}><select aria-label={t('{external_key} 冲突动作', { external_key: o.external_key })} value={batch.actions[o.key]?.action??''} disabled={disabled} onChange={e=>{if(e.target.value)action(o,e.target.value as ImportAction['action']);}}><option value="">{t('请选择整项处理')}</option>{o.status!=='error'&&<><option value="keep">{t('保留现有')}</option><option value="correct">{t('更正整项')}</option></>}<option value="exclude">{t('排除整项，不导入')}</option></select></FormRow>}
    </article>)}
    <nav className="import-pagination" aria-label={t('预览分页')}><button type="button" disabled={disabled||preview.page===0} onClick={()=>void readPreview({...batch,page:preview.page-1},3)}>{t('上一页')}</button><span>{t('第')} {preview.page+1} {t('/ {v1} 页 · 每页最多 50 项', { v1: previewPageCount(preview.total) })}</span><button type="button" disabled={disabled||preview.page+1>=previewPageCount(preview.total)} onClick={()=>void readPreview({...batch,page:preview.page+1},3)}>{t('下一页')}</button></nav>
    <div className="import-issues">{receiptPage(preview.issues,issuePage).map((i,n)=><p key={n} className={i.blocking?'notice':'muted'} role={i.blocking?'alert':undefined}>{i.file}{i.source_row!==null?` · 第 ${batch.files.find(f=>f.name===i.file)?.row_numbers?.[i.source_row]??i.source_row} 行`:''}{i.column?` · ${i.column}`:''}：{i.message}{!i.blocking&&i.severity==='error'?t('（已明确排除）'):''}</p>)}</div>{preview.issues.length>50&&<nav className="import-pagination" aria-label={t('问题分页')}><button type="button" disabled={issuePage===0} onClick={()=>setIssuePage(p=>p-1)}>{t('上一批问题')}</button><span>{t('问题第')} {issuePage+1} {t('/ {v1} 页', { v1: previewPageCount(preview.issues.length) })}</span><button type="button" disabled={issuePage+1>=previewPageCount(preview.issues.length)} onClick={()=>setIssuePage(p=>p+1)}>{t('下一批问题')}</button></nav>}
    <h3>{t('导入前完整备份')}</h3><p>{t('更正会改变历史事实。建议先建立完整备份，整体回退请用备份恢复。')}</p><button type="button" disabled={disabled} onClick={()=>void protect()}>{t('建立完整备份…')}</button>
    {backup?<p className="notice">{t('已建立备份：{backup}', { backup })}</p>:<label className="import-check"><input type="checkbox" checked={withoutBackup} disabled={disabled} onChange={e=>setWithoutBackup(e.target.checked)}/>{t('我确认本次尚未建立保护备份，仍继续导入')}</label>}
   </section>}
   {step===4&&<section className="form-block">
    {unresolved&&<><h3>{t('提交结果待核对')}</h3><p>{t('上次操作编号：{request_id}', { request_id: unresolved.input.request_id })}</p><p>{t('这里只保留上次操作的编号，没有保存原始 Excel。请先核对那次是否导入成功，不要重新选择文件重复导入。')}</p><button type="button" disabled={!!busy} onClick={()=>void verify()}>{t('核对上次导入结果')}</button>{currentGeneration&&unresolved.input.generation!==currentGeneration&&<button type="button" disabled={!!busy} onClick={()=>void verify(true)}>{t('在当前资料中检查同一次导入（不写入）')}</button>}</>}
    {receipt&&<><h3>{t('整批导入结果')}</h3>{receiptAvailability(receipt)&&<p className="notice" role="status">{receiptAvailability(receipt)}</p>}<p>{receipt.unavailable_objects?t('原导入记录：'):''}{t('账户新增 {created_accounts} 个 · 盘点新增 {created_snapshots} 次 · 收入新增', { created_accounts: receipt.counts.created_accounts, created_snapshots: receipt.counts.created_snapshots })} {receipt.counts.created_incomes??0} {t('条 · 更正 {corrected} 项 · 跳过 {skipped} 项', { corrected: receipt.counts.corrected, skipped: receipt.counts.skipped })}</p><p>{receipt.origin_changed?t('起点盘点已改变，请复核当前计划来源。'):t('起点盘点没有改变。')}{t('每月能存的钱、收益等假设和已保存的规划基准都没有自动改变。')}</p><p className="muted">{receipt.source_name} · {receipt.mapping_set_id} · {receipt.created_at}<br/>{t('操作编号：{request_id}', { request_id: receipt.request_id })}</p><details><summary>{t('查看各条记录及修改版本（{length} 项）', { length: receipt.objects.length })}</summary><div className="import-receipt-list">{receiptPage(receipt.objects,receiptPageIndex).map((r,i)=><p key={i}>{r.kind==='account'?t('账户'):r.kind==='income'?t('收入'):t('盘点')} · {r.external_key} · {r.action==='create'?t('新增'):r.action==='correct'?t('更正'):t('跳过')} {t('· 修改版本')} {r.revision_before??t('新建')} → {r.revision_after??t('未知')}<br/><small>{r.id}</small></p>)}</div><nav className="import-pagination" aria-label={t('导入结果分页')}><button type="button" disabled={receiptPageIndex===0} onClick={()=>setReceiptPageIndex(p=>p-1)}>{t('上一批结果')}</button><span>{t('第')} {receiptPageIndex+1} {t('/ {v1} 页', { v1: previewPageCount(receipt.objects.length) })}</span><button type="button" disabled={receiptPageIndex+1>=previewPageCount(receipt.objects.length)} onClick={()=>setReceiptPageIndex(p=>p+1)}>{t('下一批结果')}</button></nav></details></>}
    {receipt&&onViewFinance&&<div className="actions">{(['income','accounts','snapshots'] as const).map(target=>{const kind=target==='income'?'income':target==='accounts'?'account':'snapshot';return receipt.objects.some(o=>o.kind===kind&&(o.action==='create'||o.action==='correct'))&&<button key={target} type="button" onClick={()=>{close();onViewFinance(target);}}>{t('查看')}{target==='income'?t('收入'):target==='accounts'?t('账户'):t('盘点')}</button>;})}</div>}
    {!unresolved&&!receipt&&<p>{t('还没有已完成的导入记录。可以关闭后重新选择文件。')}</p>}
   </section>}
   <footer><button type="button" onClick={close}>{receipt?t('完成'):t('关闭')}</button>{step>1&&step<4&&<button type="button" disabled={disabled} onClick={()=>setStep(step-1)}>{t('上一步')}</button>}
    {step===1&&<button type="button" className="primary" disabled={disabled||!batch.files.length} onClick={()=>void readPreview(batch,2)}>{t('对应账户与列')}</button>}
    {step===2&&<button type="button" className="primary" disabled={disabled} onClick={()=>void readPreview({...batch,page:0},3)}>{t('预览所选集合')}</button>}
    {step===3&&preview?.prior_receipt&&<button type="button" className="primary" disabled={disabled} onClick={()=>{setReceipt(preview.prior_receipt);setStep(4);}}>{t('查看上次导入结果')}</button>}{step===3&&!preview?.prior_receipt&&<button type="button" className="primary" disabled={disabled||dirty||!preview?.can_commit||(!backup&&!withoutBackup)} onClick={()=>void commit()}>{t('确认导入整批')}</button>}
   </footer>
  </form>
 </dialog>;
}
function ObjectDetails({object:o,accounts,names}:{object:ImportObject;names:Record<string,string>;accounts:ImportPreview['accounts']}){
 const [rowPage,setRowPage]=useState(0);
 if(o.kind==='account')return <details><summary>{t('查看账户字段')}{o.before?t('差异'):''}</summary><dl className="import-fields">{Object.entries(o.after).filter(([key])=>key!=='group_id').map(([key,value])=><div key={key}><dt>{({name:'名称',institution:'平台',side:'方向',kind:'类型',counted:'计入净资产',opened_on:'启用日期',closed_on:'停用日期',notes:'备注',group_name:'分组'} as Record<string,string>)[key]??key}</dt><dd>{o.before&&<span>{t('现有：{v1} →', { v1: accountField(key,o.before[key]) })} </span>}{t('导入：{v1}', { v1: accountField(key,value) })}</dd></div>)}</dl></details>;
 if(o.kind==='income')return <details><summary>{t('查看收入字段')}{o.before?t('差异'):''}</summary><dl className="import-fields">{Object.entries(o.after).map(([key,value])=><div key={key}><dt>{({date:'到账日期',net_cents:'税后到账',hpf_cents:'公积金缴存',notes:'备注',category:'来源分类',source_account_id:'来源账户',destination:'收入去向',receiving_account_id:'接收账户',legacy_estimate_unavailable:'停用旧口径估计',classification_changed:'分类已更正'} as Record<string,string>)[key]??key}</dt><dd>{o.before&&<span>{t('现有：{v1} →', { v1: incomeField(key,o.before[key],names,accounts) })} </span>}{t('导入：{v1}', { v1: incomeField(key,value,names,accounts) })}</dd></div>)}</dl></details>;
 const rows=o.after.entries as {account_id:string;amount_cents:string|null;kind:string;counted:boolean;side:string}[];
 const before=(o.before?.entries??[]) as typeof rows;
 return <details><summary>{t('完整组余额与历史含义（{length} 个账户）', { length: rows.length })}</summary><div className="import-table-wrap"><table className="ui-table"><thead><tr><th>{t('账户')}</th>{o.before&&<th>{t('现有')}</th>}<th>{t('导入余额')}</th><th>{t('历史类型 / 范围')}</th></tr></thead><tbody>{rows.slice(rowPage*50,rowPage*50+50).map(r=>{const old=before.find(e=>e.account_id===r.account_id);return <tr key={r.account_id}><td>{names[r.account_id]??accounts.find(a=>a.id===r.account_id)?.fields.name??t('历史账户')}</td>{o.before&&<td>{old?`${importMoney(old.amount_cents)} · ${kindLabel(old.kind)} · ${old.counted?'计入':'不计入'}`:t('现有无此行')}</td>}<td>{r.side==='liability'?t('欠 '):''}{importMoney(r.amount_cents)}</td><td>{kindLabel(r.kind)} · {r.counted?t('计入'):t('不计入')}</td></tr>;})}</tbody></table></div>{rows.length>50&&<nav className="import-pagination" aria-label={t('组内账户分页')}><button type="button" disabled={rowPage===0} onClick={()=>setRowPage(p=>p-1)}>{t('上一批组内账户')}</button><span>{t('第')} {rowPage+1} {t('/ {v1} 页', { v1: previewPageCount(rows.length) })}</span><button type="button" disabled={rowPage+1>=previewPageCount(rows.length)} onClick={()=>setRowPage(p=>p+1)}>{t('下一批组内账户')}</button></nav>}<p>{t('导入备注：{v1}', { v1: String(o.after.notes||'未填') })}{o.before&&<> {t('· 现有备注：{v1}', { v1: String(o.before.notes||'未填') })}</>}</p></details>;
}

function accountField(key:string,value:unknown):string {
 if(value===null||value===undefined||value==='')return '未填';
 if(key==='counted')return value?'计入':'不计入';
 if(key==='side')return value==='liability'?'负债':'资产';
 if(key==='kind')return kindLabel(String(value));
 return String(value);
}

function incomeField(key:string,value:unknown,names:Record<string,string>,accounts:ImportPreview['accounts']):string {
 if(key==='source_account_id'||key==='receiving_account_id')return value ? names[String(value)]??accounts.find(a=>a.id===value)?.fields.name??'历史账户（当前不可用）' : '未指定';
 if(key==='legacy_estimate_unavailable'||key==='classification_changed')return value===true?'是':'否';
 if(key==='category')return incomeCategories[String(value) as keyof typeof incomeCategories]??'未分类';
 if(key==='destination')return ({retained:'留在来源账户',transferred:'转到其他账户',unknown:'去向未确认'} as Record<string,string>)[String(value)]??'未指定';
 return key==='net_cents'||key==='hpf_cents'?importMoney(value===null?null:String(value)):String(value||'未填');
}
