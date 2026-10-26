import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import type { Page } from '../../asset';
import { Button, ChipRow, FormGroup, Notice, ErrorState } from '../ui';
import { useNav } from '../nav-context';
import { labelFilterOptions } from '../../tag-investment';
type Choice = { id:string; name:string; enabled:boolean };
import { chooseSort, sortOptions } from './list-model';
import { resetItemQuery, setItemQuery, useItemQuery } from './list-store';
import './items.css';
import { t as tr } from '../../i18n.ts';
export default function ItemFilter() {
  const query=useItemQuery(), nav=useNav();
  const draft=query, setDraft=setItemQuery;
  const [categories,setCategories]=useState<{id:string;name:string}[]>([]),[tags,setTags]=useState<Choice[]>([]),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{ let live=true; invoke<{items:Choice[]}>('choice_list',{kind:'label'}).then(r=>{if(live)setTags(r.items);}).catch(e=>{if(live)setError(errorMessage(e));});return()=>{live=false;};},[retry]);
  useEffect(()=>{ let live=true; invoke<{categories:{id:string;name:string}[]}>('taxonomy_snapshot').then(r=>{if(live)setCategories(r.categories);}).catch(()=>{}); return()=>{live=false;};},[retry]);
  const [total,setTotal]=useState<number|null>(null);
  // Changes apply live, so show how many items the current conditions match.
  useEffect(()=>{ let live=true; invoke<Page>('list_assets',{query:{...query,offset:0}}).then(r=>{if(live)setTotal(r.total);}).catch(()=>{if(live)setTotal(null);}); return()=>{live=false;};},[JSON.stringify(query)]);
  const categoryId=draft.category?.mode==='category'?draft.category.id:draft.category?.mode==='uncategorized'?'none':'all';
  return <div className="mi-filter">
    <FormGroup title={tr('分类')}>
      <ChipRow label={tr('分类')} value={categoryId} onChange={id=>setDraft({...draft,category:id==='all'?{mode:'all'}:id==='none'?{mode:'uncategorized'}:{mode:'category',id}})} items={[{id:'all',label:tr('全部')},...categories.map(c=>({id:c.id,label:c.name})),{id:'none',label:tr('未分类')}]}/>
    </FormGroup>
    <FormGroup title={tr('保障')}>
      <ChipRow label={tr('保障')} value={draft.warranty??'all'} onChange={warranty=>setDraft({...draft,warranty})} items={[['all',tr('全部')],['covered',tr('有有效保障')],['expiring',tr('即将到期')],['lapsed',tr('有记录，当前无有效保障')],['none',tr('无保障记录')]].map(([id,label])=>({id,label}))}/>
    </FormGroup>
    <FormGroup title={tr('缺失资料')}>
      <ChipRow label={tr('缺失资料')} value={['missing_price','missing_date'].includes(draft.filter)?draft.filter:'all'} onChange={filter=>setDraft({...draft,filter:filter==='all' ? (['missing_price','missing_date'].includes(query.filter)?'all':query.filter) : filter})} items={[{id:'all',label:tr('不限')},{id:'missing_price',label:tr('金额未知')},{id:'missing_date',label:tr('日期未知')}]}/>
    </FormGroup>
    <FormGroup title={tr('标签')}>
      <ChipRow label={tr('标签')} value={draft.label??''} onChange={label=>setDraft({...draft,label:label||null})} items={[{id:'',label:tr('全部')},{id:'none',label:tr('无标签')},...labelFilterOptions(tags).map(t=>({id:t.id,label:t.text}))]}/>
    </FormGroup>
    {error&&<ErrorState message={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>}
    <Notice>{tr('不计入统计的物品仍保留在列表和详情中。总金额、日均、统计和时间轴分别遵循每件物品的设置。')}</Notice>
    <FormGroup title={tr('排序方式')}>
      <div className="mi-sort-options" role="group" aria-label={tr('排序方式')}>{sortOptions.map(([id,label])=><button key={id} aria-pressed={draft.sort===id} onClick={()=>setDraft(chooseSort(draft,id))}>{label}</button>)}</div>
      <ChipRow label={tr('顺序')} value={draft.descending?'desc':'asc'} onChange={v=>setDraft({...draft,descending:v==='desc'})} items={[{id:'asc',label:tr('升序 ↑')},{id:'desc',label:tr('降序 ↓')}]}/>
    </FormGroup>
    <p className="mi-caption">{tr('未知值在升序、降序下都放最后，置顶优先。按次或资料不全的物品不显示日均。持有时长截至今天，已售出截至售出日。')}</p>
    <div className="mi-filter-foot"><span className="m-sr" role="status" aria-live="polite">{total===null?'':tr('共 {total} 件', { total })}</span><Button onClick={resetItemQuery}>{tr('清除条件')}</Button><Button variant="primary" onClick={()=>nav.pop()}>{total===null?tr('完成'):tr('查看 {total} 件', { total })}</Button></div>
  </div>;
}
