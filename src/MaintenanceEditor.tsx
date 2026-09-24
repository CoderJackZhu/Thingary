import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage, type AssetRecord, type Photo } from "./asset";
import { PhotoView } from "./Photos";
import { blankMaintenance, draftKey, maintenanceChange, maintenanceDraft, maintenanceKinds, money, validateMaintenance, type MaintenanceDraft } from "./maintenance";
import type { CloseIntent } from './AssetEditor';

export function MaintenanceEditor({record,generation,today,maintenanceId,closeIntent,onKeep,onSaved,onClose}:{record:AssetRecord;generation:string;today:string;maintenanceId?:string;closeIntent:CloseIntent|null;onKeep:()=>void;onSaved:(r:AssetRecord)=>void;onClose:(intent:CloseIntent)=>void}){
  const key=draftKey(record.asset.id,maintenanceId); const initial=useMemo(()=>maintenanceDraft(record,maintenanceId),[record.asset.id,maintenanceId]);
  const [draft,setDraft]=useState<MaintenanceDraft>(()=>{try{return {...initial,...JSON.parse(sessionStorage.getItem(key)||"null")}}catch{return initial}});
  const [photos,setPhotos]=useState<Photo[]>(()=>{const map=new Map(record.photos.map(p=>[p.id,p])); record.maintenances.flatMap(m=>m.photos).forEach(p=>map.set(p.id,p)); return draft.photo_ids.map(id=>map.get(id)).filter(Boolean) as Photo[]});
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false); const dirty=JSON.stringify(draft)!==JSON.stringify(initial); const draftRef=useRef(draft); draftRef.current=draft;
  useEffect(()=>{sessionStorage.setItem(key,JSON.stringify(draft));},[key,draft]);
  useEffect(()=>()=>{ if(!dirty) sessionStorage.removeItem(key) },[dirty,key]);
  useEffect(()=>{if(closeIntent){if(!dirty||confirm('维护草稿已保留。确认关闭窗口？'))onClose(closeIntent);else onKeep()}},[closeIntent]);
  const set=<K extends keyof MaintenanceDraft>(name:K,value:MaintenanceDraft[K])=>setDraft(d=>({...d,[name]:value}));
  async function pickPhoto(){try{const photo=await invoke<Photo|null>("pick_photo",{generation,repair:null});if(photo){setPhotos(p=>[...p,photo]);set("photo_ids",[...draftRef.current.photo_ids,photo.id])}}catch(e){setError(errorMessage(e))}}
  async function save(){const issue=validateMaintenance(draft,record,today);if(issue){setError(issue);return} setSaving(true);setError("");try{const result=await invoke<AssetRecord>("change_maintenance",{input:maintenanceChange(record,generation,draft,maintenanceId)});sessionStorage.removeItem(key);onSaved(result)}catch(e){setError(errorMessage(e))}finally{setSaving(false)}}
  function close(){if(dirty&&!confirm("维护草稿仍保留在本机，确认关闭？"))return;onClose('form')}
  return <div className="modal-backdrop"><section className="editor maintenance-editor" aria-modal="true" role="dialog"><header><div><p className="eyebrow">维护档案</p><h2>{maintenanceId?"更正维护记录":"新增维护记录"}</h2><p className="muted">更正保留原记录标识与审计轨迹；空费用表示未知，0 表示免费。</p></div><button className="secondary" onClick={close}>关闭</button></header>
    <div className="editor-grid"><label>日期（可留空）<input type="date" max={record.sale?.fields.date??today} min={record.asset.purchase_date??undefined} value={draft.date??""} onChange={e=>set("date",e.target.value||null)}/></label><label>类型<select value={draft.kind} onChange={e=>set("kind",e.target.value as MaintenanceDraft["kind"])}>{maintenanceKinds.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label>标题<input maxLength={200} value={draft.title} onChange={e=>set("title",e.target.value)}/></label><label>服务方<input maxLength={200} value={draft.provider} onChange={e=>set("provider",e.target.value)}/></label><label>费用（元）<input inputMode="decimal" placeholder="留空表示未知；0 表示免费" value={draft.cost} onChange={e=>set("cost",e.target.value)}/></label><label className="wide">说明<textarea maxLength={10000} value={draft.description} onChange={e=>set("description",e.target.value)}/></label></div>
    <section className="photo-section"><h3>维护图片 <small>{photos.length}</small></h3><div className="photo-strip">{photos.map(photo=><span className="photo-tile" key={photo.id}><PhotoView photo={photo} generation={generation}/><span className="photo-name">{photo.name}</span><button className="secondary" onClick={()=>{setPhotos(p=>p.filter(x=>x.id!==photo.id));set("photo_ids",draft.photo_ids.filter(id=>id!==photo.id))}}>移除</button></span>)}</div><button className="secondary" type="button" onClick={()=>void pickPhoto()}>添加图片</button></section>
    <aside className="settlement"><span>当前已知维护</span><strong>{money(record.costs.known_maintenance_cents)}</strong><span>{record.costs.unknown_maintenance_count?`${record.costs.unknown_maintenance_count} 条费用待补录`:"费用完整"}</span></aside>
    {error&&<p className="error" role="alert">{error}</p>}<footer><button className="secondary" onClick={()=>{setDraft(blankMaintenance());setPhotos([])}}>清空</button><button disabled={saving} onClick={save}>{saving?"保存中…":"保存维护记录"}</button></footer>
  </section></div>
}
