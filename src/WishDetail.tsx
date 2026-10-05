import { usePendingReceipt } from './WealthPage';
import { storedPending } from './wealth';
import { CloseButton } from './CloseButton';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {money,errorMessage,localDay} from './asset';
import {defaultWishPreferences} from './preferences';
import {PhotoView} from './Photos';
import {DefaultAssetIcon} from './IconPicker';
import {FormRow} from './FormControls';
import {DateInput} from './DateInput';
import {wishDecisionLabel,verifyAssetPatch} from './wishlist';
import type {TaxonomySnapshot} from './taxonomy';
import type {CloseIntent} from './AssetEditor';
import type {AssetRecord} from './asset';
import type {WishlistChange, WishlistItem, WishLink, WishVerify, VerifyBase} from './wishlist';
const savingsKey='thingary.savings-pending.v1';
const decisionKey='thingary.wishlist-decision.v1';
const linkKey='thingary.wish-link-pending.v1';
const verifyKey='thingary.wish-verify-pending.v1';
type Saving={request_id:string;generation:string;id:string;expected_revision:number;mode:'add'|'total';cents:string};
import { loadAssetCandidates as linkCandidates, assetStateLabel, type AssetCandidate as LinkCandidate, type AssetCandidatePage as LinkPage } from './asset-picker';

