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
import { categoryName, percentage, readStatistics, type Granularity, type HoldingScope, type Ranked, type Statistics, type StatsPeriod } from './stats';
import './stats.css';
import { t } from '../../i18n.ts';
const periods: { id: StatsPeriod; label: string }[] = [{ id: 'all', label: t('全部') }, { id: 'week', label: t('本周') }, { id: 'month', label: t('本月') }, { id: 'quarter', label: t('本季') }, { id: 'year', label: t('本年') }];
const daysText = (value: number | null) => value === null ? t('未知') : t('{v1} 天', { v1: Number.isInteger(value) ? value : value.toFixed(1) });

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
    <LargeTitle title={t('统计')}/>
    <SegmentedControl items={periods} label={t('统计时间段')} value={period} onChange={setPeriod}/>
    {error && !data ? <ErrorState title={t('统计读取失败')} message={error} onRetry={() => setRetry(n => n + 1)}/> : !data || !snapshot || !trend || !holding || !resale ? <Loading label={t('正在读取物品统计…')}/> : <div className={`mi-stats-body${loading ? ' mi-stats-loading' : ''}`} aria-busy={loading}>
      {error && <ErrorState title={t('统计刷新失败，以下为上一次的结果')} message={error} onRetry={() => setRetry(n => n + 1)}/>}
      <section className="mi-stats-range" aria-label={t('时间段购入')}>
        <span className="mi-stats-note">{period === 'all' ? t('全部物品（含已售出，不含已删除）') : `${periods.find(p => p.id === period)!.label}购入 · ${dayLabel(snapshot.start, session.today)} 至 ${dayLabel(snapshot.end, session.today)}`}</span>
        <MetricGrid><Metric label={t('购入件数')} value={t('{total} 件', { total: snapshot.total })}/><Metric label={snapshot.unknown_price_count ? t('已知购入金额') : t('购入金额')} value={moneyText(snapshot.known_cents)}/></MetricGrid>
        <p className="mi-stats-note">{t('使用中 {active} · 已退役 {retired} · 已售出 {sold}。', { active: snapshot.active, retired: snapshot.retired, sold: snapshot.sold })}</p>
      </section>
      {snapshot.unknown_price_count > 0 && <Notice>{t('{unknown_price_count} 件购入金额未知，金额合计只含已知部分。', { unknown_price_count: snapshot.unknown_price_count })}</Notice>}
      {snapshot.total === 0 && <EmptyState title={t('这个时间段没有物品')} message={t('可以切换时间段，或在物品页新增一件。')} action={<Button onClick={() => nav.setSegment('items.list')}>{t('查看物品')}</Button>}/>}
      <Section title={t('分类分布')} action={<SegmentedControl label={t('分类分布口径')} value={metric} onChange={setMetric} items={[{ id: 'amount', label: t('按金额') }, { id: 'count', label: t('按数量') }]}/> }>
        <Card className="mi-stats-card">
          {!categories.length ? <p className="mi-stats-note">{t('暂无分类数据。')}</p> : <div className="mi-stats-category"><DonutChart size={124} slices={categories.map(row => ({ label: categoryName(row), value: shareValue(row, metric) }))} summary={`分类分布，${metric === 'amount' ? t('按已知购入金额') : t('按件数')}：${categories.map(row => `${categoryName(row)} ${metric === 'amount' ? moneyText(row.known_cents) : t('{count}件', { count: row.count })}`).join('，')}`} center={{ top: String(snapshot.total), bottom: t('件物品') }}/><ul className="mi-stats-legend">{categories.map((row, index) => <li key={row.id ?? 'none'}><span className="mi-stats-legend-name"><i className="mi-stats-swatch" style={{ background: `var(--series-${index % 7 + 1})` }}/>{categoryName(row)}</span><span className="mi-stats-legend-value">{metric === 'amount' ? moneyText(row.known_cents) : t('{count} 件', { count: row.count })}{row.unknown_price_count > 0 && <small><br/>{t('{unknown_price_count} 件金额未知', { unknown_price_count: row.unknown_price_count })}</small>}</span></li>)}</ul></div>}
        </Card>
      </Section>
      <ListGroup title={t('当前时间段 · 回收分析')} footer={t('仅比较购入价与售出价，不含维护费。{v1} 件售出物品购入价未知或为零，未纳入。', { v1: snapshot.sold_unknown_price_count + snapshot.sold_zero_price_count })}>
        <ListRow title={t('售出回收')} value={moneyText(snapshot.sale_proceeds_cents)}/>
        <ListRow title={t('已知购入成本')} value={moneyText(snapshot.sold_purchase_cents)}/>
        <ListRow title={t('购入成本回收率')} value={percentage(Number(snapshot.sale_proceeds_cents), Number(snapshot.sold_purchase_cents))} unknown={Number(snapshot.sold_purchase_cents) <= 0}/>
      </ListGroup>
      <Section title={t('购买趋势')}><Card className="mi-stats-card">
        <SegmentedControl label={t('购买趋势粒度')} value={granularity} onChange={setGranularity} items={[{ id: 'month', label: t('按月') }, { id: 'quarter', label: t('按季') }, { id: 'year', label: t('按年') }]}/>
        <p className="mi-stats-note">{t('历史全部，不随上方时间段变化。点按期间查看明细。')}</p>
        <p>{t('已知购入合计')} <strong>{moneyText(trend.known_cents)}</strong></p>
        {trend.unknown_price_count > 0 && <Notice>{t('{unknown_price_count} 件有日期但金额未知，未计入。', { unknown_price_count: trend.unknown_price_count })}</Notice>}
        {trend.unknown_date_count > 0 && <Notice>{t('{unknown_date_count} 件购入日期未知，不归入期间（其中已知金额 {v2}）。', { unknown_date_count: trend.unknown_date_count, v2: moneyText(trend.unknown_date_known_cents) })}</Notice>}
        {!trend.buckets.length ? <UnknownState title={t('暂无带日期的物品')} message={t('补充购入日期后即可查看购买趋势。')}/> : <>
          <h3>{t('各期间购入金额')}</h3>
          <BarChart bars={trend.buckets.map(row => ({ label: '', value: row.count > 0 && row.unknown_price_count === row.count ? null : Number(row.known_cents) }))} summary={`各期间已知购入金额：${trend.buckets.map(row => `${bucketLabel(row.key)} ${moneyText(row.known_cents)}${row.unknown_price_count ? t('另有{unknown_price_count}件未知', { unknown_price_count: row.unknown_price_count }) : ''}`).join('，')}`} height={132}/>
          <div className="mi-stats-trend" role="group" aria-label={t('选择购买趋势期间')}>{trend.buckets.map((row, index) => <button type="button" key={row.key} aria-pressed={bucketIndex === index} onClick={() => setBucketIndex(index)}>{bucketLabel(row.key)}</button>)}</div>
          {selected && <ListGroup title={t('{v1} 至 {v2}', { v1: dayLabel(selected.start, session.today), v2: dayLabel(selected.end, session.today) })}><ListRow title={t('本期购入')} value={t('{count} 件', { count: selected.count })}/><ListRow title={t('已知购入金额')} value={moneyText(selected.known_cents)} valueSub={selected.unknown_price_count ? t('{unknown_price_count} 件金额未知', { unknown_price_count: selected.unknown_price_count }) : undefined}/><ListRow title={t('累计已知购入')} value={moneyText(selected.cumulative_cents)}/></ListGroup>}
          <h3>{t('累计购入金额')}</h3><LineAreaChart values={trend.buckets.map(row => Number(row.cumulative_cents))} summary={t('累计已知购入金额 {v1}，出售不回减，不是当前估值。', { v1: moneyText(trend.known_cents) })} height={90}/>
        </>}
      </Card></Section>
      <Section title={t('持有周期')}><Card className="mi-stats-card">
        <SegmentedControl label={t('持有范围')} value={scope} onChange={setScope} items={[{ id: 'held', label: t('当前持有') }, { id: 'history', label: t('历史全部') }]}/>
        <p className="mi-stats-note">{scope === 'held' ? t('当前持有截至今天') : t('历史全部，已售出截至售出日')}{t('；按自然月／年纪念日分组，左闭右开。')}</p>
        <MetricGrid><Metric label={t('平均持有')} value={daysText(holding.average_days)} unknown={holding.average_days === null}/><Metric label={t('中位数')} value={daysText(holding.median_days)} unknown={holding.median_days === null}/></MetricGrid>
        <HBarChart rows={holding.groups.map(row => ({ label: row.label, value: row.count, display: t('{count} 件', { count: row.count }) }))} summary={`持有周期：${holding.groups.map(row => t('{label}{count}件', { label: row.label, count: row.count })).join('，')}`}/>
        <p className="mi-stats-note">{t('{dated_count} 件参与计算；{unknown_date_count} 件日期未知，未计入分组与平均。', { dated_count: holding.dated_count, unknown_date_count: holding.unknown_date_count })}</p>
        {holding.longest && <ListRow title={t('持有最久')} subtitle={holding.longest.name} value={t('{held_days} 天', { held_days: holding.longest.held_days })} onClick={() => open(holding.longest!.id)}/>}
      </Card></Section>
      <Section title={t('日均成本排行')} action={<Button variant="plain" onClick={() => setDescending(value => !value)}>{descending ? t('高到低 ↓') : t('低到高 ↑')}</Button>}>
        <p className="mi-stats-note">{t('历史全部，不随上方时间段变化。')}</p>
        <ListGroup title={t('当前持有 · 毛日均')} footer={t('总投入（购入＋维护）÷持有天数。')}>{!holding.held_ranking.length ? <ListRow title={t('暂无可完整计算的物品')}/> : ranked(holding.held_ranking).map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={t('{held_days} 天 · 总投入 {v2}', { held_days: row.held_days, v2: moneyText(row.cost_cents) })} value={t('{v1}/天', { v1: unitMoneyText(row.daily_cents) })} onClick={() => open(row.id)}/>)}</ListGroup>
        <ListGroup title={t('已售出 · 净日均')} footer={t('（总投入−售出回收）÷截至售出日天数，可为负。')}>{!holding.sold_ranking.length ? <ListRow title={t('暂无可完整计算的售出物品')}/> : ranked(holding.sold_ranking).map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={t('{held_days} 天 · 净成本 {v2}', { held_days: row.held_days, v2: moneyText(row.cost_cents) })} value={t('{v1}/天', { v1: unitMoneyText(row.daily_cents) })} onClick={() => open(row.id)}/>)}</ListGroup>
        {holding.excluded.length > 0 && <details><summary>{t('{length} 件未参与排行', { length: holding.excluded.length })}</summary><ListGroup>{holding.excluded.map(row => <ListRow key={row.id} title={row.name} subtitle={row.reason} onClick={() => open(row.id)}/>)}</ListGroup></details>}
      </Section>
      <Section title={t('售出保值率')}><Card className="mi-stats-card">
        <p className="mi-stats-note">{t('售出价÷购入价，不含维护费。历史全部，不随上方时间段变化。购入价未知或为零不参与。')}</p>
        <div className="mi-stats-totals"><div><span className="mi-stats-note">{t('平均保值率（每件同权）')}</span><strong>{resale.average_rate_hundredths === null ? t('未知') : percentText(resale.average_rate_hundredths)}</strong></div><div><span className="mi-stats-note">{t('总回收率（按金额加权）')}</span><strong>{resale.weighted_rate_hundredths === null ? t('未知') : percentText(resale.weighted_rate_hundredths)}</strong></div></div>
        <p className="mi-stats-note">{t('{included_count} 件参与 · 总购入 {v2} · 总售出 {v3} · 总盈亏', { included_count: resale.included_count, v2: moneyText(resale.total_purchase_cents), v3: moneyText(resale.total_sale_cents) })} {resale.included_count ? changeText(resale.total_gain_cents) : t('未知')}</p>
        {!resales.length ? <p className="mi-stats-note">{t('暂无可计算保值率的售出物品。')}</p> : <><Button variant="plain" onClick={() => setResaleDescending(value => !value)}>{resaleDescending ? t('保值率从高到低 ↓') : t('保值率从低到高 ↑')}</Button><ListGroup>{resales.map((row, i) => <ListRow key={row.id} title={`${i + 1}. ${row.name}`} subtitle={t('购入 {v1} · 售出 {v2} · {v3}', { v1: moneyText(row.purchase_cents), v2: moneyText(row.sale_cents), v3: dayLabel(row.sold_date, session.today) })} value={percentText(row.rate_hundredths)} valueSub={changeText(row.gain_cents)} onClick={() => open(row.id)}/>)}</ListGroup></>}
        {resale.excluded.length > 0 && <details><summary>{t('{length} 件未参与保值率', { length: resale.excluded.length })}</summary><ListGroup>{resale.excluded.map(row => <ListRow key={row.id} title={row.name} subtitle={row.reason} onClick={() => open(row.id)}/>)}</ListGroup></details>}
      </Card></Section>
      <details className="mi-stats-rules"><summary>{t('统计口径说明')}</summary>
        <p className="mi-stats-note">{t('时间段按购入日期筛选，日期未知的只在「全部」显示；设为不计入统计的物品不参与。')}</p>
        <p className="mi-stats-note">{t('日均成本为当前持有（使用中＋已退役）的每件日均之和，含维护费；售出后退出，不随购入时间段变化。未知不按零计算，统计排除选项不影响日均。')}</p>
        <p className="mi-stats-note">{t('累计购入只加已知购入金额，出售不回减，不是当前估值。日均排行按未舍入的精确值排序，显示到分。')}</p>
      </details>
    </div>}
  </div>;
}
