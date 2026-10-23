import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dayLabel, moneyText } from '../format';
import { cellText, changeText, defaultRange, kindLabel, rateText, sortRows } from '../../wealth';
import { fxSplit } from '../../wealth-display';
import type { Compare, CompareRow } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Card, EmptyState, FormGroup, HeroCard, LargeTitle, NavBar, Notice, SegmentedControl, SelectField } from '../ui';
import { ReadState, useRead } from './shared';
import { t } from '../../i18n.ts';
function Comparison({from,to,generation,mode}:{from:string;to:string;generation:string;mode:'impact'|'kind'}) {
  const nav=useNav(),today=useSession().today,read=useRead(`compare:${generation}:${from}:${to}`,async()=>{const result=await invoke<Compare>('wealth_compare',{from,to});if(result.generation!==generation || result.from.snapshot_id!==from || result.to.snapshot_id!==to)throw Error(t('比较来源已变化，请重新选择。'));return result;});
  const value=read.value,rows=sortRows(value?.rows??[],mode);
  const blocks:{title:string;matches:(r:CompareRow)=>boolean}[]=[{title:t('计入的资产'),matches:r=>r.group==='counted'&&r.side==='asset'},{title:t('计入的负债'),matches:r=>r.group==='counted'&&r.side==='liability'},{title:t('计入范围有变化'),matches:r=>r.group==='scope_changed'},{title:t('不进合计'),matches:r=>r.group==='uncounted'}];
  return <><ReadState error={read.error} reload={read.reload} loading={!value}/>{value && <>
    <HeroCard eyebrow={t('金融净资产变化')} title={value.net_change_cents===null?t('暂不能比较'):changeText(value.net_change_cents)} subtitle={value.net_rate_hundredths===null?undefined:rateText(value.net_rate_hundredths)} footnote={t('{v1} → {v2}；变化包含存取、消费和估值，不等于投资收益。', { v1: dayLabel(value.from.date, today), v2: dayLabel(value.to.date, today) })}/>
    {(!value.from.complete||!value.to.complete) && <Notice>{t('所选盘点有缺项：')}{value.missing_names.join('、')||t('部分金额未知')}{t('。已知影响仅作核对，不能当作完整变化。')}</Notice>}
    {blocks.map(block=>{const group=rows.filter(block.matches);return !!group.length&&<Card key={block.title}><h2>{block.title}</h2>{group.map(row=><div className="mw-compare-row" key={row.account_id}><div className="mw-toolbar"><button type="button" onClick={()=>nav.push('wealth.account',{id:row.account_id})}>{row.name}</button><strong>{row.group==='uncounted'?(row.change_cents===null?t('未知'):changeText(row.change_cents)):(row.effect_cents===null?t('未知'):changeText(row.effect_cents))}</strong></div><p className="mw-muted">{kindLabel(row.kind)}{row.tag==='new'?t(' · 新启用'):row.tag==='closed'?t(' · 已停用'):''}{row.side==='liability'?t(' · 欠款变化'):''}</p>{(()=>{const split=row.group==='uncounted'?null:fxSplit(row);return split&&split.fx_cents!=='0'?<p className="mw-muted">{t('账户自身 {v1} · 汇率 {v2}',{v1:changeText(split.own_cents),v2:changeText(split.fx_cents)})}</p>:null;})()}<div className="mw-compare-values"><div><span>{dayLabel(value.from.date, today)}</span>{cellText(row.from,row.side)}</div><div><span>{dayLabel(value.to.date, today)}</span>{cellText(row.to,row.side)}</div></div></div>)}</Card>;})}
    <Card><h2>{t('表尾对账')}</h2><p>{t('已知账户净资产影响：{v1}', { v1: moneyText(value.known_effect_cents) })}</p><p>{t('金融净资产变化：')}{value.net_change_cents===null?t('未知'):changeText(value.net_change_cents)}</p><Notice>{value.reconciled?t('✓ 各账户影响相加与净资产变化一致。'):t('尚不能完整对账，请核对缺项与计入范围变化。')}</Notice><p className="mw-muted">{t('负债增加会减少净资产；不进合计的账户只供单独核对。')}</p></Card>
  </>}</>;
}
export default function ComparePage({params}:PageProps) {
  const s=useSession(),points=s.data?.summary.points??[],seed=defaultRange(points);
  const [from,setFrom]=useState(String(params.from??seed?.from??'')),[to,setTo]=useState(String(params.to??seed?.to??'')),[mode,setMode]=useState<'impact'|'kind'>('impact');
  const actualFrom=from||seed?.from||'',actualTo=to||seed?.to||'', a=points.find(p=>p.snapshot_id===actualFrom),b=points.find(p=>p.snapshot_id===actualTo);
  const options=points.map(p=>({id:p.snapshot_id,label:`${p.date}${p.complete?'':t(' · 有缺项')}`}));
  return <div className="m-page m-wealth"><NavBar/><LargeTitle title={t('盘点比较')} subtitle={t('选择两次盘点，逐个账户核对变化。')}/>{points.length<2?<EmptyState icon="wallet" title={t('还需要两次盘点')} message={t('完成两次盘点后，可以选择日期比较。')}/>:<>
    <FormGroup><SelectField label={t('起点')} value={actualFrom} onChange={setFrom} options={options}/><SelectField label={t('终点')} value={actualTo} onChange={setTo} options={options}/></FormGroup>
    <SegmentedControl label={t('排序方式')} value={mode} onChange={setMode} items={[{id:'impact',label:t('按影响')},{id:'kind',label:t('按类型')}]}/>
    {!a||!b||a.date>=b.date?<Notice>{t('请选择不同日期，起点须早于终点。')}</Notice>:<Comparison from={actualFrom} to={actualTo} generation={s.data!.summary.generation} mode={mode}/>}
  </>}</div>;
}
