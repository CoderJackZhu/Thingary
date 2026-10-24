import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { moneyText } from '../format';
import type { VirtualOverview } from '../../virtual';
import { matchesFilter } from '../../virtual';
import type { VirtualFilter } from '../../virtual';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, ChipRow, EmptyState, ListGroup, ListRow, Metric, MetricGrid, SearchField, SegmentedControl } from '../ui';
import { inSegment, matchesVirtual, virtualFilterChips, virtualLine, virtualSegments, virtualSummary } from './model';
import type { VirtualSegment } from './model';
import { Head, Loaded, Tag } from './parts';
import { useRead } from './read';
import { t } from '../../i18n.ts';
/** spending.virtual: virtual assets by billing mode (design 16). */
export default function VirtualHome(_: PageProps) {
  const nav = useNav(), { today } = useSession(), { modules } = useModules();
  const on = modules ? modules.virtual : true;
  const read = useRead(() => invoke<VirtualOverview>('virtual_overview'), 'virtual');
  const [segment, setSegment] = useState<VirtualSegment>('all'), [filter, setFilter] = useState<VirtualFilter>('all'), [keyword, setKeyword] = useState('');
  return <div className="m-page">
    <Head title={t('虚拟资产')} add={on ? { label: t('新增虚拟资产'), onClick: () => nav.push('spending.virtualEdit') } : undefined}/>
    {!on ? <EmptyState icon="info" title={t('虚拟资产已关闭')} message={t('可以在「我的 › 设置 › 功能模块」重新开启；已有记录不会丢失。')}/> : <Loaded read={read} what={t('虚拟资产')}>{data => {
      if (!data.items.length) return <EmptyState icon="wallet" title={t('还没有虚拟资产')} message={t('把买断的软件、注册的域名、订阅的服务和储值卡记下来，就能看到它们的计费方式、什么时候到期、一共花了多少。')} action={<Button variant="primary" onClick={() => nav.push('spending.virtualEdit')}>{t('新增虚拟资产')}</Button>}/>;
      const sum = virtualSummary(data.items);
      const shown = data.items.filter(v => inSegment(v, segment) && matchesFilter(v, filter) && matchesVirtual(v, keyword));
      return <>
        <SegmentedControl label={t('计费方式')} items={virtualSegments} value={segment} onChange={setSegment}/>
        <MetricGrid>
          <Metric label={t('订阅年化费用')} value={moneyText(sum.annual)} sub={sum.subscriptions ? t('{subscriptions} 项 · 月均 {v2}', { subscriptions: sum.subscriptions, v2: moneyText(sum.monthly) }) : t('暂无进行中的订阅')}/>
          <Metric label={t('储值余额')} value={sum.balance !== null ? moneyText(sum.balance) : t('未知')} unknown={sum.balance === null} sub={sum.topups ? (sum.balanceUnknown ? t('{balanceUnknown} 项余额未知', { balanceUnknown: sum.balanceUnknown }) : t('{topups} 项储值', { topups: sum.topups })) : t('暂无储值')}/>
        </MetricGrid>
        <p className="sp-note sp-note-pad">{t('年化按计划每期金额折算，不是已付；已记录支出 {v1}', { v1: moneyText(data.spent_cents) })}{data.unknown_price ? t('，另有 {unknown_price} 件金额未知', { unknown_price: data.unknown_price }) : ''}。{data.expiring ? t('即将到期 {expiring} 件。', { expiring: data.expiring }) : ''}</p>
        <ChipRow label={t('状态')} items={virtualFilterChips.map(([id, label]) => ({ id, label }))} value={filter} onChange={id => setFilter(id as VirtualFilter)}/>
        <SearchField subject={t('虚拟资产')} value={keyword} onChange={setKeyword}/>
        {!shown.length ? <EmptyState icon="wallet" title={t('当前条件下没有记录')} action={<Button onClick={() => { setSegment('all'); setFilter('all'); setKeyword(''); }}>{t('清除筛选')}</Button>}/>
          : <ListGroup title={t('{label} · {length} 项', { label: virtualSegments.find(s => s.id === segment)!.label, length: shown.length })} footer={t('累计费用标明估算；金额未知不按 0 计。')}>
            {shown.map(v => { const line = virtualLine(v, today); return <ListRow key={v.id} onClick={() => nav.push('spending.virtualDetail', { id: v.id })}
              title={<span className="sp-title">{v.fields.name}<Tag tone="accent">{line.typeLabel}</Tag></span>}
              subtitle={<span className="sp-lines"><span>{line.detail}</span><span>{line.status}{line.flag && <> · <Tag tone={line.flag.tone}>{line.flag.text}</Tag></>}</span></span>}
              value={line.cost.text !== null ? moneyText(line.cost.text) : line.cost.note || t('未知')} unknown={line.cost.text === null} valueSub={line.cost.text !== null ? (line.cost.note || line.cost.label) : line.cost.label}/>; })}
          </ListGroup>}
      </>;
    }}</Loaded>}
  </div>;
}
