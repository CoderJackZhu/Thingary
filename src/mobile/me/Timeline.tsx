import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from '../../asset';
import { allModules, hiddenKinds } from '../../modules';
import { defaultTimeline } from '../../source';
import type { TimelineSelection } from '../../source';
import { eventDetail, eventLabel, timelineFilters } from '../../Timeline';
import type { TimelineEvent } from '../../Timeline';
import { useModules } from '../modules-context';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { Button, ChipRow, EmptyState, ErrorState, Icon, IconButton, ListGroup, ListRow, Loading, NavBar, LargeTitle, Notice, SelectField, FormGroup } from '../ui';
import type { PageProps } from '../routes';
import { groupByMonth, monthSpendingText, monthsPerStep } from './model';
import { eventTarget, openRoute } from './shared';
import { MeIcon } from './icons';
import './me.css';

type TimelinePage = { generation: string; today: string; years?: number[]; dated: TimelineEvent[]; undated: TimelineEvent[] };
const tones: Record<string, 'accent' | 'warn' | 'positive' | 'danger' | 'neutral'> = { purchase: 'accent', maintenance: 'neutral', warranty_start: 'warn', warranty_end: 'warn', retire: 'neutral', activate: 'positive', sale: 'positive', expense: 'danger', refund: 'positive', payment: 'neutral', snapshot: 'positive', virtual: 'accent', wish_added: 'warn', wish_achieved: 'positive', wish_abandoned: 'neutral' };

/** 时间轴 (design 23): the desktop `timeline_view` projection, grouped by month with a spending total per month. */
export default function Timeline(_props: PageProps) {
  const nav = useNav(), { modules: runtime } = useModules(), session = useSession(), reveal = useReveal();
  const modules = runtime ?? allModules, today = session.today;
  const [selection, setSelection] = useState<TimelineSelection>(defaultTimeline);
  const [page, setPage] = useState<TimelinePage | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [months, setMonths] = useState(monthsPerStep);
  const spend = modules.expenses || modules.recurring || modules.virtual;
  const filters = timelineFilters.filter(([key]) => (key !== 'wishlist' || modules.wishlist) && (key !== 'snapshot' || modules.wealth) && (key !== 'expense' || spend));
  useEffect(() => {
    let live = true; setError('');
    invoke<TimelinePage>('timeline_view', { query: { filter: selection.filter, asset_id: null }, domain: selection.domain, year: selection.year })
      .then(result => { if (live) { setPage(result); setMonths(monthsPerStep); } }).catch(cause => { if (live) setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [selection.filter, selection.domain, selection.year, retry, reveal]);
  const hidden = useMemo(() => hiddenKinds(modules), [modules]);
  const groups = useMemo(() => page ? groupByMonth(page.dated.filter(event => !hidden.has(event.kind))) : [], [page, hidden]);
  const undated = page ? page.undated.filter(event => !hidden.has(event.kind)) : [];
  const years = [...new Set([...(page?.years ?? []), ...(selection.year === null ? [] : [selection.year])])].sort((a, b) => b - a);
  const shown = groups.slice(0, months);

  const row = (event: TimelineEvent) => {
    const snapshot = event.kind === 'snapshot', target = eventTarget(event), detail = eventDetail(event);
    const props = {
      icon: <MeIcon name={event.kind.startsWith('wish_') ? 'heart' : event.kind.startsWith('warranty_') ? 'shield' : event.kind === 'snapshot' ? 'doc' : event.kind === 'purchase' ? 'box' : event.kind === 'payment' ? 'refresh' : event.kind === 'expense' || event.kind === 'refund' ? 'wallet' : event.kind === 'virtual' ? 'database' : 'clock'}/>,
      tone: tones[event.kind] ?? 'neutral', title: snapshot ? eventLabel(event) : `${eventLabel(event)} ${event.title}`,
      subtitle: [event.date ? `${Number(event.date.slice(5, 7))} 月 ${Number(event.date.slice(8))} 日` : '日期待补充', detail].filter(Boolean).join(' · '),
      value: !snapshot && event.amount_cents !== null ? money(event.amount_cents) : undefined,
    };
    return target ? <ListRow key={event.id} {...props} onClick={() => openRoute(nav, target.route, target.params)}/> : <ListRow key={event.id} {...props}/>;
  };

  return <div className="m-page">
    <NavBar right={<IconButton label="搜索全部资料" onClick={() => nav.push('me.search')}><Icon name="search"/></IconButton>}/>
    <LargeTitle title="时间轴"/>
    <ChipRow label="事件类型" items={filters.map(([id, label]) => ({ id, label }))} value={selection.filter} onChange={filter => setSelection({ ...selection, filter })}/>
    {years.length > 0 && <FormGroup><SelectField label="年份" value={selection.year === null ? 'all' : String(selection.year)} onChange={value => setSelection({ ...selection, year: value === 'all' ? null : Number(value) })} options={[{ id: 'all', label: '全部年份' }, ...years.map(year => ({ id: String(year), label: `${year} 年` }))]}/></FormGroup>}
    {error && !page ? <ErrorState title="时间轴读取失败" message={error} onRetry={() => setRetry(n => n + 1)}/>
      : !page ? <Loading label="正在读取时间轴…"/>
      : !groups.length && !undated.length ? <EmptyState icon="clock" title={selection.filter === 'all' && selection.year === null ? '还没有可显示的记录' : '没有符合条件的记录'} message={selection.filter === 'all' && selection.year === null ? '新增物品、盘点或付款后会按月份排在这里。' : '换一个类型或年份再看看。'} action={selection.filter !== 'all' || selection.year !== null ? <Button onClick={() => setSelection(defaultTimeline)}>清除筛选</Button> : undefined}/>
      : <>
        {error && <Notice tone="danger">更新失败，当前显示上次读取的结果：{error}</Notice>}
        {shown.map(group => <section key={group.key} className="me-month" aria-label={group.title}>
          <div className="me-month-head"><h2>{group.title}</h2><span>{monthSpendingText(group, today.slice(0, 7))}</span></div>
          <div className="m-card m-list">{group.events.map(row)}</div>
        </section>)}
        {groups.length > shown.length && <Button variant="secondary" block onClick={() => setMonths(count => count + monthsPerStep)}>加载更早的记录</Button>}
        {undated.length > 0 && <ListGroup title="日期待补充" footer="这些记录没有已知日期，不放入任何月份；补填日期后会自动归位。">{undated.map(row)}</ListGroup>}
        <p className="m-group-footer me-foot">点任一条会打开原记录。月支出含购入、维护、重要支出、周期付款与虚拟资产价格，退款冲减；盘点金额是净资产较上次的变化，不计入支出。</p>
      </>}
  </div>;
}
