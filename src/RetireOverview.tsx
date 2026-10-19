import { forecastMoney } from './plan-format';
import { CoverageNote } from './CoverageNote';
import { Fragment, useMemo, useState } from 'react';
import { money } from './asset';
import { Info, Segments } from './FormControls';
import { rateText } from './plan';
import type { RetireInputs } from './plan';
import type { LifeEvent } from './plan-events';
import type { Outcome, Plan, Projection } from './plan-ledger';
import { timeLabel } from './plan-ledger';
import { eventImpact, offsetOf } from './plan-events';
import { terminalText } from './planning-basic-view';
import { compactYuan, coverage, coverageSeries, milestones, progress, scaleAt, snapshotRows, trajectory, verdict } from './plan-view';
import type { Seg, ValueMode } from './plan-view';
import { CoverageChart, TrajectoryChart } from './RetireCharts';
import './retire.css';

export const yuan = forecastMoney;

const storeKey = 'thingary.retire.valueMode';
export function useValueMode(): [ValueMode, (v: ValueMode) => void] {
  const [mode, set] = useState<ValueMode>(() => { try { return localStorage.getItem(storeKey) === 'nominal' ? 'nominal' : 'today'; } catch { return 'today'; } });
  return [mode, v => { set(v); try { localStorage.setItem(storeKey, v); } catch { /* 偏好存不下也不影响使用 */ } }];
}

export const valueModeLabel: Record<ValueMode, string> = { today: '按今天物价', nominal: '未来账面金额' };
export function ValueToggle({ value, onChange }: { value: ValueMode; onChange: (v: ValueMode) => void }) {
  return <span className="rd-toggle"><Segments label="金额显示方式" value={value} options={[{ value: 'today', label: valueModeLabel.today }, { value: 'nominal', label: valueModeLabel.nominal }]} onChange={onChange}/>
    <Info text={value === 'today' ? '将未来的金额换算回今天的购买力，使金额与你当前的预算具有可比性。' : '显示计入通胀后的金额，也就是未来那一年账面上的数字。'}/></span>;
}

const text = (segs: Seg[]) => segs.map((s, i) => s.strong ? <strong key={i}>{s.t}</strong> : <span key={i}>{s.t}</span>);
const milestoneLabels = { coast: '现在停止追加存钱', lean: '生活预算少一些', fi: '按完整预算生活', fat: '生活预算更宽裕' };

/** What the overview reads. The original plan passes its calc; the basic plan passes the shared prediction value. */
export type OverviewInput = { plan: Plan; proj: Projection; out: Outcome; assets: number; plan0?: Plan; events: LifeEvent[]; r: RetireInputs };
type Ready = OverviewInput;
/** Basic-mode context: where the contribution came from and how the horizon ends. Hides the original plan's income-change table. */
export type BasicOverview = { temporary: boolean; note?: string; contribution: string; terminal: keyof typeof terminalText };

