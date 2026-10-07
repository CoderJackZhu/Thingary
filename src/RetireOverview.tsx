import { useMemo, useState } from 'react';
import { money } from './asset';
import { Info, Segments } from './FormControls';
import { rateText } from './plan';
import type { RetireInputs } from './plan';
import type { LifeEvent } from './plan-events';
import type { Outcome, Plan, Projection } from './plan-ledger';
import { eventImpact, offsetOf } from './plan-events';
import { terminalText } from './planning-basic-view';
import { requiredSaving, stressTests, workSaving } from './plan-risk';
import { checkpoints, compactYuan, coverage, coverageSeries, durationText, milestones, progress, rangeRows, scaleAt, snapshotRows, trajectory, verdict } from './plan-view';
import type { Seg, ValueMode } from './plan-view';
import { CoverageChart, TrajectoryChart } from './RetireCharts';
import './retire.css';

export const yuan = (c: number) => money(String(Math.round(c)));

const storeKey = 'thingary.retire.valueMode';
export function useValueMode(): [ValueMode, (v: ValueMode) => void] {
  const [mode, set] = useState<ValueMode>(() => { try { return localStorage.getItem(storeKey) === 'nominal' ? 'nominal' : 'today'; } catch { return 'today'; } });
  return [mode, v => { set(v); try { localStorage.setItem(storeKey, v); } catch { /* 偏好存不下也不影响使用 */ } }];
}

export const valueModeLabel: Record<ValueMode, string> = { today: '现值', nominal: '名义值' };
export function ValueToggle({ value, onChange }: { value: ValueMode; onChange: (v: ValueMode) => void }) {
  return <span className="rd-toggle"><Segments label="金额口径" value={value} options={[{ value: 'today', label: '现值' }, { value: 'nominal', label: '名义值' }]} onChange={onChange}/>
    <Info text={value === 'today' ? '将未来的金额换算回今天的购买力，使金额与你当前的预算具有可比性。' : '显示计入通胀后的未来名义金额，这是你在未来那一年将看到的数字。'}/></span>;
}

const text = (segs: Seg[]) => segs.map((s, i) => s.strong ? <strong key={i}>{s.t}</strong> : <span key={i}>{s.t}</span>);

/** What the overview reads. The original plan passes its calc; the basic plan passes the shared prediction value. */
export type OverviewInput = { plan: Plan; proj: Projection; out: Outcome; assets: number; plan0?: Plan; events: LifeEvent[]; r: RetireInputs };
type Ready = OverviewInput;
/** Basic-mode context: where the contribution came from and how the horizon ends. Hides the original plan's income-change table. */
export type BasicOverview = { temporary: boolean; contribution: string; terminal: keyof typeof terminalText };

