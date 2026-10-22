import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { NOT_SET, dayLabel, moneyText, optionalText } from '../format';
import { changeText, kindLabel, quickAvailable } from '../../wealth';
import { closeFields, quickBlockedReason, stopDateRange } from './model';
import type { AccountHistory } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, Card, ConfirmSheet, DateField, DeleteSheet, HeroCard, LargeTitle, LineAreaChart, ListGroup, ListRow, NavBar, Notice } from '../ui';
import { factDetail, factText, ReadState, useGroups, useRead, useWrite } from './shared';
export default function AccountDetail({params}:PageProps) {
  const s=useSession(),nav=useNav(),groups=useGroups(),id=String(params.id??''), generation=s.data?.summary.generation;
  const read=useRead(`account:${generation}:${id}`,async()=>{const result=await invoke<AccountHistory>('wealth_account_history',{account:id});if(result.generation!==generation || result.account.id!==id)throw Error('账户资料已变化，请返回后重新读取。');return result;});
  const writer=useWrite(()=>nav.pop()),[remove,setRemove]=useState(false),[stop,setStop]=useState(false),[stopDate,setStopDate]=useState(''),stopper=useWrite(()=>setStop(false));
  const account=read.value?.account, rows=read.value?.rows??[];
  const blocked=account?quickBlockedReason(account,s.data?.summary.points??[],s.today):'', range=account?stopDateRange(account,s.today):null;
  const openStop=()=>{stopper.setError('');setStopDate(range?.ok?range.max:'');setStop(true);};
  const stopSave=(closed_on:string|null)=>void stopper.write({command:'wealth_account_save',label:closed_on?`停用账户 ${account!.fields.name}`:`重新启用账户 ${account!.fields.name}`,input:{request_id:crypto.randomUUID(),generation:generation!,id,expected_revision:account!.revision,fields:closeFields(account!.fields,closed_on)}});
  return <div className="m-page m-wealth"><NavBar primary={account?{label:'编辑',onClick:()=>nav.push('wealth.accountEdit',{id},{title:'编辑账户'}),disabled:writer.frozen}:undefined}/><ReadState error={read.error} loading={!read.value} reload={read.reload}/>
    {account && <><LargeTitle title={account.fields.name} subtitle={`${account.fields.institution || `平台${NOT_SET}`} · ${kindLabel(account.fields.kind)}`}/>
      <HeroCard eyebrow={account.fields.side==='liability'?'当前欠款':'当前金额'} title={account.latest?moneyText(account.latest.amount_cents):'未知'} subtitle={factDetail(account.latest,account)} footnote={account.latest?`记录日期 ${account.latest.date}`:undefined}/>
      <Button variant="primary" disabled={writer.frozen || !quickAvailable(account,s.data?.summary.points??[],s.today)} onClick={()=>nav.push('wealth.checkin',{accountId:id},{title:'更新余额'})}>更新余额</Button>
      {blocked && <p className="mw-muted mw-reason" role="note">{blocked}</p>}
      <Card><h2>账户趋势</h2><LineAreaChart values={rows.map(r=>r.amount_cents==null?null:Number(r.amount_cents))} summary={`${account.fields.name}的历史金额，缺项保留缺口`} height={130}/><div className="mw-toolbar mw-muted"><span>{rows[0] && dayLabel(rows[0].date, s.today)}</span><span>{rows.length > 1 && dayLabel(rows.at(-1)!.date, s.today)}</span></div></Card>
      <ListGroup title={`历史记录 · ${rows.length} 条`}>{[...rows].reverse().map(row=><ListRow key={row.snapshot_id} title={dayLabel(row.date, s.today)} subtitle={`${row.state==='unchanged'?'沿用':row.state==='missing'?'金额未知':'本次填写'} · ${row.counted?'计入':'不计入'}${account.fields.currency && account.fields.currency!=='CNY' || row.quantity_e8!=null ? ` · ${factText(row,account)}` : ''}`} value={row.amount_cents==null?'未知':moneyText(row.amount_cents)} valueSub={row.change_cents==null?undefined:changeText(row.change_cents)} onClick={()=>nav.push('wealth.snapshots',{id:row.snapshot_id},{title:'盘点详情'})}/>)}</ListGroup>
      <ListGroup title="账户资料"><ListRow title="平台" value={optionalText(account.fields.institution)}/><ListRow title="类型" value={kindLabel(account.fields.kind)}/><ListRow title="币种" value={account.fields.currency??'CNY'}/><ListRow title="分组" value={groups.value?.find(g=>g.id===account.fields.group_id)?.name??(groups.error?'读取失败':account.fields.group_id?'正在读取…':'未分组')}/><ListRow title="启用日期" value={account.fields.opened_on}/><ListRow title="停用日期" value={account.fields.closed_on??'使用中'}/><ListRow title="计入金融净资产" value={account.fields.counted?'开启':'关闭'}/><ListRow title="按持仓记录" value={account.fields.holding_mode?`开启 · ${account.fields.holding_unit??'份'}`:'关闭'}/>{account.fields.purchase_cents!=null && <ListRow title="购入价" value={moneyText(account.fields.purchase_cents)}/>}<ListRow title="购入日期" value={account.fields.purchased_on??'未知'}/></ListGroup>
      {account.fields.notes && <Card><h2>备注</h2><p className="mw-notes">{account.fields.notes}</p></Card>}
      <Button disabled={writer.frozen || stopper.frozen} onClick={openStop}>{account.fields.closed_on?'重新启用账户':'停用账户'}</Button>
      <p className="mw-muted">也可以在盘点时直接把账户标为已注销。已有盘点记录的账户保留历史，只能停用，不能删除。</p>
      {writer.error && !remove && !stop && <Notice tone="danger">{writer.error}</Notice>}
      {!account.has_entries && !account.latest && <Button variant="danger" onClick={()=>setRemove(true)}>删除账户</Button>}
      {stop && (account.fields.closed_on
        ? <ConfirmSheet title="重新启用账户？" message={`「${account.fields.name}」会重新出现在之后的盘点里，已有的历史记录不变。`} confirm="重新启用" busy={stopper.frozen} error={stopper.error} onClose={()=>setStop(false)} onConfirm={()=>stopSave(null)}/>
        : <ConfirmSheet title="停用账户？" confirm="停用" danger busy={stopper.frozen} error={stopper.error} disabled={!range?.ok||!stopDate} onClose={()=>setStop(false)} onConfirm={()=>stopSave(stopDate)}>
            <p className="m-confirm-text">「{account.fields.name}」从停用日起不再出现在盘点里，历史记录保留。{account.latest?`上次盘点是 ${dayLabel(account.latest.date,s.today)} 的 ${moneyText(account.latest.amount_cents)}，停用后视为已转出，不用再填 0。`:'这个账户还没有盘点记录。'}</p>
            {range?.ok ? <DateField label="停用日期" value={stopDate} min={range.min} max={range.max} onChange={setStopDate}/> : <Notice>今天已有这个账户的盘点，不能再选停用日期。请在下一次盘点时把它标为已注销。</Notice>}
          </ConfirmSheet>)}
      {remove && account && <DeleteSheet name={account.fields.name} busy={writer.frozen} error={writer.error} onClose={()=>setRemove(false)} onConfirm={()=>void writer.write({command:'wealth_trash',label:`删除账户 ${account.fields.name}`,input:{request_id:crypto.randomUUID(),generation:generation!,kind:'account',id,expected_revision:account.revision,deleted:true}})}><p className="m-confirm-text">只能删除没有任何盘点记录的误建账户。</p></DeleteSheet>}
    </>}
  </div>;
}
