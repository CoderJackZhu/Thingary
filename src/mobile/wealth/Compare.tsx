import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import { cellText, changeText, defaultRange, kindLabel, rateText, sortRows } from '../../wealth';
import type { Compare, CompareRow } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Card, EmptyState, FormGroup, HeroCard, LargeTitle, NavBar, Notice, SegmentedControl, SelectField } from '../ui';
import { ReadState, useRead } from './shared';
function Comparison({from,to,generation,mode}:{from:string;to:string;generation:string;mode:'impact'|'kind'}) {
  const nav=useNav(),read=useRead(`compare:${generation}:${from}:${to}`,async()=>{const result=await invoke<Compare>('wealth_compare',{from,to});if(result.generation!==generation || result.from.snapshot_id!==from || result.to.snapshot_id!==to)throw Error('比较来源已变化，请重新选择。');return result;});
  const value=read.value,rows=sortRows(value?.rows??[],mode);
  const blocks:{title:string;matches:(r:CompareRow)=>boolean}[]=[{title:'计入的资产',matches:r=>r.group==='counted'&&r.side==='asset'},{title:'计入的负债',matches:r=>r.group==='counted'&&r.side==='liability'},{title:'计入范围有变化',matches:r=>r.group==='scope_changed'},{title:'不进合计',matches:r=>r.group==='uncounted'}];
  return <><ReadState error={read.error} reload={read.reload} loading={!value}/>{value && <>
    <HeroCard eyebrow="金融净资产变化" title={value.net_change_cents===null?'暂不能比较':changeText(value.net_change_cents)} subtitle={value.net_rate_hundredths===null?undefined:rateText(value.net_rate_hundredths)} footnote={`${value.from.date} → ${value.to.date}；变化包含存取、消费和估值，不等于投资收益。`}/>
    {(!value.from.complete||!value.to.complete) && <Notice>所选盘点有缺项：{value.missing_names.join('、')||'部分金额未知'}。已知影响仅作核对，不能当作完整变化。</Notice>}
    {blocks.map(block=>{const group=rows.filter(block.matches);return !!group.length&&<Card key={block.title}><h2>{block.title}</h2>{group.map(row=><div className="mw-compare-row" key={row.account_id}><div className="mw-toolbar"><button type="button" onClick={()=>nav.push('wealth.account',{id:row.account_id})}>{row.name}</button><strong>{row.group==='uncounted'?(row.change_cents===null?'未知':changeText(row.change_cents)):(row.effect_cents===null?'未知':changeText(row.effect_cents))}</strong></div><p className="mw-muted">{kindLabel(row.kind)}{row.tag==='new'?' · 新启用':row.tag==='closed'?' · 已停用':''}{row.side==='liability'?' · 欠款变化':''}</p><div className="mw-compare-values"><div><span>{value.from.date}</span>{cellText(row.from,row.side)}</div><div><span>{value.to.date}</span>{cellText(row.to,row.side)}</div></div></div>)}</Card>;})}
    <Card><h2>表尾对账</h2><p>已知账户净资产影响：{money(value.known_effect_cents)}</p><p>金融净资产变化：{value.net_change_cents===null?'未知':changeText(value.net_change_cents)}</p><Notice>{value.reconciled?'✓ 各账户影响相加与净资产变化一致。':'尚不能完整对账，请核对缺项与计入范围变化。'}</Notice><p className="mw-muted">负债增加会减少净资产；不进合计的账户只供单独核对。</p></Card>
  </>}</>;
}
export default function ComparePage({params}:PageProps) {
  const s=useSession(),points=s.data?.summary.points??[],seed=defaultRange(points);
  const [from,setFrom]=useState(String(params.from??seed?.from??'')),[to,setTo]=useState(String(params.to??seed?.to??'')),[mode,setMode]=useState<'impact'|'kind'>('impact');
  const actualFrom=from||seed?.from||'',actualTo=to||seed?.to||'', a=points.find(p=>p.snapshot_id===actualFrom),b=points.find(p=>p.snapshot_id===actualTo);
  const options=points.map(p=>({id:p.snapshot_id,label:`${p.date}${p.complete?'':' · 有缺项'}`}));
  return <div className="m-page m-wealth"><NavBar title="盘点比较"/><LargeTitle title="盘点比较" subtitle="选择两次盘点，逐个账户核对变化。"/>{points.length<2?<EmptyState title="还需要两次盘点" message="完成两次盘点后，可以选择日期比较。"/>:<>
    <FormGroup><SelectField label="起点" value={actualFrom} onChange={setFrom} options={options}/><SelectField label="终点" value={actualTo} onChange={setTo} options={options}/></FormGroup>
    <SegmentedControl label="排序方式" value={mode} onChange={setMode} items={[{id:'impact',label:'按影响'},{id:'kind',label:'按类型'}]}/>
    {!a||!b||a.date>=b.date?<Notice>请选择不同日期，起点须早于终点。</Notice>:<Comparison from={actualFrom} to={actualTo} generation={s.data!.summary.generation} mode={mode}/>}
  </>}</div>;
}