/** 概览主列：判词、进度、轨迹、里程碑、覆盖与逐年快照。 */
export function RetireOverview({ calc, mode, onMode, basic }: { calc: Ready; mode: ValueMode; onMode: (m: ValueMode) => void; basic?: BasicOverview }) {
  const { plan: P, proj, out } = calc, assets = calc.assets;
  const fmt = (c: number) => yuan(c);
  const v = verdict(P, proj, out, assets, mode, fmt), pr = progress(P, out, assets, mode);
  const ms = milestones(P, assets, mode);
  const points = useMemo(() => trajectory(P, proj, mode), [P, proj, mode]);
  const rows = useMemo(() => snapshotRows(P, proj, mode), [P, proj, mode]);
  const fiAge = proj.fi_month === null ? null : proj.fi_month / 12, retireAge = proj.retire_month === null ? null : proj.retire_month / 12;
  const endAge = Math.round(P.horizon_months / 12);
  return <div className="rd-main">
    <article className="ui-card rd-hero" aria-label="退休结论">
      <div className="rd-hero-top"><span className={`rd-badge ${v.tone}`}><i/>{v.badge}</span><ValueToggle value={mode} onChange={onMode}/></div>
      <h2 className="rd-verdict">{text(v.headline)}</h2>
      {v.sub.length > 0 && <p className="rd-sub">{text(v.sub)}</p>}
      <p className="rd-summary">{text(v.summary)}</p>
      <div className="rd-progress">
        <div className="rd-progress-row"><span>当前投资组合<b>{fmt(pr.now)}</b></span><span className="rd-right">{pr.goal_age} 岁时{P.mode === 'fire' ? '目标' : '所需'}<b>{fmt(pr.target)}</b><Info text={`根据计划的支出、收入、收益率与养老金假设，估算目标退休年龄所需的资金。以${valueModeLabel[mode]}显示。`}/></span></div>
        {pr.pct !== null ? <div className="rd-bar" role="img" aria-label={`已达标 ${Math.round(pr.pct)}%`}><div className={`rd-bar-fill ${v.tone}`} style={{ width: `${pr.pct}%` }}/>{pr.coast_pct !== null && pr.coast_pct > 0 && pr.coast_pct < 100 && <i className="rd-bar-coast" style={{ left: `${pr.coast_pct}%` }} title="Coast FIRE"/>}</div> : <p className="muted small">当前假设下无需额外资金。</p>}
        {pr.pct !== null && <p className="rd-progress-note">已达标 {Math.round(pr.pct)}%</p>}
      </div>
      {v.guidance && <p className={`rd-guidance ${v.tone}`}>{v.guidance}</p>}
    </article>

    {basic && <p className={`plan-basis ${basic.temporary ? 'temporary' : ''}`} role="status">{basic.temporary ? <span className="ui-tag warn">临时试算，未保存</span> : <span className="ui-tag">按已保存的预计投入</span>} 每月净投入 {money(basic.contribution)}（不含投资收益）；{terminalText[basic.terminal]}。</p>}
    <p className="muted small">资金起点：{P.anchor_date ?? '当前'} 收盘；现值金额基准：{P.monetary_basis_date ?? '当前'}。计划付款在月初核对，投入计入月末。</p>
    <EventWarnings calc={calc}/>
    {!basic && <Range calc={calc} mode={mode}/>}

    <article className="ui-card rd-card" aria-label="投资组合轨迹">
      <div className="rd-head"><h3>投资组合轨迹<Info text={P.mode === 'fire' ? '财务独立标记显示首个可持续的年龄。「所需」是在计入剩余计划供款后，每个年龄段所需的最低余额；「预计」是预计的投资组合路径。' : '退休标记显示提取开始的时间。「所需」是每个年龄段维持计划退休支出至规划终点所需的最低余额。'}/></h3><span className="muted small">预测 · {Math.round(points[0].age)} → {endAge} 岁</span></div>
      <TrajectoryChart points={points} rows={rows} goalAge={P.target_months / 12} fiAge={fiAge} retireAge={retireAge} tone={v.tone} fmt={fmt} valueLabel={valueModeLabel[mode]}/>
      <div className="rd-milestones">{ms.map(m => <div key={m.id} className={m.done ? 'done' : undefined}><span>{m.label}{m.done && <em>已完成</em>}</span><strong>{compactYuan(m.amount)}</strong><small>{m.hint}</small></div>)}</div>
    </article>

    <Coverage calc={calc} mode={mode} basic={!!basic}/>
    <Snapshot calc={calc} mode={mode} rows={rows}/>
    <aside className="rd-disclaimer"><strong>有一点需要记住</strong><p>预测取决于你的假设。实际结果可能不同。不构成财务建议。</p></aside>
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

/** 结果区间：基准与收入变化并排；收入是最大的不确定因素，这不是预测。 */
function Range({ calc, mode }: { calc: Ready; mode: ValueMode }) {
  const { plan: P, proj, out } = calc, fire = P.mode === 'fire';
  const rows = useMemo(() => rangeRows(P, stressTests(P, 0), out), [P, out]);
  const cps = useMemo(() => checkpoints(P, proj), [P, proj]);
  const back = useMemo(() => {
    const goal = requiredSaving(P, 0, P.target_months), first = cps.find(c => c.label === '储蓄下降前');
    return { goal, front: first ? { month: first.month, cents: requiredSaving(P, 0, first.month) } : null, now: workSaving(P) };
  }, [P, cps]);
  const k = (m: number) => scaleAt(P, mode, m);
  const age = (m: number | null) => (m === null ? '无法达成' : `${Math.floor(m / 12)} 岁${m % 12 ? ` ${m % 12} 个月` : ''}`);
  return <article className="ui-card rd-card" aria-label="结果区间">
    <div className="rd-head"><div><p className="eyebrow">区间</p><h3>收入变了会怎样<Info text="收入是最大的不确定因素，没人能预测哪年被裁或转行。这里把基准和几种收入变化并排，看结论会摇摆多大；你在「储蓄阶段」里设的每一段会直接进入基准。"/></h3></div></div>
    <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="收入变化对照表"><table className="ui-table rd-table"><thead><tr><th>情形</th><th>{fire ? '财务独立年龄' : '目标年龄时'}</th><th className="amount">{fire ? '相比基准' : '盈余／缺口'}</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id} className={r.id === 'base' ? 'selected' : undefined}><td>{r.label}</td>
        <td>{fire ? age(r.fi_month) : r.surplus >= 0 ? '资金够用' : '资金不够'}{r.failed && <span className="ui-tag warn">资金不足</span>}</td>
        <td className="amount">{fire ? (r.id === 'base' ? '—' : r.late_months === null ? '—' : r.late_months === 0 ? '无变化' : r.late_months < 0 ? `早 ${durationText(-r.late_months)}` : `晚 ${durationText(r.late_months)}`) : `${r.surplus >= 0 ? '+' : '−'}${compactYuan(Math.abs(r.surplus) * k(P.target_months))}`}</td></tr>)}</tbody></table></div>
    <div className="rd-checkpoints"><h4>反推：要存多少才够</h4>
      <p>{back.goal === null ? <>要在 <strong>{Math.floor(P.target_months / 12)} 岁</strong>达到目标，按当前假设，每月存到 100 万也不够，需要调整目标年龄、退休预算或大额计划。</> : back.goal === 0 ? <>要在 <strong>{Math.floor(P.target_months / 12)} 岁</strong>达到目标，按现有设置不用再存，已经够了。</> : <>要在 <strong>{Math.floor(P.target_months / 12)} 岁</strong>达到目标，从现在到那时<strong>每月至少存 {yuan(back.goal)}</strong>（今天的钱）；你有收入时的储蓄是 {yuan(back.now)}，{back.goal <= back.now ? '够。' : `还差 ${yuan(back.goal - back.now)}。`}</>}</p>
      {back.front && back.front.cents !== null && <p>若只在 <strong>{Math.floor(back.front.month / 12)} 岁</strong>以前集中存、之后沿用你设的更低储蓄：前期{back.front.cents === 0 ? '不用额外存。' : <>每月至少存 <strong>{yuan(back.front.cents)}</strong>。</>}</p>}
      {back.front && back.front.cents === null && <p>若只在 <strong>{Math.floor(back.front.month / 12)} 岁</strong>以前存，每月存到 100 万也不够，说明之后的低储蓄撑不住目标。</p>}
      <p className="muted small">这是反过来问：不预测收入，只看目标需要什么。数字按当前假设、最少需要的恒定金额算；真实收入起伏时，前期多存是最稳的办法。</p></div>
    {cps.length > 0 && <div className="rd-checkpoints"><h4>前期要存到多少</h4>
      {cps.map(c => <p key={c.month}>{c.label}，到 <strong>{Math.floor(c.month / 12)} 岁</strong>手里至少要有 <strong>{compactYuan(c.need * k(c.month))}</strong>，之后就算不再存钱也能按期退休；按计划那时预计有 <strong className={c.ok ? 'good' : 'warn'}>{compactYuan(c.expected * k(c.month))}</strong>{c.ok ? '，够。' : `，还差 ${compactYuan((c.need - c.expected) * k(c.month))}。`}</p>)}
      <p className="muted small">实际收益率接近 0 时钱不会自己增值，所以几乎等于全部所需资金：高收入期存下的钱是决定退休早晚的主要因素。</p></div>}
  </article>;
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
      <p className="muted small">收入和投资组合提取如何在整个退休期内覆盖计划支出。数值以{valueModeLabel[mode]}显示；堆叠区域显示支出的资金来源，虚线为计划退休支出。</p>
      <CoverageChart series={series} fmt={fmt} valueLabel={valueModeLabel[mode]}/></> : <>
      <p className="rd-cov-caption">{c.age} 岁时的快照：计划 <strong>{fmt(c.spend)}/月</strong> 支出与资金支持。未来项目保持可见，并在生效时计入。</p>
      <label className="rd-slider"><span>查看年龄</span><input type="range" aria-label="覆盖快照年龄" min={Math.ceil(start / 12)} max={Math.floor(end / 12)} value={c.age} onChange={e => setPick(Number(e.target.value) * 12)}/><b>{c.age} 岁</b></label>
      <div className="rd-stack" role="img" aria-label={`${c.age} 岁时：收入 ${Math.round(c.pct.income)}%，投资组合 ${Math.round(c.pct.portfolio)}%，无资金支持 ${Math.round(c.pct.unfunded)}%`}>
        {c.segments.map((s, i) => <div key={s.key} className={`rd-seg ${s.kind}`} style={{ width: `${c.spend > 0 ? Math.min(100, (s.monthly / c.spend) * 100) : 0}%`, opacity: s.kind === 'income' ? Math.max(0.45, 1 - i * 0.2) : 1 }} title={`${s.label}：${Math.round(c.spend > 0 ? (s.monthly / c.spend) * 100 : 0)}%`}/>)}
      </div>
      <p className="rd-stack-legend"><span><i className="income"/>收入 {Math.round(c.pct.income)}%</span><span><i className="portfolio"/>投资组合 {Math.round(c.pct.portfolio)}%</span><span><i className="unfunded"/>无资金支持 {Math.round(c.pct.unfunded)}%</span>
        {c.draw_rate !== null && <span className="rd-right">从投资组合提取：{rateText(Math.round(c.draw_rate * 10000))}/年<Info text="此年龄段的投资组合总提取额除以预计投资组合价值。仅供参考——它不设定你的支出。"/></span>}</p>
      {c.income_items.every(i => !i.active) && c.next_income_age !== null && <p className="muted small">{c.age} 岁时无生效收入；首笔收入始于 {c.next_income_age} 岁。</p>}
      <div className="rd-schedules">
        <section><h4>支出计划表</h4><ul>{[...c.spend_items, ...c.flow_items].map(i => <li key={i.id} className={i.active ? undefined : 'inactive'}><span>{i.label}<small>{i.start} → {i.end}{i.active ? '' : ' · 未生效'}</small></span><i className="ui-tag">{i.essential ? '必需' : '灵活'}</i><b>{fmt(i.monthly)}/月</b></li>)}</ul></section>
        <section><h4>收入计划表</h4>{c.income_items.length === 0 ? <p className="muted small">{basic ? '这次没有计入退休收入；可在右侧「退休收入」里选择。' : '未配置退休收入。国家养老金需先在养老金页填写个人资料。'}</p> : <ul>{c.income_items.map(i => <li key={i.id} className={i.active ? undefined : 'inactive'}><span>{i.label}<small>{i.start} → {i.end}{i.active ? '' : ' · 未生效'}</small></span><b>{fmt(i.monthly)}/月</b></li>)}</ul>}</section>
      </div></>}
  </article>;
}

