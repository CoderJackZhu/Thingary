import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
// Choice-list state shared by the desktop settings tab and the iPhone settings page; contains no UI.
export type Entry={id:string;name:string;enabled:boolean;references:number;scope?:string|null;virtual_references?:number|null};export type Snapshot={revision:number;items:Entry[]};
export type ChoiceKind='category'|'channel'|'label'|'sale_channel';
// Shared by the picker dialog and the settings tab: one receipt-retrying change path per choice list.
export function useChoices(kind:ChoiceKind,generation:string){
 const [data,setData]=useState<Snapshot|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef<unknown>(null),lock=useRef(false);
 const key=`thingary.choice-request.v1.${generation}.${kind}`;
 const notify=()=>window.dispatchEvent(new Event('thingary-choices-changed'));
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
