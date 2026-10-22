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
import { Button, Card, EmptyState, ErrorState, HeroCard, Icon, IconButton, ListGroup, ListRow, LargeTitle, Loading, Metric, MetricGrid, LineAreaChart, Notice } from '../ui';
import type { PageProps } from '../routes';
import { browserStorage, openRoute, readHideAmounts, writeHideAmounts } from '../me/shared';
import { installMobileRuntime } from '../me/runtime';
import { dailyView, heroView, netWorthView, pendingEntries, pendingSourcesFailed, recentRows } from './model';
import type { WarrantyAlert, WishDue } from './model';
import { readExpiringWarranties, readGate, readConsideringWishes, readReview } from './read';
import type { Gate } from './read';
import { warrantyAlert } from './model';
import './home.css';

installMobileRuntime();

type Loaded = { gate: Gate; review: Review; warranty: WarrantyAlert | null; wishes: WishDue[] | null; warrantyFailed: boolean; wishesFailed: boolean };

/** 总览 (design 01): 还要上几年班, 金融净资产, 物品日均成本, 待处理, 近期记录. */
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
      hero: retire ? heroView(retire) : null,
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
    {modules.wealth && <IconButton label={hidden ? '显示金融金额' : '隐藏金融金额'} pressed={hidden} onClick={() => setHidden(value => !value)}><Icon name={hidden ? 'eyeOff' : 'eye'}/></IconButton>}
    <IconButton label="搜索全部资料" onClick={() => nav.push('me.search')}><Icon name="search"/></IconButton>
  </>;
  if (error && !loaded) return <div className="m-page"><LargeTitle title="总览" actions={actions}/><ErrorState title="总览读取失败" message={error} onRetry={() => setRetry(n => n + 1)}/></div>;
  if (!loaded || !view) return <div className="m-page"><LargeTitle title="总览" actions={actions}/><Loading label="正在读取总览…"/></div>;

  const { hero, net, daily } = view;
  return <div className="m-page">
    <LargeTitle title="总览" actions={actions}/>
    {loaded.gate.demo.active && <Card tone="warn" label="样例体验"><div className="h-banner"><span><strong>样例体验</strong> · 虚构资料，改动不影响你的资料</span><Button variant="secondary" disabled={demoBusy} onClick={() => void leaveSample()}>{loaded.gate.demo.started ? '返回我的资料' : '开始记录我的资料'}</Button></div>{demoError && <Notice tone="danger">{demoError}</Notice>}</Card>}
    {error && <Notice tone="danger">更新失败，当前显示上次读取的结果：{error}</Notice>}
    {hero && (hero.state === 'error'
      ? <Card label="规划"><ErrorState title={hero.title} message={hero.subtitle ?? undefined} onRetry={() => setRetry(n => n + 1)}/></Card>
      : <HeroCard eyebrow={hero.eyebrow} action={hero.state === 'setup' ? '去设置' : '查看规划'} title={hero.title} subtitle={hero.subtitle ?? undefined} tags={hero.tags.map(text => ({ text }))} footnote={hero.warn ?? '估算结果，不是理财建议'} onClick={() => openRoute(nav, 'plan.goal')}/>)}
    {view.empty && <Card label="从这里开始"><div className="h-start"><h2>从这里开始</h2><p>物谱记两件事：你持有的物品，和账户里的钱。每样只填一点也行，之后慢慢补。</p>
      <div className="h-start-actions"><Button variant="primary" onClick={() => nav.push('items.edit')}>记录第一件物品</Button>{modules.wealth && <Button onClick={() => nav.push('wealth.accountEdit')}>建立账户并盘点</Button>}</div></div></Card>}
    {(net || daily || view.wealthError || view.physicalError) && <MetricGrid>
      {modules.wealth && (net?.state === 'known'
        ? <Metric label="金融净资产" value={net.net} sub={net.change ?? `截至 ${dayLabel(net.date, today)}`} subTone={net.changeTone ?? undefined} onClick={() => openRoute(nav, 'wealth.overview')}>
            <LineAreaChart values={net.values} summary={net.summary}/><span className="h-asof">{net.incomplete ?? `截至 ${dayLabel(net.date, today)}盘点`}</span></Metric>
        : <Metric label="金融净资产" value="未知" unknown sub={view.wealthError || '还没有完整盘点，净资产不会按零计算'} onClick={() => openRoute(nav, 'wealth.overview')}/>)}
      {daily ? <Metric label="物品日均成本" value={daily.value} unknown={daily.unknown} sub={daily.sub} onClick={() => openRoute(nav, 'items.list')}><span className="h-asof">{daily.note}</span></Metric>
        : <Metric label="物品日均成本" value="未知" unknown sub={view.physicalError || '暂时读不出来'}/>}
    </MetricGrid>}
    <ListGroup title="待处理" action={view.pending.length ? <span className="h-count">{view.pending.length} 项</span> : undefined} footer={view.failed ? '部分来源读取失败，这里只显示已读取的部分。' : undefined}>
      {view.pending.length === 0 && <ListRow icon="check" tone="positive" title={view.failed ? '可用来源中暂无事项' : '暂时没有需要处理的事项'}/>}
      {view.pending.map(entry => entry.action
        ? <ListRow key={entry.id} icon={entry.icon} tone={entry.tone} title={entry.title} subtitle={entry.subtitle} trailing={<Button variant="primary" onClick={() => openRoute(nav, entry.route, entry.params)}>{entry.action}</Button>}/>
        : <ListRow key={entry.id} icon={entry.icon} tone={entry.tone} title={entry.title} subtitle={entry.subtitle} onClick={() => openRoute(nav, entry.route, entry.params)}/>)}
    </ListGroup>
    <ListGroup title="近期记录" action={<button type="button" onClick={() => nav.push('me.timeline')}>查看时间轴 ›</button>}>
      {view.recent.length === 0 && <EmptyState icon="home" title="还没有带日期的记录" message="新增物品、盘点或付款后会出现在这里。"/>}
      {view.recent.map(row => {
        const props = { icon: <Icon name={recentIcon(row.kind)} size={20}/>, tone: 'neutral' as const, title: row.title, subtitle: [row.date, row.detail].filter(Boolean).join(' · '), value: row.amount ?? undefined };
        return row.target ? <ListRow key={row.id} {...props} onClick={() => openRoute(nav, row.target!.route, row.target!.params)}/> : <ListRow key={row.id} {...props}/>;
      })}
    </ListGroup>
  </div>;
}