function Snapshot({ calc, mode, rows }: { calc: Ready; mode: ValueMode; rows: ReturnType<typeof snapshotRows> }) {
  const { plan: P, proj } = calc, goal = Math.floor(P.target_months / 12), hasUnlock = rows.some(r => r.unlock > 0), hasOneoff = rows.some(r => r.oneoff > 0);
  const marks = new Map<number, string>([[goal, '目标']]);
  if (proj.fi_month !== null) marks.set(Math.floor(proj.fi_month / 12), (marks.get(Math.floor(proj.fi_month / 12)) ? marks.get(Math.floor(proj.fi_month / 12)) + ' · ' : '') + 'FI');
  if (proj.retire_month !== null) marks.set(Math.floor(proj.retire_month / 12), (marks.get(Math.floor(proj.retire_month / 12)) ? marks.get(Math.floor(proj.retire_month / 12)) + ' · ' : '') + '退休');
  return <article className="ui-card rd-card" aria-label="逐年快照">
    <div className="rd-head"><div><p className="eyebrow">表格</p><h3>逐年快照</h3></div><span className="muted small">金额按{valueModeLabel[mode]}</span></div>
    <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="逐年快照表"><table className="ui-table rd-table"><thead><tr><th>年龄</th><th>年份</th><th>阶段</th><th className="amount">期末投资组合</th><th className="amount">供款/年</th><th className="amount">退休收入/年</th>{hasUnlock && <th className="amount">一次性解锁</th>}{hasOneoff && <th className="amount">大额一次性</th>}<th className="amount">计划支出/年</th><th className="amount">投资组合提取/年</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.age} className={marks.has(r.age) ? 'selected' : undefined}><td>{r.age}{marks.has(r.age) && <span className="ui-tag">{marks.get(r.age)}</span>}</td><td>{r.year}</td><td>{r.phase === 'retired' ? '退休' : '积累'}</td><td className="amount">{yuan(r.end)}</td><td className="amount">{r.contribution ? yuan(r.contribution) : '—'}</td><td className="amount">{r.income ? yuan(r.income) : '—'}</td>{hasUnlock && <td className="amount">{r.unlock ? yuan(r.unlock) : '—'}</td>}{hasOneoff && <td className="amount">{r.oneoff ? yuan(r.oneoff) : '—'}</td>}<td className="amount">{r.spend ? yuan(r.spend) : '—'}</td><td className="amount">{r.withdrawal ? yuan(r.withdrawal) : '—'}{r.unfunded > 0 && <small className="warn"> 缺 {yuan(r.unfunded)}</small>}</td></tr>)}</tbody></table></div>
    <p className="muted small">国家养老金与收入流合并在「退休收入」；公积金与个人养老金在领取年龄一次性解锁，单列一栏。起点是当前盘点，逐月推演后按年汇总。</p>
  </article>;
}

export { scaleAt };
