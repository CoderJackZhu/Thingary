import { useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { currencyCode, currencyDecimals, rateSuggestions } from '../../currency';
import { code as errorCode, holdingQuickChange, quickChanges, quickDateMin, quickFact, quickTransferPairs } from '../../wealth';
import type { Draft, HoldingQuickMode, QuickMode, QuickUpdate } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, DateField, FormGroup, MoneyField, NavBar, Notice, SegmentedControl, SelectField, TextAreaField } from '../ui';
import { factText, ReadState, useRead, useWrite } from './shared';
import { t } from '../../i18n.ts';
export function Update({draft,id,onStale,header}:{draft:Draft;id:string;onStale?:()=>void;header?:ReactNode}) {
  const s=useSession(),nav=useNav(),writer=useWrite(()=>nav.pop(),error=>{if(errorCode(error)==='QUICK_STALE')onStale?.();});
  const [mode,setMode]=useState<QuickMode>('balance'),[holdingMode,setHoldingMode]=useState<HoldingQuickMode>('replace'),[amount,setAmount]=useState(''),[quantity,setQuantity]=useState(''),[price,setPrice]=useState(''),[note,setNote]=useState('');
  const pairs=quickTransferPairs(draft),[from,setFrom]=useState(pairs.find(p=>p.from===id)?.from??pairs[0]?.from??''),[to,setTo]=useState(pairs.find(p=>p.from===id)?.to??pairs[0]?.to??'');
  const account=draft.rows.find(r=>r.account.id===id)?.account;
  const code=currencyCode(draft.rows.find(r=>r.account.id===(mode==='transfer'?from:id))?.account.fields.currency);
  const [rates,setRates]=useState<Record<string,string>>(()=>Object.fromEntries(Object.entries(rateSuggestions(draft)).map(([c,v])=>[c,v.rate])));
  if(!account)return <><NavBar title={t('更新余额')}/>{header}<Notice>{t('这个账户不在所选日期的盘点范围内。历史金额请到盘点记录更正。')}</Notice></>;
  let changes:QuickUpdate['changes']=[],problem='';
  try {changes=account.fields.holding_mode?[holdingQuickChange(draft,id,holdingMode,quantity,price,rates[code]??'')]:quickChanges(draft,id,mode,amount,from,to,rates[code]??'');} catch(e){problem=e instanceof Error?e.message:String(e);}
  async function save() {
    if(problem){writer.setError(problem);return;}
    if([...note].length>500||note.includes('\0')){writer.setError(t('备注最多 500 字，不能含空字符。'));return;}
    await writer.write({command:'wealth_quick_update',label:t('{name} 快速更新', { name: account!.fields.name }),input:{request_id:crypto.randomUUID(),generation:draft.generation,date:draft.date,note,changes}});
  }
  return <><NavBar title={t('更新余额')} primary={{label:t('保存'),onClick:()=>void save(),disabled:writer.frozen}}/>{header}<p className="mw-muted">{t('原金额：{v1}', { v1: factText(quickFact(draft,id),account) })}</p>{draft.existing && <Notice>{t('当天已有盘点，保存将更正同一次记录，其他账户保留原记录。')}</Notice>}
    <fieldset disabled={writer.frozen} style={{border:0,padding:0,margin:0,minWidth:0}}>
      {account.fields.holding_mode?<SegmentedControl label={t('持仓更新方式')} value={holdingMode} onChange={v=>{setHoldingMode(v);setQuantity('');setPrice('');}} items={[{id:'replace',label:t('修改持仓')},{id:'quantity',label:t('增减持仓')},{id:'price',label:t('更新价格')}]}/>:<SegmentedControl label={t('更新方式')} value={mode} onChange={v=>{setMode(v);setAmount('');}} items={[{id:'balance',label:t('修改余额')},{id:'delta',label:t('增减金额')},{id:'transfer',label:t('转账')}]}/>}
      <FormGroup title={t('本次更新')}><div className="mw-inputs">
        {account.fields.holding_mode?<>{holdingMode!=='price' && <MoneyField label={holdingMode==='quantity'?t('份额变化'):t('新份额')} symbol={account.fields.holding_unit??t('份')} places={8} signed={holdingMode==='quantity'} value={quantity} onChange={setQuantity}/>}<MoneyField label={t('手填单价')} symbol={code} places={6} value={price} onChange={setPrice}/></>:<>
          {mode==='transfer' && <><SelectField label={t('转出账户')} value={from} onChange={v=>{setFrom(v);setTo(pairs.find(p=>p.from===v)?.to??'');}} options={draft.rows.filter(r=>pairs.some(p=>p.from===r.account.id)).map(r=>({id:r.account.id,label:r.account.fields.name}))}/><SelectField label={t('转入／还款账户')} value={to} onChange={setTo} options={draft.rows.filter(r=>pairs.some(p=>p.from===from&&p.to===r.account.id)).map(r=>({id:r.account.id,label:r.account.fields.name}))}/></>}
          <MoneyField label={mode==='balance'?t('新的余额或欠款'):mode==='delta'?t('增减金额'):t('转账金额')} symbol={code} places={currencyDecimals(code)} signed={mode==='delta'} value={amount} onChange={setAmount}/>
        </>}
        {code!=='CNY' && <MoneyField label={t('{code} 本次汇率', { code })} places={6} symbol="" value={rates[code]??''} onChange={v=>setRates(old=>({...old,[code]:v}))}/>}
      </div></FormGroup><FormGroup><TextAreaField label={t('备注（最多 500 字）')} value={note} onChange={setNote}/></FormGroup>
    </fieldset>
    {!!changes.length && <FormGroup title={t('保存后金额')}>{changes.map(change=><p className="mw-equation" key={change.account_id}>{draft.rows.find(r=>r.account.id===change.account_id)?.account.fields.name}：{factText(change,draft.rows.find(r=>r.account.id===change.account_id)?.account)}</p>)}</FormGroup>}
    {writer.error && <Notice tone="danger">{t('{error} 你的输入保留，请核对原金额后再保存。', { error: writer.error })}<Button disabled={writer.frozen} onClick={()=>{s.reload();nav.pop();}}>{t('返回重新读取')}</Button></Notice>}
    <p className="mw-muted">{t('其他账户沿用已有金额，没有金额的仍为未知。增减填正数或负数，结果不能小于 0。转账仅支持金额已知、币种及计入范围相同的账户。')}</p>
  </>;
}
export default function QuickUpdatePage({params}:PageProps) {
  const s=useSession(),id=String(params.id??''),[date,setDate]=useState(s.today),generation=s.data?.summary.generation??'';
  const read=useRead(`quick:${generation}:${date}`,async()=>{const d=await invoke<Draft>('wealth_snapshot_draft',{date});if(d.generation!==generation || d.date!==date)throw Error(t('账户资料已变化，请返回后重新读取。'));return d;});
  const header=<DateField label={t('日期')} value={date} min={quickDateMin(s.data?.summary.points??[])} max={s.today} disabled={s.navBlocked} onChange={setDate}/>;
  return <div className="m-page m-wealth">{read.value ? <Update key={`${generation}:${date}`} draft={read.value} id={id} onStale={read.reload} header={header}/> : <><NavBar title={t('更新余额')}/>{header}<ReadState error={read.error} reload={read.reload} loading/></>}</div>;
}
