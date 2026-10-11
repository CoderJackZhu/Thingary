import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildBasicCapabilities } from '../plan-basic';
import type { PlanningSources } from '../plan-basic-contract';
import type { StoredProfile } from '../plan';
import { forecastMoney } from '../plan-format';
import { requirementLine, missingText } from '../planning-basic-view';
import '../theme.css';
import './preview.css';

// Development-only fixture: no IPC, local storage or profile save commands.
const url = new URL(location.href);
for (const [key, value] of Object.entries({ 'plan-basic': 'beijing-complete', 'plan-core': 'confirmed', capabilities: 'real' })) url.searchParams.set(key, value);
history.replaceState(null, '', url);
const { wealthPreview } = await import('../wealth-preview');
const initial = structuredClone(wealthPreview('planning_sources', {})!.value as PlanningSources);
function profile(s: PlanningSources): StoredProfile {
  if (s.profile.status !== 'ready' || !s.profile.value.saved) throw new Error('原型样例缺少资料');
  return s.profile.value.saved.profile;
}
type Section = 'time' | 'spend' | 'funds' | 'saving' | 'income' | 'cost' | 'assumptions' | 'medical';
const names: Record<Section, string> = { time: '退休时间', spend: '退休生活费', funds: '现在可用的钱', saving: '退休前每月存钱', income: '退休后收入', cost: '退休后继续缴社保', assumptions: '计算假设', medical: '退休医保' };
const exactMoney = (n: string | null | undefined) => n == null ? '还没填' : `¥${(Number(n) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
const yuan = (n: string | null | undefined) => n == null ? '' : String(Number(n) / 100);
const cents = (v: FormDataEntryValue | null) => v === null || String(v).trim() === '' ? null : String(Math.round(Number(v) * 100));

function App() {
  const [sources, setSources] = useState(initial);
  const [editing, setEditing] = useState<Section | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [scenario, setScenario] = useState('normal');
  useEffect(() => { if (editing) document.querySelector<HTMLInputElement | HTMLSelectElement>(`#row-${editing} form input, #row-${editing} form select`)?.focus(); }, [editing]);
  const p = profile(sources), r = p.retire, b = r.basic!;
  const cap = useMemo(() => buildBasicCapabilities(sources), [sources]);
  const req = cap.requirement.status === 'ready' ? cap.requirement.value.set : null;
  const annotations = (cap.annotations ?? []).filter(a => a.actionable !== false && a.effect !== 'none');
  const difference = req && 'monthly_cents' in req && b.contribution.monthly_cents !== null && Number(b.contribution.monthly_cents) >= 0 ? Number(b.contribution.monthly_cents) - Number(req.monthly_cents) : null;
  const pension = cap.pension.status === 'ready' ? cap.pension.value : null;
  const funds = cap.funds.status === 'ready' ? cap.funds.value : null;
  const cost = b.retirement_contribution_cost;
  const missing = cap.requirement.status === 'blocked' ? cap.requirement.missing : [];
  const medicalPending = annotations.some(a => a.reason_code === 'MEDICAL_FACTS_UNKNOWN' || a.reason_code === 'MEDICAL_YEARS_SHORT');
  const next: Section = missing.length ? (!p.birth_month || r.target_age === null ? 'time' : r.spend_cents === null ? 'spend' : !funds ? 'funds' : 'income') : annotations.some(a => a.reason_code === 'PENSION_COST_UNCONFIRMED') ? 'cost' : medicalPending ? 'medical' : b.contribution.monthly_cents === null ? 'saving' : 'assumptions';
  const nextCopy = next === 'cost' ? '确认退休后交社保的钱从哪来' : next === 'medical' && medicalPending && !missing.length ? '核对医保缴费年限' : next === 'saving' ? '填一下你估计每月能存多少钱' : missing.length ? `先补充${names[next]}` : '比较一组不同的计算假设';
  function open(id: Section) { setEditing(id); setError(''); setNotice(''); requestAnimationFrame(() => document.querySelector(`#row-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }
  function reset(value: string) {
    const s = structuredClone(initial), x = profile(s);
    if (value === 'unknown') x.retire.basic!.contribution.monthly_cents = null;
    if (value === 'empty') { x.birth_month = null; x.retire.target_age = null; x.retire.spend_cents = null; x.retire.basic!.contribution.monthly_cents = null; }
    setSources(s); setScenario(value); setEditing(null); setError(''); setNotice('');
  }
  function save(event: React.FormEvent<HTMLFormElement>, id: Section) {
    event.preventDefault();
    const data = new FormData(event.currentTarget), s = structuredClone(sources), x = profile(s), t = x.retire, base = t.basic!;
    if (id === 'time') { x.birth_month = String(data.get('birth')) || null; t.target_age = Number(data.get('age')); t.horizon_age = Number(data.get('horizon')); }
    if (id === 'spend') t.spend_cents = cents(data.get('amount'));
    if (id === 'saving') base.contribution.monthly_cents = cents(data.get('amount'));
    if (id === 'funds') base.start = { kind: 'simulation', id: 'goal-prototype-funds', available_cents: cents(data.get('amount')), date: String(data.get('date')) || null, notes: '虚构交互原型' };
    if (id === 'income') {
      base.retirement_income.mode = data.get('mode') === 'employee' ? 'employee' : 'excluded';
    }
    if (id === 'medical') {
      for (const key of ['medical_paid_months', 'medical_local_paid_months', 'medical_local_required_months'] as const) x[key] = String(data.get(key) ?? '').trim() === '' ? null : Number(data.get(key));
    }
    if (id === 'cost') {
      base.retirement_contribution_cost = { treatment: data.get('treatment') as 'extra' | 'included' | 'excluded' | 'unknown', monthly_cents: cents(data.get('amount')), stop_month: String(data.get('stop')) || null };
      const c = base.retirement_contribution_cost;
      if (['extra', 'included'].includes(c.treatment) && (c.monthly_cents === null || !c.stop_month)) { setError('请填写每月自己承担的金额和结束月份；不知道时可以选“还不确定”。'); return; }
    }
    if (id === 'assumptions') { t.real_return_before_hundredths = Math.round(Number(data.get('before')) * 100); t.real_return_after_hundredths = Math.round(Number(data.get('after')) * 100); x.assumptions.inflation_hundredths = Math.round(Number(data.get('inflation')) * 100); }
    const result = buildBasicCapabilities(s);
    const invalid = result.requirement.status === 'blocked' ? result.requirement.missing.filter(m => m.kind === 'constraint') : [];
    if (invalid.length) { setError(invalid.map(m => m.message).join(' ')); return; }
    setSources(s); setEditing(null); setError('');
    const resultText = result.requirement.status === 'ready' ? requirementLine(result.requirement.value.set, forecastMoney).text : '还需要补充其他条件';
    setNotice(`${names[id]}已用于本页试算。更新后：${resultText}。`);
    requestAnimationFrame(() => document.getElementById(`edit-${id}`)?.focus());
  }
  const numberField = (label: string, name: string, value: string | number, min: number, max: number, optional = false) => <label>{label}<input name={name} type="number" min={min} max={max} step={name === 'age' || name === 'horizon' || name.startsWith('medical_') ? '1' : '0.01'} defaultValue={value} required={!optional}/></label>;
  function editor(id: Section) {
    return <form className="editor" onSubmit={e => save(e, id)} onKeyDown={e => { if (e.key === 'Escape') { setEditing(null); requestAnimationFrame(() => document.getElementById(`edit-${id}`)?.focus()); } }}>
      <div className="fields">
        {id === 'time' && <><label>出生年月<input name="birth" type="month" defaultValue={p.birth_month ?? ''} required autoFocus/></label>{numberField('几岁起不再工作', 'age', r.target_age ?? '', 18, 100)}{numberField('生活费安排到几岁', 'horizon', r.horizon_age, 19, 120)}</>}
        {(id === 'spend' || id === 'saving') && numberField(id === 'spend' ? '每月生活费（元，按现在物价）' : '每月能存（元，留空表示不知道；负数表示取用）', 'amount', yuan(id === 'spend' ? r.spend_cents : b.contribution.monthly_cents), id === 'spend' ? 1 : -1000000, 1000000, id === 'saving')}
        {id === 'funds' && <>{numberField('用于这次试算的金额（元）', 'amount', yuan(funds?.available_cents), 0, 1000000000)}<label>这笔钱的截至日期<input name="date" type="date" defaultValue={funds?.date ?? sources.today} required/></label><p>应用后改用模拟金额，不改账户盘点；公积金等受限资金不能直接加进来。</p></>}
        {id === 'income' && <><label>本次计算<select name="mode" defaultValue={b.retirement_income.mode ?? 'excluded'}><option value="employee">计入职工养老金估算</option><option value="excluded">暂不计退休收入</option></select></label><p>此原型复用北京虚构社保资料：已缴 {p.paid_months ?? '未知'} 个月，个人账户 {exactMoney(p.account_balance_cents)}，月缴费基数 {exactMoney(b.pension_contributions.base_cents)}。缴费从 {b.pension_contributions.start_month} 至 {b.pension_contributions.stop_month} 前。社保事实的完整编辑仍在现有养老金页。</p></>}
        {id === 'medical' && <><p>医保年限与养老年限不同。以下按月填写，不知道可留空。</p>{numberField('医保累计缴费月数', 'medical_paid_months', p.medical_paid_months ?? '', 0, 1200, true)}{numberField('医保本地实际缴费月数', 'medical_local_paid_months', p.medical_local_paid_months ?? '', 0, 1200, true)}{numberField('本地要求实际缴费月数', 'medical_local_required_months', p.medical_local_required_months ?? '', 0, 1200, true)}</>}
        {id === 'cost' && <><label>缴费怎么安排<select name="treatment" defaultValue={cost?.treatment ?? 'unknown'}><option value="unknown">还不确定，暂未计入</option><option value="extra">生活费之外另外支付</option><option value="included">已包含在每月生活费里</option><option value="excluded">这次明确不计入</option></select></label>{numberField('每月自己承担的费用（元）', 'amount', yuan(cost?.monthly_cents), 0, 1000000, true)}<label>缴费结束月份（该月起不再支付）<input type="month" name="stop" defaultValue={cost?.stop_month ?? b.pension_contributions.stop_month ?? ''}/></label><p>从不工作后开始计算。费用结束时间与养老金缴费安排需要一致；“已包含”不会再加一次。</p></>}
        {id === 'assumptions' && <>{numberField('退休前实际年收益（%）', 'before', r.real_return_before_hundredths / 100, -8, 18)}{numberField('退休后实际年收益（%）', 'after', r.real_return_after_hundredths / 100, -8, 18)}{numberField('年通胀（%）', 'inflation', p.assumptions.inflation_hundredths / 100, 0, 10)}<p>实际收益已扣除通胀。0% 表示购买力不变，并不是银行利息为零；这是假设，不是收益承诺。</p></>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions"><button className="primary" type="submit">应用到本页试算</button><button type="button" onClick={() => { setEditing(null); document.getElementById(`edit-${id}`)?.focus(); }}>取消</button></div>
    </form>;
  }
  const rows: { id: Section; value: string; description: string; state: string }[] = [
    { id: 'time', value: r.target_age === null ? '还没选退休年龄' : `${r.target_age} 岁不再工作 · 安排到 ${r.horizon_age} 岁`, description: `出生年月 ${p.birth_month ?? '还没填'}。不工作、停止缴费、开始领养老金是三个不同时间。`, state: r.target_age === null ? '待填写' : '你设定的目标' },
    { id: 'spend', value: `${exactMoney(r.spend_cents)}${r.spend_cents === null ? '' : ' / 月'}`, description: '按现在物价填写退休后的日常生活费；社保缴费是否包含，见下方单独一项。', state: r.spend_cents === null ? '待填写' : '你估计的预算' },
    { id: 'funds', value: funds ? exactMoney(funds.available_cents) : '还不能确定', description: funds ? `${funds.date} 截至金额。另有受限资金 ${exactMoney(funds.restricted_cents)}，不作为现在可用的钱。` : '选择能用于退休生活的钱，或填写一个模拟金额。', state: b.start.kind === 'live' ? '来自虚构盘点' : '模拟金额' },
    { id: 'saving', value: b.contribution.monthly_cents === null ? '还没估计' : `${exactMoney(b.contribution.monthly_cents)} / 月`, description: '从现在到不工作之前，扣除日常开支和缴费后，预计每月净存入多少。', state: b.contribution.monthly_cents === null ? '可稍后填' : '你估计的投入' },
    { id: 'income', value: pension?.included ? `养老金约 ${forecastMoney(pension.monthly_cents)} / 月` : b.retirement_income.mode === 'excluded' ? '暂不计退休收入' : '养老金资料待补充', description: pension?.included ? `${pension.start_month} 起领取。预计缴费至 ${b.pension_contributions.stop_month} 前，领钱前的生活仍靠存款。` : '养老金属于退休后的收入，不会从停止工作那天自动到账。', state: pension?.included ? '已计入 · 估算' : '未计入' },
    { id: 'cost', value: !cost || cost.treatment === 'unknown' ? '还没确认费用' : cost.treatment === 'excluded' ? '本次不计入' : `${exactMoney(cost.monthly_cents)} / 月 · ${cost.treatment === 'extra' ? '另外支付' : '生活费已包含'}`, description: '提前不工作后，若继续自己交社保，这笔钱会影响需要准备的存款。', state: !cost || ['unknown', 'excluded'].includes(cost.treatment) ? '未计入费用' : '已安排' },
    { id: 'medical', value: medicalPending || p.medical_paid_months == null || p.medical_local_paid_months == null || p.medical_local_required_months == null ? '医保条件待核对' : '医保年限已核对', description: `累计 ${p.medical_paid_months ?? '未填'} 个月 · 本地实缴 ${p.medical_local_paid_months ?? '未填'} 个月 · 本地要求 ${p.medical_local_required_months ?? '未填'} 个月。医保年限不足可能需要补缴。`, state: p.medical_paid_months == null ? '资料未填' : '你填写的资料' },
    { id: 'assumptions', value: `实际收益 ${r.real_return_before_hundredths / 100}% / ${r.real_return_after_hundredths / 100}%`, description: `依次为退休前 / 后的年收益，已扣除通胀。通胀假设 ${p.assumptions.inflation_hundredths / 100}%。`, state: '计算假设' },
  ];
  return <><div className="prototype-bar"><span>交互原型 · 虚构资料 · 修改只在本页，刷新重置</span><label>查看状态 <select value={scenario} onChange={e => reset(e.target.value)}><option value="normal">已有规划</option><option value="unknown">储蓄未知</option><option value="empty">基础条件未填</option><option value="error">读取失败</option></select></label></div>
    <main><header><div><p className="eyebrow">物谱 / 规划</p><h1>我的退休目标</h1><p>先核对下面的条件，再看需要准备多少。每一项都可以单独调整。</p></div><a href="/visual-preview.html?section=planning&plan-basic=beijing-complete&capabilities=real&plan-core=confirmed">查看现有页面 ↗</a></header>
      {scenario === 'error' ? <section className="panel"><h2>暂时读不到规划资料</h2><p>读取失败时不显示旧结果，也不把金额当成 0。</p><button onClick={() => reset('normal')}>重新读取虚构样例</button></section> : <>
      <div className="notice" role="status">{notice}</div><div className="layout"><section className="panel conditions"><div className="panel-heading"><h2>这次计算用了什么</h2><span>按顺序核对 · 随时可改</span></div>{rows.map((row, index) => <article className="plan-row" id={`row-${row.id}`} key={row.id}><div className="row-top"><span className="step">{index + 1}</span><div className="row-content"><div className="row-label"><h3>{names[row.id]}</h3><span className="state">{row.state}</span></div><strong>{row.value}</strong><p>{row.description}</p></div><button id={`edit-${row.id}`} aria-expanded={editing === row.id} onClick={() => editing === row.id ? setEditing(null) : open(row.id)}>{editing === row.id ? '收起' : '调整'}<span className="sr-only">{names[row.id]}</span></button></div>{editing === row.id && editor(row.id)}</article>)}</section>
      <aside><section className="panel result"><p className="eyebrow">{missing.length ? '还不能算出结果' : annotations.length ? '当前暂算结果' : '按当前条件估算'}</p><h2>{r.target_age === null ? '先定一个退休目标' : `${r.target_age} 岁起不工作`}</h2><div className="amounts"><div><span>目标需要每月存</span><strong>{req && 'monthly_cents' in req ? forecastMoney(req.monthly_cents) : '待计算'}</strong></div><div><span>你估计每月能存</span><strong>{exactMoney(b.contribution.monthly_cents)}</strong></div></div><p>{req ? req.status === 'no_positive_contribution' && annotations.length ? '只看目前已计入的条件，暂不要求额外存钱。请先核对下面的遗漏。' : requirementLine(req, forecastMoney).text : missing.map(missingText).filter((v, i, all) => all.indexOf(v) === i).join(' ')}</p>
      {difference !== null && req?.status === 'found' && <p className={difference < 0 ? 'error' : ''}>按已计入的条件，{difference < 0 ? '每月还差约 ' : '每月余量约 '}{forecastMoney(Math.abs(difference))}。</p>}
      {annotations.length > 0 && <div className="caution"><strong>这些情况还会影响结果</strong><ul>{annotations.map(a => <li key={a.id}>{a.reason_code === 'MEDICAL_FACTS_UNKNOWN' ? '医保年限尚未核对；是否需要额外补缴还不确定。' : a.reason_code === 'PENSION_COST_UNCONFIRMED' ? '养老金按继续缴费估算，但退休后自己承担的缴费支出还没有完整计入。' : a.message}</li>)}</ul></div>}<p className="footnote">金额按当前条件估算；未来收入、支出和政策变化后需要重算。</p></section>
      <section className="panel next"><p className="eyebrow">建议下一步</p><h2>{nextCopy}</h2><p>{next === 'cost' ? '养老金已按继续缴费估算，但自己承担的费用还需要你确认。' : next === 'medical' && medicalPending ? '养老保险和医保的缴费要求不同，医保不足可能产生另外的支出。' : next === 'saving' ? '填后才能比较目标所需与实际存钱能力。' : '先完成这一项，其余已填内容都会保留。'}</p><button className="primary" onClick={() => open(next)}>{next === 'cost' ? '确认缴费支出' : next === 'medical' && medicalPending ? '核对医保年限' : `调整${names[next]}`}</button></section>
      <details className="panel details"><summary>其他计划与计算范围</summary><p>本例没有另加买房、买车计划。医保是否需要补缴，以当前资料核对结果为准。</p><p>原型使用现有月度计算模型。社保事实、医保、贷款和大额计划的完整编辑继续使用现有页面；这次先验证主页面顺序和单项调整。</p></details></aside></div></>}
    </main></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
