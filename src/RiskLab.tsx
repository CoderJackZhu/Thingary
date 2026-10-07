import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, Segments } from './FormControls';
import { rateText } from './plan';
import { outcome, project } from './plan-ledger.ts';
import type { Plan } from './plan-ledger.ts';
import { ageSpendingMatrix, contributionReturnMatrix, largestRisk, monteCarlo, sorr, stressTests } from './plan-risk.ts';
import type { Cell, Matrix, MonteCarlo, SorrPath, StressResult } from './plan-risk.ts';
import { compactYuan, durationText, verdict } from './plan-view.ts';
import { FanChart, PathsChart } from './RetireCharts';
import { yuan } from './RetireOverview';
import { terminalText } from './planning-basic-view';
import './retire.css';

type Ready = { plan: Plan; assets: number };
/** Basic mode: an unsaved trial is labelled, and the terminal wording follows the complete-budget horizon. */
export type BasicRisk = { temporary: boolean; terminal: keyof typeof terminalText };

const ageText = (months: number | null) => (months === null ? '无法达成' : `${Math.floor(months / 12)} 岁`);
const sevText = { high: '高', medium: '中', low: '低' };

/** 假设分析：基准情形、压力测试、市场路径、决策矩阵与崩盘路径。全部用「今天的钱」。 */
export function RiskLab({ calc, today, basic }: { calc: Ready; today: string; basic?: BasicRisk }) {
  const P = calc.plan, year = Number(today.slice(0, 4)), fire = P.mode === 'fire';
  const base = useMemo(() => { const proj = project(P, year); return { proj, out: outcome(P, proj) }; }, [P, year]);
  const stress = useMemo(() => stressTests(P, year), [P, year]);
  const top = largestRisk(stress);
  const fmt = (c: number) => yuan(c);
  const v = verdict(P, base.proj, base.out, calc.assets, 'today', fmt);
  const [mc, setMc] = useState<MonteCarlo | null>(null), [running, setRunning] = useState<number | null>(null), [done, setDone] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMc(null); }, [P]);
  async function run(n: number) {
    setRunning(n); setDone(0);
    try { const r = await monteCarlo(P, n, { progress: d => { if (alive.current) setDone(d); } }); if (alive.current) setMc(r); }
    finally { if (alive.current) setRunning(null); }
  }
  const goalAge = Math.floor(P.target_months / 12), horizonAge = Math.floor(P.horizon_months / 12);
  const o = base.out, gap = o.shortfall_at_goal;
  const pctTone = mc ? (mc.success_rate >= 0.9 ? 'good' : mc.success_rate >= 0.75 ? 'watch' : 'bad') : '';
  return <div className="rl">
    {basic && <p className={`plan-basis ${basic.temporary ? 'temporary' : ''}`} role="status">{basic.temporary ? <span className="ui-tag warn">临时试算，未保存</span> : <span className="ui-tag">按已保存的预计投入</span>} 风险结果按完整预算、覆盖到规划终点；{terminalText[basic.terminal]}。</p>}
    <article className="ui-card rl-hero" aria-label="基准情形">
      <div className="rl-lead"><span>基准情形</span><strong>你的基础计划 <span className={`rd-badge ${v.tone}`}><i/>{v.badge}</span></strong>
        <small>{top ? `在这些测试中，${top.label}的影响最大${top.shortfall_delta > 0 ? `，退休缺口增加 ${fmt(top.shortfall_delta)}` : ''}${top.fi_delay_months ? `${top.shortfall_delta > 0 ? ' 和' : '，'}财务独立推迟 ${durationText(top.fi_delay_months)}` : ''}。` : '这些压力测试均未实质性改变你的基础计划。'}</small></div>
      <div><span>{fire ? '期望年龄' : '退休年龄'}</span><strong>{goalAge} 岁</strong><small>你的目标</small></div>
      <div><span>预计余额</span><strong>{fmt(o.assets_at_goal)}</strong><small>在 {goalAge} 岁时</small></div>
      <div><span>{fire ? '基准财务独立年龄' : '准备就绪年龄'}</span><strong>{ageText(o.fi_month)}</strong><small>{o.fi_month !== null && o.fi_month > P.target_months ? `比期望晚 ${durationText(o.fi_month - P.target_months)}` : '不晚于目标'}</small></div>
      <div><span>缺口/盈余</span><strong>{gap > 0 ? fmt(gap) + ' 缺口' : fmt(Math.max(0, o.assets_at_goal - o.required_at_goal)) + ' 盈余'}</strong><small>目标年龄时</small></div>
      <div><span>资金充足</span><strong className={`rl-pct ${pctTone}`}>{mc ? `${Math.round(mc.success_rate * 100)}%` : '未运行'}</strong><small>{mc ? `${mc.n.toLocaleString('zh-CN')} 条路径` : '见下方市场路径'}</small></div>
    </article>

    <Stress results={stress} fmt={fmt}/>

    <article className="ui-card rd-card" aria-label="市场路径">
      <div className="rd-head"><div><p className="eyebrow">市场路径</p><h3>资金够用的模拟路径占比是多少？</h3></div></div>
      <p className="muted small">我们根据你的假设模拟不同市场路径。阴影显示各年龄的第 10 至第 90 百分位区间；线条显示各路径的中位数，并非单一路径。收益取扣除通胀后的实际收益，围绕假设值按波动率 {rateText(P.volatility_hundredths)} 随机，每年一次，固定种子，同一计划每次结果一致。</p>
      <p className="muted small">{fire ? `「资金充足」表示计划实现财务独立、覆盖必需支出，并在 ${horizonAge} 岁前仍有余钱。` : `「资金充足」表示计划覆盖必需支出，并在 ${horizonAge} 岁前仍有余钱。`}这些是模型结果，不是现实概率。</p>
      <div className="rl-actions"><button type="button" className="primary" disabled={running !== null} onClick={() => void run(10000)}>{running === 10000 ? `正在运行… ${done}` : '运行 1 万条路径'}</button><button type="button" className="ui-btn" disabled={running !== null} onClick={() => void run(100000)}>{running === 100000 ? `正在运行… ${done.toLocaleString('zh-CN')}` : '运行 10 万条路径'}</button>
        {running !== null && <span className="muted small" role="status">正在测试多种可能的市场路径。运行完成后结果和扇形图将显示出来。</span>}</div>
      {mc ? <>
        <div className="rl-mc-stats">
          <div><span>资金充足</span><strong className={`rl-pct ${pctTone}`}>{Math.round(mc.success_rate * 100)}%</strong></div>
          <div><span>提取开始</span><strong>{base.proj.retire_month === null ? '—' : ageText(base.proj.retire_month)}</strong></div>
          <div><span>中位数财务独立年龄</span><strong>{ageText(mc.median_fi_month)}</strong></div>
          <div><span>较低结果</span><strong>{fmt(mc.final.p10)}</strong></div>
          <div><span>中位数</span><strong>{fmt(mc.final.p50)}</strong></div>
          <div><span>较高结果</span><strong>{fmt(mc.final.p90)}</strong></div>
        </div>
        <p className="muted small">较低结果、中位数、较高结果是 {horizonAge} 岁时剩余资金的第 10、50、90 百分位（今天的钱）。</p>
        <FanChart ages={mc.ages} bands={mc.bands} goalAge={P.target_months / 12} retireAge={base.proj.retire_month === null ? null : base.proj.retire_month / 12} fiAge={mc.median_fi_month === null ? null : mc.median_fi_month / 12} fmt={fmt} count={mc.n}/>
      </> : running === null && <p className="muted small">尚未运行市场路径。</p>}
    </article>

    <Moves P={P} year={year} fire={fire}/>
    <Crash P={P} year={year} fmt={fmt}/>
  </div>;
}

