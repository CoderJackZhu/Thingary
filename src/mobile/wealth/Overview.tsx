import { useState } from 'react';
import { dayLabel, moneyText } from '../format';
import { accountGroupTotals, accountVisible } from '../../wealth-display';
import type { AccountView } from '../../wealth-display';
import { changeText, comparisonText, defaultRange, kindLabel } from '../../wealth';
import type { Point } from '../../wealth';
import { monthsBefore, periodChange } from '../../review';
import { dualLineAxis, trendPaths } from '../../dual-line-chart';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import { useModules } from '../modules-context';
import { Button, Card, DonutChart, EmptyState, HeroCard, Icon, IconButton, LargeTitle, ListGroup, ListRow, Notice, SegmentedControl, SelectField } from '../ui';
import { ReadState, useGroups, WealthGate } from './shared';

function Trend({ points, today }: { points: Point[]; today: string }) {
  const [liabilities, setLiabilities] = useState(false);
  const series = [points.map(p => p.complete ? p.net_cents : null), points.map(p => p.complete ? p.liabilities_cents : null)];
  const axis = dualLineAxis(series, [true, liabilities]);
  const start = Date.parse(points[0]?.date ?? ''), span = Date.parse(points.at(-1)?.date ?? '') - start || 1;
  const x = (date: string) => 48 + (Date.parse(date) - start) / span * 244;
  const y = (value: number) => 112 - (value - axis.bottom) / (axis.top - axis.bottom) * 100;
  const paths = series.map(line => trendPaths(line.map((v, i) => v == null ? null : { x: x(points[i].date), y: y(Number(v)) }), 112));
  return <><div className="mw-chart"><svg viewBox="0 0 300 140" role="img" aria-label={`金融净资产${liabilities ? '与负债同轴' : ''}趋势，${points.filter(p => p.complete).length}次完整盘点；缺项不连线`}>
    {axis.grid.map(v => <g key={v}><line x1="48" x2="292" y1={y(v)} y2={y(v)} stroke="var(--line-soft)"/><text x="44" y={y(v) + 4} textAnchor="end">{Math.round(v / 10000) / 10}千</text></g>)}
    {paths.map((path, i) => (!i || liabilities) && <g key={i}>{!i && <path d={path.area} fill="var(--accent)" opacity=".1"/>}<path d={path.line} fill="none" stroke={i ? 'var(--error)' : 'var(--accent)'} strokeWidth="2" strokeDasharray={i ? '4 3' : undefined}/></g>)}
    {points.map(p=>p.complete && <circle key={p.snapshot_id} cx={x(p.date)} cy={y(Number(p.net_cents))} r="2.8" fill="var(--accent)"/>)}
    {points.length > 0 && <><text x="48" y="136">{dayLabel(points[0].date, today)}</text><text x="292" y="136" textAnchor="end">{dayLabel(points.at(-1)!.date, today)}</text></>}
  </svg></div><div className="mw-toolbar"><span className="mw-muted">金融净资产</span><Button variant="plain" ariaLabel="负债图例" onClick={() => setLiabilities(!liabilities)}>{liabilities ? '✓ ' : ''}负债</Button></div></>;
}
export function AccountList() {
  const s = useSession(), nav = useNav(), groups = useGroups(), [view, setView] = useState<AccountView>('active');
  if (!s.data) return null;
  const shown = s.data.accounts.filter(a => accountVisible(a, view));
  const entries = (s.data.summary.latest_entries ?? []).filter(e => shown.some(a => a.id === e.account_id));
  const totals = accountGroupTotals(shown, groups.value ?? [], entries, true);
  return <><SelectField label="显示账户" value={view} onChange={v => setView(v as AccountView)} options={[{id:'active',label:'使用中'},{id:'closed',label:'已停用'},{id:'all',label:'全部'}]}/>
    <ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>
    {!shown.length && <EmptyState icon="wallet" title="这里还没有账户" message={view === 'closed' ? '没有已停用的账户。' : '先添加账户，再填写余额。'} action={<Button onClick={()=>nav.push('wealth.accountEdit')}>新增账户</Button>}/>}
    {groups.value && totals.filter(g => g.accounts.length).map(group => <ListGroup key={group.id} title={group.name} footer={`最近盘点计入小计 ${group.partial && !group.known ? '未知' : moneyText(group.net_cents)}${group.partial ? ' · 有账户未涵盖或金额未知' : ''}`}>
      {group.accounts.map(account => <ListRow key={account.id} title={account.fields.name} subtitle={`${account.fields.institution || kindLabel(account.fields.kind)} · ${account.fields.counted ? '计入' : '不计入'}${account.fields.side === 'liability' ? ' · 欠款' : ''}`} value={account.latest ? moneyText(account.latest.amount_cents) : '未知'} valueSub={account.latest ? dayLabel(account.latest.date, s.today) : undefined} unknown={!account.latest} onClick={() => nav.push('wealth.account',{id:account.id})}/>)}
    </ListGroup>)}<p className="mw-muted">显示范围只筛选账户清单。小计采用最近一次盘点的计入范围，未涵盖账户不补零。</p></>;
}
export function Accounts() {
  const nav = useNav();
  return <div className="m-page m-wealth"><LargeTitle title="账户" actions={<IconButton label="新增账户" onClick={()=>nav.push('wealth.accountEdit')}><Icon name="plus"/></IconButton>}/><WealthGate><AccountList/></WealthGate></div>;
}
export default function Overview() {
  const nav = useNav(), s = useSession(), groups = useGroups(), {modules} = useModules();
  const [range,setRange] = useState('1y'), [structure,setStructure] = useState('kind');
  const summary = s.data?.summary, points = summary?.points ?? [], latest = points.at(-1), complete = [...points].reverse().find(p=>p.complete);
  const from = range === 'all' ? '' : monthsBefore(s.today, range === '3m' ? 3 : 12);
  const shown = points.filter(p=>p.date >= from && p.date <= s.today), period = periodChange(shown), pair = defaultRange(points);
  const grouped = accountGroupTotals(s.data?.accounts ?? [], groups.value ?? [], summary?.structure_entries ?? []);
  const slices = structure === 'kind' ? (summary?.structure ?? []).map(e=>({label:kindLabel(e.kind),value:Number(e.amount_cents),display:moneyText(e.amount_cents)})) : grouped.filter(g=>g.known).map(g=>({label:g.name,value:Number(g.assets_cents),display:moneyText(g.assets_cents)}));
  return <div className="m-page m-wealth"><LargeTitle title="财富" actions={<><Button variant="primary" onClick={()=>nav.push('wealth.checkin')}>盘点</Button><IconButton label="新增账户" onClick={()=>nav.push('wealth.accountEdit')}><Icon name="plus"/></IconButton></>}/><WealthGate>
    {!s.data?.accounts.length ? <EmptyState icon="wallet" title="从第一个账户开始" message="添加银行卡、投资账户，或信用卡欠款，再做第一次完整盘点。" action={<Button onClick={()=>nav.push('wealth.accountEdit')}>新增账户</Button>}/> : <>
      <HeroCard eyebrow="金融净资产" title={complete ? moneyText(complete.net_cents) : '未知'} subtitle={complete ? `较上次 ${comparisonText(complete.change_cents,complete.compared_to)}` : '完成一次完整盘点后显示金融净资产'} footnote={complete ? `最近完整盘点 ${dayLabel(complete.date, s.today)}` : undefined}/>
      {latest && !latest.complete && <Notice>最近盘点 {dayLabel(latest.date, s.today)} 缺 {latest.missing} 个账户。上方净资产和结构仍来自最近完整盘点。</Notice>}
      <Card><div className="mw-toolbar"><h2>净资产趋势</h2><SegmentedControl label="趋势时间范围" items={[{id:'3m',label:'3 月'},{id:'1y',label:'1 年'},{id:'all',label:'全部'}]} value={range} onChange={setRange}/></div><Trend points={shown} today={s.today}/><p className="mw-muted">{period.status === 'ready' ? `较期初 ${changeText(period.cents)}` : period.status === 'scope_changed' ? '账户计入范围变化，暂不直接比较' : '所选期间完整盘点不足两次'}</p></Card>
      <ListGroup title="与上次比较"><ListRow title={complete ? comparisonText(complete.change_cents,complete.compared_to) : '等待完整盘点'} subtitle={complete?.compared_to ? `${dayLabel(complete.compared_to, s.today)} → ${dayLabel(complete.date, s.today)}${complete.scope_changed ? ' · 计入范围有变化' : ''}` : '完成两次完整盘点后可比较'} onClick={pair ? ()=>nav.push('wealth.compare',pair) : undefined}/></ListGroup>
      <Card><h2>资产结构</h2><SegmentedControl label="资产结构方式" items={[{id:'kind',label:'按类型'},{id:'group',label:'按分组'}]} value={structure} onChange={setStructure}/>{structure === 'group' && <ReadState error={groups.error} reload={groups.reload} loading={!groups.value && !groups.error}/>}{(structure === 'kind' || groups.value) && <div className="mw-structure"><DonutChart summary={`按最近完整盘点 ${dayLabel(summary?.structure_date, s.today)} 的计入资产结构`} slices={slices}/><div>{slices.map((slice,i)=><div className="mw-legend" key={slice.label}><span><i className="mw-dot" style={{background:`var(--series-${i%7+1})`}}/>{slice.label}</span><span>{slice.display}</span></div>)}</div></div>}<p className="mw-muted">{summary?.structure_date ? `${dayLabel(summary.structure_date, s.today)} 完整盘点 · 仅含计入的资产，负债单独记录。` : '暂无完整盘点，结构未知。'}</p></Card>
      <AccountList/>
    </>}
    <ListGroup title="更多财富记录">
      {modules?.expenses !== false && <ListRow title="重要支出" onClick={()=>nav.push('spending.home')}/>}
      {modules?.recurring !== false && <ListRow title="周期费用" onClick={()=>nav.push('spending.recurring')}/>}
      {modules?.virtual !== false && <ListRow title="虚拟资产" onClick={()=>nav.push('spending.virtual')}/>}
      <ListRow title="财务复盘" onClick={()=>nav.push('spending.review')}/>
    </ListGroup>
  </WealthGate></div>;
}
