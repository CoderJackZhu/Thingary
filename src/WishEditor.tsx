import {persistSubmission} from './editor-session';
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {errorMessage,inputMoney,localDay,money,type Photo} from './asset';
import type {CloseIntent} from './AssetEditor';
import {replaceDraftCover} from './asset-media';
import {DefaultAssetIcon,IconPicker,type IconChoice} from './IconPicker';
import {PhotoView} from './Photos';
import {DateInput} from './DateInput';
import {FormRow,Switch,ChoiceField,AddImageButton} from './FormControls';
import {allowReminders,ReminderPermissionHelp} from './NotificationNotice';
import {loadAssetCandidates,assetStateLabel,type AssetCandidate} from './asset-picker';
import type {AssetRecord} from './asset';
import {defaultWishPreferences} from './preferences';
import {validateWishlist,wishlistDraftKey,type WishlistDraft,type WishlistItem,type WishPlanSave} from './wishlist';
import type {TaxonomySnapshot} from './taxonomy';
import {DeleteButton} from './WealthPage';
export function WishlistEditor({initial,closeIntent,onKeep,onClose,onSaved,onDeleted}:{initial:WishlistDraft;taxonomy:TaxonomySnapshot;closeIntent:CloseIntent|null;onKeep:()=>void;onClose:(intent:CloseIntent,keep:boolean)=>void;onSaved:(i:WishlistItem)=>void;onDeleted?:(i:WishlistItem)=>void}){
 const dialog=useRef<HTMLDialogElement>(null),lock=useRef(false);
 const [draft,setDraft]=useState(initial),[busy,setBusy]=useState(false),[picker,setPicker]=useState(false),[notice,setNotice]=useState(''),[permissionPending,setPermissionPending]=useState(false),[permissionError,setPermissionError]=useState('');
 const p=draft.preferences??{...defaultWishPreferences(),added_date:localDay()},photos=draft.photos??(draft.cover?[draft.cover]:[]),pending=!!draft.pending||!!draft.planPending,disabled=busy||pending;
 const replacementId=draft.replacementAssetId!==undefined?draft.replacementAssetId:draft.item?.replacement_asset?.id??null;
 const [replacementRecord,setReplacementRecord]=useState<AssetRecord|null>(null),[replacementError,setReplacementError]=useState(''),[replacementRetry,setReplacementRetry]=useState(0);
 // 现有关系的展示资料；失效（永久删除）用保存的历史名称。
 useEffect(()=>{setReplacementRecord(null);setReplacementError('');if(!replacementId)return;let live=true;invoke<AssetRecord|null>('read_asset',{id:replacementId}).then(r=>{if(live){setReplacementRecord(r);if(!r)setReplacementError('原物品已删除或不存在，请重新读取心愿。')}}).catch(e=>{if(live)setReplacementError(errorMessage(e))});return()=>{live=false}},[replacementId,replacementRetry]);
 const [replacePickerOpen,setReplacePickerOpen]=useState(false),[replaceQuery,setReplaceQuery]=useState(''),[replaceCandidates,setReplaceCandidates]=useState<AssetCandidate[]|null>(null),[replaceNext,setReplaceNext]=useState<number|null>(null),[replaceError,setReplaceError]=useState(''),[replaceLoading,setReplaceLoading]=useState(false);
 const replaceRun=useRef(0),[replaceRetry,setReplaceRetry]=useState(0);
 // Only legacy rows still carry a savings amount; it is read-only history (§3.6).
 const legacySavings=draft.item?.preferences?.mode==='savings';
 // 分类、渠道、置顶只给已有值的旧记录；挂载时判定，清除时该行不消失。
 const [shown]=useState(()=>({category:!!draft.fields.category_id,channel:!!p.channel_id,pinned:!!p.pinned}));
 useEffect(()=>{dialog.current?.showModal();return ()=>dialog.current?.close()},[]);useEffect(()=>{if(closeIntent)askClose(closeIntent)},[closeIntent]);
 function remember(next:WishlistDraft){setDraft(next);try{persistSubmission(wishlistDraftKey, next);return true}catch{setNotice('暂时无法记录保存请求，请重试。');return false}}
 function field<K extends keyof WishlistDraft['fields']>(key:K,value:WishlistDraft['fields'][K]){remember({...draft,fields:{...draft.fields,[key]:value}})}
 function prefs(part:Partial<typeof p>){remember({...draft,preferences:{...p,...part}})}
 function askClose(intent:CloseIntent){if(lock.current||pending||picker){onKeep();setNotice('请先完成当前操作或核对保存结果。');return}onClose(intent,false)}
 async function icon(choice:IconChoice){if(lock.current)return;lock.current=true;setBusy(true);try{const cover=choice.kind==='default'?null:choice.kind==='photo'?choice.photo:await invoke<Photo>('prepare_material',{input:{id:choice.entry.id,generation:draft.generation}});const next=replaceDraftCover(photos,draft.transientCover,cover,!!cover&&!photos.some(x=>x.id===cover.id));remember({...draft,cover,photos:next.photos,transientCover:next.transientCover,photoError:''})}finally{lock.current=false;setBusy(false)}}
 async function addPhoto(){if(lock.current)return;lock.current=true;setBusy(true);try{const photo=await invoke<Photo|null>('pick_photo',{generation:draft.generation,repair:null});if(photo)remember({...draft,photos:[...photos,photo],photoError:''})}catch(e){remember({...draft,photoError:errorMessage(e)})}finally{lock.current=false;setBusy(false)}}
 async function save(){if(lock.current)return;lock.current=true;setBusy(true);try{
 if(draft.pending){const item=await invoke<WishlistItem|null>('saved_wishlist_request',{input:draft.pending});if(item){localStorage.removeItem(wishlistDraftKey);onSaved(item)}else remember({...draft,pending:null});return}
 const errors=validateWishlist(draft.fields);
 if(p.reminder&&!draft.fields.target_date)errors.target_date='开启提醒需要先选择计划日期。';
 if(Object.keys(errors).length){setNotice(Object.values(errors).join(' '));return}
 let input=draft.planPending??null;
 if(!input){input={request_id:crypto.randomUUID(),generation:draft.generation,id:draft.item?.id??null,expected_revision:draft.item?.revision??null,fields:{...draft.fields,estimated_price_cents:inputMoney(draft.fields.estimated_price),target_date:draft.fields.target_date||null},preferences:p,photos:{ids:photos.map(x=>x.id),cover_id:draft.cover?.id??null},replacement_asset_id:replacementId,...(draft.replacementAssetId===null?{clear_replacement:true}:{})};delete (input.fields as unknown as Record<string,unknown>).estimated_price;if(!remember({...draft,planPending:input}))return}
 try{const item=await invoke<WishlistItem>('save_wish_plan',{input});localStorage.removeItem(wishlistDraftKey);onSaved(item)}catch(e){try{const saved=await invoke<WishlistItem|null>('saved_wish_feature',{request:input.request_id,generation:input.generation});if(saved){localStorage.removeItem(wishlistDraftKey);onSaved(saved)}else{remember({...draft,planPending:null});setNotice(errorMessage(e))}}catch{setNotice('暂时无法核对保存结果，请重试同一请求。')}}
 }catch(e){setNotice(errorMessage(e))}finally{lock.current=false;setBusy(false)}}
 // Query/open/retry starts a new page session; closed or superseded reads
 // cannot append candidates or overwrite a newer query's cursor.
 useEffect(()=>{
   const run=++replaceRun.current;
   if(!replacePickerOpen)return;
   setReplaceCandidates(null);setReplaceNext(null);setReplaceError('');setReplaceLoading(true);
   void loadAssetCandidates(null,replaceQuery).then(page=>{
     if(run!==replaceRun.current)return;
     setReplaceCandidates(page.items);setReplaceNext(page.nextOffset);
   }).catch(e=>{if(run===replaceRun.current){setReplaceCandidates([]);setReplaceError(errorMessage(e));}})
     .finally(()=>{if(run===replaceRun.current)setReplaceLoading(false);});
   return()=>{replaceRun.current++;};
 },[replacePickerOpen,replaceQuery,replaceRetry]);
 async function loadMoreReplace(){
   if(replaceLoading||replaceNext===null)return;
   const run=replaceRun.current;setReplaceLoading(true);setReplaceError('');
   try{const page=await loadAssetCandidates(null,replaceQuery,replaceNext);
     if(run!==replaceRun.current)return;
     setReplaceCandidates(old=>[...(old??[]),...page.items.filter(c=>!old?.some(p=>p.id===c.id))]);setReplaceNext(page.nextOffset)}
   catch(e){if(run===replaceRun.current)setReplaceError(errorMessage(e))}
   finally{if(run===replaceRun.current)setReplaceLoading(false)}
 }
 async function enableReminder(){prefs({reminder:true});setPermissionError('');setPermissionPending(true);try{await allowReminders()}catch(e){setPermissionError(errorMessage(e))}finally{setPermissionPending(false)}}
 return <dialog ref={dialog} className={picker?'icon-picker-host':'editor wishlist-editor'} aria-labelledby={picker?'icon-picker-title':'wishlist-editor-title'} onCancel={e=>{e.preventDefault();askClose('form')}}><form hidden={picker} onSubmit={e=>{e.preventDefault();void save()}}><header><div><p className="eyebrow">心愿清单</p><h2 id="wishlist-editor-title">{draft.item?'编辑心愿':'新增心愿'}</h2></div><div className="editor-header-actions"><button type="button" disabled={disabled} onClick={()=>askClose('form')}>取消</button><button type="submit" className="primary" disabled={busy||!!draft.photoError}>{busy?'正在保存…':pending?'重试并核对保存':'保存心愿'}</button></div></header><div className="editor-body">
 <p className="muted">名称之外都可以留空，之后回来再补；保存不会生成物品，也不产生支出。</p>
 <div className="asset-identity-editor"><button type="button" className="asset-avatar-button" aria-label="选择心愿图标" disabled={disabled} onClick={()=>setPicker(true)}>{draft.cover?<PhotoView photo={draft.cover} generation={draft.generation}/>:<DefaultAssetIcon/>}<span className="avatar-edit">更换图标</span></button><label className="field"><span>物品名称</span><input autoFocus placeholder="请输入物品名称" value={draft.fields.name} disabled={disabled} onChange={e=>field('name',e.target.value)}/></label></div>
 <section className="form-block"><FormRow label="预计价格（元）"><input aria-label="预计价格" placeholder="可留空" inputMode="decimal" value={draft.fields.estimated_price} disabled={disabled} onChange={e=>field('estimated_price',e.target.value)}/></FormRow><div className="field wide"><label htmlFor="wish-notes">想买的理由与顾虑</label><textarea id="wish-notes" rows={4} placeholder="为什么想买？还有什么顾虑？以后回来时提醒自己" value={draft.fields.notes} disabled={disabled} onChange={e=>field('notes',e.target.value)}/></div></section>
 <section className="form-block"><FormRow label="相关链接" hint="http:// 或 https://，可留空"><input aria-label="相关链接" placeholder="https://example.com/item" value={draft.fields.external_link} disabled={disabled} onChange={e=>field('external_link',e.target.value)}/></FormRow></section>
 <details className="more-fields"><summary>更多资料<span>计划日期、替换物品与图片</span></summary><section className="form-block" style={{border:0,padding:0}}>
 {shown.category&&<FormRow label="分类"><ChoiceField label="分类" kind="category" generation={draft.generation} value={draft.fields.category_id} disabled={disabled} onChange={v=>field('category_id',v)}/></FormRow>}
 {shown.channel&&<FormRow label="可能购买的渠道"><ChoiceField label="可能购买的渠道" kind="channel" generation={draft.generation} value={p.channel_id} disabled={disabled} onChange={channel_id=>prefs({channel_id})}/></FormRow>}
 <FormRow label="考虑替换的物品" hint="可选；关系独立于购入关联，不会改变该物品的资料">{replacementId
   ?<span className="wish-replacement-current">{replacementRecord?.asset.id===replacementId?`${replacementRecord.asset.name} · ${replacementRecord.asset.purchase_date??'购入日期未知'} · ${assetStateLabel(replacementRecord.lifecycle?.state??'active')}`:(replacementRecord===null&&replacementId===draft.item?.replacement_asset?.id&&(draft.item?.replacement_asset?.name??draft.item?.replacement_asset_name))||'…'}{draft.item?.replacement_asset?.deleted?'（在最近删除）':''} <button type="button" disabled={disabled} onClick={()=>remember({...draft,replacementAssetId:null})}>清除</button></span>
   :<>{draft.item?.replacement_asset_name&&draft.replacementAssetId!==null&&<span className="wish-replacement-current">原物品「{draft.item.replacement_asset_name}」已永久删除 <button type="button" disabled={disabled} onClick={()=>remember({...draft,replacementAssetId:null})}>清除</button></span>}{!replacePickerOpen&&<button type="button" disabled={disabled} onClick={()=>{setReplacePickerOpen(true);setReplaceQuery('')}}>选择物品…</button>}</>}
   {replacementError&&replacementId&&<p className="notice" role="alert">原物品资料读取失败：{replacementError} <button type="button" disabled={disabled} onClick={()=>setReplacementRetry(n=>n+1)}>重新读取物品</button></p>}
   {replacePickerOpen&&<div className="wish-replace-picker">
     <input aria-label="搜索物品" placeholder="按名称搜索" value={replaceQuery} disabled={disabled} onChange={e=>setReplaceQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault()}}/>
     {replaceError&&<p className="notice" role="alert">{replaceError}</p>}
     <ul className="wish-link-list">{(replaceCandidates??[]).map(c=><li key={c.id}><button type="button" disabled={disabled} onClick={()=>{remember({...draft,replacementAssetId:c.id});setReplacePickerOpen(false)}}><strong>{c.name}</strong><small>{c.purchase_date??'购入日期未知'} · {assetStateLabel(c.state)} · <span className="mono">{c.id.length>8?c.id.slice(0,8)+'…':c.id}</span></small></button></li>)}</ul>
     {replaceLoading&&<p className="muted" role="status">正在读取…</p>}
     {!replaceLoading&&!replaceError&&replaceCandidates?.length===0&&<p className="muted" role="status">没有匹配的物品</p>}
     {replaceError&&<button type="button" disabled={disabled||replaceLoading} onClick={()=>setReplaceRetry(n=>n+1)}>重试</button>}
     <button type="button" disabled={disabled||replaceLoading||replaceNext===null} onClick={()=>void loadMoreReplace()}>{replaceLoading?'正在读取…':replaceCandidates===null?'搜索':'加载更多'}</button>
     <button type="button" disabled={disabled} onClick={()=>setReplacePickerOpen(false)}>收起</button>
   </div>}
 </FormRow>
 <FormRow label="计划日期" hint="准备再次考虑或购买的日期，可留空"><DateInput label="计划日期" id="wish-target" value={draft.fields.target_date} disabled={disabled} allowClear onChange={v=>field('target_date',v)}/></FormRow>
 {draft.fields.target_date&&<FormRow label="计划日期提醒" hint="所选日期上午 9:00 单次通知"><Switch label="计划日期提醒" value={p.reminder} disabled={disabled} onChange={reminder=>{if(!reminder)prefs({reminder:false});else void enableReminder()}}/></FormRow>}
 {legacySavings&&<FormRow label="旧版攒钱记录" hint="攒钱功能已停用，金额保留为只读历史"><input aria-label="旧版已攒金额（只读）" value={money(draft.item?.preferences?.saved_cents??'0')+'（只读）'} readOnly disabled/></FormRow>}
 {shown.pinned&&<FormRow label="置顶心愿"><Switch label="置顶心愿" value={p.pinned} disabled={disabled} onChange={pinned=>prefs({pinned})}/></FormRow>}
 <section className="form-block form-notes"><div className="photo-strip">{photos.filter(x=>x.id!==draft.cover?.id).map(photo=><div className="photo-tile" key={photo.id}><PhotoView photo={photo} generation={draft.generation}/><button type="button" disabled={disabled} onClick={()=>remember({...draft,photos:photos.filter(x=>x.id!==photo.id)})}>移除</button></div>)}<AddImageButton disabled={disabled||photos.length>=20} onClick={()=>void addPhoto()}/></div></section>
 </section></details>
 <ReminderPermissionHelp pending={p.reminder&&permissionPending} error={p.reminder?permissionError:''}/>

 {draft.photoError&&<p role="alert">{draft.photoError}<button type="button" onClick={()=>remember({...draft,photoError:''})}>取消这次失败选图</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}{draft.item&&onDeleted&&!pending&&<div className="wish-editor-delete"><DeleteButton label="删除心愿" disabled={disabled} kind="wish" id={draft.item.id} revision={draft.item.revision} generation={draft.generation} name={draft.item.fields.name} onDone={()=>onDeleted(draft.item!)} onError={message=>setNotice(message)}/></div>}</div></form>{picker&&<IconPicker generation={draft.generation} photos={photos} cover={draft.cover?.id??null} onClose={()=>setPicker(false)} onUse={icon}/>}</dialog>
}