/** 概览主列：判词、进度、轨迹、里程碑、覆盖与逐年快照。 */
export function RetireOverview({ calc, mode, onMode, basic, hideSnapshot = false }: { calc: Ready; mode: ValueMode; onMode: (m: ValueMode) => void; basic?: BasicOverview; hideSnapshot?: boolean }) {
  const { plan: P, proj, out } = calc, assets = calc.assets;
  const fmt = (c: number) => yuan(c);
  const v = verdict(P, proj, out, assets, mode, fmt), pr = progress(P, out, assets, mode);
  const ms = milestones(P, assets, mode);
  // 收益为 0% 时 Coast 与 FI 相等（四舍五入到元），Coast 卡不再单列。
  const coast = ms.find(m => m.id === 'coast'), fi = ms.find(m => m.id === 'fi');
  const sameCoastFi = !!coast && !!fi && Math.round(coast.amount / 100) === Math.round(fi.amount / 100);
  const points = useMemo(() => trajectory(P, proj, mode), [P, proj, mode]);
  const rows = useMemo(() => snapshotRows(P, proj, mode), [P, proj, mode]);
  const fiMonth = proj.fi_month === null ? null : proj.fi_month, retireMonth = proj.retire_month === null ? null : proj.retire_month;
  const endMonth = timeLabel(P, P.horizon_months - 1);
  return <div className="rd-main">
    <article className="ui-card rd-hero" aria-label="退休结论">
      <div className="rd-hero-top"><span className={`rd-badge ${v.tone}`}><i/>{v.badge}</span><ValueToggle value={mode} onChange={onMode}/></div>
      <h2 className="rd-verdict">{text(v.headline)}</h2><CoverageNote annotations={P.annotations} compact/>
      {v.sub.length > 0 && <p className="rd-sub">{text(v.sub)}</p>}
      <p className="rd-summary">{text(v.summary)}</p>
      <div className="rd-progress">
        <div className="rd-progress-row"><span>目前准备的资金<b>{money(String(Math.round(pr.now)))}</b></span><span className="rd-right">{pr.goal_month} 时{P.mode === 'fire' ? '目标' : '所需'}<b>{fmt(pr.target)}</b><Info text={`根据计划的支出、收入、收益率假设，估算目标月份所需的资金。金额显示方式：${valueModeLabel[mode]}。`}/></span></div>
        {pr.pct !== null ? <div className="rd-bar" role="img" aria-label={`已达标 ${Math.round(pr.pct)}%`}><div className={`rd-bar-fill ${v.tone}`} style={{ width: `${pr.pct}%` }}/>{pr.coast_pct !== null && pr.coast_pct > 0 && pr.coast_pct < 100 && <i className="rd-bar-coast" style={{ left: `${pr.coast_pct}%` }} title="现在停止追加存钱所需的资金"/>}</div> : <p className="muted small">当前假设下无需额外资金。</p>}
        {pr.pct !== null && <p className="rd-progress-note">已达标 {Math.round(pr.pct)}%</p>}
      </div>
      {v.guidance && <p className={`rd-guidance ${v.tone}`}>{v.guidance}</p>}
    </article>

    {basic && <p className={`plan-basis ${basic.temporary ? 'temporary' : ''}`} role="status">{basic.temporary ? <span className="ui-tag warn">{basic.note ?? '临时试算，未保存'}</span> : <span className="ui-tag">按已保存的预计投入</span>} 每月存入 {money(basic.contribution)}（不含投资收益）；{terminalText[basic.terminal]}。</p>}
    <p className="muted small">从 {P.anchor_date ?? '当前'} 的资金起点开始算，金额按 {P.monetary_basis_date ?? '当前'} 的物价。每月的付款按月初扣，存入按月末算。</p>
    <p className="muted small">本次只核对到 {endMonth}。</p>
    <EventWarnings calc={calc}/>

    <article className="ui-card rd-card" aria-label="预计资金变化">
      <div className="rd-head"><h3>预计资金变化<Info text={P.mode === 'fire' ? '“预计不靠工资”标记表示按你设的投入、收入和支出，资金第一次能用到规划终点的月份。“所需”已考虑之后计划存入的钱，表示各时点至少要有多少余额；“预计”表示按当前条件算出的资金变化。' : '退休标记显示开始取用资金的月份。“所需”表示各时点至少要有多少余额，才能支付计划中的退休开销直到规划终点。'}/></h3><span className="muted small">预测 · {points[0]?.label} → {endMonth}</span></div>
      <TrajectoryChart points={points} rows={rows} goalMonth={P.target_months} timeLabel={m => timeLabel(P, m)} fiMonth={fiMonth} retireMonth={retireMonth} tone={v.tone} fmt={fmt} valueLabel={valueModeLabel[mode]}/>
      <details className="rd-snapshot rd-milestone-details" aria-label="不同生活预算需要多少钱">
        <summary><strong>不同生活预算需要多少钱</strong><span className="muted small">按当前假设比较</span></summary>
      <div className={`rd-milestones${sameCoastFi ? ' merged' : ''}`}>{(sameCoastFi ? ms.filter(m => m.id !== 'coast') : ms).map(m => <div key={m.id} className={m.done ? 'done' : undefined}><span>{milestoneLabels[m.id]}{m.done && <em>已完成</em>}</span><strong>{compactYuan(m.amount)}</strong><small>{m.id === 'coast' ? '从现在不再额外存钱，按假设收益增长；仍需承担计划中的付款与取用。' : m.hint}</small>{sameCoastFi && m.id === 'fi' && <small>按当前显示精度，停止追加存钱与完整生活预算所需的资金相同，已合并展示。</small>}</div>)}</div>
      </details>
    </article>

    <Coverage calc={calc} mode={mode} basic={!!basic}/>
    {!hideSnapshot && <Snapshot mode={mode} rows={rows}/>}
    {!basic && <aside className="rd-disclaimer"><p>预测取决于你的假设，实际结果可能不同，不保证未来一定够用。</p></aside>}
  </div>;
}

