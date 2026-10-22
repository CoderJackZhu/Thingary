import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dayLabel, localizeDates, moneyText } from '../format';
import { readFinanceSources } from '../../finance-service';
import type { ExpenseView } from '../../expenses';
import type { FinancePeriod } from '../../finance-contract';
import { pendingSubscriptionStart, recurringCategoryText } from '../../recurring';
import type { Due, Overview, Plan } from '../../recurring';
import { periodLabel } from '../../recurring-model';
import { submit } from '../../wealth';
import { useModules } from '../modules-context';
import { useNav } from '../nav-context';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { BarChart, Button, Card, ConfirmSheet, EmptyState, ListGroup, ListRow, MetricGrid, Metric, Notice, SearchField, SegmentedControl } from '../ui';
import { dueBadge, dueTotal, expenseChart, expenseRows, expenseSummary, matchesPlan, nextPayment, paidInPeriod, periodTitle, periodWord, planAmountText, planCost, planStatusInfo, samePeriod, shortDay, signedMoney, sortPlans } from './model';
import type { ExpenseRow, PeriodKey } from './model';
import { skipSave } from './forms';
import { Head, Loaded, PeriodBar, Tag, periodOf } from './parts';
import { useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
type Seg = 'expenses' | 'recurring';

/** spending.home: 重要支出 / 周期费用 (design 14). The period is shared by both segments. */
export default function SpendingHome({ params }: PageProps) {
  const nav = useNav(), { today } = useSession(), { modules } = useModules();
  const expensesOn = modules ? modules.expenses : true, recurringOn = modules ? modules.recurring : true;
  const wantRecurring = params.seg === 'recurring';
  const [picked, setPicked] = useState<Seg | null>(null);
  const seg: Seg = picked && (picked === 'expenses' ? expensesOn : recurringOn) ? picked : wantRecurring && recurringOn ? 'recurring' : expensesOn ? 'expenses' : 'recurring';
  const [key, setKey] = useState<PeriodKey>('year'), [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const period = periodOf(key, today, custom);
  const anyOn = expensesOn || recurringOn, wealthHub = modules ? modules.wealth : true;
  const virtualOn = modules ? modules.virtual : true, reviewOn = modules ? modules.wealth || modules.incomes : true;
  const add = !anyOn ? undefined : seg === 'expenses' ? { label: t('记一笔支出'), onClick: () => nav.push('spending.expenseEdit') } : { label: t('新增周期计划'), onClick: () => nav.push('spending.recurringEdit') };
  return <div className="m-page">
    <Head title={t('支出与周期费用')} add={add}/>
    {expensesOn && recurringOn && <SegmentedControl label={t('支出与周期费用')} items={[{ id: 'expenses' as Seg, label: t('重要支出') }, { id: 'recurring' as Seg, label: t('周期费用') }]} value={seg} onChange={setPicked}/>}
    {anyOn && <PeriodBar today={today} value={key} custom={custom} onChange={(next, range) => { setKey(next); setCustom(range); }}/>}
    {!anyOn && <EmptyState icon="info" title={t('重要支出和周期费用已关闭')} message={t('可以在「我的 › 设置 › 功能模块」重新开启；已有记录不会丢失。')}/>}
    {anyOn && seg === 'expenses' && <ExpensesPanel period={period} today={today} key={`e:${JSON.stringify(period)}`}/>}
    {anyOn && seg === 'recurring' && <RecurringPanel period={period} periodKey={key} today={today}/>}
    {/* 虚拟资产 / 财务复盘 live once in the 财富 overview; this list only stands in when that overview is switched off. */}
    {!wealthHub && (virtualOn || reviewOn) && <ListGroup title={t('更多')}>
      {virtualOn && <ListRow icon="doc" title={t('虚拟资产')} subtitle={t('软件、域名、订阅与储值')} onClick={() => nav.push('spending.virtual')}/>}
      {reviewOn && <ListRow icon="chart" title={t('财务复盘')} subtitle={t('收入记录、期间汇总与年度回顾')} onClick={() => nav.push('spending.review')}/>}
    </ListGroup>}
  </div>;
}

// ---------------------------------------------------------------- 重要支出

function ExpensesPanel({ period, today }: { period: FinancePeriod; today: string }) {
  const nav = useNav(), { modules } = useModules();
  const read = useRead(async () => {
    const sources = await readFinanceSources(period);
    if (!samePeriod(sources.period, period)) throw new Error(t('期间已变化，请重新读取。'));
    if (sources.expenses.status === 'error') throw new Error(sources.expenses.message);
    return sources.expenses;
  }, JSON.stringify(period));
  const [keyword, setKeyword] = useState(''), [shown, setShown] = useState(40);
  function open(row: ExpenseRow) {
    const line = row.line;
    if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund') nav.push('spending.expenseEdit', { id: line.id });
    else if (line.source === 'payment') { if (line.plan_id) nav.push('spending.recurring', { id: line.plan_id }); }
    else if (line.source === 'virtual') nav.push('spending.virtualDetail', { id: line.id });
    else if (line.source === 'topup') { if (line.asset_id) nav.push('spending.virtualDetail', { id: line.asset_id }); }
    else if (line.asset_id) nav.push('items.detail', { id: line.asset_id });
  }
  const tappable = (row: ExpenseRow) => row.line.source === 'payment' ? !!row.line.plan_id && (modules ? modules.recurring : true) : row.line.source === 'virtual' || row.line.source === 'topup' ? (modules ? modules.virtual : true) : true;
  return <Loaded read={read} what={t('重要支出')}>{result => {
    if (result.status === 'disabled') return <Notice>{result.reason}</Notice>;
    const view: ExpenseView = result.value, summary = expenseSummary(view), chart = expenseChart(view, period);
    const rows = [...expenseRows(view.lines, keyword, today), ...expenseRows(view.undated, keyword, today)];
    const empty = !view.lines.length && !view.undated.length;
    return <>
      <MetricGrid>
        <Metric label={t('{v1}已记录支出', { v1: periodTitle(period) })} value={summary.display.value !== null ? moneyText(view.spent_cents) : summary.display.note ?? t('未知')} unknown={summary.display.value === null} sub={summary.display.value !== null ? summary.display.note ?? (period.kind === 'year' && period.year === Number(today.slice(0, 4)) ? t('截至今天已记录') : undefined) : undefined}/>
        <Metric label={t('退款')} value={moneyText(view.refund_cents)} sub={t('按退款日期计入')}/>
        <Metric label={t('净支出')} value={summary.netUnknown ? t('仅已知部分 {v1}', { v1: moneyText(view.net_cents) }) : moneyText(view.net_cents)} sub={t('支出 − 退款，可为负')}/>
        <Metric label={t('售出回收')} value={moneyText(view.sale_cents)} sub={t('单列，不抵扣支出')}/>
      </MetricGrid>
      {(view.undated.length > 0 || view.unknown_amount_count > 0) && <p className="sp-note sp-note-pad">{view.undated.length > 0 && t('日期未知 {length} 条，不归入任何期间。', { length: view.undated.length })}{view.unknown_amount_count > 0 && t('{unknown_amount_count} 条金额未知，未计入。', { unknown_amount_count: view.unknown_amount_count })}</p>}
      {chart && <Card className="sp-chart-card"><h2>{chart.title}</h2><p>{chart.caption}</p><BarChart bars={chart.bars} summary={chart.summary}/></Card>}
      {empty ? <EmptyState icon="wallet" title={period.kind === 'all' ? t('还没有重要支出') : t('{v1}没有记录', { v1: periodTitle(period) })} message={t('物品的购入和维护会自动出现在这里；旅行、培训等没有对应物品的大额花费，可以单独记一笔。')} action={<Button variant="primary" onClick={() => nav.push('spending.expenseEdit')}>{t('记一笔支出')}</Button>}/> : <>
        <SearchField subject={t('支出明细')} value={keyword} onChange={value => { setKeyword(value); setShown(40); }}/>
        {!rows.length ? <EmptyState icon="wallet" title={t('当前条件下没有找到记录')} message={t('搜索只筛选明细，上面的合计不变。')} action={<Button onClick={() => setKeyword('')}>{t('清除搜索')}</Button>}/>
          : <ListGroup title={t('明细 · {v1} 条', { v1: keyword.trim() ? t('找到 {length}', { length: rows.length }) : rows.length })} footer={t('仅已记录支出；退款按发生日期，售出回收单列。物品的购入与维护从物品里读取。')}>
            {rows.slice(0, shown).map(row => {
              const amount = signedMoney(row);
              return <ListRow key={row.key} title={row.title} subtitle={row.subtitle} value={amount ?? t('金额未知')} unknown={amount === null} onClick={tappable(row) ? () => open(row) : undefined}/>;
            })}
            {rows.length > shown && <button type="button" className="sp-more-row" onClick={() => setShown(n => n + 40)}>{t('显示更多（还有')} {rows.length - shown} {t('条）')}</button>}
          </ListGroup>}
      </>}
    </>;
  }}</Loaded>;
}

// ---------------------------------------------------------------- 周期费用

function RecurringPanel({ period, periodKey, today }: { period: FinancePeriod; periodKey: PeriodKey; today: string }) {
  const nav = useNav(), saver = useSaver();
  const read = useRead(() => invoke<Overview>('recurring_overview'), 'recurring');
  const [keyword, setKeyword] = useState(''), [skipping, setSkipping] = useState<Due | null>(null), [all, setAll] = useState(false), [notice, setNotice] = useState('');
  return <Loaded read={read} what={t('周期费用')}>{data => {
    if (!data.plans.length) return <EmptyState icon="calendar" title={t('还没有周期费用')} message={t('把房租、订阅、保险这类定期付的钱记成计划，就能看到每年的固定负担和下次什么时候付。')} action={<Button variant="primary" onClick={() => nav.push('spending.recurringEdit')}>{t('新增计划')}</Button>}/>;
    const paid = paidInPeriod(data.payments, period);
    const items = [...data.due.map(d => ({ d, overdue: true })), ...data.upcoming.map(d => ({ d, overdue: false }))];
    const shownItems = all ? items : items.slice(0, 4);
    const plans = sortPlans(data.plans.filter(p => matchesPlan(p, keyword)), today);
    const skip = () => skipping && void saver.run(requestId => submit({ command: 'recurring_payment_save', input: skipSave(skipping, data.generation, requestId), label: t('{plan_name} {due_date} 本期不付', { plan_name: skipping.plan_name, due_date: skipping.due_date }) }), { onDone: () => { setNotice(t('已标记「{plan_name}」{v2} 本期不付。', { plan_name: skipping.plan_name, v2: dayLabel(skipping.due_date, today) })); setSkipping(null); read.reload(); } });
    return <>
      {notice && <Notice tone="positive">{notice}</Notice>}
      <div className="sp-stat3">
        <Card className="sp-stat"><span>{t('进行中月均')}</span><strong>{moneyText(data.monthly_cents)}</strong></Card>
        <Card className="sp-stat"><span>{t('{v1}已付', { v1: periodWord(periodKey) })}</span><strong>{moneyText(paid.cents)}</strong>{paid.unknown > 0 && <small>{t('另有 {unknown} 笔金额未知', { unknown: paid.unknown })}</small>}</Card>
        <Card className="sp-stat"><span>{t('未来 12 个月')}</span><strong>{moneyText(data.next12_cents)}</strong></Card>
      </div>
      <p className="sp-note sp-note-pad">{t('月均、未来 12 个月都是估算；只有确认付款后才计入重要支出，不改变账户余额。')}</p>
      {items.length > 0 && <>
        <div className="sp-head-line"><h2>{t('即将到期')}</h2><span>{[data.due.length ? t('{length} 笔待确认', { length: data.due.length }) : '', data.upcoming.length ? t('{length} 笔即将到期', { length: data.upcoming.length }) : ''].filter(Boolean).join(' · ')} · {moneyText(dueTotal([...data.due, ...data.upcoming]))}</span></div>
        {shownItems.map(({ d, overdue }) => { const badge = dueBadge(d.due_date, today); return <Card key={d.plan_id + d.due_date} className="sp-due">
          <div className="sp-due-head"><strong>{d.plan_name}</strong><span className="sp-due-amount">{moneyText(d.amount_cents)}</span></div>
          <div className="sp-due-sub"><span>{shortDay(d.due_date, today)}{d.coverage_start && d.coverage_end ? t(' · 覆盖 {v1}', { v1: localizeDates(periodLabel(d.coverage_start, d.coverage_end), today) }) : ''}</span><Tag tone={overdue ? 'danger' : badge.tone}>{overdue && badge.tone !== 'danger' ? t('待确认') : badge.text}</Tag></div>
          <div className="sp-due-actions"><Button variant="primary" onClick={() => nav.push('spending.payment', { plan: d.plan_id, due: d.due_date })}>{t('确认付款')}</Button><Button onClick={() => { saver.setError(''); setSkipping(d); }}>{t('跳过')}</Button></div>
        </Card>; })}
        {items.length > 4 && <div className="sp-more"><button type="button" className="sp-link" onClick={() => setAll(!all)}>{all ? t('收起') : t('查看全部 {length} 期', { length: items.length })}</button></div>}
      </>}
      <SearchField subject={t('计划')} value={keyword} onChange={setKeyword}/>
      {!plans.length ? <EmptyState icon="wallet" title={t('当前条件下没有找到计划')} action={<Button onClick={() => setKeyword('')}>{t('清除搜索')}</Button>}/> : <ListGroup title={t('计划列表')} action={<span className="sp-note">{t('共 {length} 项', { length: plans.length })}</span>}>
        {plans.map(p => <PlanRow key={p.id} plan={p} today={today} onClick={() => nav.push('spending.recurring', { id: p.id })}/>)}
      </ListGroup>}
      {skipping && <ConfirmSheet title={t('本期不付？')} confirm={t('确认本期不付')} busy={saver.busy} error={saver.error} onClose={() => setSkipping(null)} onConfirm={skip}
        message={t('「{plan_name}」{v2} 这一期会记为不付，不计入重要支出，也不会再出现在待确认里。之后可以在计划详情里更正。', { plan_name: skipping.plan_name, v2: dayLabel(skipping.due_date, today) })}/>}
    </>;
  }}</Loaded>;
}

function PlanRow({ plan, today, onClick }: { plan: Plan; today: string; onClick: () => void }) {
  const status = planStatusInfo(plan, today), amount = planAmountText(plan, !!pendingSubscriptionStart(plan, today)), cost = planCost(plan), next = nextPayment(plan, today);
  return <ListRow title={<span className="sp-title">{plan.fields.name}<Tag tone={status.tone}>{status.text}</Tag></span>} onClick={onClick}
    subtitle={<span className="sp-lines"><span>{recurringCategory(plan)} · {amount.main}{amount.monthly ? ` · ${amount.monthly}` : ''}</span><span>{t('下次付款')} {next ? dayLabel(next.date, today) : t('暂无')} {t('· 累计费用 {v1}', { v1: moneyText(cost.cents) })}{cost.estimated ? t('（估算）') : ''}</span></span>}/>;
}
const recurringCategory = (plan: Plan) => recurringCategoryText(plan.fields.category);
