import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { money } from '../../asset';
import type { VirtualOverview } from '../../virtual';
import { matchesFilter } from '../../virtual';
import type { VirtualFilter } from '../../virtual';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, ChipRow, EmptyState, ListGroup, ListRow, Metric, MetricGrid, SegmentedControl } from '../ui';
import { inSegment, matchesVirtual, virtualFilterChips, virtualLine, virtualSegments, virtualSummary } from './model';
import type { VirtualSegment } from './model';
import { Head, Loaded, SearchBox, Tag } from './parts';
import { useRead } from './read';

/** spending.virtual: virtual assets by billing mode (design 16). */
export default function VirtualHome(_: PageProps) {
  const nav = useNav(), { today } = useSession(), { modules } = useModules();
  const on = modules ? modules.virtual : true;
  const read = useRead(() => invoke<VirtualOverview>('virtual_overview'), 'virtual');
  const [segment, setSegment] = useState<VirtualSegment>('all'), [filter, setFilter] = useState<VirtualFilter>('all'), [keyword, setKeyword] = useState('');
  return <div className="m-page">
    <Head title="虚拟资产" add={on ? { label: '新增', onClick: () => nav.push('spending.virtualEdit') } : undefined}/>
    {!on ? <EmptyState icon="info" title="虚拟资产已关闭" message="可以在「我的 › 设置 › 功能模块」重新开启；已有记录不会丢失。"/> : <Loaded read={read} what="虚拟资产">{data => {
      if (!data.items.length) return <EmptyState icon="doc" title="还没有虚拟资产" message="把买断的软件、注册的域名、订阅的服务和储值卡记下来，就能看到它们的计费方式、什么时候到期、一共花了多少。" action={<Button variant="primary" onClick={() => nav.push('spending.virtualEdit')}>新增虚拟资产</Button>}/>;
      const sum = virtualSummary(data.items);
      const shown = data.items.filter(v => inSegment(v, segment) && matchesFilter(v, filter) && matchesVirtual(v, keyword));
      return <>
        <SegmentedControl label="计费方式" items={virtualSegments} value={segment} onChange={setSegment}/>
        <MetricGrid>
          <Metric label="订阅年化费用" value={money(sum.annual)} sub={sum.subscriptions ? `${sum.subscriptions} 项 · 月均 ${money(sum.monthly)}` : '没有进行中的订阅'}/>
          <Metric label="储值余额" value={sum.balance !== null ? money(sum.balance) : '未知'} unknown={sum.balance === null} sub={sum.topups ? (sum.balanceUnknown ? `${sum.balanceUnknown} 项未记录余额` : `${sum.topups} 项储值`) : '没有储值'}/>
        </MetricGrid>
        <p className="sp-note sp-note-pad">年化按计划每期金额折算，不是已付；已记录支出 {money(data.spent_cents)}{data.unknown_price ? `，另有 ${data.unknown_price} 件金额未知` : ''}。{data.expiring ? `即将到期 ${data.expiring} 件。` : ''}</p>
        <ChipRow label="状态" items={virtualFilterChips.map(([id, label]) => ({ id, label }))} value={filter} onChange={id => setFilter(id as VirtualFilter)}/>
        <SearchBox label="搜索虚拟资产" value={keyword} onChange={setKeyword}/>
        {!shown.length ? <EmptyState icon="search" title="当前条件下没有记录" action={<Button onClick={() => { setSegment('all'); setFilter('all'); setKeyword(''); }}>清除筛选</Button>}/>
          : <ListGroup title={`${virtualSegments.find(s => s.id === segment)!.label} · ${shown.length} 项`} footer="累计费用标明估算；金额未知不按 0 计。">
            {shown.map(v => { const line = virtualLine(v, today); return <ListRow key={v.id} onClick={() => nav.push('spending.virtualDetail', { id: v.id })}
              title={<span className="sp-title">{v.fields.name}<Tag tone="accent">{line.typeLabel}</Tag></span>}
              subtitle={<span className="sp-lines"><span>{line.detail}</span><span>{line.status}{line.flag && <> · <Tag tone={line.flag.tone}>{line.flag.text}</Tag></>}</span></span>}
              value={line.cost.text !== null ? money(line.cost.text) : line.cost.note || '未知'} unknown={line.cost.text === null} valueSub={line.cost.text !== null ? (line.cost.note || line.cost.label) : line.cost.label}/>; })}
          </ListGroup>}
      </>;
    }}</Loaded>}
  </div>;
}