/** 已计入的大额计划里付不起首付或买后储蓄不为正的：结论按先借后还算，不可靠，必须提醒。 */
function EventWarnings({ calc }: { calc: Ready }) {
  const warnings = useMemo(() => {
    if (!calc.plan0) return [];
    const emergency = calc.r.emergency_months * (calc.plan0.items[0]?.monthly_cents ?? 0), today = calc.plan.anchor_date ?? new Date().toISOString().slice(0, 10);
    return calc.events.filter(e => e.included && !calc.r.core?.occurrences.some(o => o.event_id === e.id)).flatMap(e => {
      const i = eventImpact(calc.plan0!, e, offsetOf(e.date, today), emergency), out: string[] = [];
      if (i.short > 0) out.push(`「${e.label}」在 ${e.date} 付不起首付：还差 ${yuan(i.short)}（含杂费与应急金线），结论按先借后还算。`);
      if (i.saving_not_positive) out.push(`「${e.label}」买后每月储蓄约 ${yuan(i.saving_after)}，不为正，要靠当时的收入支撑。`);
      return out;
    });
  }, [calc]);
  if (!warnings.length) return null;
  return <aside className="notice" role="status" aria-label="大额计划提醒"><strong>已计入的大额计划有不现实的地方，下面的结论不可靠：</strong>{warnings.map(w => <p key={w}>{w}</p>)}<p className="muted small">调整日期、首付或贷款，或到目标页暂时取消计入后再看。</p></aside>;
}

function Coverage({ calc, mode, basic }: { calc: Ready; mode: ValueMode; basic: boolean }) {
  const { plan: P, proj } = calc;
  const [view, setView] = useState<'at' | 'over'>('at');
  const start = proj.retire_month ?? Math.max(P.target_months, P.now_months), end = P.horizon_months - 1;
  const [pick, setPick] = useState<number | null>(null);
  const month = Math.min(end, Math.max(start, pick ?? start));
  const c = coverage(P, proj, month, mode), series = useMemo(() => coverageSeries(P, proj, mode), [P, proj, mode]);
  const fmt = (x: number) => yuan(x);
  return <article className="ui-card rd-card" aria-label="覆盖情况">
    <div className="rd-head"><div><p className="eyebrow">覆盖情况</p><h3>退休支出覆盖情况</h3></div>
      <Segments label="覆盖视图" value={view} options={[{ value: 'at', label: '退休时' }, { value: 'over', label: '随时间变化' }]} onChange={setView}/></div>
    {view === 'over' ? <>
      <p className="muted small">各颜色表示收入或资产提款承担的预算部分；未覆盖部分单独显示。金额显示方式：{valueModeLabel[mode]}；堆叠区域显示支出的资金来源，虚线为计划退休支出。</p>
      <CoverageChart series={series} fmt={fmt} valueLabel={valueModeLabel[mode]}/></> : <>
      <p className="rd-cov-caption">{c.calendar_month} 时的快照：计划 <strong>{fmt(c.spend)}/月</strong> 该时点的预算及各项资金贡献。</p>
      <label className="rd-slider"><span>查看月份</span><input type="range" aria-label="覆盖快照月份" min={start} max={end} value={month} onChange={e => setPick(Number(e.target.value))}/><b>{c.calendar_month}</b></label>
      <div className="rd-stack" role="img" aria-label={`${c.calendar_month} 时：收入 ${Math.round(c.pct.income)}%，从已有资金中取用 ${Math.round(c.pct.portfolio)}%，无资金支持 ${Math.round(c.pct.unfunded)}%`}>
        {c.segments.map((s, i) => <div key={s.key} className={`rd-seg ${s.kind}`} style={{ width: `${c.spend > 0 ? Math.min(100, (s.monthly / c.spend) * 100) : 0}%`, opacity: s.kind === 'income' ? Math.max(0.45, 1 - i * 0.2) : 1 }} title={`${s.kind === 'portfolio' ? '从已有资金中取用' : s.label}：${Math.round(c.spend > 0 ? (s.monthly / c.spend) * 100 : 0)}%`}/>)}
      </div>
      <p className="rd-stack-legend"><span><i className="income"/>收入 {Math.round(c.pct.income)}%</span><span><i className="portfolio"/>从已有资金中取用 {Math.round(c.pct.portfolio)}%</span><span><i className="unfunded"/>无资金支持 {Math.round(c.pct.unfunded)}%</span>
        {c.draw_rate !== null && <span className="rd-right">每年从已有资金中取用的比例：{rateText(Math.round(c.draw_rate * 10000))}<Info text="这一阶段每年取用的金额除以预计资金价值。只是参考比例，不会据此改变你的开销。"/></span>}</p>

      <div className="rd-schedules">
        <section><h4>支出计划表</h4><ul>{[...c.spend_items, ...c.flow_items].map(i => <li key={i.id} className={i.active ? undefined : 'inactive'}><span>{i.label}<small>{i.start} → {i.end}{i.active ? '' : ' · 未生效'}</small></span><i className="ui-tag">{i.essential ? '必需' : '灵活'}</i><b>{fmt(i.monthly)}/月</b></li>)}</ul></section>
        <section><h4>收入计划表</h4>{c.income_items.length === 0 ? <p className="muted small">{basic ? '这次没有计入退休收入；可在右侧「未来收入」里选择。' : '未配置未来收入，可在目标页填写官方测算结果或其他收入假设。'}</p> : <ul>{c.income_items.map(i => <li key={i.id} className={i.active ? undefined : 'inactive'}><span>{i.label}<small>{i.start} → {i.end}{i.active ? '' : ' · 未生效'}</small></span><b>{fmt(i.monthly)}/月</b></li>)}</ul>}</section>
      </div></>}
  </article>;
}