function Stress({ results, fmt }: { results: StressResult[]; fmt: (c: number) => string }) {
  return <article className="ui-card rd-card" aria-label="压力测试">
    <div className="rd-head"><div><p className="eyebrow">压力测试 · {results.length} 个情景</p><h3>什么可能破坏此计划？</h3></div></div>
    <div className="plan-table-scroll" tabIndex={0} role="region" aria-label="压力测试表"><table className="rl-stress"><thead><tr><th>情景</th><th>财务独立年龄</th><th className="amount">额外缺口</th><th className="amount">剩余资金</th><th>严重程度</th></tr></thead>
      <tbody>{results.map(r => {
        const noChange = r.fi_delay_months === 0 || r.fi_delay_months === null && r.stressed.fi_month === r.baseline.fi_month;
        return <tr key={r.id}><td><b>{r.label}</b><small>{r.description}</small></td>
          <td>{r.stressed.fi_month === null ? <span className="muted">未达成</span> : <>{ageText(r.stressed.fi_month)}</>}<small>{r.fi_delay_months ? (r.fi_delay_months < 0 ? `早 ${durationText(-r.fi_delay_months)}` : `晚 ${durationText(r.fi_delay_months)}`) : noChange ? '无变化' : r.baseline.fi_month === null ? '' : '未达成'}</small></td>
          <td className="amount">{r.shortfall_delta > 0 ? fmt(r.shortfall_delta) : '无变化'}{r.stressed.shortfall_month !== null && <small>缺口始于 {ageText(r.stressed.shortfall_month)}</small>}</td>
          <td className="amount">{fmt(Math.max(0, r.stressed.at_horizon))}<small>{r.horizon_delta === 0 ? '无变化' : `${r.horizon_delta < 0 ? '减少' : '增加'} ${fmt(Math.abs(r.horizon_delta))}`}</small>{r.stressed.failure_month !== null && <small>{ageText(r.stressed.failure_month)}时资金不足</small>}</td>
          <td><span className={`rl-sev ${r.severity}`}>{sevText[r.severity]}</span></td></tr>;
      })}</tbody></table></div>
    <p className="muted small">每个情景只改一件事，其余假设不变，用同一套计算重新推演。期末剩余资金在 FIRE 下可能因推迟退休而更多，所以请和财务独立年龄一起看。</p>
  </article>;
}

