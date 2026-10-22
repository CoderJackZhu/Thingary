import SnapshotDetail from './Snapshot';
import type { PageProps } from '../routes';
import { dayLabel, moneyText } from '../format';
import { changeText } from '../../wealth';
import { useSession } from '../session';
import { useNav } from '../nav-context';
import { Button, EmptyState, LargeTitle, ListGroup, ListRow } from '../ui';
import { WealthGate } from './shared';
import { t } from '../../i18n.ts';
export function SnapshotList() {
  const s=useSession(),nav=useNav(),points=s.data?.summary.points??[];
  return <div className="m-page m-wealth"><LargeTitle title={t('盘点记录')} actions={<Button onClick={()=>nav.push('wealth.checkin')}>{t('盘点')}</Button>}/><WealthGate>
    {!points.length?<EmptyState icon="wallet" title={t('暂无盘点记录')} message={t('逐个账户填齐金额并保存后，会在这里留下记录。')} action={<Button onClick={()=>nav.push('wealth.checkin')}>{t('开始盘点')}</Button>}/>:<>
      <Button disabled={points.length<2} onClick={()=>nav.push('wealth.compare')}>{t('比较两次盘点')}</Button>
      <ListGroup title={t('共 {length} 次', { length: points.length })}>{[...points].reverse().map(point=><ListRow key={point.snapshot_id} title={dayLabel(point.date, s.today)} subtitle={`${point.complete?'完整':`缺 ${point.missing} 个账户`}${point.has_unchanged?' · 含沿用金额':''}${point.notes?` · ${point.notes}`:''}`} value={point.complete?moneyText(point.net_cents):t('未完整')} valueSub={point.change_cents===null?undefined:changeText(point.change_cents)} onClick={()=>nav.push('wealth.snapshots',{id:point.snapshot_id},{title:t('盘点详情')})}/>)}</ListGroup>
      <p className="mw-muted">{t('完整表示应盘账户都有金额；含沿用金额不代表全部重新核对。金额缺项时不展示净资产合计。')}</p>
    </>}
  </WealthGate></div>;
}

export default function Snapshots(props:PageProps) {
  return props.params.id ? <SnapshotDetail {...props}/> : <SnapshotList/>;
}