export function Snapshot({ mode, rows }: { mode: ValueMode; rows: ReturnType<typeof snapshotRows> }) {
  const hasAge = rows.some(r => r.age !== null), hasPeriod = rows.some(r => r.period !== null);
  return <details className="ui-card rd-card rd-snapshot rd-annual" aria-label="逐年快照" open>
    <summary><strong>逐年快照（{rows.length} 行）</strong><span className="muted small">{valueModeLabel[mode]} · 金额为该行期间合计</span></summary>
    <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="逐年快照表"><table className="ui-table rd-table"><thead><tr><th>{hasPeriod ? '期间' : '年份'}</th>{hasAge && <th>年龄</th>}<th>阶段</th><th className="amount">期末资产</th><th className="amount">投入</th><th className="amount">固定收入</th><th className="amount">计划支出</th><th className="amount">资产提取</th></tr></thead>
      <tbody>{rows.map(r => <Fragment key={r.start_month}><tr className={r.marks.length ? 'selected' : undefined}><td>{r.period ?? r.year}</td>{hasAge && <td>{r.age ?? '—'}</td>}<td>{r.retire_starts ? '积累 → 退休' : r.phase === 'retired' ? '退休' : '积累'}</td><td className="amount">{yuan(r.end)}</td><td className="amount">{yuan(r.contribution)}</td><td className="amount">{yuan(r.income)}</td><td className="amount">{yuan(r.spend)}</td><td className="amount">{yuan(r.withdrawal)}{r.unfunded > 0 && <small className="warn"> 缺 {yuan(r.unfunded)}</small>}</td></tr>
      {(r.unlock > 0 || r.oneoff > 0 || r.marks.length > 0) && <tr className="rd-year-detail"><td colSpan={hasAge ? 8 : 7}>{r.unlock > 0 || r.oneoff > 0 ? <details><summary>{r.period ?? r.year} · 特殊安排{r.marks.length > 0 ? ` · ${r.marks.join(' · ')}` : ''}</summary><dl className="plan-facts">{r.unlock > 0 && <div><dt>一次性解锁</dt><dd>{yuan(r.unlock)}</dd></div>}{r.oneoff > 0 && <div><dt>大额一次性支出</dt><dd>{yuan(r.oneoff)}</dd></div>}</dl></details> : <span>{r.period ?? r.year} · {r.marks.join(' · ')}</span>}</td></tr>}</Fragment>)}</tbody></table></div>
    <p className="muted small">每行从资金起点起汇总最多12个月，不是日历年；期末资产是该行结束时的余额。解锁、大额支出及里程碑可展开查看。</p>
  </details>;
}

export { scaleAt };
