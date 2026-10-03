import { CloseButton } from './CloseButton';
import {useEffect,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {errorMessage} from './asset';
export function FormRow({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <div className="form-row"><div className="form-row-label">{label}{hint&&<small>{hint}</small>}</div><div className="form-row-control">{children}</div></div>}
export function Switch({label,value,onChange,disabled}:{label:string;value:boolean;onChange:(v:boolean)=>void;disabled?:boolean}){return <button type="button" role="switch" aria-label={label} aria-checked={value} disabled={disabled} className="form-switch" onClick={()=>onChange(!value)}><span/></button>}
export function Segments<T extends string>({label,value,options,onChange,disabled}:{label:string;value:T;options:readonly {value:T;label:string}[];onChange:(v:T)=>void;disabled?:boolean}){return <div className="form-segments" role="group" aria-label={label} style={{'--segments':options.length,'--selected':Math.max(0,options.findIndex(o=>o.value===value))} as CSSProperties}><span className="segment-thumb"/>{options.map(o=><button type="button" key={o.value} aria-pressed={value===o.value} disabled={disabled} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>}
export function DragHandle({label,disabled,onDrop,onStep}:{label:string;disabled?:boolean;onDrop:(id:string)=>void;onStep:(direction:-1|1)=>void}){
 const drag=useRef<{source:HTMLElement;ghost:HTMLElement;target:HTMLElement|null;startX:number;startY:number;left:number;top:number}|null>(null);
 function clear(){const active=drag.current;if(!active)return;active.source.classList.remove('sort-origin');active.target?.classList.remove('sort-target');active.ghost.remove();drag.current=null}
 useEffect(()=>clear,[]);
 return <button type="button" className="drag-handle" aria-label={'拖动排序：'+label} title="拖动排序；聚焦后用上下方向键移动" disabled={disabled} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();onStep(e.key==='ArrowUp'?-1:1)}}} onPointerDown={e=>{if(disabled||e.button!==0)return;const source=e.currentTarget.closest<HTMLElement>('[data-sort-id]');if(!source)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const rect=source.getBoundingClientRect(),ghost=source.cloneNode(true) as HTMLElement;ghost.classList.add('sort-ghost');ghost.setAttribute('aria-hidden','true');ghost.inert=true;Object.assign(ghost.style,{width:rect.width+'px',height:rect.height+'px',left:rect.left+'px',top:rect.top+'px'});source.after(ghost);source.classList.add('sort-origin');drag.current={source,ghost,target:null,startX:e.clientX,startY:e.clientY,left:rect.left,top:rect.top}}} onPointerMove={e=>{const active=drag.current;if(!active)return;active.ghost.style.left=active.left+e.clientX-active.startX+'px';active.ghost.style.top=active.top+e.clientY-active.startY+'px';const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-sort-id]');if(target===active.target)return;active.target?.classList.remove('sort-target');active.target=target&&target!==active.source?target:null;active.target?.classList.add('sort-target')}} onPointerUp={e=>{const active=drag.current;if(!active)return;const id=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-sort-id]')?.getAttribute('data-sort-id');clear();if(id)onDrop(id)}} onPointerCancel={clear}><svg viewBox="0 0 20 20" aria-hidden="true">{[5,10,15].flatMap(y=>[7,13].map(x=><circle key={x+','+y} cx={x} cy={y} r="1.4"/>))}</svg></button>
}
export function SelectionMark(){return <span className="selection-mark" aria-hidden="true"><span/></span>}
type Entry={id:string;name:string;enabled:boolean;references:number};type Snapshot={revision:number;items:Entry[]};
type ChoiceKind='category'|'channel'|'label'|'sale_channel';
// Shared by the picker dialog and the settings tab: one receipt-retrying change path per choice list.
function useChoices(kind:ChoiceKind,generation:string){
 const [data,setData]=useState<Snapshot|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<unknown>(null),lock=useRef(false);
 const key=`possio.choice-request.v1.${generation}.${kind}`;
 const notify=()=>window.dispatchEvent(new Event('possio-choices-changed'));
 async function load(){
  try {
   const stored=JSON.parse(localStorage.getItem(key)||'null');
   if(stored){
    pending.current=stored;
    const result=await invoke<string|null>('wealth_request_result',{request:stored.request_id,generation:stored.generation});
    localStorage.removeItem(key);pending.current=null;
    setNotice(result?'已核对：上次操作已保存。':'已核对：上次操作未保存，可以重新操作。');notify();
   }
   setData(await invoke<Snapshot>('choice_list',{kind}));
  }catch(e){setNotice(errorMessage(e));}
 }
 useEffect(()=>{setData(null);pending.current=null;void load()},[kind,generation]);
 async function change(action:unknown){
  if(!data||lock.current||pending.current)return false;
  lock.current=true;setBusy(true);
  const input={request_id:crypto.randomUUID(),generation,expected_revision:data.revision,kind,action};
  try{
   localStorage.setItem(key,JSON.stringify(input));pending.current=input;
   setData(await invoke<Snapshot>('choice_change',{input}));
   localStorage.removeItem(key);pending.current=null;setNotice('');notify();return true;
  }catch(e){
   setNotice(errorMessage(e));
   if(pending.current){
    try{
     const result=await invoke<string|null>('wealth_request_result',{request:input.request_id,generation});
     localStorage.removeItem(key);pending.current=null;
     setData(await invoke<Snapshot>('choice_list',{kind}));
     if(result){setNotice('已核对：操作已保存。');notify();return true;}
    }catch{setNotice('暂时无法确认操作结果，原请求已保留，请核对后继续。');}
   }
   return false;
  }finally{lock.current=false;setBusy(false);}
 }
 function move(id:string,to:number){if(!data)return;const ids=data.items.map(i=>i.id),from=ids.indexOf(id);ids.splice(from,1);ids.splice(to,0,id);void change({type:'reorder',ids})}
 return {kind,data,notice,busy,pending,load,change,move,locked:busy||!!pending.current};
}
type Choices=ReturnType<typeof useChoices>;
function ManageList({c,label,onRemap}:{c:Choices;label:string;onRemap?:(old:Entry,next:Entry|null)=>void}){
 const [name,setName]=useState('');
 const [editing,setEditing]=useState<{entry:Entry;mode:'rename'|'remove'}|null>(null);
 const [newName,setNewName]=useState(''),[replacement,setReplacement]=useState('');
 const canEdit=c.kind==='label'||c.kind==='sale_channel';
 const create=async()=>{if(await c.change({type:'create',name}))setName('')};
 function start(entry:Entry,mode:'rename'|'remove'){setEditing({entry,mode});setNewName(entry.name);setReplacement('');}
 async function apply(){
  if(!editing)return;
  const {entry,mode}=editing;
  const next=mode==='rename'?{...entry,name:newName.trim().normalize('NFC')}:c.data?.items.find(e=>e.id===replacement)??null;
  const action=mode==='rename'?{type:'rename',id:entry.id,name:newName}:{type:'remove',id:entry.id,replacement:replacement||null,expected_references:entry.references};
  if(await c.change(action)){onRemap?.(entry,next);setEditing(null);}
 }
 return <>
  <div className="choice-list">{c.data?.items.map((e,i)=><div key={e.id} className="choice-item" data-sort-id={e.id}>
   <DragHandle label={e.name} disabled={c.locked||!!editing} onDrop={id=>{const to=c.data!.items.findIndex(item=>item.id===id);if(to>=0&&to!==i)c.move(e.id,to)}} onStep={direction=>{const to=i+direction;if(to>=0&&to<c.data!.items.length)c.move(e.id,to)}}/>
   <span>{e.name}</span><Switch label={'启用'+e.name} value={e.enabled} disabled={c.locked||!!editing} onChange={enabled=>void c.change({type:'enable',id:e.id,enabled})}/>
   {canEdit&&<details className="choice-more"><summary aria-label={e.name+'的更多操作'}>•••</summary><div><button type="button" disabled={c.locked||!!editing} onClick={event=>{event.currentTarget.closest('details')!.open=false;start(e,'rename')}}>重命名</button><button type="button" className="danger" disabled={c.locked||!!editing} onClick={event=>{event.currentTarget.closest('details')!.open=false;start(e,'remove')}}>删除</button></div></details>}
  </div>)}</div>
  {editing&&<div className="choice-edit" role="group" aria-label={(editing.mode==='rename'?'重命名':'删除')+label}>
   <strong>{editing.mode==='rename'?'重命名':'删除'}「{editing.entry.name}」</strong>
   {editing.mode==='rename'?<><label>新名称<input autoFocus aria-label="新名称" value={newName} disabled={c.locked} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(newName.trim())void apply()}}}/></label><p>关联记录将同步显示新名称。</p></>:<><p>关联 {editing.entry.references} 条记录（含最近删除）。只删除选项，不删除物品或售出记录。</p>{editing.entry.references>0&&<label>原有关联改为<select aria-label="原有关联改为" value={replacement} disabled={c.locked} onChange={e=>setReplacement(e.target.value)}><option value="">清空关联（未设置）</option>{c.data?.items.filter(e=>e.id!==editing.entry.id&&e.enabled).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}</>}
   <div className="actions"><button type="button" autoFocus={editing.mode==='remove'} disabled={c.locked} onClick={()=>setEditing(null)}>取消</button><button type="button" className={editing.mode==='remove'?'primary danger':'primary'} disabled={c.locked||(editing.mode==='rename'&&!newName.trim())} onClick={()=>void apply()}>{c.busy?'正在保存…':editing.mode==='remove'?'确认删除':'保存名称'}</button></div>
  </div>}
  <div className="choice-create"><input onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(name.trim()&&!c.locked&&!editing)void create()}}} aria-label={'新'+label+'名称'} placeholder={'输入'+label+'名称'} value={name} disabled={c.locked||!!editing} onChange={e=>setName(e.target.value)}/><button type="button" disabled={!name.trim()||c.locked||!!editing} onClick={()=>void create()}>创建</button></div>
  {c.notice&&<p className="error" role="alert">{c.notice}</p>}
  {(!c.data||!!c.pending.current)&&<button type="button" disabled={c.busy} onClick={()=>void c.load()}>重新读取并核对</button>}
 </>;
}
export function ChoiceManager({kind,label,generation}:{kind:ChoiceKind;label:string;generation:string}){
 const c=useChoices(kind,generation);
 return <div className="choice-manager"><p className="muted small">拖动左侧手柄排序；键盘可用上下方向键。停用后不再出现在选择里，已有记录不受影响。</p><ManageList c={c} label={label}/></div>;
}
export function ChoiceField({kind,label,value,onChange,generation,disabled,byName=false}:{kind:ChoiceKind;label:string;value:string|null;onChange:(v:string|null)=>void;generation:string;disabled?:boolean;byName?:boolean}){
 const c=useChoices(kind,generation),{data,locked}=c,[open,setOpen]=useState(false),[manage,setManage]=useState(false);
 const panel=useRef<HTMLDialogElement>(null);
 const empty=kind==='category'?'未分类':'未选择';
 useEffect(()=>{if(open)panel.current?.showModal();else panel.current?.close()},[open]);useEffect(()=>{panel.current?.querySelector('.choice-body')?.scrollTo(0,0)},[manage]);
 const selected=data?.items.find(e=>(byName?e.name:e.id)===value);
 const previousSelection=useRef<Entry|null>(null);
 useEffect(()=>{
  if(!data)return;
  const previous=previousSelection.current;
  if(selected)previousSelection.current=selected;
  else if(previous&&value===(byName?previous.name:previous.id)){
   const next=data.items.find(e=>e.id===previous.id)??null;
   previousSelection.current=next;onChange(next?(byName?next.name:next.id):null);
  }
 },[data,value,byName]);
 return <><button className="choice-trigger" type="button" disabled={disabled} aria-label={label} onClick={()=>{setOpen(true);void c.load()}}>{selected?.name||value||empty}<svg className="choice-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg></button>{open&&<dialog ref={panel} className="editor choice-dialog" aria-label={(manage?'管理':'选择')+label} onCancel={e=>{e.preventDefault();if(!locked)setOpen(false)}}><header><h2>{manage?'管理':'选择'}{label}</h2><CloseButton type="button" disabled={locked} onClick={()=>setOpen(false)} aria-label="关闭选项"/></header><div className="choice-body"><p className="muted small">{manage?'拖动左侧手柄排序；键盘可用上下方向键。停用不影响已有记录。':kind==='label'?'标签用来给物品分组，比如「工作用」；使用中、保障、退役和售出按真实记录自动显示。':'选择一项；可以在管理中添加和整理。'}</p>{manage?<ManageList c={c} label={label} onRemap={(old,next)=>{if(value===(byName?old.name:old.id))onChange(next?(byName?next.name:next.id):null)}}/>:<><div className="choice-list"><button type="button" aria-pressed={!value} onClick={()=>{onChange(null);setOpen(false)}}>{empty}<SelectionMark/></button>{data?.items.filter(e=>e.enabled||(byName?e.name:e.id)===value).map(e=><div key={e.id} className="choice-item" data-sort-id={e.id}><button type="button" aria-pressed={value===(byName?e.name:e.id)} onClick={()=>{onChange(byName?e.name:e.id);setOpen(false)}}>{e.name}{!e.enabled&&'（已停用）'}<SelectionMark/></button></div>)}</div>{c.notice&&<p className="error" role="alert">{c.notice}</p>}</>}</div><footer className="actions"><button type="button" disabled={locked} onClick={()=>setManage(!manage)}>{manage?'完成管理':'管理'}</button></footer></dialog>}</>;
}
export function AddImageButton({onClick,disabled}:{onClick:()=>void;disabled?:boolean}){return <button type="button" className="add-image-button" onClick={onClick} disabled={disabled}><svg viewBox="0 0 40 40" aria-hidden="true"><rect className="album-back" x="5" y="5" width="25" height="29" rx="5" transform="rotate(-8 17 20)"/><rect className="album-front" x="8" y="8" width="26" height="27" rx="5"/><circle className="album-sun" cx="16" cy="16" r="3"/><path className="album-hill" d="m10 29 7-8 5 5 4-5 6 8v4H10Z"/><circle className="album-plus" cx="32" cy="9" r="7"/><path className="album-plus-line" d="M32 6v6M29 9h6"/></svg><span>添加图片</span></button>}
export function CentInput({label,value,onChange,disabled,placeholder}:{label:string;value:string;onChange:(v:string)=>void;disabled?:boolean;placeholder?:string}){const [raw,setRaw]=useState(value===''?'':String(Number(value)/100));useEffect(()=>{const normalized=raw===''?'':String(Math.round(Number(raw)*100));if(normalized!==value)setRaw(value===''?'':String(Number(value)/100))},[value]);return <input aria-label={label} inputMode="decimal" placeholder={placeholder} disabled={disabled} value={raw} onChange={e=>{const next=e.target.value;if(!/^\d{0,9}(\.\d{0,2})?$/.test(next))return;setRaw(next);const [whole,fraction='']=next.split('.');onChange(next===''?'':(BigInt(whole||'0')*100n+BigInt(fraction.padEnd(2,'0'))).toString())}}/>}

// U15c/U16a：口径与说明收进 ⓘ；悬停或聚焦即时显示（ui.css），读屏读出 aria-label。
export function Info({text}:{text:string}){return <span className="info-tip" role="img" tabIndex={0} aria-label={'说明：'+text} data-tip={text}>i</span>}