export function WishDetail({onBusyChange,initial,generation,onClose,onEdit,onChange,onConvert,closeIntent,onKeepClose,onFinishClose,onOpenAsset,onOpenTrash,taxonomy}:{onBusyChange:(busy:boolean)=>void;onOpenAsset:(id:string)=>void;onOpenTrash:()=>void;onFinishClose:(intent:CloseIntent)=>void;taxonomy:TaxonomySnapshot|null;closeIntent:CloseIntent|null;onKeepClose:()=>void;initial:WishlistItem;generation:string;onClose:()=>void;onEdit:(i:WishlistItem)=>void;onChange:(i:WishlistItem)=>void;onConvert:(i:WishlistItem)=>void}){
 const lock=useRef(false);
 const receipt=usePendingReceipt(()=>{onChange(item);void reload()});
 const [item,setItem]=useState(initial),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [dropOpen,setDropOpen]=useState(false),[dropNote,setDropNote]=useState('');
 const [reconsiderOpen,setReconsiderOpen]=useState(false),[reconsiderNote,setReconsiderNote]=useState(initial.decision_note??'');
 const [verifyOpen,setVerifyOpen]=useState(false),[verifyNote,setVerifyNote]=useState('');
 const [verifyPrice,setVerifyPrice]=useState(''),[verifyDate,setVerifyDate]=useState('');
 const verifyBase=useRef<VerifyBase|null>(null);
 const [linkOffset,setLinkOffset]=useState<number|null>(null),[linkLoading,setLinkLoading]=useState(false);
 const linkRun=useRef(0);
 const [linkRetry,setLinkRetry]=useState(0);
 const [linkOpen,setLinkOpen]=useState(false),[candidates,setCandidates]=useState<LinkCandidate[]|null>(null),[linkError,setLinkError]=useState(''),[linkQuery,setLinkQuery]=useState('');
 // Retired savings receipts stay checkable here; they are never re-executed.
 const [oldSaving,setOldSaving]=useState<Saving|null>(null);
 const [decisionPending,setDecisionPending]=useState<WishlistChange|null>(null);
 const [linkPending,setLinkPending]=useState<WishLink|null>(null);
 const [verifyPending,setVerifyPending]=useState<WishVerify|null>(null);
 const wishIdOf=(input:unknown)=>{const a=(input as {action?:{wishlist_id?:string}}).action;return typeof a?.wishlist_id==='string'?a.wishlist_id:(input as {wishlist_id?:string}).wishlist_id};
 function readStored<T>(key:string):T|null{try{const v=JSON.parse(localStorage.getItem(key)||'null');return v&&typeof v.request_id==='string'?(v as T):null}catch{return null}}
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem(savingsKey)||'null');if(v?.generation===generation&&v?.id===initial.id)setOldSaving(v)}catch{}},[generation,initial.id]);
 // Crash recovery: a stored decision/link/verify receipt for this wish resumes here.
 useEffect(()=>{const d=readStored<WishlistChange>(decisionKey);if(d&&wishIdOf(d)===initial.id)setDecisionPending(d);const l=readStored<WishLink>(linkKey);if(l&&l.wishlist_id===initial.id)setLinkPending(l);const v=readStored<WishVerify>(verifyKey);if(v&&v.wishlist_id===initial.id)setVerifyPending(v)},[initial.id]);
 const pending=decisionPending||linkPending||verifyPending||oldSaving;
 async function reload(){const fresh=await invoke<WishlistItem|null>('read_wishlist',{id:item.id});if(fresh)onChange(fresh)}
 useEffect(()=>{onBusyChange(busy||!!pending||!!receipt.pending||receipt.busy);return()=>onBusyChange(false)},[busy,pending,receipt.pending,receipt.busy,onBusyChange]);
 const noticeRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(notice)noticeRef.current?.scrollIntoView({block:'nearest'})},[notice]);
 const p=item.preferences??defaultWishPreferences();
 // 考虑替换的物品：读取其现有资料展示日期、状态与已有投入（§7.1）。
 const [replacementRecord,setReplacementRecord]=useState<AssetRecord|null>(null),[replacementError,setReplacementError]=useState(''),[replacementRetry,setReplacementRetry]=useState(0);
 useEffect(()=>{const id=item.replacement_asset?.id;setReplacementRecord(null);setReplacementError('');if(!id)return;let live=true;invoke<AssetRecord|null>('read_asset',{id}).then(r=>{if(live){setReplacementRecord(r);if(!r)setReplacementError('原物品已删除或不存在，请重新读取心愿。')}}).catch(e=>{if(live)setReplacementError(errorMessage(e))});return()=>{live=false}},[item.replacement_asset?.id,item.revision,replacementRetry]);
 const legacy=item.decision_state==='legacy_achieved';
 const considering=item.decision_state==='considering';
 const purchased=item.decision_state==='purchased';
 const dropped=item.decision_state==='dropped';
 function storePending(key:string,input:unknown){try{localStorage.setItem(key,JSON.stringify(input));return true}catch{setNotice('暂时无法记录保存请求，请重试。');return false}}
 function clearPending(key:string){localStorage.removeItem(key);setDecisionPending(null);setLinkPending(null);setVerifyPending(null);setOldSaving(null)}
 // 决策写（不再考虑／重新考虑）走 change_wishlist 的回执核对路径。
 async function sendDecision(input:WishlistChange,done:(i:WishlistItem)=>void){
   if(lock.current)return;lock.current=true;setBusy(true);
   if(!storePending(decisionKey,input)){lock.current=false;setBusy(false);return}
   setDecisionPending(input);
   try{const saved=await invoke<WishlistItem>('change_wishlist',{input});localStorage.removeItem(decisionKey);setDecisionPending(null);setItem(saved);onChange(saved);done(saved)}
   catch(e){try{const checked=await invoke<WishlistItem|null>('saved_wishlist_request',{input});if(checked){localStorage.removeItem(decisionKey);setDecisionPending(null);setItem(checked);onChange(checked);done(checked)}else{localStorage.removeItem(decisionKey);setDecisionPending(null);setNotice(errorMessage(e))}}catch{setNotice(errorMessage(e)+' 原请求已保留，请稍后再核对。')}}
   finally{lock.current=false;setBusy(false)}
 }
 async function resolveDecision(){if(!decisionPending)return;setBusy(true);try{const checked=await invoke<WishlistItem|null>('saved_wishlist_request',{input:decisionPending});if(checked){localStorage.removeItem(decisionKey);setDecisionPending(null);setItem(checked);onChange(checked);setNotice('已核对：这次决定已保存。')}else{localStorage.removeItem(decisionKey);setDecisionPending(null);setNotice('已核对：这次决定没有保存。')}}catch(e){setNotice(errorMessage(e)+' 原请求仍保留，请点击“再次核对”。')}finally{setBusy(false)}}
 async function dropWish(){
   await sendDecision({request_id:crypto.randomUUID(),generation,expected_revision:item.revision,action:{type:'drop',wishlist_id:item.id,decision_note:dropNote.trim()}},()=>{setDropOpen(false);setNotice('已记录为不再考虑；档案与图片都保留着。')});
 }
 async function reconsider(){
   await sendDecision({request_id:crypto.randomUUID(),generation,expected_revision:item.revision,action:{type:'reconsider',wishlist_id:item.id,decision_note:reconsiderNote.trim()}},()=>{setReconsiderOpen(false);setNotice('已回到考虑中；上次的提醒不会自动恢复。')});
 }
 function openLink(){setLinkQuery('');setLinkOpen(true);}
 useEffect(()=>{
   const run=++linkRun.current;
   if(!linkOpen)return;
   setLinkError('');setCandidates(null);setLinkOffset(null);setLinkLoading(true);
   void linkCandidates(item.legacy_generated_asset?.id??null,linkQuery).then(page=>{
     if(run!==linkRun.current)return;
     setCandidates(page.items);setLinkOffset(page.nextOffset);
   }).catch(e=>{if(run===linkRun.current){setCandidates([]);setLinkError(errorMessage(e));}})
     .finally(()=>{if(run===linkRun.current)setLinkLoading(false);});
   return()=>{linkRun.current++;};
 },[linkOpen,linkQuery,item.id,item.legacy_generated_asset?.id,linkRetry]);
 async function moreLinks(){
   if(linkLoading||linkOffset===null)return;
   const run=linkRun.current;setLinkLoading(true);setLinkError('');
   try{
     const page=await linkCandidates(null,linkQuery,linkOffset);
     if(run!==linkRun.current)return;
     setCandidates(old=>[...(old??[]),...page.items.filter(c=>!old?.some(p=>p.id===c.id))]);setLinkOffset(page.nextOffset);
   }catch(e){if(run===linkRun.current)setLinkError(errorMessage(e));}
   finally{if(run===linkRun.current)setLinkLoading(false);}
 }
 async function linkAsset(assetId:string,assetRevision:number){
   const input:WishLink={request_id:crypto.randomUUID(),generation,wishlist_id:item.id,expected_revision:item.revision,asset_id:assetId,expected_asset_revision:assetRevision};
   if(lock.current)return;lock.current=true;setBusy(true);
   if(!storePending(linkKey,input)){lock.current=false;setBusy(false);return}
   setLinkPending(input);
   try{const saved=await invoke<WishlistItem>('link_wish_asset',{input});localStorage.removeItem(linkKey);setLinkPending(null);setItem(saved);onChange(saved);setLinkOpen(false);setNotice('已关联这件物品为本次购入；物品资料保持原样。')}
   catch(e){try{const checked=await invoke<WishlistItem|null>('saved_wish_feature',{request:input.request_id,generation});if(checked){localStorage.removeItem(linkKey);setLinkPending(null);setItem(checked);onChange(checked);setLinkOpen(false);setNotice('已核对：关联已保存。')}else{localStorage.removeItem(linkKey);setLinkPending(null);setLinkError(errorMessage(e))}}catch{setLinkError(errorMessage(e)+' 原请求已保留，请稍后再核对。')}}
   finally{lock.current=false;setBusy(false)}
 }
 async function openVerify(){
   if(lock.current)return;lock.current=true;setBusy(true);setNotice('');
   verifyBase.current=null;
   try{
     let record:AssetRecord|null=null;
     if(item.legacy_generated_asset){
       record=await invoke<AssetRecord|null>('read_asset',{id:item.legacy_generated_asset.id});
       if(!record)throw new Error('找不到原关联物品，请重新读取。');
     }
     verifyBase.current=record?.asset??null;
     setVerifyPrice(record?.asset.price_cents==null?'':String(Number(record.asset.price_cents)/100));
     setVerifyDate(record?.asset.purchase_date??'');setVerifyNote('');
     // Inputs appear only once their baseline has loaded, so a late read
     // cannot replace text the user has already begun editing.
     setVerifyOpen(true);
   }catch(e){setNotice(errorMessage(e));}
   finally{lock.current=false;setBusy(false);}
 }
 async function verify(outcome:'purchased'|'considering'|'dropped'){
   if(lock.current)return;
   let assetPatch:WishVerify['asset_patch']=null;
   if(outcome==='purchased'&&item.legacy_generated_asset){
     if(!verifyBase.current){setNotice('请先重新读取原物品。');return;}
     try{assetPatch=verifyAssetPatch(verifyBase.current,verifyPrice,verifyDate);}
     catch(e){setNotice(errorMessage(e));return;}
   }
   lock.current=true;setBusy(true);
   const input:WishVerify={request_id:crypto.randomUUID(),generation,wishlist_id:item.id,expected_revision:item.revision,outcome,decision_note:verifyNote.trim(),asset_patch:assetPatch};
   if(!storePending(verifyKey,input)){lock.current=false;setBusy(false);return}
   setVerifyPending(input);
   try{const saved=await invoke<WishlistItem>('verify_legacy_wish',{input});localStorage.removeItem(verifyKey);setVerifyPending(null);setItem(saved);onChange(saved);setVerifyOpen(false);setNotice(outcome==='purchased'?'已确认购入：复用原物品，未新建第二件。':outcome==='considering'?'已确认尚未购入，回到考虑中；旧版生成的物品仍在档案中。':'已记录为不再考虑；原物品保留在档案中。')}
   catch(e){try{const checked=await invoke<WishlistItem|null>('saved_wish_feature',{request:input.request_id,generation});if(checked){localStorage.removeItem(verifyKey);setVerifyPending(null);setItem(checked);onChange(checked);setVerifyOpen(false);setNotice('已核对：这次核实已保存。')}else{localStorage.removeItem(verifyKey);setVerifyPending(null);setNotice(errorMessage(e))}}catch{setNotice(errorMessage(e)+' 原请求已保留，请稍后再核对。')}}
   finally{lock.current=false;setBusy(false)}
 }
 async function resendLink(input:WishLink){if(lock.current)return;lock.current=true;setBusy(true);try{const saved=await invoke<WishlistItem>('link_wish_asset',{input});localStorage.removeItem(linkKey);setLinkPending(null);setItem(saved);onChange(saved);setLinkOpen(false);setNotice('已核对：关联已保存。')}catch(e){try{const checked=await invoke<WishlistItem|null>('saved_wish_feature',{request:input.request_id,generation});if(checked){localStorage.removeItem(linkKey);setLinkPending(null);setItem(checked);onChange(checked);setLinkOpen(false);setNotice('已核对：关联已保存。')}else{localStorage.removeItem(linkKey);setLinkPending(null);setNotice(errorMessage(e))}}catch{setNotice(errorMessage(e)+' 原请求仍保留，请稍后再核对。')}}finally{lock.current=false;setBusy(false)}}
 async function resendVerify(input:WishVerify){if(lock.current)return;lock.current=true;setBusy(true);try{const saved=await invoke<WishlistItem>('verify_legacy_wish',{input});localStorage.removeItem(verifyKey);setVerifyPending(null);setItem(saved);onChange(saved);setVerifyOpen(false);setNotice('已核对：这次核实已保存。')}catch(e){try{const checked=await invoke<WishlistItem|null>('saved_wish_feature',{request:input.request_id,generation});if(checked){localStorage.removeItem(verifyKey);setVerifyPending(null);setItem(checked);onChange(checked);setVerifyOpen(false);setNotice('已核对：这次核实已保存。')}else{localStorage.removeItem(verifyKey);setVerifyPending(null);setNotice(errorMessage(e))}}catch{setNotice(errorMessage(e)+' 原请求仍保留，请稍后再核对。')}}finally{lock.current=false;setBusy(false)}}
 async function checkOldSaving(){
   if(!oldSaving)return;setBusy(true);
   try{const saved=await invoke<WishlistItem|null>('saved_wish_feature',{request:oldSaving.request_id,generation});
     if(saved){localStorage.removeItem(savingsKey);setOldSaving(null);setItem(saved);onChange(saved);setNotice('已核对：这笔旧攒钱在升级前已保存，结果按历史数据显示。')}
     else{localStorage.removeItem(savingsKey);setOldSaving(null);setNotice('已核对：这笔旧攒钱没有提交。攒钱功能已停用，如需记录实际购入，请使用「已买到，记录购入」。')}}
   catch(e){setNotice(errorMessage(e)+' 暂时无法核对，请求仍保留。')}
   finally{setBusy(false)}
 }
 useEffect(()=>{if(closeIntent){if(busy||!!pending||!!receipt.pending||receipt.busy){setNotice('正在核对这次操作，请稍候。');onKeepClose()}else{onClose();onFinishClose(closeIntent)}}},[closeIntent]);
 const blocked=busy||!!pending||!!receipt.pending||receipt.busy;
 const stateLine=`${taxonomy?.categories.find(c=>c.id===item.fields.category_id)?.name||'未分类'} · ${wishDecisionLabel(item.decision_state)}${p.pinned?' · 置顶':''}`;
 return <aside className="ui-inspector wish-inspector" aria-labelledby="wish-detail-title"><header><CloseButton type="button" className="icon-button" disabled={blocked} aria-label="关闭心愿详情" onClick={onClose}/><div className="wish-detail-identity">{item.cover?<PhotoView photo={item.cover} generation={generation}/>:<DefaultAssetIcon/>}<div><p className="eyebrow">{wishDecisionLabel(item.decision_state)}</p><h2 id="wish-detail-title">{item.fields.name}</h2></div></div><button type="button" className="wish-edit" disabled={blocked} onClick={()=>onEdit(item)}>编辑</button></header>
 <div className="wish-detail-body">{receipt.pending&&<div className="notice">删除结果待确认。<button disabled={receipt.busy} onClick={()=>void receipt.verify()}>核对结果</button></div>}
 {oldSaving&&<div className="notice" role="status">有一笔升级前的攒钱提交结果待核对。<button disabled={busy} onClick={()=>void checkOldSaving()}>核对旧请求</button></div>}
 {decisionPending&&<div className="notice" role="status">上次「{decisionPending.action.type==='drop'?'不再考虑':'重新考虑'}」的结果待确认。<button disabled={busy} onClick={()=>void resolveDecision()}>再次核对</button></div>}
 {linkPending&&<div className="notice" role="status">上次关联物品的结果待确认。<button disabled={busy} onClick={()=>void resendLink(linkPending)}>再次核对</button></div>}
 {verifyPending&&<div className="notice" role="status">上次核实的结果待确认。<button disabled={busy} onClick={()=>void resendVerify(verifyPending)}>再次核对</button></div>}
 {legacy&&<section className="form-block wish-legacy" aria-label="历史待核实"><p className="notice">{item.legacy_generated_asset?'旧版因攒钱达标标为已实现，购入情况尚未确认。':'旧版已实现记录缺少购入确认来源，请核实。'}不急着处理，它的金额不计入考虑中合计。</p>
   {!verifyOpen?<div className="wish-verify-entry"><button type="button" className="primary" disabled={blocked} onClick={()=>void openVerify()}>核实这条旧记录…</button></div>
   :<div className="wish-verify">
     {item.legacy_generated_asset&&<><p><strong>{item.legacy_generated_asset.name}</strong>（旧版自动生成的物品）{item.legacy_generated_asset.deleted&&<>{' · '}<span className="muted">在最近删除中，确认购入会先恢复它</span></>}</p><FormRow label="补录实际价格（元）"><input aria-label="补录实际价格" inputMode="decimal" placeholder="留空保留原价格" value={verifyPrice} disabled={blocked} onChange={e=>setVerifyPrice(e.target.value)}/></FormRow><FormRow label="补录购入日期"><DateInput label="补录购入日期" id="wish-verify-date" value={verifyDate} max={localDay()} allowClear disabled={blocked} onChange={v=>setVerifyDate(v)}/></FormRow><button type="button" disabled={blocked} onClick={()=>void verify('purchased')}>{verifyPending?'核对中…':'确实已购入（复用原物品）'}</button></>}
     {!item.legacy_generated_asset&&<p className="muted">这条记录没有原关联物品；确认购入请直接记录这次购入或关联已有物品。</p>}
     <FormRow label="决定备注（可选）"><textarea aria-label="决定备注" rows={2} placeholder="这次决定的说明" value={verifyNote} disabled={blocked} onChange={e=>setVerifyNote(e.target.value)}/></FormRow>
     <div className="wish-verify-actions"><button type="button" disabled={blocked} onClick={()=>void verify('considering')}>尚未购入，继续考虑</button><button type="button" disabled={blocked} onClick={()=>void verify('dropped')}>不再考虑</button><button type="button" disabled={blocked} onClick={()=>setVerifyOpen(false)}>取消</button></div>
     {item.legacy_generated_asset&&<p className="muted">确认「尚未购入」后，旧关联只作为只读的历史生成关系保留；如为误记，请前往物品核对。</p>}
   </div>}
 </section>}
 <div className="inspector-metrics"><div><span>预计价格</span><strong>{money(item.fields.estimated_price_cents)}</strong></div>{item.fields.target_date&&<div><span>计划日期{item.fields.target_date<localDay()?'（已过）':''}</span><strong>{item.fields.target_date}</strong></div>}</div>
 <section className="form-block wish-facts"><FormRow label="添加时间">{p.added_date??localDay(new Date(item.created_at))}</FormRow>{item.fields.category_id&&<FormRow label="分类">{taxonomy?.categories.find(c=>c.id===item.fields.category_id)?.name||'未分类'}</FormRow>}{p.channel_id&&<FormRow label="可能购买的渠道">{taxonomy?.channels.find(c=>c.id===p.channel_id)?.name||'未选择'}</FormRow>}{item.fields.target_date&&<FormRow label="计划日期提醒">{p.reminder?'已开启（当日 9:00 单次通知）':'未开启'}</FormRow>}</section>
 {(item.fields.notes||item.fields.external_link||item.photos?.some(x=>x.id!==item.cover?.id))&&<section className="form-block form-notes wish-notes">{item.fields.notes&&<><h3>想买的理由与顾虑</h3><p className="notes">{item.fields.notes}</p></>}{item.fields.external_link&&<a href={item.fields.external_link} target="_blank" rel="noreferrer">相关链接</a>}<div className="photo-strip">{item.photos?.filter(x=>x.id!==item.cover?.id).map(photo=><PhotoView key={photo.id} photo={photo} generation={generation}/>)}</div></section>}
 {dropped&&item.decision_note&&<section className="form-block wish-decision-note"><h3>为什么不买</h3><p className="notes">{item.decision_note}</p></section>}
 {item.converted_asset&&<p className="wishlist-link">已购入物品：{item.converted_asset.name}{item.converted_asset.deleted?<button onClick={()=>{onClose();onOpenTrash()}}>关联物品在最近删除，前往恢复</button>:<button onClick={()=>{onClose();onOpenAsset(item.converted_asset!.id)}}>查看物品</button>}</p>}
 {item.replacement_asset&&<p className="wishlist-link">考虑替换的物品：{item.replacement_asset.name}{replacementRecord&&<small className="muted"> · {replacementRecord.asset.purchase_date??'购入日期未知'} · {assetStateLabel(replacementRecord.lifecycle?.state??'active')} · 已有总投入 {replacementRecord.costs.total_investment_cents===null?'未知':money(replacementRecord.costs.total_investment_cents)}{replacementRecord.costs.unknown_maintenance_count>0?`（${replacementRecord.costs.unknown_maintenance_count} 笔维护金额未知）`:''}</small>}{item.replacement_asset.deleted?<button onClick={()=>{onClose();onOpenTrash()}}>原物品在最近删除</button>:<button onClick={()=>{onClose();onOpenAsset(item.replacement_asset!.id)}}>查看物品</button>}</p>}
 {replacementError&&item.replacement_asset&&<p className="notice" role="alert">原物品资料读取失败：{replacementError} <button disabled={busy||!!pending} onClick={()=>setReplacementRetry(n=>n+1)}>重新读取物品</button></p>}
 {item.replacement_asset_name&&!item.replacement_asset&&<p className="wishlist-link muted">考虑替换的原物品「{item.replacement_asset_name}」已永久删除；可在编辑心愿中清除这条关系。</p>}
 {item.legacy_generated_asset&&(!item.converted_asset||item.converted_asset.id!==item.legacy_generated_asset.id)&&<p className="wishlist-link muted">旧版由此心愿自动生成：{item.legacy_generated_asset.name}{item.legacy_generated_asset.deleted?<button onClick={()=>{onClose();onOpenTrash()}}>物品在最近删除</button>:<button onClick={()=>{onClose();onOpenAsset(item.legacy_generated_asset!.id)}}>查看物品</button>}</p>}
 {p.mode==='savings'&&p.saved_cents!=='0'&&<details className="wish-legacy-record"><summary>旧版记录</summary><div className="form-block"><FormRow label="旧版已攒金额（只读）">{money(p.saved_cents)}</FormRow>{item.legacy_generated_at&&<FormRow label="旧版标为实现的日期">{localDay(new Date(item.legacy_generated_at))}</FormRow>}<p className="muted">攒钱功能已停用；金额保留为只读历史，不作为预算或账户余额。</p></div></details>}
 {notice&&<p className="notice" role="status" ref={noticeRef}>{notice}</p>}</div>
 {dropOpen&&<div className="confirm" role="alert"><strong>不再考虑「{item.fields.name}」？</strong><p className="muted">记录与图片保留，以后可以回看；不会产生支出。</p><FormRow label="为什么不买（可选）"><textarea aria-label="为什么不买" rows={2} placeholder="这次决定的说明" value={dropNote} disabled={blocked} onChange={e=>setDropNote(e.target.value)}/></FormRow><button type="button" className="primary" disabled={blocked} onClick={()=>void dropWish()}>确认不再考虑</button><button type="button" disabled={blocked} onClick={()=>setDropOpen(false)}>取消</button></div>}
 {reconsiderOpen&&<div className="confirm" role="alert"><strong>重新考虑「{item.fields.name}」？</strong><p className="muted">回到考虑中；上一次决定备注保留，可在此更正，提醒不会自动恢复。</p><FormRow label="为什么不买"><textarea aria-label="为什么不买" rows={2} placeholder="保留或更正上次的说明" value={reconsiderNote} disabled={blocked} onChange={e=>setReconsiderNote(e.target.value)}/></FormRow><button type="button" className="primary" disabled={blocked} onClick={()=>void reconsider()}>确认重新考虑</button><button type="button" disabled={blocked} onClick={()=>setReconsiderOpen(false)}>取消</button></div>}
 {linkOpen&&<div className="confirm wish-link-picker" role="dialog" aria-label="关联已有物品"><strong>关联已有物品</strong><p className="muted">选择这件心愿对应的那次购入；不会修改所选物品的资料。退役或售出物品可用于补记历史购入。</p><input aria-label="搜索物品" placeholder="输入关键词搜索" value={linkQuery} maxLength={200} disabled={blocked} onChange={e=>setLinkQuery(e.target.value)}/>{linkError&&<p className="notice">{linkError}</p>}{candidates===null?<p role="status" className="muted">正在读取物品…</p>:<ul className="wish-link-list">{candidates.map(c=><li key={c.id}><button type="button" disabled={blocked} onClick={()=>void linkAsset(c.id,c.revision)}><strong>{c.name}</strong>{c.own&&<em>本心愿旧版生成档案</em>}<small>{c.purchase_date??'购入日期未知'} · {c.state==='sold'?'已售出':c.state==='retired'?'已退役':'使用中'} · <span className="mono">{c.id.length>8?c.id.slice(0,8)+'…':c.id}</span></small></button></li>)}</ul>}{candidates?.length===0&&!linkError&&<p className="muted">未找到匹配的物品，可更换关键词。</p>}{linkOffset!==null&&<button type="button" disabled={blocked||linkLoading} onClick={()=>void moreLinks()}>{linkLoading?'正在读取…':'加载更多物品'}</button>}{linkError&&<button type="button" disabled={blocked||linkLoading} onClick={()=>{if(linkOffset!==null)void moreLinks();else setLinkRetry(n=>n+1);}}>重试读取</button>}<button type="button" disabled={blocked} onClick={()=>setLinkOpen(false)}>取消</button></div>}
 <div className="ui-foot">{considering&&<><button className="primary" disabled={blocked} onClick={()=>onConvert(item)}>已买到，记录购入</button><button type="button" disabled={blocked} onClick={()=>openLink()}>关联已有物品</button>{!dropOpen&&!reconsiderOpen&&!linkOpen&&<button className="ui-link" disabled={blocked} onClick={()=>{setDropOpen(true);setDropNote(item.decision_note??'')}}>不再考虑</button>}</>}
 {legacy&&!verifyOpen&&<><button disabled={blocked} onClick={()=>void openVerify()}>核实这条旧记录…</button>{!item.legacy_generated_asset&&<><button className="primary" disabled={blocked} onClick={()=>onConvert(item)}>已买到，记录购入</button><button type="button" disabled={blocked} onClick={()=>openLink()}>关联已有物品</button></>}</>}
 {purchased&&item.converted_asset&&!item.converted_asset.deleted&&<button className="primary" onClick={()=>{onClose();onOpenAsset(item.converted_asset!.id)}}>查看物品</button>}
 {purchased&&item.converted_asset?.deleted&&<button onClick={()=>{onClose();onOpenTrash()}}>关联物品在最近删除，前往恢复</button>}
 {dropped&&!reconsiderOpen&&<button className="primary" disabled={blocked} onClick={()=>{setReconsiderOpen(true);setReconsiderNote(item.decision_note??'')}}>重新考虑</button>}
 </div></aside>
}
