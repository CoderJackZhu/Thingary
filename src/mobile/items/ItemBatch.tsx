import { useEffect, useRef, useState } from 'react';
import './date.css';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { moneyText } from '../format';
import { batchSummary, dateError, stateBlock, saleNet } from '../../batch-select';
import type { BatchRow } from '../../batch-select';
import { submit } from '../../wealth';
import { useSession } from '../session';
import { Button, DateField, ErrorState, FormGroup, Loading, MoneyField, Notice, SelectField, Sheet, TextField } from '../ui';
type Kind='none'|'delete'|'classify'|'label'|'retire'|'activate'|'sell';
type Choice={id:string;name:string;enabled:boolean};
export default function ItemBatch({ids,generation,today,onClose,onDone,initialKind='none'}:{initialKind?:Kind;ids:string[];generation:string;today:string;onClose:()=>void;onDone:()=>void}){
  const session=useSession(),lock=useRef(false),request=useRef<string|null>(null);
  const [rows,setRows]=useState<BatchRow[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[notice,setNotice]=useState('');
  const [kind,setKind]=useState<Kind>(initialKind),[choices,setChoices]=useState<{category:Choice[];label:Choice[]}|null>(null),[values,setValues]=useState<Record<string,string>>({}),[date,setDate]=useState(today),[platform,setPlatform]=useState('');
  useEffect(()=>{let live=true;setError('');setRows(null);setChoices(null);
    Promise.all([invoke<BatchRow[]>('batch_rows',{ids}),invoke<{items:Choice[]}>('choice_list',{kind:'category'}),invoke<{items:Choice[]}>('choice_list',{kind:'label'}),invoke<{generation:string}>('asset_counts')]).then(([r,c,l,g])=>{
      if(!live)return;if(g.generation!==generation||r.length!==ids.length)throw new Error('所选物品已变化，请关闭后重新选择。');setRows(r);setChoices({category:c.items.filter(i=>i.enabled),label:l.items.filter(i=>i.enabled)});
    }).catch(e=>{if(live)setError(errorMessage(e));});return()=>{live=false;};},[retry,JSON.stringify(ids),generation]);
  useEffect(()=>{if(request.current&&session.settled?.input.request_id===request.current)onDone();},[session.settled]);
  const summary=rows?batchSummary(rows):null;
  const applicable=(row:BatchRow)=>kind==='sell'?row.state!=='sold':kind==='retire'||kind==='activate'?!stateBlock(row,kind):true;
  const invalid=rows?.some(r=>applicable(r)&&((kind==='retire'||kind==='activate')&&dateError(r,date,today)||(kind==='sell'&&(!values[r.id]||dateError(r,date,today)))));
  async function save(){
    if(lock.current||session.navBlocked||!rows||!choices||error||invalid||kind==='none')return;
    const items=rows.filter(applicable).flatMap((r):Record<string,unknown>[]=>{
      const base={asset_id:r.id,expected_revision:r.revision};
      if(kind==='classify'||kind==='label') {const value=values[r.id]??'keep';return value==='keep'?[]:[{...base,[kind==='classify'?'category_id':'label_id']:value||null}];}
      if(kind==='sell')return [{...base,sale:{date,price_cents:values[r.id],platform,buyer:'',notes:''}}];
      return [{...base,...(kind==='retire'||kind==='activate'?{date}:{})}];
    });
    if(!items.length){setNotice('没有需要保存的更改。');return;}
    lock.current=true;session.setBusy(true);setNotice('');request.current=crypto.randomUUID();
    try{await submit({command:'batch_change',input:{request_id:request.current,generation,action:kind,items},label:'物品批量操作'});onDone();}catch(e){setNotice(errorMessage(e));}finally{lock.current=false;session.setBusy(false);session.refreshPending();}
  }
  const options=[{id:'keep',label:'保持不变'},{id:'',label:kind==='label'?'无标签':'未分类'},...(choices?.[kind==='label'?'label':'category']??[]).map(c=>({id:c.id,label:c.name}))];
  return <Sheet title={`批量操作 · ${ids.length} 件`} onClose={()=>{if(!session.navBlocked)onClose();}}><div className="mi-filter"><SelectField label="操作" value={kind} disabled={session.navBlocked} options={[['none','请选择操作'],['classify','改分类'],['label','改标签'],['retire','退役'],['activate','重新启用'],['sell','记录售出'],['delete','删除']].map(([id,label])=>({id,label}))} onChange={v=>{setKind(v as Kind);setValues({});setNotice('');}}/>
    {error?<ErrorState message={error} onRetry={()=>setRetry(n=>n+1)}/>:!rows?<Loading/>:<>
      <Notice>已选 {summary?.count} 件 · 已知金额 {moneyText(summary?.total??null)}{summary?.unknown?` · ${summary.unknown} 件金额未知`:''}</Notice>
      {kind==='none'?<Notice>先选一个操作，再核对所选物品。</Notice>:kind==='delete'?<Notice>删除后物品及关联记录从各处隐藏，可在“最近删除”中恢复。已经不用请选退役，卖掉了请选记录售出。</Notice>:kind==='sell'?<><DateField label="售出日期" value={date} onChange={setDate} max={today} disabled={session.navBlocked}/><TextField label="统一售出平台" value={platform} onChange={setPlatform} disabled={session.navBlocked}/></>:kind==='retire'||kind==='activate'?<DateField label="动作日期" value={date} onChange={setDate} max={today} disabled={session.navBlocked}/>:<SelectField label="全部设为" value="keep" options={options} disabled={session.navBlocked} onChange={v=>setValues(Object.fromEntries(rows.map(r=>[r.id,v])))}/>}
      {kind!=='none'&&<FormGroup title="核对所选物品">{rows.map(r=><div className="mi-batch-row" key={r.id}><strong>{r.name}</strong>{kind==='classify'||kind==='label'?<SelectField label={r.name+' 新'+(kind==='label'?'标签':'分类')} value={values[r.id]??'keep'} options={options} disabled={session.navBlocked} onChange={v=>setValues({...values,[r.id]:v})}/>:kind==='sell'?r.state==='sold'?<p className="mi-caption">已售出 · 不参与保存</p>:<><MoneyField label={r.name+' 售价'} value={values[r.id]??''} onChange={v=>setValues({...values,[r.id]:v})} disabled={session.navBlocked} hint="逐件填写，可为 0"/><p className="mi-caption">{dateError(r,date,today)||`净成本 ${moneyText(saleNet(r,values[r.id]||null))}`}</p></>:kind!=='delete'&&<p className="mi-caption">{stateBlock(r,kind)||dateError(r,date,today)||`将于 ${date} ${kind==='retire'?'退役':'重新启用'}`}</p>}</div>)}</FormGroup>}
      <Button variant={kind==='delete'?'danger':'primary'} block disabled={session.navBlocked||kind==='none'||!!invalid||!choices} onClick={()=>void save()}>{kind==='delete'?'移入最近删除':'保存更改'}</Button>
    </>}{notice&&<Notice tone="danger">{notice}</Notice>}</div></Sheet>;
}
