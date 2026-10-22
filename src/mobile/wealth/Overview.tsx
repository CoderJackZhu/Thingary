import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dayLabel, moneyText } from '../format';
import { accountGroupTotals, accountVisible } from '../../wealth-display';
import type { AccountView } from '../../wealth-display';
import { changeText, comparisonText, defaultRange, kindLabel } from '../../wealth';
import type { Point } from '../../wealth';
import { monthsBefore, periodChange } from '../../review';
import { useNav, useReveal } from '../nav-context';
import type { Due, Overview as RecurringOverview } from '../../recurring';
import { useSession } from '../session';
import { useModules } from '../modules-context';
import { Button, Card, PullToRefresh, DonutChart, EmptyState, Fab, HeroCard, LargeTitle, ListGroup, ListRow, LineChart, Notice, SegmentedControl, SelectField } from '../ui';
import { browserStorage, readHideAmounts } from '../me/shared';
import { trendKinds, trendSummary, trendTip, trendValues } from './trend-model';
import type { TrendKind } from './trend-model';
import { ReadState, useGroups, WealthGate } from './shared';
import { t } from '../../i18n.ts';
function Trend({ points: all, today }: { points: Point[]; today: string }) {
  // Like the desktop chart: only complete check-ins are drawn, joined across incomplete ones.
  const points = all.filter(p => p.complete);
  const [kind, setKind] = useState<TrendKind>('net'), hidden = readHideAmounts(browserStorage());
  const tone = kind === 'liabilities' ? 'var(--error)' : 'var(--accent)';
  return <><SegmentedControl label={t('趋势指标')} items={trendKinds} value={kind} onChange={setKind}/>
    <LineChart className="mw-trend" height={190} hidden={hidden} series={[{ name: trendKinds.find(k => k.id === kind)!.label, values: trendValues(points, kind), color: tone }]}
      labels={points.map(p => dayLabel(p.date, today))} xs={points.map(p => Date.parse(p.date))} summary={trendSummary(points, kind, hidden)} tip={i => trendTip(points[i], hidden)}/></>;
}
/** Subscriptions and rents waiting for a 确认付款, up top so they are not missed. Reads quietly: a failed read just shows nothing. */
function PendingPayments() {
  const nav = useNav(), s = useSession(), reveal = useReveal(), { modules } = useModules(), on = modules?.recurring !== false;
  const [due, setDue] = useState<Due[]>([]);
  useEffect(() => {
    if (!on) { setDue([]); return; }
    let live = true;
    invoke<RecurringOverview>('recurring_overview').then(o => { if (live) setDue(o.due); }).catch(() => { if (live) setDue([]); });
    return () => { live = false; };
  }, [on, reveal, s.data?.summary.generation]);
  if (!on || !due.length) return null;
  return <ListGroup title={t('待确认付款')} action={<span className="mw-muted">{t('{length} 笔', { length: due.length })}</span>}>
    {due.slice(0, 3).map(d => <ListRow key={d.plan_id + d.due_date} title={d.plan_name} subtitle={t('{v1} 到期', { v1: dayLabel(d.due_date, s.today) })} value={moneyText(d.amount_cents)} onClick={() => nav.push('spending.payment', { plan: d.plan_id, due: d.due_date })}/>)}
    <ListRow title={due.length > 3 ? t('查看全部 {length} 笔', { length: due.length }) : t('周期费用')} onClick={() => nav.push('spending.home', { seg: 'recurring' })}/>
  </ListGroup>;
}
export function AccountList() {
  const s = useSession(), nav = useNav(), groups = useGroups(), [view, setView] = useState<AccountView>('active');
  if (!s.data) return null;
  const shown = s.data.accounts.filter(a => accountVisible(a, view));
  const entries = (s.data.summary.latest_entries ?? []).filter(e => shown.some(a => a.id === e.account_id));
  const totals = accountGroupTotals(shown, groups.value ?? [], entries, true);
  return <><SelectField label={t('显示账户')} value={view} onChange={v => setView(v as AccountView)} options={[{id:'active',label:t('使用中')},{id:'closed',label:t('已停用')},{id:'all',label:t('全部')}]}/>
    <ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>
    {!shown.length && <EmptyState icon="wallet" title={t('这里还没有账户')} message={view === 'closed' ? t('没有已停用的账户。') : t('先添加账户，再填写余额。')} action={s.data.accounts.length ? undefined : <Button onClick={()=>nav.push('wealth.accountEdit')}>{t('新增账户')}</Button>}/>}
    {groups.value && totals.filter(g => g.accounts.length).map(group => <ListGroup key={group.id} title={group.name} footer={t('最近盘点计入小计 {v1}{v2}', { v1: group.partial && !group.known ? '未知' : moneyText(group.net_cents), v2: group.partial ? ' · 有账户未涵盖或金额未知' : '' })}>
      {group.accounts.map(account => <ListRow key={account.id} title={account.fields.name} subtitle={`${account.fields.institution || kindLabel(account.fields.kind)} · ${account.fields.counted ? '计入' : '不计入'}${account.fields.side === 'liability' ? ' · 欠款' : ''}`} value={account.latest ? moneyText(account.latest.amount_cents) : t('未知')} valueSub={account.latest ? dayLabel(account.latest.date, s.today) : undefined} unknown={!account.latest} onClick={() => nav.push('wealth.account',{id:account.id})}/>)}
    </ListGroup>)}<Button block onClick={()=>nav.push('wealth.groups')}>{t('管理分组')}</Button><p className="mw-muted">{t('显示范围只筛选账户清单。小计采用最近一次盘点的计入范围，未涵盖账户不补零。')}</p></>;
}
export function Accounts() {
  const nav = useNav(), s = useSession();
  return <div className="m-page m-wealth m-has-fab"><LargeTitle title={t('账户')}/><WealthGate><AccountList/></WealthGate><Fab label={t('新增账户')} text={t('新增账户')} disabled={s.navBlocked} hidden={!s.data?.accounts.length} onClick={()=>nav.push('wealth.accountEdit')}/></div>;
}
export default function Overview() {
  const nav = useNav(), s = useSession(), groups = useGroups(), {modules} = useModules();
  const [range,setRange] = useState('1y'), [structure,setStructure] = useState('kind');
  const summary = s.data?.summary, points = summary?.points ?? [], latest = points.at(-1), complete = [...points].reverse().find(p=>p.complete);
  const from = range === 'all' ? '' : monthsBefore(s.today, range === '3m' ? 3 : 12);
  const shown = points.filter(p=>p.date >= from && p.date <= s.today), period = periodChange(shown), pair = defaultRange(points);
  const grouped = accountGroupTotals(s.data?.accounts ?? [], groups.value ?? [], summary?.structure_entries ?? []);
  const slices = structure === 'kind' ? (summary?.structure ?? []).map(e=>({label:kindLabel(e.kind),value:Number(e.amount_cents),display:moneyText(e.amount_cents)})) : grouped.filter(g=>g.known).map(g=>({label:g.name,value:Number(g.assets_cents),display:moneyText(g.assets_cents)}));
  return <PullToRefresh onRefresh={s.reload}><div className="m-page m-wealth m-has-fab"><LargeTitle title={t('财富')}/><WealthGate>
    {!s.data?.accounts.length ? <EmptyState icon="wallet" title={t('从第一个账户开始')} message={t('添加银行卡、投资账户，或信用卡欠款，再做第一次完整盘点。')} action={<Button onClick={()=>nav.push('wealth.accountEdit')}>{t('新增账户')}</Button>}/> : <>
      <HeroCard eyebrow={t('金融净资产')} title={complete ? moneyText(complete.net_cents) : t('未知')} subtitle={complete ? t('较上次 {v1}', { v1: comparisonText(complete.change_cents,complete.compared_to) }) : t('完成一次完整盘点后显示金融净资产')} footnote={complete ? t('最近完整盘点 {v1}', { v1: dayLabel(complete.date, s.today) }) : undefined}/>
      <PendingPayments/>
      {latest && !latest.complete && <Notice>{t('最近盘点 {v1} 缺 {missing} 个账户。上方净资产和结构仍来自最近完整盘点。', { v1: dayLabel(latest.date, s.today), missing: latest.missing })}</Notice>}
      <Card><div className="mw-toolbar"><h2>{t('净资产趋势')}</h2><SegmentedControl variant="chips" label={t('趋势时间范围')} items={[{id:'3m',label:t('3 月')},{id:'1y',label:t('1 年')},{id:'all',label:t('全部')}]} value={range} onChange={setRange}/></div><Trend points={shown} today={s.today}/><p className="mw-muted">{period.status === 'ready' ? t('较期初 {v1}', { v1: changeText(period.cents) }) : period.status === 'scope_changed' ? t('账户计入范围变化，暂不直接比较') : t('所选期间完整盘点不足两次')}</p></Card>
      <ListGroup title={t('与上次比较')}><ListRow title={complete ? comparisonText(complete.change_cents,complete.compared_to) : t('等待完整盘点')} subtitle={complete?.compared_to ? `${dayLabel(complete.compared_to, s.today)} → ${dayLabel(complete.date, s.today)}${complete.scope_changed ? ' · 计入范围有变化' : ''}` : t('完成两次完整盘点后可比较')} onClick={pair ? ()=>nav.push('wealth.compare',pair) : undefined}/></ListGroup>
      <Card><h2>{t('资产结构')}</h2><SegmentedControl label={t('资产结构方式')} items={[{id:'kind',label:t('按类型')},{id:'group',label:t('按分组')}]} value={structure} onChange={setStructure}/>{structure === 'group' && <ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>}{(structure === 'kind' || groups.value) && <div className="mw-structure"><DonutChart summary={t('按最近完整盘点 {v1} 的计入资产结构', { v1: dayLabel(summary?.structure_date, s.today) })} slices={slices}/><div>{slices.map((slice,i)=><div className="mw-legend" key={slice.label}><span><i className="mw-dot" style={{background:`var(--series-${i%7+1})`}}/>{slice.label}</span><span>{slice.display}</span></div>)}</div></div>}<p className="mw-muted">{summary?.structure_date ? t('{v1} 完整盘点 · 仅含计入的资产，负债单独记录。', { v1: dayLabel(summary.structure_date, s.today) }) : t('暂无完整盘点，结构未知。')}</p></Card>
    </>}
    <ListGroup title={t('更多财富记录')}>
      {modules?.expenses !== false && <ListRow title={t('重要支出')} onClick={()=>nav.push('spending.home')}/>}
      {modules?.recurring !== false && <ListRow title={t('周期费用')} onClick={()=>nav.push('spending.recurring')}/>}
      {modules?.virtual !== false && <ListRow title={t('虚拟资产')} onClick={()=>nav.push('spending.virtual')}/>}
      <ListRow title={t('财务复盘')} onClick={()=>nav.push('spending.review')}/>
    </ListGroup>
  </WealthGate><Fab label={t('盘点')} text={t('盘点')} icon="checkCircle" disabled={s.navBlocked} hidden={!s.data?.accounts.length} onClick={()=>nav.push('wealth.checkin')}/></div></PullToRefresh>;
}
