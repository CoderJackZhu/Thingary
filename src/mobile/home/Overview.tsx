import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { allModules } from '../../modules';
import { requestGate, ready } from '../../review';
import type { Review } from '../../review';
import { summaryRetire } from '../../plan-summary';
import { eventDetail, eventLabel } from '../../Timeline';
import { startChoiceDismissed, choiceStorage } from '../../start-choice';
import { useModules } from '../modules-context';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import { dayLabel } from '../format';
import { Button, Card, EmptyState, PullToRefresh, ErrorState, HeroCard, Icon, IconButton, ListGroup, ListRow, LargeTitle, Loading, Metric, LineChart, Notice } from '../ui';
import type { PageProps } from '../routes';
import { browserStorage, openRoute, readHideAmounts, writeHideAmounts } from '../me/shared';
import { installMobileRuntime } from '../me/runtime';
import { dailyView, planView, netWorthView, pendingEntries, pendingSourcesFailed, recentRows } from './model';
import type { WarrantyAlert, WishDue } from './model';
import { readExpiringWarranties, readGate, readConsideringWishes, readReview } from './read';
import type { Gate } from './read';
import { warrantyAlert } from './model';
import './home.css';
import { t } from '../../i18n.ts';
installMobileRuntime();

type Loaded = { gate: Gate; review: Review; warranty: WarrantyAlert | null; wishes: WishDue[] | null; warrantyFailed: boolean; wishesFailed: boolean };

/** 总览 (design 01): 金融净资产, 规划结果, 物品日均成本, 待处理, 近期记录. */
const recentIcon = (kind: string) => kind.startsWith('wish_') ? 'heart' as const : kind.startsWith('warranty_') ? 'shield' as const : kind === 'snapshot' ? 'doc' as const : kind === 'purchase' ? 'box' as const : kind === 'payment' ? 'refresh' as const : kind === 'expense' || kind === 'refund' ? 'wallet' as const : 'clock' as const;