type Show = 'money' | 'age';
function Moves({ P, year, fire }: { P: Plan; year: number; fire: boolean }) {
  const [built, setBuilt] = useState<{ a: Matrix; b: Matrix } | null>(null), [busy, setBusy] = useState(false), [show, setShow] = useState<Show>('money');
  useEffect(() => { setBuilt(null); }, [P]);
  function build() { setBusy(true); setTimeout(() => { setBuilt({ a: contributionReturnMatrix(P, year), b: ageSpendingMatrix(P, year) }); setBusy(false); }, 0); }
  const ageLabel = fire ? '财务独立年龄' : '准备就绪年龄';
  return <article className="ui-card rd-card" aria-label="决策矩阵">
    <div className="rd-head"><div><p className="eyebrow">什么对计划影响最大？</p><h3>哪些因素影响计划？</h3></div>{built && <Segments label="矩阵数值" value={show} options={[{ value: 'money', label: '期末剩余资金' }, { value: 'age', label: ageLabel }]} onChange={setShow}/>}</div>
    <p className="muted small">比较储蓄、收益率、退休年龄和支出。绿色表示比基础计划更好，黄色表示更差。红色表示存在缺口或没有剩余资金；黑框是基础计划。</p>
    {!built ? <div className="empty"><h4>看看哪些改变最有帮助。</h4><p className="muted small">比较多储蓄、获得不同收益率、减少支出，或在不同年龄退休。</p><button type="button" className="primary" disabled={busy} onClick={build}>{busy ? '正在构建…' : '构建图表'}</button></div>
      : <div className="rl-matrices">
        <MatrixView title="供款 × 收益率" sub={show === 'money' ? '期末剩余资金，以今天的金额计' : ageLabel} m={built.a} show={show} rowText={d => rateText(P.r_before_hundredths + d)} colText={c => compactYuan(c)} rowHead="实际收益率" colHead="每月供款"/>
        <MatrixView title={`${fire ? '期望年龄' : '退休年龄'} × 支出`} sub={show === 'money' ? '期末剩余资金，以今天的金额计' : ageLabel} m={built.b} show={show} rowText={c => compactYuan(c)} colText={a => `${a}`} rowHead="每月支出" colHead={fire ? '期望年龄' : '退休年龄'} flatHint={fire}/>
      </div>}
  </article>;
}

