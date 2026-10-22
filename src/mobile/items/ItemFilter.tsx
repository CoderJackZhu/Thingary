import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { useNav } from '../nav-context';
import { Button, FormGroup, SelectField, Notice, ErrorState } from '../ui';
import { labelFilterOptions } from '../../tag-investment';
type Choice = { id:string; name:string; enabled:boolean };
import { chooseSort, sortOptions } from './list-model';
import { resetItemQuery, setItemQuery, useItemQuery } from './list-store';
import './items.css';
export default function ItemFilter() {
  const nav=useNav(), query=useItemQuery();
  const draft=query, setDraft=setItemQuery;
  const [tags,setTags]=useState<Choice[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{ let live=true; invoke<{items:Choice[]}>('choice_list',{kind:'label'}).then(r=>{if(live)setTags(r.items);}).catch(e=>{if(live)setError(errorMessage(e));});return()=>{live=false;};},[retry]);
  return <div className="mi-filter">
    <FormGroup title="筛选">
      <SelectField label="保障" value={draft.warranty??'all'} onChange={warranty=>setDraft({...draft,warranty})} options={[['all','全部'],['covered','有有效保障'],['expiring','即将到期'],['lapsed','有记录，当前无有效保障'],['none','无保障记录']].map(([id,label])=>({id,label}))}/>
      <SelectField label="缺失资料" value={['missing_price','missing_date'].includes(draft.filter)?draft.filter:'all'} onChange={filter=>setDraft({...draft,filter:filter==='all' ? (['missing_price','missing_date'].includes(query.filter)?'all':query.filter) : filter})} options={[{id:'all',label:'不限'},{id:'missing_price',label:'金额未知'},{id:'missing_date',label:'日期未知'}]}/>
      <SelectField label="标签" value={draft.label??''} onChange={label=>setDraft({...draft,label:label||null})} options={[{id:'',label:'全部'},{id:'none',label:'无标签'},...labelFilterOptions(tags).map(t=>({id:t.id,label:t.text}))]}/>
    </FormGroup>
    {error&&<ErrorState message={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>}
    <Notice>不计入统计的物品仍保留在列表和详情中。总金额、日均、统计和时间轴分别遵循每件物品的设置。</Notice>
    <FormGroup title="排序方式">
      <div className="mi-sort-options" role="group" aria-label="排序方式">{sortOptions.map(([id,label])=><button key={id} aria-pressed={draft.sort===id} onClick={()=>setDraft(chooseSort(draft,id))}>{label}</button>)}</div>
      <SelectField label="顺序" value={draft.descending?'desc':'asc'} onChange={v=>setDraft({...draft,descending:v==='desc'})} options={[{id:'asc',label:'升序 ↑'},{id:'desc',label:'降序 ↓'}]}/>
    </FormGroup>
    <p className="mi-caption">未知值在升序、降序下都放最后，置顶优先。按次或资料不全的物品不显示日均。持有时长截至今天，已售出截至售出日。</p>
    <div className="mi-actions"><Button onClick={()=>{resetItemQuery();nav.pop();}}>清除条件</Button><Button variant="primary" onClick={()=>{setItemQuery(draft);nav.pop();}}>应用条件</Button></div>
  </div>;
}
