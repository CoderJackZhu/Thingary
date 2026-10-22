import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import { dayLabel, moneyText, monthLabel, unitMoneyText } from '../format';
import { sortByShare, shareValue, type ShareMetric } from '../../distribution';
import { percentText } from '../../resale';
import { changeText } from '../../wealth';
import { useNav, useReveal } from '../nav-context';
import { useSession } from '../session';
import type { PageProps } from '../routes';
import { BarChart, Button, Card, DonutChart, EmptyState, ErrorState, HBarChart, LargeTitle, LineAreaChart, ListGroup, ListRow, Loading, Metric, MetricGrid, Notice, Section, SegmentedControl, UnknownState } from '../ui';
import { percentage, readStatistics, type Granularity, type HoldingScope, type Ranked, type Statistics, type StatsPeriod } from './stats';
import './stats.css';

const periods: { id: StatsPeriod; label: string }[] = [{ id: 'all', label: '全部' }, { id: 'week', label: '本周' }, { id: 'month', label: '本月' }, { id: 'quarter', label: '本季' }, { id: 'year', label: '本年' }];
const daysText = (value: number | null) => value === null ? '未知' : `${Number.isInteger(value) ? value : value.toFixed(1)} 天`;

export default function ItemStats(_props: PageProps) {
  const nav = useNav(), reveal = useReveal(), session = useSession();
  const [period, setPeriod] = useState<StatsPeriod>('all'), [granularity, setGranularity] = useState<Granularity>('month'), [scope, setScope] = useState<HoldingScope>('held');
  const [metric, setMetric] = useState<ShareMetric>('amount'), [descending, setDescending] = useState(true), [resaleDescending, setResaleDescending] = useState(true);
  const [data, setData] = useState<Statistics | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [bucketIndex, setBucketIndex] = useState<number | null>(null), [loading, setLoading] = useState(true);
  const generation = session.data?.summary.generation;
  useEffect(() => {
    // Keep the previous numbers on screen while the next ones load, so the page height (and scroll position) stays put.
    let live = true; setError(''); setLoading(true);
    readStatistics(invoke, { period, granularity, scope, today: session.today, generation }).then(next => { if (live) { setData(next); setLoading(false); } }).catch(cause => { if (live) { setError(errorMessage(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [period, granularity, scope, session.today, generation, reveal, retry]);
  useEffect(() => { setBucketIndex(null); }, [granularity]);
  const bucketLabel = (key: string) => /^\d{4}-\d{2}$/.test(key) ? monthLabel(key, session.today) : key;
  const open = (id: string) => nav.push('items.detail', { id });
  const snapshot = data?.snapshot, trend = data?.trend, holding = data?.holding, resale = data?.resale;
  const categories = sortByShare(snapshot?.categories ?? [], metric);
  const selected = trend && bucketIndex !== null ? trend.buckets[bucketIndex] : null;
  const ranked = (rows: Ranked[]) => descending ? rows : rows.slice().reverse();
  const resales = resale ? resaleDescending ? resale.rows : resale.rows.slice().reverse() : [];
  return <div className="m-page mi-stats">
    <LargeTitle title="统计" segments/>
    <SegmentedControl items={periods} label="统计时间段" value={period} onChange={setPeriod}/>
    {error && !data ? <ErrorState title="统计读取失败" message={error} onRetry={() => setRetry(n => n + 1)}/> : !data || !snapshot || !trend || !holding || !resale ? <Loading label="正在读取物品统计…"/> : <div className={`mi-stats-body${loading ? ' mi-stats-loading' : ''}`} aria-busy={loading}>
      {error && <ErrorState title="统计刷新失败，以下为上一次的结果" message={error} onRetry={() => setRetry(n => n + 1)}/>}
      <section className="mi-stats-range" aria-label="时间段购入">
        <span className="mi-stats-note">{period === 'all' ? '全部物品（含已售出，不含已删除）' : `${periods.find(p => p.id === period)!.label}购入 · ${dayLabel(snapshot.start, session.today)} 至 ${dayLabel(snapshot.end, session.today)}`}</span>
        <MetricGrid><Metric label="购入件数" value={`${snapshot.total} 件`}/><Metric label={snapshot.unknown_price_count ? '已知购入金额' : '购入金额'} value={moneyText(snapshot.known_cents)}/></MetricGrid>
        <p className="mi-stats-note">使用中 {snapshot.active} · 已退役 {snapshot.retired} · 已售出 {snapshot.sold}。</p>
      </section>
      {snapshot.unknown_price_count > 0 && <Notice>{snapshot.unknown_price_count} 件购入金额未知，金额合计只含已知部分。</Notice>}
      {snapshot.total === 0 && <EmptyState title="这个时间段没有物品" message="可以切换时间段，或在物品页新增一件。" action={<Button onClick={() => nav.setSegment('items.list')}>查看物品</Button>}/>}
      <Section title="分类分布" action={<SegmentedControl label="分类分布口径" value={metric} onChange={setMetric} items={[{ id: 'amount', label: '按金额' }, { id: 'count', label: '按数量' }]}/> }>
        <Card className="mi-stats-card">
          {!categories.length ? <p className="mi-stats-note">暂无分类数据。</p> : <div className="mi-stats-category"><DonutChart size={124} slices={categories.map(row => ({ label: row.name, value: shareValue(row, metric) }))} summary={`分类分布，${metric === 'amount' ? '按已知购入金额' : '按件数'}：${categories.map(row => `${row.name} ${metric === 'amount' ? moneyText(row.known_cents) : `${row.count}件`}`).join('，')}`} center={{ top: String(snapshot.total), bottom: '件物品' }}/><ul className="mi-stats-legend">{categories.map((row, index) => <li key={row.id ?? 'none'}><span className="mi-stats-legend-name"><i className="mi-stats-swatch" style={{ background: `var(--series-${index % 7 + 1})` }}/>{row.name}</span><span className="mi-stats-legend-value">{metric === 'amount' ? moneyText(row.known_cents) : `${row.count} 件`}{row.unknown_price_count > 0 && <small><br/>{row.unknown_price_count} 件金额未知</small>}</span></li>)}</ul></div>}
        </Card>
      </Section>
      <ListGroup title="当前时间段 · 回收分析" footer={`仅比较购入价与售出价，不含维护费。${snapshot.sold_unknown_price_count + snapshot.sold_zero_price_count} 件售出物品购入价未知或为零，未纳入。`}>
        <ListRow title="售出回收" value={moneyText(snapshot.sale_proceeds_cents)}/>
        <ListRow title="已知购入成本" value={moneyText(snapshot.sold_purchase_cents)}/>
        <ListRow title="购入成本回收率" value={percentage(Number(snapshot.sale_proceeds_cents), Number(snapshot.sold_purchase_cents))} unknown={Number(snapshot.sold_purchase_cents) <= 0}/>
      </ListGroup>
      <Section title="购买趋势"><Card className="mi-stats-card">
        <SegmentedControl label="购买趋势粒度" value={granularity} onChange={setGranularity} items={[{ id: 'month', label: '按月' }, { id: 'quarter', label: '按季' }, { id: 'year', label: '按年' }]}/>
        <p className="mi-stats-note">历史全部，不随上方时间段变化。点按期间查看明细。</p>
        <p>已知购入合计 <strong>{moneyText(trend.known_cents)}</strong></p>
        {trend.unknown_price_count > 0 && <Notice>{trend.unknown_price_count} 件有日期但金额未知，未计入。</Notice>}
        {trend.unknown_date_count > 0 && <Notice>{trend.unknown_date_count} 件购入日期未知，不归入期间（其中已知金额 {moneyText(trend.unknown_date_known_cents)}）。</Notice>}
        {!trend.buckets.length ? <UnknownState title="暂无带日期的物品" message="补充购入日期后即可查看购买趋势。"/> : <>
          <h3>各期间购入金额</h3>
          <BarChart bars={trend.buckets.map(row => ({ label: '', value: row.count > 0 && row.unknown_price_count === row.count ? null : Number(row.known_cents) }))} summary={`各期间已知购入金额：${trend.buckets.map(row => `${bucketLabel(row.key)} ${moneyText(row.known_cents)}${row.unknown_price_count ? `另有${row.unknown_price_count}件未知` : ''}`).join('，')}`} height={132}/>
          <div className="mi-stats-trend" role="group" aria-label="选择购买趋势期间">{trend.buckets.map((row, index) => <button type="button" key={row.key} aria-pressed={bucketIndex === index} onClick={() => setBucketIndex(index)}>{bucketLabel(row.key)}</button>)}</div>
          {selected && <ListGroup title={`${dayLabel(selected.start, session.today)} 至 ${dayLabel(selected.end, session.today)}`}><ListRow title="本期购入" value={`${selected.count} 件`}/><ListRow title="已知购入金额" value={moneyText(selected.known_cents)} valueSub={selected.unknown_price_count ? `${selected.unknown_price_count} 件金额未知` : undefined}/><ListRow title="累计已知购入" value={moneyText(selected.cumulative_cents)}/></ListGroup>}
          <h3>累计购入金额</h3><LineAreaChart values={trend.buckets.map(row => Number(row.cumulative_cents))} summary={`累计已知购入金额 ${moneyText(trend.known_cents)}，出售不回减，不是当前估值。`} height={90}/>
        </>}
      </Card></Section>
      <Section title="持有周期"><Card className="mi-stats-card">
        <SegmentedControl label="持有范围" value={scope} onChange={setScope} items={[{ id: 'held', label: '当前持有' }, { id: 'history', label: '历史全部' }]}/>
        <p className="mi-stats-note">{scope === 'held' ? '当前持有截至今天' : '历史全部，已售出截至售出日'}；按自然月／年纪念日分组，左闭右开。</p>
        <MetricGrid><Metric label="平均持有" value={daysText(holding.average_days)} unknown={holding.average_days === null}/><Metric label="中位数" value={daysText(holding.median_days)} unknown={holding.median_days === null}/></MetricGrid>
        <HBarChart rows={holding.groups.map(row => ({ label: row.label, value: row.count, display: `${row.count} 件` }))} summary={`持有周期：${holding.groups.map(row => `${row.label}${row.count}件`).join('，')}`}/>
        <p className="mi-stats-note">{holding.dated_count} 件参与计算；{holding.unknown_date_count} 件日期未知，未计入分组与平均。</p>
        {holding.longest && <ListRow title="持有最久" subtitle={holding.longest.name} value={`${holding.longest.held_days} 天`} onClick={() => open(holding.longest!.id)}/>}
      </Card></Section>
      <Section title="日均成本排行" action={<Button variant="plain" onClick={() => setDescending(value => !value)}>{descending ? '高到低 ↓' : '低到高 ↑'}</Button>}>
        <p className="mi-stats-note">历史全部，不随上方时间段变化。</p>
        <ListGroup title="当前持有 · 毛日均" footer="总投入（购入＋维护）÷持有天数。">{!holding.held_ranking.length ? <ListRow title="暂无可完整计算的物品"/> : ranked(holding.held_ranking).map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={`${row.held_days} 天 · 总投入 ${moneyText(row.cost_cents)}`} value={`${unitMoneyText(row.daily_cents)}/天`} onClick={() => open(row.id)}/>)}</ListGroup>
        <ListGroup title="已售出 · 净日均" footer="（总投入−售出回收）÷截至售出日天数，可为负。">{!holding.sold_ranking.length ? <ListRow title="暂无可完整计算的售出物品"/> : ranked(holding.sold_ranking).map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={`${row.held_days} 天 · 净成本 ${moneyText(row.cost_cents)}`} value={`${unitMoneyText(row.daily_cents)}/天`} onClick={() => open(row.id)}/>)}</ListGroup>
        {holding.excluded.length > 0 && <details><summary>{holding.excluded.length} 件未参与排行</summary><ListGroup>{holding.excluded.map(row => <ListRow key={row.id} title={row.name} subtitle={row.reason} onClick={() => open(row.id)}/>)}</ListGroup></details>}
      </Section>
      <Section title="售出保值率"><Card className="mi-stats-card">
        <p className="mi-stats-note">售出价÷购入价，不含维护费。历史全部，不随上方时间段变化。购入价未知或为零不参与。</p>
        <div className="mi-stats-totals"><div><span className="mi-stats-note">平均保值率（每件同权）</span><strong>{resale.average_rate_hundredths === null ? '未知' : percentText(resale.average_rate_hundredths)}</strong></div><div><span className="mi-stats-note">总回收率（按金额加权）</span><strong>{resale.weighted_rate_hundredths === null ? '未知' : percentText(resale.weighted_rate_hundredths)}</strong></div></div>
        <p className="mi-stats-note">{resale.included_count} 件参与 · 总购入 {moneyText(resale.total_purchase_cents)} · 总售出 {moneyText(resale.total_sale_cents)} · 总盈亏 {resale.included_count ? changeText(resale.total_gain_cents) : '未知'}</p>
        {!resales.length ? <p className="mi-stats-note">暂无可计算保值率的售出物品。</p> : <><Button variant="plain" onClick={() => setResaleDescending(value => !value)}>{resaleDescending ? '保值率从高到低 ↓' : '保值率从低到高 ↑'}</Button><ListGroup>{resales.map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={`购入 ${moneyText(row.purchase_cents)} · 售出 ${moneyText(row.sale_cents)} · ${dayLabel(row.sold_date, session.today)}`} value={percentText(row.rate_hundredths)} valueSub={changeText(row.gain_cents)} onClick={() => open(row.id)}/>)}</ListGroup></>}
        {resale.excluded.length > 0 && <details><summary>{resale.excluded.length} 件未参与保值率</summary><ListGroup>{resale.excluded.map(row => <ListRow key={row.id} title={row.name} subtitle={row.reason} onClick={() => open(row.id)}/>)}</ListGroup></details>}
      </Card></Section>
      <details className="mi-stats-rules"><summary>统计口径说明</summary>
        <p className="mi-stats-note">时间段按购入日期筛选，日期未知的只在「全部」显示；设为不计入统计的物品不参与。</p>
        <p className="mi-stats-note">日均成本为当前持有（使用中＋已退役）的每件日均之和，含维护费；售出后退出，不随购入时间段变化。未知不按零计算，统计排除选项不影响日均。</p>
        <p className="mi-stats-note">累计购入只加已知购入金额，出售不回减，不是当前估值。日均排行按未舍入的精确值排序，显示到分。</p>
      </details>
    </div>}
  </div>;
}
