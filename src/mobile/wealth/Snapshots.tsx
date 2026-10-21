import SnapshotDetail from './Snapshot';
import type { PageProps } from '../routes';
import { money } from '../../asset';
import { changeText } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import { Button, EmptyState, LargeTitle, ListGroup, ListRow } from '../ui';
import { WealthGate } from './shared';
export function SnapshotList() {
  const s=useSession(),nav=useNav(),points=s.data?.summary.points??[];
  return <div className="m-page m-wealth"><LargeTitle title="盘点记录" actions={<Button onClick={()=>nav.push('wealth.checkin')}>盘点</Button>}/><WealthGate>
    {!points.length?<EmptyState title="还没有盘点记录" message="逐个账户填齐金额并保存后，会在这里留下记录。" action={<Button onClick={()=>nav.push('wealth.checkin')}>开始盘点</Button>}/>:<>
      <Button disabled={points.length<2} onClick={()=>nav.push('wealth.compare')}>比较两次盘点</Button>
      <ListGroup title={`共 ${points.length} 次`}>{[...points].reverse().map(point=><ListRow key={point.snapshot_id} title={point.date} subtitle={`${point.complete?'完整':`缺 ${point.missing} 个账户`}${point.has_unchanged?' · 含沿用金额':''}${point.notes?` · ${point.notes}`:''}`} value={point.complete?money(point.net_cents):'未完整'} valueSub={point.change_cents===null?undefined:changeText(point.change_cents)} onClick={()=>nav.push('wealth.snapshots',{id:point.snapshot_id},{title:'盘点详情'})}/>)}</ListGroup>
      <p className="mw-muted">完整表示应盘账户都有金额；含沿用金额不代表全部重新核对。金额缺项时不展示净资产合计。</p>
    </>}
  </WealthGate></div>;
}

export default function Snapshots(props:PageProps) {
  return props.params.id ? <SnapshotDetail {...props}/> : <SnapshotList/>;
}
