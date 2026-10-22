import { useState } from 'react';
import { dayLabel, localizeDates, moneyText } from '../format';
import { annualCopyText, buildAnnualReview } from '../../annual-review';
import { reviewRecordsPeriod } from '../../finance-contract';
import type { FinancePeriod } from '../../finance-contract';
import { reviewPeriodPresets, resolveReviewPreset } from '../../finance-period-control';
import { expenseMetric, incomeMetric, reviewInterval } from '../../finance-review-model';
import { readFinanceSources } from '../../finance-service';
import type { FinanceSources } from '../../finance-service';
import { investmentStatusLabel, reasonText } from './labels';
import { incomeCategories } from '../../income-classification';
import { hpfSummary } from '../../plan';
import { changeText, readInvestmentReview } from '../../wealth';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, Card, ChipRow, EmptyState, ErrorState, LineAreaChart, ListGroup, ListRow, Metric, MetricGrid, Notice, SearchField, SegmentedControl, SelectField, FormGroup } from '../ui';
import { incomeView, samePeriod } from './model';
import type { PeriodKey } from './model';
import { Head, Loaded, PeriodBar, periodOf } from './parts';
import { useRead } from './read';

type Seg = 'summary' | 'income' | 'annual';
const hiddenPref = () => { try { return localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { return false; } };

/** spending.review: period summary, income records and annual review (no investment-flow reconciliation here). */
export default function ReviewPage({ params }: PageProps) {
  const { modules } = useModules();
  const wealthOn = modules ? modules.wealth : true, incomesOn = modules ? modules.incomes : true;
  const items = [...(wealthOn ? [{ id: 'summary' as Seg, label: '期间汇总' }] : []), ...(incomesOn ? [{ id: 'income' as Seg, label: '收入' }] : []), ...(wealthOn ? [{ id: 'annual' as Seg, label: '年度回顾' }] : [])];
  const wanted = (params.seg as Seg | undefined) ?? 'summary';
  const [picked, setPicked] = useState<Seg>(wanted);
  const seg = items.find(i => i.id === picked)?.id ?? items[0]?.id;
  const nav = useNav();
  return <div className="m-page">
    <Head title="财务复盘" add={seg === 'income' ? { label: '记一笔收入', onClick: () => nav.push('spending.incomeEdit') } : undefined}/>
    {!items.length ? <EmptyState icon="wallet" title="财务复盘已关闭" message="账户与盘点、收入记录两个功能都已关闭。可以在「我的 › 设置 › 功能模块」重新开启；已有记录不会丢失。"/> : <>
      {items.length > 1 && <SegmentedControl label="复盘视图" items={items} value={seg!} onChange={setPicked}/>}
      {seg === 'summary' && <Summary/>}
      {seg === 'income' && <Income/>}
      {seg === 'annual' && <Annual/>}
    </>}
  </div>;
}

// ---------------------------------------------------------------- 期间汇总

function Summary() {
  const [toId, setToId] = useState<string | undefined>();
  const boot = useRead(() => readFinanceSources({ kind: 'all' }), 'boot');
  return <Loaded read={boot} what="财务事实">{sources => {
    if (sources.wealth.status !== 'ready' || sources.asset_review.status !== 'ready') {
      const why = sources.wealth.status === 'error' ? sources.wealth.message : sources.wealth.status === 'disabled' ? sources.wealth.reason : sources.asset_review.status === 'error' ? sources.asset_review.message : sources.asset_review.status === 'disabled' ? sources.asset_review.reason : '';
      return <ErrorState title="暂时不能复盘" message={why || '盘点资料不可用。'} onRetry={boot.reload}/>;
    }
    const points = sources.wealth.value.points, intervals = sources.asset_review.value.intervals;
    const chosen = reviewInterval(intervals, points, toId);
    if (!chosen) return <EmptyState icon="wallet" title="还没有可比较的两次完整盘点" message={sources.asset_review.value.incomplete_count ? `有 ${sources.asset_review.value.incomplete_count} 次盘点不完整，不能拿来比较。` : '完成两次完整盘点后，这里会把净资产变化和同一区间的收入、支出放在一起看。'}/>;
    return <>
      <FormGroup footer="盘点区间由两次完整盘点决定；收入和支出取同一段自然日。"><SelectField label="本期区间" value={chosen.pair.toSnapshotId} onChange={setToId}
        options={intervals.filter(i => reviewInterval(intervals, points, i.snapshot_id)).map(i => ({ id: i.snapshot_id, label: `${i.from} 至 ${i.to}` }))}/></FormGroup>
      <Period key={chosen.pair.toSnapshotId} sources={sources} chosen={chosen}/>
    </>;
  }}</Loaded>;
}

function Period({ sources, chosen }: { sources: FinanceSources; chosen: NonNullable<ReturnType<typeof reviewInterval>> }) {
  const { today } = useSession();
  const { from, to } = chosen.interval, period = reviewRecordsPeriod(from, to);
  const read = useRead(async () => {
    const [facts, invest] = await Promise.all([readFinanceSources(period), readInvestmentReview(sources.generation, chosen.pair.fromSnapshotId, chosen.pair.toSnapshotId).catch(() => null)]);
    if (!samePeriod(facts.period, period)) throw new Error('期间已变化，请重新读取。');
    return { facts, invest };
  }, `${from}:${to}`);
  return <Loaded read={read} what="本期收支">{({ facts, invest }) => {
    const income = incomeMetric(facts.incomes), expense = expenseMetric(facts.expenses), delta = chosen.interval.delta_nw_cents;
    const result = invest?.result;
    const scope = chosen.interval.status === 'scope_changed';
    return <>
      <MetricGrid>
        <Metric label="金融净资产变化" value={delta !== null && !scope ? changeText(delta) : '未知'} unknown={delta === null || scope} sub={scope ? '参与比较的账户有变化，本期暂不可比' : `${chosen.interval.days} 天 · 来自两次完整盘点`} subTone={delta !== null && !scope ? (delta.startsWith('-') ? 'danger' : 'positive') : undefined}/>
        <Metric label="已记录收入" value={income.cents !== null ? moneyText(income.cents) : '未知'} unknown={income.cents === null} sub={income.note}/>
        <Metric label="已记录重要支出（退款前）" value={expense.cents !== null ? moneyText(expense.cents) : '未知'} unknown={expense.cents === null} sub={expense.note}/>
        <Metric label="投资损益（只读）" value={result?.status === 'ready' ? changeText(result.value.profit_cents) : '未知'} unknown={result?.status !== 'ready'}
          sub={result?.status === 'ready' ? '来自电脑端核对结果；现金收入不重复计入' : result ? `${investmentStatusLabel(result.status)}${'reasons' in result && result.reasons.length ? '：' + result.reasons.map(reasonText).join('；') : ''}` : '读取失败或未核对'}/>
      </MetricGrid>
      <Card><h2 className="sp-h2">本期结论</h2><p className="sp-sheet-text">{dayLabel(from, today)} 至 {dayLabel(to, today)}：{scope ? '参与比较的账户有变化，净资产变化不可比' : delta !== null ? `金融净资产${delta.startsWith('-') ? '减少' : '增加'} ${moneyText(delta.replace('-', ''))}` : '净资产变化未知'}。已记录收入与重要支出只说明到账和花费的构成，不能推算真实结余；转账不作为收入或消费。{result?.status === 'ready' ? '' : '投资损益需要在电脑上完成资金流动核对后才会显示。'}</p></Card>
      {facts.expenses.status === 'ready' && <p className="sp-note sp-note-pad">退款 {moneyText(facts.expenses.value.refund_cents)} · 售出回收 {moneyText(facts.expenses.value.sale_cents)}（单列，不抵扣支出）。</p>}
    </>;
  }}</Loaded>;
}

// ---------------------------------------------------------------- 收入

function Income() {
  const nav = useNav(), { today } = useSession();
  const [key, setKey] = useState<PeriodKey>('year'), [custom, setCustom] = useState<{ from: string; to: string } | null>(null), [keyword, setKeyword] = useState('');
  const period = periodOf(key, today, custom);
  return <>
    <PeriodBar today={today} value={key} custom={custom} onChange={(next, range) => { setKey(next); setCustom(range); }}/>
    <IncomeList key={JSON.stringify(period)} period={period} keyword={keyword} setKeyword={setKeyword} onOpen={id => nav.push('spending.incomeEdit', { id })} onNew={() => nav.push('spending.incomeEdit')}/>
  </>;
}

function IncomeList({ period, keyword, setKeyword, onOpen, onNew }: { period: FinancePeriod; keyword: string; setKeyword: (v: string) => void; onOpen: (id: string) => void; onNew: () => void }) {
  const { today } = useSession();
  const read = useRead(async () => {
    const facts = await readFinanceSources(period);
    if (!samePeriod(facts.period, period)) throw new Error('期间已变化，请重新读取。');
    return facts.incomes;
  }, JSON.stringify(period));
  return <Loaded read={read} what="收入记录">{source => {
    if (source.status === 'disabled') return <Notice>{source.reason}</Notice>;
    if (source.status === 'error') return <ErrorState title="收入读取失败" message={source.message} onRetry={read.reload}/>;
    const view = incomeView(source.value, period, keyword);
    if (!view.count) return <EmptyState icon="wallet" title="本期尚未记录收入" message="未知不等于零。可以记录实际到账的税后收入和公积金缴存。" action={<Button variant="primary" onClick={onNew}>记一笔收入</Button>}/>;
    return <>
      <MetricGrid>
        <Metric label="已记录到账" value={view.net !== null ? moneyText(view.net) : '尚未记录'} sub={`${view.count} 笔 · 同日可多笔`}/>
        <Metric label="公积金缴存" value={hpfSummary(view.hpf.total, view.hpf.known, view.hpf.unknown, v => v === null ? '未知' : moneyText(v))}/>
      </MetricGrid>
      <ListGroup title="按来源分类" footer="已记录收入仅说明到账构成，不再加到资产余额或投资损益；搜索只筛选明细，合计不变。">
        {view.categories.map(c => <ListRow key={c.label} title={c.label} subtitle={`${c.count} 笔`} value={moneyText(c.cents)}/>)}
      </ListGroup>
      <SearchField subject="收入明细" value={keyword} onChange={setKeyword}/>
      {!view.shown.length ? <EmptyState icon="wallet" title="没有匹配的收入记录" message="期间合计不受搜索影响。" action={<Button onClick={() => setKeyword('')}>清除搜索</Button>}/>
        : <ListGroup title={`明细 · ${view.shown.length} 条`}>
          {view.shown.map(r => <ListRow key={r.id} onClick={() => onOpen(r.id)} title={dayLabel(r.fields.date, today)} subtitle={[incomeCategories[r.fields.category ?? 'unclassified'], r.fields.hpf_cents === null ? '公积金未知' : `公积金 ${moneyText(r.fields.hpf_cents)}`, r.fields.notes].filter(Boolean).join(' · ')} value={moneyText(r.fields.net_cents)}/>)}
        </ListGroup>}
    </>;
  }}</Loaded>;
}

// ---------------------------------------------------------------- 年度回顾

function Annual() {
  const { today } = useSession();
  const presets = reviewPeriodPresets(today);
  const [id, setId] = useState<string>('1y'), [hidden, setHidden] = useState(hiddenPref), [copy, setCopy] = useState(false);
  const period = presets.find(p => p.id === id)!.period;
  const read = useRead(async () => {
    const sources = await readFinanceSources(period, 'annual');
    const model = buildAnnualReview(sources, period, sources.today, resolveReviewPreset(period, today));
    if (!model) throw new Error('区间来源与所选期间不一致，请重新读取。');
    return model;
  }, id);
  const toggle = () => { const next = !hidden; setHidden(next); try { localStorage.setItem('thingary.hide-financial-amounts.v1', next ? '1' : '0'); } catch { /* visual preference only */ } };
  const show = (cents: string | null) => cents === null ? '暂无完整金额' : hidden ? '金额已隐藏' : moneyText(cents);
  return <>
    <ChipRow label="回顾窗口" items={presets.map(p => ({ id: p.id, label: p.label }))} value={id} onChange={setId}/>
    <Loaded read={read} what="区间回顾">{model => {
      const pts = model.net.points.filter(p => p.complete);
      const compare = !!model.net.from && !!model.net.to && model.net.from.date !== model.net.to.date;
      const summary = compare && !model.net.scopeChanged ? `金融净资产从 ${dayLabel(model.net.from!.date, today)} 到 ${dayLabel(model.net.to!.date, today)}：${hidden ? '金额已隐藏' : `${moneyText(model.net.from!.net_cents)} 到 ${moneyText(model.net.to!.net_cents)}`}，共 ${pts.length} 次完整盘点。` : '区间内可比较的完整盘点不足两次，不画走势。';
      return <>
        <p className="sp-note sp-note-pad">回顾窗口 {localizeDates(model.windowLabel, today)}；仅汇总已记录事实，记录数量不证明覆盖完整。</p>
        <Card><h2 className="sp-h2">金融净资产</h2>
          <p className="sp-sheet-text">区间内完整盘点 {model.net.completeCount} 次，另有 {model.net.incompleteCount} 次不完整。{model.net.note}</p>
          {model.net.to && <MetricGrid>
            <Metric label={`${compare ? '实际起点' : '实际盘点'} ${model.net.from ? dayLabel(model.net.from.date, today) : ''}`} value={show(model.net.from?.net_cents ?? null)}/>
            {compare && <Metric label={`实际终点 ${dayLabel(model.net.to.date, today)}`} value={show(model.net.to.net_cents)}/>}
            {compare && <Metric label={model.net.label} value={show(model.net.delta_cents)}/>}
          </MetricGrid>}
          {compare && !model.net.scopeChanged && !hidden && <LineAreaChart values={pts.map(p => Number(p.net_cents))} summary={summary} height={96}/>}
          <p className="sp-note">{model.net.scopeChanged ? '期间范围发生变化，不直接比较。' : summary}</p>
        </Card>
        <MetricGrid>
          <Metric label="已记录税后收入" value={model.income.count === 0 ? '暂无记录' : show(model.income.cents)} unknown={model.income.count > 0 && model.income.cents === null} sub={`${model.income.note}${model.income.count ? ` · ${model.income.count} 条；公积金已知小计 ${show(model.income.hpf_known_cents)}${model.income.hpf_unknown_count ? `，${model.income.hpf_unknown_count} 条未知` : ''}` : ''}`}/>
          <Metric label="已记录重要支出（退款前）" value={model.expenses.count === 0 && model.expenses.undatedCount === 0 ? '暂无记录' : show(model.expenses.cents)} sub={`${model.expenses.note}${model.expenses.count ? ` · ${model.expenses.count} 条${model.expenses.unknownCount ? `，${model.expenses.unknownCount} 条金额未知` : ''}` : ''}`}/>
        </MetricGrid>
        <Card><h2 className="sp-h2">存钱目标 · 当前进度</h2><p className="sp-note">{model.savings.note}</p>
          {model.savings.goals.map(g => <div key={g.id} className="sp-goal"><strong>{hidden ? g.alias : g.name}</strong><p>{g.note}</p>
            <p>{!g.progress.complete ? `有 ${g.progress.missing} 个未知、${g.progress.unavailable} 个失效关联；不显示完整百分比。` : hidden ? '进度已隐藏。' : `当前进度 ${((g.progress.percent_hundredths ?? 0) / 100).toFixed(2)}% · ${g.progress.reached ? '关联账户余额达标' : '余额尚未达标'}`}</p></div>)}
        </Card>
        <Card><h2 className="sp-h2">当时记录的退休规划结论</h2><p className="sp-note">{model.planning.note}</p>
          {(model.planning.conditionsChanged || model.planning.openItems) && <p className="sp-note">规划模式、目标月份或待确认条件可能不同；并列显示原结论，不计算归因变化。</p>}</Card>
        <ListGroup title="复制与隐私">
          <ListRow title={hidden ? '显示金融金额' : '隐藏金融金额'} subtitle="所有页面的金融金额都会隐藏" onClick={toggle}/>
          <ListRow title="预览摘要" subtitle="默认隐私版，不含金额" onClick={() => setCopy(!copy)} chevron={false} value={copy ? '收起' : '展开'}/>
        </ListGroup>
        {copy && <pre className="sp-pre" aria-label="区间摘要预览">{annualCopyText(model, false)}</pre>}
        <p className="sp-note sp-note-pad">净资产端点只取真实完整盘点；净资产不是包含房产的家庭总资产。收入、重要支出与退款按原来源口径读取。</p>
      </>;
    }}</Loaded>
  </>;
}