function tone(cell: Cell, base: Cell, show: Show): string {
  if (show === 'age') return cell.fi_month === null ? 'bad' : base.fi_month === null ? 'good' : cell.fi_month < base.fi_month ? 'good' : cell.fi_month > base.fi_month ? 'watch' : '';
  if (cell.failed || cell.at_horizon <= 0) return 'bad';
  return cell.at_horizon > base.at_horizon + 1 ? 'good' : cell.at_horizon < base.at_horizon - 1 ? 'watch' : '';
}
function MatrixView({ title, sub, m, show, rowText, colText, rowHead, colHead, flatHint }: { title: string; sub: string; m: Matrix; show: Show; rowText: (v: number) => string; colText: (v: number) => string; rowHead: string; colHead: string; flatHint?: boolean }) {
  const base = m.cells[m.base_row ?? 0][m.base_col ?? 0];
  const flatCols = flatHint ? m.cols.map((_, j) => m.cells.every(r => r[j].fi_month === m.cells[0][j].fi_month)) : [];
  return <div><h4>{title}</h4><p className="muted small">{sub}</p>
    <table className="rl-matrix"><thead><tr><th>{rowHead} ＼ {colHead}</th>{m.cols.map(c => <th key={c}>{colText(c)}</th>)}</tr></thead>
      <tbody>{m.rows.map((r, i) => <tr key={r}><th scope="row">{rowText(r)}</th>{m.cells[i].map((c, j) => <td key={j} className={`${tone(c, base, show)}${i === m.base_row && j === m.base_col ? ' base' : ''}`}>{show === 'age' ? (c.fi_month === null ? '—' : ageText(c.fi_month).replace(' 岁', '')) : c.failed || c.at_horizon <= 0 ? '无' : compactYuan(c.at_horizon)}</td>)}</tr>)}</tbody></table>
    {flatCols.some(Boolean) && show === 'age' && <p className="muted small">有些年龄列变化不大：FIRE 下支出在计划实现财务独立时才开始。</p>}</div>;
}

function Crash({ P, year, fmt }: { P: Plan; year: number; fmt: (c: number) => string }) {
  const [paths, setPaths] = useState<SorrPath[] | null | undefined>(undefined);
  useEffect(() => { setPaths(undefined); }, [P]);
  const baseFinal = paths?.[0]?.final ?? 0;
  return <article className="ui-card rd-card" aria-label="崩盘路径">
    <div className="rd-head"><div><p className="eyebrow">高级检查</p><h3>早期市场崩盘路径</h3></div><button type="button" className="primary" onClick={() => setPaths(sorr(P, year))}>运行路径</button></div>
    <p className="muted small">测试退休期内的五种崩盘时点路径：第 1 年下跌、第 5 年下跌、两次下跌、失落的十年，与基准对比。</p>
    {paths === undefined ? <p className="muted small">检查崩盘时点风险。运行这五条路径，查看哪种序列会最先给计划带来压力。</p>
      : paths === null ? <p className="muted small">崩盘路径不可用。此检查需要退休开始时投资组合为正值，且规划期内已经达成退休。</p>
      : <><PathsChart paths={paths} fmt={fmt}/>
        <table className="rl-sorr"><thead><tr><th>情景</th><th>存续</th><th>最早缺口</th><th className="amount">{Math.floor(P.horizon_months / 12)} 岁余额</th></tr></thead>
          <tbody>{paths.map(p => <tr key={p.id}><td>{p.label}{p.id === 'base' && <span className="ui-tag">基准</span>}</td><td>{p.survived ? '资金够用' : <span className="warn">资金不足</span>}</td><td>{p.shortfall_age !== null ? `${p.shortfall_age} 岁` : p.failure_age !== null ? `${p.failure_age} 岁` : '无'}</td><td className="amount">{fmt(p.final)}{p.id !== 'base' && <small className="muted"> {p.final - baseFinal >= 0 ? '+' : '−'}{fmt(Math.abs(p.final - baseFinal))}</small>}</td></tr>)}</tbody></table></>}
  </article>;
}
