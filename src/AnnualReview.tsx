import { useEffect, useMemo, useRef, useState } from 'react';
import { useFinanceSources } from './finance-data';
import { buildAnnualReview, annualCopyText } from './annual-review';
import { goalProgressVerdict } from './goal-progress';
import { money } from './asset';
import { Sparkline } from './Sparkline';
import type { RuntimeModules } from './modules';
import './review.css';

const hiddenPreference = () => { try { return localStorage.getItem('thingary.hide-financial-amounts.v1') === '1'; } catch { return false; } };
/** One completed, identity-checked source read supplies both the screen and copy preview. */
export function AnnualReview({ generation, today, modules }: { generation: string; today: string; modules: RuntimeModules }) {
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [hidden, setHidden] = useState(hiddenPreference);
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [copying, setCopying] = useState(false);
  const period = useMemo(() => ({ kind: 'year' as const, year }), [year]);
  const facts = useFinanceSources(generation, period, modules, 'annual');
  const sources = facts.load.status === 'ready' ? facts.load.sources : null;
  const model = sources ? buildAnnualReview(sources, year, sources.today) : null;
  const scope = JSON.stringify([generation, year, modules]);
  const snapshot = model ? `${scope}:${model.writeVersion}` : `${scope}:loading`;
  const includeAmounts = disclosure === snapshot;
  const preview = model ? annualCopyText(model, includeAmounts) : '';
  const active = useRef('');
  const copyIdentity = JSON.stringify([snapshot, includeAmounts, !!model]);
  active.current = copyIdentity;
  useEffect(() => { setDisclosure(null); setNotice(''); }, [scope]);
  const toggleHidden = () => {
    const next = !hidden; setHidden(next); setDisclosure(null); setNotice('');
    try { localStorage.setItem('thingary.hide-financial-amounts.v1', next ? '1' : '0'); } catch { /* visual preference only */ }
  };
  async function copy() {
    if (!model || copying || active.current !== copyIdentity) return;
    setCopying(true); setNotice('');
    try {
      await navigator.clipboard.writeText(preview);
      if (active.current === copyIdentity) setNotice('已复制预览中的摘要。');
    } catch { if (active.current === copyIdentity) setNotice('复制失败，请重试。'); }
    finally { setCopying(false); }
  }
  const years = model?.years ?? [year];
  const renderAmount = (cents: string | null) => cents === null ? '暂无完整金额' : hidden ? '金额已隐藏' : money(cents);
  const retry = <button type="button" onClick={facts.reload}>重新读取年度记录</button>;
  const changedYear = (value: number) => { setDisclosure(null); setNotice(''); setYear(value); };
  return <section className="stats-section wealth-section planning-section" aria-label="年度回顾">
    <div className="ui-section-head"><label>自然年 <select aria-label="年度回顾年份" value={year} onChange={e => changedYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y} 年</option>)}</select></label><button type="button" aria-pressed={hidden} onClick={toggleHidden}>{hidden ? '显示金融金额' : '隐藏金融金额'}</button></div>
    {facts.load.status === 'loading' ? <p role="status">正在读取同一年度的记录…</p> : facts.load.status === 'error' ? <p role="alert">年度记录读取失败。{retry}</p> : !model ? <p role="alert">年度来源与所选年份不一致，请重新读取。{retry}</p> : <>
      <p className="muted">{year} 年{model.currentYear ? ` · 截至 ${model.today}` : ''}。仅回顾已记录事实，不代表年度资料完整。</p>
      {model.yearsNote && <p role="alert">{model.yearsNote}{retry}</p>}
      <article className="ui-card ui-content"><h3>金融净资产</h3>
        {(model.net.status === 'ready' || model.net.status === 'empty') && <p>年内完整盘点 {model.net.completeCount} 次；另有 {model.net.incompleteCount} 次记录不完整。</p>}
        <p className="muted">{model.net.note}</p>
        {(model.net.status === 'error' || model.net.comparisonFailed) && retry}
        {model.net.to && <>
          <div className="ui-metrics">
            <article><span>{model.net.from?.date === model.net.to.date ? '实际盘点' : '实际起点'} {model.net.from?.date}</span><strong>{renderAmount(model.net.from?.net_cents ?? null)}</strong></article>
            {model.net.from?.date !== model.net.to.date && <article><span>实际终点 {model.net.to.date}</span><strong>{renderAmount(model.net.to.net_cents)}</strong></article>}
            <article><span>{model.net.label}</span><strong>{renderAmount(model.net.delta_cents)}</strong></article>
          </div>
          {hidden ? <p className="muted">金融曲线已隐藏。</p> : model.net.scopeChanged ? <p>期间范围发生变化，仅列实际盘点，不连接成连续曲线。</p> : model.net.segments.filter(s => s.length >= 2).map((segment, index) => <div className="review-nw" key={segment[0].snapshot_id}><p className="muted small">连续可比记录 {segment[0].date} 至 {segment.at(-1)!.date}{index ? '（与前段断开）' : ''}</p><Sparkline hero points={segment}/></div>)}
          <details><summary>实际盘点记录</summary><table className="ui-table"><thead><tr><th>日期</th><th>状态</th><th>金融净资产</th></tr></thead><tbody>{model.net.points.map(p => <tr key={p.snapshot_id}><td>{p.date}{p.date.slice(0, 4) !== String(year) ? '（年外起点）' : ''}</td><td>{p.complete ? p.scope_changed ? '完整 · 范围变化' : '完整' : '不完整 · 不连线'}</td><td>{p.complete ? renderAmount(p.net_cents) : '未知'}</td></tr>)}</tbody></table></details>
        </>}
      </article>
      <div className="ui-metrics ui-card">
        <article><span>已记录税后收入</span><strong>{model.income.count === 0 ? '没有记录' : renderAmount(model.income.cents)}</strong><em>{model.income.note}</em>{model.income.count > 0 && <><small>{model.income.count} 条记录</small><small>公积金缴存已知小计：{renderAmount(model.income.hpf_known_cents)}；{model.income.hpf_unknown_count} 条金额未知。</small></>}{model.income.status === 'error' && retry}</article>
        <article><span>已记录重要支出（退款前）</span><strong>{model.expenses.count === 0 && model.expenses.undatedCount === 0 ? '没有记录' : renderAmount(model.expenses.cents)}</strong><em>{model.expenses.note}</em>{model.expenses.count > 0 && <small>{model.expenses.count} 条记录；{model.expenses.unknownCount} 条金额未知。</small>}{model.expenses.refund_cents !== null && <small>退款：{renderAmount(model.expenses.refund_cents)}（单列）</small>}{model.expenses.sale_cents !== null && <small>售出回收：{renderAmount(model.expenses.sale_cents)}（单列）</small>}{model.expenses.undatedCount > 0 && <small>另有 {model.expenses.undatedCount} 条无法归年的记录，未计入本年。</small>}{model.expenses.status === 'error' && retry}</article>
      </div>
      <article className="ui-card ui-content"><h3>存钱目标 · 按当前目标设置回看</h3><p className="muted">{model.savings.note}</p>{model.savings.status === 'error' && retry}
        {model.savings.goals.map(goal => <section key={goal.id}><h4>{hidden ? goal.alias : goal.name}</h4><p>{goal.note}</p><p>建立于 {goal.created_on}；{goal.fromDate ? `起点 ${goal.fromDate}` : '起点盘点缺失'}；{goal.toDate ? `终点 ${goal.toDate}` : '年内终点盘点缺失'}。</p>
          <p>起点关联余额：{goal.from?.complete ? renderAmount(goal.from.known_cents) : '余额不完整或没有盘点'}；终点关联余额：{goal.to?.complete ? renderAmount(goal.to.known_cents) : '余额不完整或没有盘点'}。</p>
          {goal.to && <p>{!goal.to.complete ? `有 ${goal.to.missing} 个未知、${goal.to.unavailable} 个失效关联；不显示完整百分比或差额。` : hidden ? '进度已隐藏。' : `终点进度 ${((goal.to.percent_hundredths ?? 0) / 100).toFixed(2)}% · ${goal.to.reached ? '关联账户余额达标' : '余额尚未达标'}`}</p>}
          {goal.shared && <p className="muted">账户还关联其他目标；余额达标不代表多个目标可以同时兑现。</p>}
          {goal.planningOverlap === true && <p className="muted">可能与退休规划重复使用同一笔资金；目标不预留或扣减资金，也不调整规划。</p>}
        </section>)}
      </article>
      <article className="ui-card ui-content"><h3>当时记录的退休规划结论</h3><p>{model.planning.note}</p>{model.planning.status === 'error' && retry}
        {model.planning.count > 0 && <p>年内有效记录 {model.planning.count} 条，以下显示真实首末。</p>}
        {model.planning.first && [model.planning.first, ...(model.planning.last && model.planning.last.snapshot_id !== model.planning.first.snapshot_id ? [model.planning.last] : [])].map(row => <section key={row.snapshot_id}><p>盘点 {row.date} · 实际记录于 {row.recorded_on}{Number(row.recorded_on.slice(0, 4)) > year ? '（后来针对该盘点记录）' : ''}</p><p>{hidden ? '规划结果已隐藏' : goalProgressVerdict(row.point, money)}</p>{!hidden && <p className="muted small">{row.point.mode === 'fire' ? '财务自由' : '指定退休时间'} · 目标月份 {row.point.target_month ?? '未知'} · 可用资金 {money(row.point.available_cents)} · 需要每月存 {money(row.point.required_monthly_cents)} · 当时每月投入 {money(row.point.entered_monthly_cents)}{row.point.shortfall_at_goal_cents !== null ? ` · 目标时缺口 ${money(row.point.shortfall_at_goal_cents)}` : ''}</p>}{row.point.has_open_items && <p className="muted">该条结论有待确认条件。</p>}</section>)}
        {(model.planning.conditionsChanged || model.planning.openItems) && <p className="notice">规划模式、目标月份或待确认条件可能不同；并列显示原结论，不计算退休时间的归因变化。</p>}
      </article>
      <article className="ui-card ui-content"><h3>复制摘要预览</h3><p className="muted">默认隐私版；含金额版也使用目标别名，省略账户名称和自由文本。</p>
        <button type="button" aria-pressed={includeAmounts} disabled={copying} onClick={() => { setDisclosure(includeAmounts ? null : snapshot); setNotice(''); }}>{includeAmounts ? '恢复隐私预览' : hidden ? '在预览中显示金额' : '预览含金额摘要'}</button>
        <pre aria-label="年度摘要预览" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview}</pre>
        <button type="button" disabled={copying} onClick={() => void copy()}>{copying ? '复制中…' : '复制当前预览'}</button>{notice && <p role="status">{notice}</p>}
      </article>
      <details><summary>年度口径与记录限制</summary><p>净资产端点只取真实完整盘点；缺少年初或年末记录时只说明实际日期。净资产不是包含房产的家庭总资产。收入、重要支出与退款按原来源口径读取，各区块独立降级。</p><p>存钱目标按当前设置回看，余额达标不等于资金已经预留。退休规划是当时针对盘点留下的结论；旧记录没有引擎版本，不声称模型口径始终一致。</p></details>
    </>}
  </section>;
}
