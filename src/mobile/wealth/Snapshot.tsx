import { invoke } from '@tauri-apps/api/core';
import { dayLabel, moneyText, optionalText } from '../format';
import { kindLabel, previewTotals } from '../../wealth';
import type { Snapshot, Summary } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { Button, Card, HeroCard, ListGroup, ListRow, NavBar, Notice } from '../ui';
import { factText, ReadState, useRead } from './shared';
export default function SnapshotDetail({params}:PageProps) {
  const s=useSession(),nav=useNav(),id=String(params.id??''),generation=s.data?.summary.generation;
  const read=useRead(`snapshot:${generation}:${id}`,async()=>{const [snapshot,summary]=await Promise.all([invoke<Snapshot|null>('wealth_snapshot',{id}),invoke<Summary>('wealth_summary')]);if(summary.generation!==generation || !snapshot || !summary.points.some(p=>p.snapshot_id===id))throw Error('这条盘点已删除或资料库已变化，请返回后重新读取。');return snapshot;});
  const snapshot=read.value, totals=snapshot?previewTotals(snapshot.entries.map(e=>({side:e.side,counted:e.counted,cents:e.amount_cents}))):null;
  return <div className="m-page m-wealth"><NavBar title="盘点详情"/><ReadState error={read.error} reload={read.reload} loading={!snapshot}/>{snapshot && <>
    <HeroCard eyebrow={`${dayLabel(snapshot.date, s.today)} · 只读记录`} title={totals?.missing?'金额未完整':moneyText(totals!.net)} subtitle={snapshot.missing.length?`缺 ${snapshot.missing.length} 个账户`:'完整盘点'}/>
    {snapshot.entries.some(e=>e.state==='unchanged') && <Notice>含沿用金额，没有未知账户时仍是完整盘点。</Notice>}
    {(['entered','unchanged','missing'] as const).map(state=>{const entries=snapshot.entries.filter(e=>e.state===state);return entries.length>0 && <ListGroup key={state} title={state==='entered'?'本次填写':state==='unchanged'?'沿用金额':'金额未知'}>{entries.map(entry=>{const account=s.data?.accounts.find(a=>a.id===entry.account_id);return <ListRow key={entry.account_id} title={account?.fields.name??entry.account_id} subtitle={`${kindLabel(entry.kind)} · ${entry.side==='liability'?'欠款 · ':''}${entry.counted?'计入':'不计入'} · ${factText(entry,account)}`} value={entry.amount_cents==null?'未知':moneyText(entry.amount_cents)}/>;})}</ListGroup>;})}
    <Card><h2>备注</h2><p className="mw-notes">{optionalText(snapshot.notes)}</p></Card>
    <Button variant="primary" onClick={()=>nav.push('wealth.checkin',{id:snapshot.id,date:snapshot.date})}>更正这次盘点</Button>
  </>}</div>;
}
