import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AssetRecord, Page, SaveAsset } from '../../asset';
import { errorMessage } from '../../asset';
import { dayLabel, moneyText, unitMoneyText } from '../format';
import { defaultPreferences } from '../../preferences';
import { stateLabel } from '../../lifecycle';
import { collectionNavigation, collectionStatusOptions } from '../../collection-navigation';
import { nextSelection } from '../../batch-select';
import type { TaxonomySnapshot } from '../../taxonomy';
import type { OverviewData } from '../../Overview';
import { Cover } from '../../Photos';
import { submit } from '../../wealth';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { Button, Card, EmptyState, ErrorState, Fab, Icon, IconButton, LargeTitle, ListRow, SearchField, Loading, Notice, Section, SegmentedControl, SwipeRow } from '../ui';
import { appendPage, itemsSummary, stateCaption } from './list-model';
import { useItemQuery, setItemQuery } from './list-store';
import ItemBatch from './ItemBatch';
import './items.css';
type Counts = {generation:string;all:number;active:number;retired:number;sold:number};
export default function ItemList() {
  const nav=useNav(),session=useSession(),reveal=useReveal(),query=useItemQuery();
  const [page,setPage]=useState<Page|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [counts,setCounts]=useState<Counts|null>(null),[taxonomy,setTaxonomy]=useState<(TaxonomySnapshot & {generation:string})|null>(null),[overview,setOverview]=useState<OverviewData|null>(null),[expiring,setExpiring]=useState<Page|null>(null),[metaError,setMetaError]=useState('');
  const [searchOpen,setSearchOpen]=useState(false),[view,setView]=useState<'list'|'grid'>('list'),[selecting,setSelecting]=useState(false),[selected,setSelected]=useState<string[]>([]),[batch,setBatch]=useState(false),[notice,setNotice]=useState('');
  const press=useRef<{id:string;x:number;y:number;timer:number}|null>(null),pressed=useRef(false);
  const ticket=useRef(0),writing=useRef(false),sentinel=useRef<HTMLDivElement>(null),current=useRef<Page|null>(null);current.current=page;
  const [offset,setOffset]=useState(0), [loadedKey,setLoadedKey]=useState('');
  const selectionContext=useRef(''),selectionTicket=useRef(0);
  const queryKey=JSON.stringify(query), context=JSON.stringify([queryKey,reveal,retry,session.data?.summary.generation,session.settled?.input.request_id]);
  if(selectionContext.current!==context+':'+selecting)selectionTicket.current++;
  selectionContext.current=context+':'+selecting;
  useEffect(()=>{setOffset(0);setPage(null);setSelected([]);},[context]);
  useEffect(()=>{if(session.settled && ['batch_change','save_asset'].includes(session.settled.command))session.setNotice?.('已确认物品操作保存，请核对最新列表。');},[session.settled]);
  useEffect(()=>()=>{selectionContext.current='';selectionTicket.current++;},[]);
  useEffect(()=>{
    const id=++ticket.current;let live=true;setLoading(true);setError('');
    const requestedOffset=loadedKey===context?offset:0;
    invoke<Page>('list_assets',{query:{...query,offset:requestedOffset}}).then(next=>{
      if(!live||id!==ticket.current)return;
      if(session.data&&next.generation!==session.data.summary.generation)throw new Error('资料库已变化，请重新读取。');
      setPage(appendPage(requestedOffset?current.current:null,next,requestedOffset));setLoadedKey(context);
    }).catch(e=>{if(live&&id===ticket.current)setError(errorMessage(e));}).finally(()=>{if(live&&id===ticket.current)setLoading(false);});
    return()=>{live=false;};
  },[context,offset]);
  useEffect(()=>{
    let live=true;setCounts(null);setTaxonomy(null);setOverview(null);setExpiring(null);setMetaError('');
    Promise.all([invoke<Counts>('asset_counts'),invoke<TaxonomySnapshot & {generation:string}>('taxonomy_snapshot'),invoke<OverviewData>('overview',{scope:'held'}),invoke<Page>('list_assets',{query:{...query,search:'',filter:'all',category:{mode:'all'},label:null,warranty:'expiring',offset:0}})]).then(([c,t,o,w])=>{
      if(!live)return;if(c.generation!==t.generation||c.generation!==o.generation||c.generation!==w.generation)throw new Error('资料已变化，请重试。');
      setCounts(c);setTaxonomy(t);setOverview(o);setExpiring(w);
    }).catch(e=>{if(live)setMetaError(errorMessage(e));});return()=>{live=false;};
  },[reveal,retry,session.data?.summary.generation,session.settled?.input.request_id]);
  useEffect(()=>{
    if(!sentinel.current||!page||loading||error||page.items.length>=page.total)return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))setOffset(page.items.length);},{rootMargin:'160px'});observer.observe(sentinel.current);return()=>observer.disconnect();
  },[page,loading,error]);
  async function pin(record:AssetRecord){
    if(writing.current||session.navBlocked||!page)return;writing.current=true;session.setBusy(true);setNotice('');
    const input:SaveAsset={base:{request_id:crypto.randomUUID(),generation:page.generation,asset_id:record.asset.id,expected_revision:record.asset.revision,name:record.asset.name,price_cents:record.asset.price_cents,purchase_date:record.asset.purchase_date},details:record.details,photos:{ids:record.photos.map(p=>p.id),cover_id:record.cover_id},classification:record.classification,options:{preferences:{...(record.preferences??defaultPreferences()),pinned:!record.preferences?.pinned}}};
    try{await submit({command:'save_asset',input,label:record.preferences?.pinned?'取消置顶物品':'置顶物品'});setRetry(n=>n+1);}catch(e){setNotice(errorMessage(e));}finally{writing.current=false;session.setBusy(false);session.refreshPending();}
  }
  async function selectAll(){
    if (!page || session.navBlocked) return;
    const key=selectionContext.current, id=++selectionTicket.current, generation=page.generation;
    try {
      const ids=await invoke<string[]>('asset_ids',{query});
      const check=await invoke<Counts>('asset_counts');
      if(id===selectionTicket.current && key===selectionContext.current && check.generation===generation) setSelected(ids);
    } catch(e) { if(id===selectionTicket.current && key===selectionContext.current)setNotice(errorMessage(e)); }
  }
  function select(id:string){selectionTicket.current++;setSelected(prev=>nextSelection(prev,null,id,page?.items.map(r=>r.asset.id)??[],{meta:false,shift:false,toggle:true},null).ids);}
  const categoryName=query.category?.mode==='category'?taxonomy?.categories.find(c=>c.id===(query.category as {id:string}).id)?.name??'已选分类':query.category?.mode==='uncategorized'?'未分类':'全部';
  const summary=overview?itemsSummary(overview):null;
  const searching=searchOpen||!!query.search;
  const stopSelecting=()=>{setSelecting(false);setSelected([]);};
  function cancelPress(){if(press.current){window.clearTimeout(press.current.timer);press.current=null;}}
  const pressHandlers=(id:string)=>({
    onPointerDown:(e:{clientX:number;clientY:number})=>{if(session.navBlocked)return;cancelPress();pressed.current=false;press.current={id,x:e.clientX,y:e.clientY,timer:window.setTimeout(()=>{press.current=null;pressed.current=true;setSelecting(true);setSelected([id]);},500)};},
    onPointerMove:(e:{clientX:number;clientY:number})=>{const p=press.current;if(p&&Math.hypot(e.clientX-p.x,e.clientY-p.y)>8)cancelPress();},
    onPointerUp:cancelPress,onPointerCancel:cancelPress,onPointerLeave:cancelPress,
    onContextMenu:(e:{preventDefault:()=>void})=>{if(pressed.current||press.current)e.preventDefault();},
  });
  const open=(record:AssetRecord)=>{if(pressed.current){pressed.current=false;return;}if(selecting)select(record.asset.id);else nav.push('items.detail',{id:record.asset.id});};
  const row=(record:AssetRecord)=> <ListRow title={<>{selecting&&<span className="mi-check" aria-hidden="true">{selected.includes(record.asset.id)?'✓':'○'}</span>}{record.asset.name}{record.preferences?.pinned&&<span className="mi-pin"> · 置顶</span>}</>} icon={<Cover record={record} generation={page!.generation}/>} subtitle={[taxonomy?.categories.find(c=>c.id===record.classification?.category_id)?.name??'未分类',record.label_name,dayLabel(record.asset.purchase_date)].filter(Boolean).join(' · ')} value={record.sale?`售 ${moneyText(record.sale.fields.price_cents)}`:unitMoneyText(record.preferences?.cost_mode==='per_use'?record.per_use_cents??null:record.costs.daily_cents)+(record.preferences?.cost_mode==='per_use'?'/次':'/天')} valueSub={`${stateLabel(record)} · ${moneyText(record.asset.price_cents)}`} disabled={session.navBlocked} onClick={()=>open(record)}/>;
  return <div className="m-page mi-page">
    <LargeTitle title="物品" segments/>
    {metaError?<ErrorState title="摘要或选项读取失败" message={metaError} onRetry={()=>setRetry(n=>n+1)}/>:summary&&<Card className="mi-summary" label="持有物品摘要">
      <span className="mi-summary-label">持有物品总价</span>
      <strong className={`mi-summary-total${summary.totalCents===null?' m-unknown':''}`}>{summary.totalCents===null?'未知':moneyText(summary.totalCents)}</strong>
      {summary.unknownPriceCount>0&&<small className="mi-summary-note">{summary.unknownPriceCount} 件价格未知，未计入</small>}
      <div className="mi-summary-grid">
        <div><span>日均成本</span><strong className={summary.dailyCents===null?'m-unknown':undefined}>{summary.dailyCents===null?'未知':<>{unitMoneyText(summary.dailyCents)}<small> /天</small></>}</strong></div>
        <div><span>持有数量</span><strong>{summary.heldCount}<small> 件{summary.soldCount>0?` · ${summary.soldCount} 件已售`:''}</small></strong></div>
      </div>
      {summary.dailyNotes.length>0&&<small className="mi-summary-note">{summary.dailyNotes.join('；')}。</small>}
    </Card>}
    <SegmentedControl label="物品状态" variant="compact" value={collectionNavigation(query).selected??''} items={collectionStatusOptions.map(([id,label])=>({id,label:`${label}${counts?' '+counts[id]:''}`}))} onChange={filter=>setItemQuery({filter})}/>
    <div className="mi-toolbar"><button type="button" className="mi-state" onClick={()=>nav.push('items.filter')} aria-label={`筛选与排序，当前${stateCaption(query,categoryName)}`}><span>{stateCaption(query,categoryName)}</span><Icon name="chevronDown" size={14} strokeWidth={2.4}/></button>
      <div className="mi-tools">
        <IconButton label="搜索" pressed={searching} onClick={()=>setSearchOpen(true)}><Icon name="search" size={18}/></IconButton>
        <IconButton label="批量选择" pressed={selecting} disabled={session.navBlocked} onClick={()=>selecting?stopSelecting():setSelecting(true)}><Icon name="checkCircle" size={18}/></IconButton>
        <IconButton label="筛选与排序" onClick={()=>nav.push('items.filter')}><Icon name="filter" size={18}/></IconButton>
        <IconButton label={view==='list'?'切换网格':'切换列表'} onClick={()=>setView(view==='list'?'grid':'list')}><Icon name={view==='list'?'grid':'list'} size={18}/></IconButton>
      </div></div>
    {searching&&<div className="mi-search"><SearchField subject="物品" maxLength={200} autoFocus value={query.search} onChange={search=>setItemQuery({search})}/><button type="button" className="mi-search-cancel" onClick={()=>{setItemQuery({search:''});setSearchOpen(false);}}>取消</button></div>}
    {expiring&&expiring.total>0&&<Card tone="warn" className="mi-expiring"><ListRow icon="bell" title={`${expiring.items[0]?.asset.name ?? '物品'}${expiring.total>1?` 等 ${expiring.total} 件`:''} 保障 30 天内到期`} onClick={()=>setItemQuery({warranty:'expiring'})}/></Card>}
    {notice&&<Notice tone="danger">{notice}</Notice>}
    {selecting&&<Card><div className="mi-actions"><span>已选 {selected.length} 件</span><Button onClick={()=>void selectAll()}>全选结果</Button><Button variant="primary" disabled={!selected.length||session.navBlocked} onClick={()=>setBatch(true)}>批量操作</Button></div></Card>}
    {error?<ErrorState message={error} onRetry={()=>{setOffset(0);setRetry(n=>n+1);}}/>:page&&!page.items.length?<EmptyState title={counts?.all===0?'还没有物品':'没有符合条件的物品'} message="可以先拍张照片，价格和日期不知道就留空。" action={<Button variant="primary" onClick={()=>nav.push('items.edit')}>拍照建档</Button>}/>:<Section title={collectionNavigation(query).title}><div className={view==='grid'?'mi-grid':'mi-list'}>{page?.items.map(record=>selecting?<div key={record.asset.id} onPointerDown={()=>{pressed.current=false;}}>{row(record)}</div>:<SwipeRow key={record.asset.id} label={record.asset.name+' 操作'} actions={[{label:record.preferences?.pinned?'取消置顶':'置顶',onAction:()=>void pin(record)},{label:'删除',tone:'danger',onAction:()=>{setSelected([record.asset.id]);setBatch(true);}}]}><div {...pressHandlers(record.asset.id)}>{row(record)}</div></SwipeRow>)}</div></Section>}
    {loading&&<Loading/>}{page&&<div ref={sentinel} className="mi-caption">已显示 {page.items.length} / {page.total} 件{page.items.length<page.total&&<Button disabled={loading} onClick={()=>setOffset(page.items.length)}>加载更多</Button>}</div>}
    <Fab label="新增物品" hidden={selecting||batch} disabled={session.navBlocked} onClick={()=>nav.push('items.edit')}/>
    {batch&&page&&<ItemBatch ids={selected} generation={page.generation} today={page.today} onClose={()=>{if(!session.navBlocked)setBatch(false);}} onDone={()=>{setBatch(false);setSelected([]);setSelecting(false);setRetry(n=>n+1);}}/>}
  </div>;
}