export default function Overview(_props: PageProps) {
  const nav = useNav(), { modules: runtime } = useModules(), session = useSession(), reveal = useReveal();
  const modules = runtime ?? allModules, today = session.today;
  const [loaded, setLoaded] = useState<Loaded | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [hidden, setHidden] = useState(() => readHideAmounts(browserStorage()));
  const [demoBusy, setDemoBusy] = useState(false), [demoError, setDemoError] = useState('');
  const gate = useRef(requestGate());
  const moduleKey = JSON.stringify(modules);

  useEffect(() => { writeHideAmounts(browserStorage(), hidden); }, [hidden]);
  useEffect(() => {
    const refresh = () => setRetry(n => n + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  useEffect(() => {
    const ticket = gate.current.next();
    let live = true;
    setError('');
    (async () => {
      const first = await readGate();
      if (!live) return;
      // 首次打开：与电脑端同一条件（不是样例、还没开始记录、这个资料库没有跳过过）。
      if (!first.demo.active && !first.demo.started && !startChoiceDismissed(choiceStorage(), first.counts.generation)) { nav.replace('welcome'); return; }
      const [review, warranty, wishes] = await Promise.all([
        readReview(modules.planning && modules.wealth),
        readExpiringWarranties().then(page => warrantyAlert(page, today), () => null),
        modules.wishlist ? readConsideringWishes().catch(() => null) : Promise.resolve([] as WishDue[]),
      ]);
      if (!live) return;
      if (!gate.current.accepts(ticket, first.counts.generation, review.generation)) { setError('资料库已变化，请重新读取。'); return; }
      setLoaded({ gate: first, review, warranty, wishes, warrantyFailed: warranty === null, wishesFailed: wishes === null });
    })().catch(cause => { if (live) setError(errorMessage(cause)); });
    return () => { live = false; gate.current.invalidate(); };
  }, [today, moduleKey, retry, reveal]);

  const view = useMemo(() => {
    if (!loaded) return null;
    const { review } = loaded;
    const wealth = ready(review.wealth), physical = ready(review.physical);
    const retire = modules.planning && modules.wealth && review.planning ? summaryRetire(review.planning, today) : null;
    return {
      plan: retire ? planView(retire, hidden) : null,
      net: wealth ? netWorthView(wealth, hidden) : null,
      daily: physical ? dailyView(physical.held_daily) : null,
      pending: pendingEntries({ today, modules, review, warranty: loaded.warranty, wishes: loaded.wishes }),
      failed: pendingSourcesFailed(modules, review, loaded.warrantyFailed, loaded.wishesFailed),
      recent: recentRows(ready(review.recent) ?? [], modules, event => ({ label: eventLabel(event), detail: eventDetail(event) }), hidden),
      wealthError: modules.wealth && review.wealth.status === 'error' ? review.wealth.value.message : '',
      physicalError: review.physical.status === 'error' ? review.physical.value.message : '',
      empty: !!physical && physical.held_count === 0 && (!wealth || wealth.points.length === 0),
    };
  }, [loaded, hidden, moduleKey, today]);

  async function leaveSample() {
    if (demoBusy) return;
    if (session.pending) { setDemoError('上次保存的结果待核对，请先核对后再切换。'); return; }
    setDemoBusy(true); setDemoError('');
    try { await invoke('switch_demo', { demo: false }); location.reload(); }
    catch (cause) { setDemoBusy(false); setDemoError(errorMessage(cause)); }
  }

  const actions = <>
    {modules.wealth && <IconButton label={hidden ? t('显示金融金额') : t('隐藏金融金额')} pressed={hidden} onClick={() => setHidden(value => !value)}><Icon name={hidden ? 'eyeOff' : 'eye'}/></IconButton>}
    <IconButton label={t('搜索全部资料')} onClick={() => nav.push('me.search')}><Icon name="search"/></IconButton>
  </>;
  if (error && !loaded) return <div className="m-page"><LargeTitle title={t('总览')} actions={actions}/><ErrorState title={t('总览读取失败')} message={error} onRetry={() => setRetry(n => n + 1)}/></div>;
  if (!loaded || !view) return <div className="m-page"><LargeTitle title={t('总览')} actions={actions}/><Loading label={t('正在读取总览…')}/></div>;

  const { plan, net, daily } = view;
  return <PullToRefresh onRefresh={() => setRetry(n => n + 1)}><div className="m-page">
    <LargeTitle title={t('总览')} actions={actions}/>
    {loaded.gate.demo.active && <Card tone="warn" label={t('样例体验')}><div className="h-banner"><span><strong>{t('样例体验')}</strong> {t('· 虚构资料，改动不影响你的资料')}</span><Button variant="secondary" disabled={demoBusy} onClick={() => void leaveSample()}>{loaded.gate.demo.started ? t('返回我的资料') : t('开始记录我的资料')}</Button></div>{demoError && <Notice tone="danger">{demoError}</Notice>}</Card>}
    {error && <Notice tone="danger">{t('更新失败，当前显示上次读取的结果：{error}', { error })}</Notice>}
    {modules.wealth && (net?.state === 'known'
      ? <HeroCard eyebrow={t('金融净资产')} action={t('查看财富')} title={net.net} onClick={() => openRoute(nav, 'wealth.overview')}
          subtitle={<span className={`m-hero-sub${net.changeTone ? ` m-${net.changeTone}` : ''}`}>{net.change ?? t('截至 {v1}', { v1: dayLabel(net.date, today) })}</span>}
          footnote={net.incomplete ?? t('截至 {v1}盘点', { v1: dayLabel(net.date, today) })}>
          {net.values.length > 1 && <LineChart compact height={56} hidden={hidden} series={[{ name: '金融净资产', values: net.values }]} labels={net.dates} summary={net.summary}/>}
        </HeroCard>
      : <HeroCard eyebrow={t('金融净资产')} action={t('查看财富')} title={<span className="m-unknown">{t('未知')}</span>} subtitle={view.wealthError || t('还没有完整盘点，净资产不会按零计算')} onClick={() => openRoute(nav, 'wealth.overview')}/>)}
    {plan && (plan.state === 'error'
      ? <Card label={t('规划')}><ErrorState title={plan.title} message={plan.subtitle ?? undefined} onRetry={() => setRetry(n => n + 1)}/></Card>
      : <button type="button" className="m-card h-plan" onClick={() => openRoute(nav, 'plan.goal')}>
          <span className="h-plan-top"><span className="h-plan-lead"><span className="m-metric-icon m-tone-accent"><Icon name="tabTarget" size={17} strokeWidth={2}/></span><span>{plan.eyebrow}</span></span><span className="h-plan-action">{plan.state === 'setup' ? t('去设置') : t('查看规划')}<Icon name="chevronRight" size={16}/></span></span>
          {plan.lead ? <span className="h-plan-title">{plan.lead.before}<strong className="h-plan-num">{plan.lead.strong}</strong>{plan.lead.after}</span> : <span className="h-plan-title">{plan.title}</span>}
          {plan.subtitle && <span className="h-plan-sub">{plan.subtitle}</span>}
          {plan.progress && <span className="h-plan-bar">
            <span className="h-bar" role="progressbar" aria-label={t('资产覆盖现在退休所需的比例')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={hidden ? undefined : Math.round(plan.progress.percent)}><span className="h-bar-fill" style={{ width: `${plan.progress.percent}%` }}/></span>
            <span className="h-bar-labels"><span>{plan.progress.have}</span><span>{plan.progress.need}</span></span>
            {plan.progress.gap && <span className="h-bar-gap">{plan.progress.gap}</span>}
          </span>}
          {plan.warn && <span className="h-plan-warn">{plan.warn}</span>}
          {plan.state === 'ready' && <span className="m-hero-foot">{t('估算结果，不是理财建议')}</span>}
        </button>)}
    {view.empty && <Card label={t('从这里开始')}><div className="h-start"><h2>{t('从这里开始')}</h2><p>{t('物谱记两件事：你持有的物品，和账户里的钱。每样只填一点也行，之后慢慢补。')}</p>
      <div className="h-start-actions"><Button variant="primary" onClick={() => nav.push('items.edit')}>{t('记录第一件物品')}</Button>{modules.wealth && <Button onClick={() => nav.push('wealth.accountEdit')}>{t('建立账户并盘点')}</Button>}</div></div></Card>}
    {(daily ? <Metric icon="tabBox" tone="warn" label={t('物品日均成本')} value={daily.value} unknown={daily.unknown} sub={daily.sub} onClick={() => openRoute(nav, 'items.list')}><span className="h-asof">{daily.note}</span></Metric>
      : <Metric icon="tabBox" tone="warn" label={t('物品日均成本')} value={t('未知')} unknown sub={view.physicalError || t('暂时读不出来')}/>)}
    <ListGroup title={t('待处理')} action={view.pending.length ? <span className="h-count">{t('{length} 项', { length: view.pending.length })}</span> : undefined} footer={view.failed ? t('部分来源读取失败，这里只显示已读取的部分。') : undefined}>
      {view.pending.length === 0 && <ListRow icon="check" tone="positive" title={view.failed ? t('可用来源中暂无事项') : t('暂时没有需要处理的事项')}/>}
      {view.pending.map(entry => entry.action
        ? <ListRow key={entry.id} icon={entry.icon} tone={entry.tone} title={entry.title} subtitle={entry.subtitle} trailing={<Button variant="primary" onClick={() => openRoute(nav, entry.route, entry.params)}>{entry.action}</Button>}/>
        : <ListRow key={entry.id} icon={entry.icon} tone={entry.tone} title={entry.title} subtitle={entry.subtitle} onClick={() => openRoute(nav, entry.route, entry.params)}/>)}
    </ListGroup>
    <ListGroup title={t('近期记录')} action={<button type="button" onClick={() => nav.push('me.timeline')}>{t('查看时间轴 ›')}</button>}>
      {view.recent.length === 0 && <EmptyState icon="home" title={t('还没有带日期的记录')} message={t('新增物品、盘点或付款后会出现在这里。')}/>}
      {view.recent.map(row => {
        const props = { icon: <Icon name={recentIcon(row.kind)} size={17} strokeWidth={2}/>, tone: 'neutral' as const, title: row.title, subtitle: [row.date, row.detail].filter(Boolean).join(' · '), value: row.amount ?? undefined };
        return row.target ? <ListRow key={row.id} {...props} onClick={() => openRoute(nav, row.target!.route, row.target!.params)}/> : <ListRow key={row.id} {...props}/>;
      })}
    </ListGroup>
  </div></PullToRefresh>;
}
