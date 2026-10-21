import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import { changeText, kindLabel, quickAvailable } from '../../wealth';
import type { AccountHistory } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, Card, HeroCard, LargeTitle, LineAreaChart, ListGroup, ListRow, NavBar, Notice } from '../ui';
import { factText, ReadState, useGroups, useRead, useWrite } from './shared';
export default function AccountDetail({params}:PageProps) {
  const s=useSession(),nav=useNav(),groups=useGroups(),id=String(params.id??''), generation=s.data?.summary.generation;
  const read=useRead(`account:${generation}:${id}`,async()=>{const result=await invoke<AccountHistory>('wealth_account_history',{account:id});if(result.generation!==generation || result.account.id!==id)throw Error('账户资料已变化，请返回后重新读取。');return result;});
  const writer=useWrite(()=>nav.pop()),[remove,setRemove]=useState(false);
  const account=read.value?.account, rows=read.value?.rows??[];
  return <div className="m-page m-wealth"><NavBar title="账户详情" primary={account?{label:'编辑',onClick:()=>nav.push('wealth.accountEdit',{id},{title:'编辑账户'}),disabled:writer.frozen}:undefined}/><ReadState error={read.error} loading={!read.value} reload={read.reload}/>
    {account && <><LargeTitle title={account.fields.name} subtitle={`${account.fields.institution || '未填写平台'} · ${kindLabel(account.fields.kind)}`}/>
      <HeroCard eyebrow={account.fields.side==='liability'?'当前欠款':'当前金额'} title={account.latest?money(account.latest.amount_cents):'未知'} subtitle={factText(account.latest,account)} footnote={account.latest?`记录日期 ${account.latest.date}`:'尚无已知金额'}/>
      <Button variant="primary" disabled={writer.frozen || !quickAvailable(account,s.data?.summary.points??[],s.today)} onClick={()=>nav.push('wealth.checkin',{accountId:id},{title:'更新余额'})}>更新余额</Button>
      <Card><h2>账户趋势</h2><LineAreaChart values={rows.map(r=>r.amount_cents==null?null:Number(r.amount_cents))} summary={`${account.fields.name}的历史金额，缺项保留缺口`} height={130}/><div className="mw-toolbar mw-muted"><span>{rows[0]?.date}</span><span>{rows.at(-1)?.date}</span></div></Card>
      <ListGroup title={`历史记录 · ${rows.length} 条`}>{[...rows].reverse().map(row=><ListRow key={row.snapshot_id} title={row.date} subtitle={`${row.state==='unchanged'?'沿用':row.state==='missing'?'金额未知':'本次填写'} · ${row.counted?'计入':'不计入'}${account.fields.currency && account.fields.currency!=='CNY' || row.quantity_e8!=null ? ` · ${factText(row,account)}` : ''}`} value={row.amount_cents==null?'未知':money(row.amount_cents)} valueSub={row.change_cents==null?undefined:changeText(row.change_cents)} onClick={()=>nav.push('wealth.snapshots',{id:row.snapshot_id},{title:'盘点详情'})}/>)}</ListGroup>
      <ListGroup title="账户资料"><ListRow title="平台" value={account.fields.institution||'未填写'}/><ListRow title="类型" value={kindLabel(account.fields.kind)}/><ListRow title="币种" value={account.fields.currency??'CNY'}/><ListRow title="分组" value={groups.value?.find(g=>g.id===account.fields.group_id)?.name??(groups.error?'读取失败':account.fields.group_id?'正在读取…':'未分组')}/><ListRow title="启用日期" value={account.fields.opened_on}/><ListRow title="停用日期" value={account.fields.closed_on??'使用中'}/><ListRow title="计入金融净资产" value={account.fields.counted?'开启':'关闭'}/><ListRow title="按持仓记录" value={account.fields.holding_mode?`开启 · ${account.fields.holding_unit??'份'}`:'关闭'}/>{account.fields.purchase_cents!=null && <ListRow title="购入价" value={money(account.fields.purchase_cents)}/>}<ListRow title="购入日期" value={account.fields.purchased_on??'未知'}/></ListGroup>
      {account.fields.notes && <Card><h2>备注</h2><p className="mw-notes">{account.fields.notes}</p></Card>}
      <Button onClick={()=>nav.push('wealth.accountEdit',{id},{title:'编辑账户'})}>编辑账户</Button><Button onClick={()=>nav.push('wealth.accountEdit',{id},{title:'编辑账户'})}>{account.fields.closed_on?'重新启用账户':'停用账户'}</Button>
      <p className="mw-muted">停用请在账户资料填写日期，停用前最后一次盘点须为 0。已有盘点记录的账户保留历史，不能删除。</p>
      {writer.error && <Notice tone="danger">{writer.error}</Notice>}
      {!account.has_entries && !account.latest && (remove?<Card><p>将误建账户移入最近删除？</p><Button variant="danger" disabled={writer.frozen} onClick={()=>void writer.write({command:'wealth_trash',label:`删除账户 ${account.fields.name}`,input:{request_id:crypto.randomUUID(),generation:generation!,kind:'account',id,expected_revision:account.revision,deleted:true}})}>确认移入最近删除</Button><Button disabled={writer.frozen} onClick={()=>setRemove(false)}>取消</Button></Card>:<Button variant="danger" onClick={()=>setRemove(true)}>删除账户</Button>)}
    </>}
  </div>;
}
