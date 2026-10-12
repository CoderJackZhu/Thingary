// 决策报告只读展示组件（契约 docs/PLANNING_COMPONENT_CONTRACTS.md §3）。
// 完整与隐私输出都从同一份校验后的快照生成：隐私模式先 redactReport 脱敏，渲染只接触视图。
// 不读取数据库、不调用规划算法补字段；金额/比例只经 Money/Ratio 通道显示。
import { useEffect, useMemo, useState } from 'react';
import type { CurrentSummary, ReportInputV1, SeriesPoint, TrendModel } from './model.ts';
import {
  parseReportInput, redactReport, formatMoney, formatValue, formatRatio, goalResultText,
  basisLabel, sourceLabel, availabilityLabel, templateLabel, kindLabel, impactLabel, seriesKindLabel,
  dateLabel, trendModel, trendAriaLabel, copyText, printableHtml, reportConclusion,
  currentOutcomeLabel, currentModeLabel, currentNextStep,
} from './model.ts';

export type ReportOuter =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; code: string; message: string }
  | { status: 'ready'; input: unknown };

const seg = (on: boolean) => 'pr-seg' + (on ? ' on' : '');

/** 趋势图：预计连线、参考虚线、实际稀疏圆点不连线不插值。隐私视图金额已清空，不渲染曲线。 */
function TrendChart({ trend, privacy }: { trend: TrendModel; privacy: boolean }) {
  const points = useMemo(() => [...trend.projected, ...trend.actual].sort((a, b) => a.date < b.date ? -1 : 1), [trend]);
  const [cur, setCur] = useState<number | null>(null);
  if (privacy) return <p className="pr-muted">金额已隐藏，趋势图与逐点明细不显示。</p>;
  if (!points.length && !trend.reference.length) return <p className="pr-muted">暂无可显示的资金趋势。</p>;
  const W = 680, H = 200, PAD = 12;
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const x0 = day(trend.all[0].date), x1 = Math.max(day(trend.all.at(-1)!.date), x0 + 1);
  const values = points.map(p => Number(p.available!.cents));
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (d: string) => PAD + (day(d) - x0) / (x1 - x0) * (W - 2 * PAD);
  const y = (p: SeriesPoint) => H - 24 - (Number(p.available!.cents) - lo) / span * (H - 48);
  const line = (rows: SeriesPoint[]) => rows.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const shown = cur === null ? null : points[cur];
  const describe = (p: SeriesPoint) => `${p.date} ${seriesKindLabel(p.kind)}可用资金 ${formatMoney(p.available!)}`;
  return <>
    <div className="pr-chart" tabIndex={0} role="img" aria-label={trendAriaLabel(trend)}
      onFocus={() => setCur(points.length - 1)} onBlur={() => setCur(null)}
      onKeyDown={e => {
        if (e.key === 'ArrowRight') { e.preventDefault(); setCur(c => Math.min(points.length - 1, (c ?? -1) + 1)); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setCur(c => Math.max(0, (c ?? points.length) - 1)); }
        else if (e.key === 'Escape') { e.preventDefault(); setCur(null); }
      }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {trend.reference.length >= 2 && <path className="pr-line-ref" d={line(trend.reference)} />}
        {trend.projected.length >= 2 && <path className="pr-line-proj" d={line(trend.projected)} />}
        {trend.projected.map(p => <circle key={'p' + p.date} className="pr-dot-proj" cx={x(p.date)} cy={y(p)} r={2.6} />)}
        {trend.actual.map(p => <circle key={'a' + p.date} className={'pr-dot-act' + (shown === p ? ' on' : '')} cx={x(p.date)} cy={y(p)} r={4} />)}
        {shown && <line className="pr-guide" x1={x(shown.date)} x2={x(shown.date)} y1={4} y2={H - 4} />}
      </svg>
      {shown && <div className="pr-tip" style={{ left: `clamp(90px, ${x(shown.date) / W * 100}%, calc(100% - 90px))` }}>{describe(shown)}</div>}
    </div>
    <p className="pr-legend" aria-hidden="true"><i className="pr-sw proj" />预计 <i className="pr-sw act" />实际（仅完整盘点，不插值） <i className="pr-sw ref" />参考</p>
    <span className="visually-hidden" aria-live="polite" aria-atomic="true">{shown ? describe(shown) : ''}</span>
  </>;
}

export function PlanningReport({ outer, privacy, onPrivacyChange, allowPrint = true, incompleteHeadlineLabel }: { outer: ReportOuter; privacy: boolean; onPrivacyChange?: (p: boolean) => void; allowPrint?: boolean; incompleteHeadlineLabel?: '本报告保留部分结果，请结合缺项与未覆盖内容核对。' }) {
  const parsed = useMemo(() => outer.status === 'ready' ? parseReportInput(outer.input) : null, [outer]);
  const report: ReportInputV1 | null = parsed?.ok ? parsed.report : null;
  const view = useMemo(() => report ? (privacy ? redactReport(report) : report) : null, [report, privacy]);
  const [showTable, setShowTable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState('');
  useEffect(() => { setCopied(false); setCopyError(''); }, [privacy, outer]);

  if (outer.status === 'loading') return <div className="pr-state" aria-busy="true" role="status">报告读取中…</div>;
  if (outer.status === 'empty') return <div className="pr-state" role="status"><h3>尚未选择报告内容</h3><p className="pr-muted">从当前方案、某份基准或两份比较生成报告后，在此预览。</p></div>;
  if (outer.status === 'error') return <div className="pr-state pr-error" role="alert"><h3>报告读取失败</h3><p>{privacy ? '请在来源处重试，详细错误已隐藏。' : outer.message}</p><p className="pr-muted">错误码：{privacy ? '已隐藏' : outer.code}。读取失败与输入不完整是两种状态，可在来源处重试。</p></div>;
  if (parsed && !parsed.ok) return <div className="pr-state pr-error" role="alert"><h3>报告输入无法识别</h3><p className="pr-muted">错误码：{parsed.code}</p><ul>{parsed.issues.slice(0, 8).map(i => <li key={i.path + i.code}>{i.path || '（根）'}：{privacy ? '字段无效，请在完整视图核对。' : i.message}</li>)}</ul></div>;
  if (!view) return null;

  const trend = trendModel(view.series);
  const summary: CurrentSummary | null = view.current_summary ?? null;
  const incomplete = summary ? summary.outcome === 'incomplete' : report!.headline.status === 'incomplete';
  const shownConclusion = !summary && incomplete && incompleteHeadlineLabel ? incompleteHeadlineLabel : reportConclusion(view);
  const hasTrend = trend.projected.length + trend.actual.length + trend.reference.length > 0;
  // 当前报告没有接入逐月数据时不占空区；基线／比较保持原兼容。
  const showTrend = hasTrend || view.kind !== 'current';
  const impactItems = summary ? view.missing.filter(m => m.impact === 'blocks_headline') : [];
  const estimatedText = (s: CurrentSummary) => s.contribution_direction === 'withdrawal' ? `${formatMoney(s.estimated_contribution)}（取用，不计为储蓄）` : formatMoney(s.estimated_contribution);
  const differenceText = (s: CurrentSummary) => s.contribution_direction === 'withdrawal' ? '取用不计差额' : formatMoney(s.difference);
  const doCopy = async () => {
    if (copying) return;
    const copiedText = copyText(report!, privacy);
    const text = !summary && incomplete && incompleteHeadlineLabel ? copiedText.replace('关键资料缺失，无法给出完整结论。', incompleteHeadlineLabel) : copiedText;
    setCopying(true); setCopied(false); setCopyError('');
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { setCopyError('复制失败，请重试。'); }
    finally { setCopying(false); }
  };
  const doPrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(printableHtml(report!, { privacy }));
    win.document.close();
  };

  return <div className="planning-report">
    <header className="pr-head">
      <div className="pr-head-main">
        <span className="pr-kind">{kindLabel(view.kind)}报告</span>
        <h2 className="pr-title">{view.subject_name}{view.other_name ? ` vs ${view.other_name}` : ''}</h2>
        <p className="pr-meta">
          起点日 {dateLabel(view.source_date)} · 生成日 {dateLabel(view.generated_on)} · 金额基准 {dateLabel(view.monetary_basis_date)}
          {view.scenario_revision !== null && <> · {view.kind === 'current' ? '规划' : '方案'}修订 {view.scenario_revision}</>} · 模型版本 {view.model_version ?? '未知'}
        </p>
      </div>
      <div className="pr-actions">
        {onPrivacyChange && <button type="button" className="pr-toggle-amount" aria-pressed={!privacy} disabled={copying} onClick={() => onPrivacyChange(!privacy)}>{privacy ? '显示金额' : '隐藏金额'}</button>}
        {onPrivacyChange && <div className="pr-segmented" role="group" aria-label="报告版本">
          <button type="button" className={seg(!privacy)} aria-pressed={!privacy} disabled={copying} onClick={() => onPrivacyChange(false)}>完整</button>
          <button type="button" className={seg(privacy)} aria-pressed={privacy} disabled={copying} onClick={() => onPrivacyChange(true)}>隐私</button>
        </div>}
        <button type="button" className="pr-btn" disabled={copying} onClick={doCopy}>{copying ? '复制中…' : copied ? '已复制' : '复制摘要'}</button>
        {allowPrint && <button type="button" className="pr-btn" onClick={doPrint}>打印版</button>}
      </div>
    </header>
    {copyError && <p className="pr-error" role="alert">{copyError}</p>}
    {copied && <p className="pr-muted" role="status">摘要已复制。</p>}

    {view.status === 'partial' && !summary && <p className="pr-banner" role="status">本报告输入不完整或展示范围有限；未知不等于零，未覆盖内容见下方说明。</p>}

    <section className="pr-card pr-conclusion" aria-label="结论">
      {summary && <p className="pr-outcome"><span className="pr-outcome-label">当前结论</span>{currentOutcomeLabel(summary.outcome)} · {currentModeLabel(summary.mode)}</p>}
      <p className="pr-headline">{shownConclusion}</p>
      <p className="pr-muted">{summary ? currentNextStep(summary) : <>下一步：{view.next_step.label}{view.next_step.detail ? `（${view.next_step.detail}）` : ''}</>}</p>
    </section>

    {summary && <section className="pr-card" aria-label="关键结果">
      <h3 className="pr-h">关键结果</h3>
      <div className="pr-results">
        <div className="pr-result"><span className="pr-result-label">所需月投入</span><span className="pr-result-value pr-num">{formatMoney(summary.required_contribution)}</span></div>
        <div className="pr-result"><span className="pr-result-label">预计月投入</span><span className="pr-result-value pr-num">{estimatedText(summary)}</span></div>
        <div className="pr-result"><span className="pr-result-label">差额（预计 − 所需）</span><span className="pr-result-value pr-num">{differenceText(summary)}</span></div>
        <div className="pr-result"><span className="pr-result-label">终点预计可用资金</span><span className="pr-result-value pr-num">{formatMoney(summary.terminal_available)}</span></div>
      </div>
    </section>}

    {summary && impactItems.length > 0 && <section className="pr-card" aria-label="影响结论的事项">
      <h3 className="pr-h">影响结论的事项</h3>
      <ul className="pr-missing">{impactItems.map(m => <li key={m.id}>
        <span className={'pr-impact ' + m.impact}>{impactLabel(m.impact)}</span>{m.label}
        {m.hint && <span className="pr-muted"> · {m.hint}</span>}
      </li>)}</ul>
    </section>}

    {summary && <section className="pr-card" aria-label="主要条件摘要">
      <h3 className="pr-h">主要条件摘要</h3>
      <table className="pr-table"><tbody>
        <tr><th>目标月</th><td>{dateLabel(summary.target_month)}</td></tr>
        <tr><th>预测终点</th><td>{dateLabel(summary.horizon_month)}</td></tr>
        <tr><th>{summary.mode === 'fire' ? '预计达成月' : '预计退休月'}</th><td>{dateLabel(summary.expected_retirement_month)}</td></tr>
        <tr><th>可用资金</th><td className="pr-num">{formatMoney(summary.available_funds)}</td></tr>
        <tr><th>完整生活预算／月</th><td className="pr-num">{formatMoney(summary.budget)}</td></tr>
        <tr><th>目标前实际年收益</th><td>{summary.before_return ? formatRatio(summary.before_return) : '未知'}</td></tr>
        <tr><th>目标后实际年收益</th><td>{summary.after_return ? formatRatio(summary.after_return) : '未知'}</td></tr>
      </tbody></table>
    </section>}

    {summary && view.status === 'partial' && <p className="pr-muted pr-scope-note">本报告展示当前已保存条件的结果；逐月趋势、逐项购买结果与历史实际对照请到计算详情查看。</p>}
    <section className="pr-card" aria-label="资金范围">
      <h3 className="pr-h">资金范围</h3>
      <table className="pr-table">
        <thead><tr><th>名称</th><th>可用性</th><th>金额</th><th>依据</th><th>备注</th></tr></thead>
        <tbody>{view.funds.map(f => <tr key={f.id}>
          <td>{f.name}</td><td>{availabilityLabel(f.availability)}</td>
          <td className="pr-num">{formatMoney(f.amount)}</td><td>{basisLabel(f.amount.basis)}</td>
          <td>{f.note ?? <span className="pr-muted">—</span>}</td>
        </tr>)}</tbody>
      </table>
    </section>

    {view.goals.length > 0 && <section className="pr-card" aria-label="目标结果">
      <h3 className="pr-h">目标结果</h3>
      <table className="pr-table">
        <thead><tr><th>目标</th><th>类型</th><th>日期</th><th>结果</th><th>缺项</th></tr></thead>
        <tbody>{view.goals.map(g => <tr key={g.id}>
          <td>{g.name}</td><td>{templateLabel(g.template)}</td><td>{dateLabel(g.date)}</td>
          <td>{goalResultText(g)}</td>
          <td>{g.missing.length ? g.missing.join('；') : <span className="pr-muted">—</span>}</td>
        </tr>)}</tbody>
      </table>
    </section>}

    {showTrend && <section className="pr-card" aria-label="资金趋势">
      <h3 className="pr-h">资金趋势
        {!privacy && (trend.projected.length + trend.actual.length + trend.reference.length > 0) &&
          <button type="button" className="pr-link" aria-expanded={showTable} onClick={() => setShowTable(v => !v)}>{showTable ? '收起数据表' : '查看数据表'}</button>}
      </h3>
      <TrendChart trend={trend} privacy={privacy} />
      {showTable && !privacy && <table className="pr-table">
        <thead><tr><th>日期</th><th>种类</th><th>可用资金</th><th>受限资金</th><th>债务</th></tr></thead>
        <tbody>{trend.all.map(s => <tr key={s.kind + s.date}>
          <td>{s.date}</td><td>{seriesKindLabel(s.kind)}</td>
          <td className="pr-num">{s.available ? formatMoney(s.available) : '—'}</td>
          <td className="pr-num">{s.restricted ? formatMoney(s.restricted) : '—'}</td>
          <td className="pr-num">{s.debt ? formatMoney(s.debt) : '—'}</td>
        </tr>)}</tbody>
      </table>}
    </section>}

    <details className="pr-card pr-details">
      <summary>计算依据（{view.assumptions.length} 项）</summary>
      <table className="pr-table">
        <thead><tr><th>项目</th><th>值</th><th>来源</th><th>确认日</th></tr></thead>
        <tbody>{view.assumptions.map(a => <tr key={a.id}>
          <td>{a.label}</td><td>{formatValue(a.value)}</td><td>{sourceLabel(a.source)}</td><td>{dateLabel(a.confirmed_on)}</td>
        </tr>)}</tbody>
      </table>
    </details>

    {view.kind === 'comparison' && view.differences.length > 0 && <section className="pr-card" aria-label="方案差异">
      <h3 className="pr-h">方案差异</h3>
      <table className="pr-table">
        <thead><tr><th>项目</th><th>方案 A</th><th>方案 B</th><th>差额</th><th>依据</th></tr></thead>
        <tbody>{view.differences.map(d => <tr key={d.id}>
          <td>{d.label}</td><td>{formatValue(d.current)}</td><td>{formatValue(d.other)}</td>
          <td className="pr-num">{d.delta ? formatMoney(d.delta) : <span className="pr-muted">不可比</span>}</td>
          <td>{d.note ?? <span className="pr-muted">—</span>}</td>
        </tr>)}</tbody>
      </table>
      <p className="pr-muted">差额仅展示已确认结果，不作因果归因。</p>
    </section>}

    {view.missing.length > 0 && <section className="pr-card" aria-label="缺项与未覆盖">
      <h3 className="pr-h">缺项与未覆盖</h3>
      <ul className="pr-missing">{view.missing.map(m => <li key={m.id}>
        <span className={'pr-impact ' + m.impact}>{impactLabel(m.impact)}</span>{m.label}
        {m.hint && <span className="pr-muted"> · {m.hint}</span>}
      </li>)}</ul>
    </section>}
  </div>;
}
