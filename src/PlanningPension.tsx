import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow, Info } from './FormControls';
import { DateInput } from './DateInput';
import { STALE_MONTHS, ageText, defaultRetire, estimateAccountCents, fundsFrom, hundredthsToPct, pctToHundredths, quitAges, rateText, staleMonths } from './plan';
import type { Income, ProfileSave, ProfileState, StoredProfile } from './plan';
import { PERSONAL_PENSION_CAP_CENTS, beijing, defaultAssumptions, effectiveParams, isOverridden, noOverrides, paramSources, verifiedText } from './plan-params';
import type { ParamKey, Overrides } from './plan-params';
import { ageMonthsAt, byQuitAge, project, startAgeMonths } from './plan-pension';
import type { Projection, Worker } from './plan-pension';
import { storedPending, submit, Unresolved } from './wealth';
import type { Snapshot, Summary } from './wealth';
import './planning.css';

const workerText: Record<Worker, string> = { male: '男职工', female_cadre: '女干部（原 55 岁退休）', female_worker: '女工人（原 50 岁退休）' };
const taxRates = [0, 300, 1000, 2000, 2500, 3000, 3500, 4500];
const yuan = (c: number) => money(String(c));

/** 个人资料与养老金估算。资料只含输入与假设；结果每次打开重算，不存库。 */
export function PlanningPension({ today, incomes, onEditingChange, onPending }: { today: string; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const [state, setState] = useState<ProfileState | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false);
  const [quit, setQuit] = useState<number | 'start'>('start');
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  useEffect(() => {
    let live = true; setError('');
    (async () => {
      const profile = await invoke<ProfileState>('plan_profile');
      const summary = await invoke<Summary>('wealth_summary');
      const latest = [...summary.points].reverse().find(p => p.complete);
      const snap = latest ? await invoke<Snapshot | null>('wealth_snapshot', { id: latest.snapshot_id }) : null;
      if (live) { setState(profile); setSnapshot(snap); }
    })().catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);

  const saved = state?.saved ?? null;
  const calc = useMemo(() => {
    if (!saved || snapshot === undefined) return null;
    const p = saved.profile, region = effectiveParams(beijing, p.overrides);
    const { funds, notes } = fundsFrom(snapshot?.entries ?? null, incomes);
    const now = ageMonthsAt(p.birth_month, today), start = startAgeMonths(p);
    const ages = quitAges(now, start);
    const chosen = quit === 'start' || !ages.includes(quit) ? start : quit * 12;
    return { p, region, funds, notes, now, start, ages, main: project(p, region, today, chosen, funds), rows: byQuitAge(p, region, today, ages, funds).concat(project(p, region, today, start, funds)) };
  }, [saved, snapshot, incomes, today, quit]);

  return <>
    {error ? <article className="ui-card ui-content" role="alert"><p>个人资料读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></article>
      : !state || snapshot === undefined ? <p role="status" className="muted">正在读取个人资料…</p>
      : !saved || !calc ? <div className="empty"><span className="empty-mark">¥</span><h2>还没有个人资料</h2><p>填写出生年月、缴费情况和个人账户余额（社保 App 里可查），就能估算法定退休年龄和退休时的养老金。资料只存在本机，估算结果不会保存。</p><button className="primary" onClick={() => setEditing(true)}>填写个人资料</button></div>
      : <>
        <Result calc={calc} quit={quit} onQuit={setQuit} onEdit={() => setEditing(true)} updatedAt={saved.updated_at} today={today}/>
        <Table calc={calc}/>
        <Params overrides={calc.p.overrides} region={calc.region}/>
      </>}
    {editing && state && <ProfileDialog saved={state.saved} generation={state.generation} today={today} onClose={ok => { (document.querySelector('dialog[open]') as HTMLDialogElement | null)?.close(); setEditing(false); onPending(); if (ok) setRetry(n => n + 1); }}/>}
  </>;
}

type Calc = { p: StoredProfile; region: ReturnType<typeof effectiveParams>; funds: { hpf_balance_cents: string; hpf_monthly_cents: string }; notes: string[]; now: number; start: number; ages: number[]; main: Projection; rows: Projection[] };

function Result({ calc, quit, onQuit, onEdit, updatedAt, today }: { calc: Calc; quit: number | 'start'; onQuit: (v: number | 'start') => void; onEdit: () => void; updatedAt: string; today: string }) {
  const r = calc.main;
  const stale = staleMonths(updatedAt, today);
  return <article className="ui-card ui-content plan-steps" aria-label="养老金估算">
    <div className="ui-section-head"><h3>养老金估算</h3><span><button type="button" className="ui-btn" onClick={onEdit}>编辑个人资料</button></span></div>
    {stale >= STALE_MONTHS && <p className="notice" role="status">个人资料更新于 {updatedAt.slice(0, 10)}，已经 {stale} 个月没更新。累计缴费月数和个人账户余额会随缴费变化，请对一次京通再改。</p>}
    <section aria-labelledby="pension-start"><h4 id="pension-start">领取年龄</h4>
      <p><strong>{ageText(r.start_age_months)}</strong>（{r.start_month}）{calc.p.flex_months !== 0 && <span className="muted">，含弹性{calc.p.flex_months > 0 ? '延后' : '提前'} {Math.abs(calc.p.flex_months)} 个月</span>}</p>
      <label className="plan-quit">假设在这个年龄停止缴费：<select aria-label="停止缴费的年龄" value={quit === 'start' ? 'start' : String(quit)} onChange={e => onQuit(e.target.value === 'start' ? 'start' : Number(e.target.value))}>
        <option value="start">缴到领取年龄</option>{calc.ages.map(a => <option key={a} value={a}>{a} 岁</option>)}</select></label>
      <p className="muted small">缴费 {Math.floor(r.total_paid_months / 12)} 年 {r.total_paid_months % 12} 个月，其中今后还缴 {r.contribution_months} 个月。停缴不改变法定领取年龄，但缴费年限、个人账户和公积金都会变少。</p>
      {!r.eligible && <p className="notice" role="status">按这个缴费年限，{r.start_month.slice(0, 4)} 年退休要求至少 {Math.floor(r.required_months / 12)} 年{r.required_months % 12 ? ` ${r.required_months % 12} 个月` : ''}，当前不足，可能不能按月领取基本养老金，需要补缴或按当地规定处理；下面的数字仍按公式计算。</p>}
    </section>
    <section aria-labelledby="pension-amount"><h4 id="pension-amount">退休首月养老金</h4>
      <dl className="plan-facts">
        <div><dt>基础养老金</dt><dd>{yuan(r.base_pension_today_cents)}</dd><small className="muted">名义 {yuan(r.base_pension_nominal_cents)}</small></div>
        <div><dt>个人账户养老金</dt><dd>{yuan(r.account_pension_today_cents)}</dd><small className="muted">名义 {yuan(r.account_pension_nominal_cents)}</small></div>
        <div><dt>合计（今天的钱）</dt><dd>{yuan(r.total_today_cents)}</dd><small className="muted">名义 {yuan(r.total_nominal_cents)}</small></div>
        <div><dt>替代率</dt><dd>{rateText(r.replacement_hundredths)}</dd><small className="muted">养老金 ÷ 停缴时月缴费基数</small></div>
      </dl>
      <p className="muted small">「今天的钱」按通胀假设折现；个人账户余额领取时约 {yuan(r.account_at_start_cents)}，计发月数 {r.disbursement_months.toFixed(1)}（非整岁按月插值，官方修订表出台前是近似）。这些都是估算，不是承诺。</p>
    </section>
    <section aria-labelledby="pension-pots"><h4 id="pension-pots">到领取年龄的锁定资金</h4>
      <dl className="plan-facts">
        <div><dt>公积金</dt><dd>{yuan(r.hpf_at_start_cents)}</dd><small className="muted">当前余额 {money(calc.funds.hpf_balance_cents)}，月缴存 {money(calc.funds.hpf_monthly_cents)}</small></div>
        <div><dt>个人养老金（税后）</dt><dd>{yuan(r.personal_pension_after_tax_cents)}</dd><small className="muted">税前 {yuan(r.personal_pension_at_start_cents)}，领取时单独按 3% 缴个税</small></div>
        <div><dt>两者合计（今天的钱）</dt><dd>{yuan(r.pots_today_cents)}</dd></div>
        {calc.p.personal_pension_annual_cents !== '0' && <div><dt>个人养老金每年省税</dt><dd>{yuan(r.personal_pension_tax_saved_cents)}</dd><small className="muted">按边际税率 {rateText(calc.p.marginal_tax_hundredths)}</small></div>}
      </dl>
      {calc.notes.map(n => <p key={n} className="muted small">{n}</p>)}
    </section>
  </article>;
}

function Table({ calc }: { calc: Calc }) {
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>不同停缴年龄</h3><span>用于判断提前退休的代价</span></div>
    <table className="ui-table plan-quits"><thead><tr><th>停止缴费</th><th className="amount">缴费年限</th><th className="amount">养老金（今天的钱）</th><th className="amount">锁定资金（今天的钱）</th><th>按月领取资格</th></tr></thead>
      <tbody>{calc.rows.map((r, i) => <tr key={r.quit_age_months + '-' + i} className={r.eligible ? undefined : 'closed'}>
        <td>{i === calc.rows.length - 1 ? '缴到领取年龄' : ageText(r.quit_age_months)}</td>
        <td className="amount">{(r.total_paid_months / 12).toFixed(1)} 年</td><td className="amount">{yuan(r.total_today_cents)}</td><td className="amount">{yuan(r.pots_today_cents)}</td>
        <td>{r.eligible ? '满足' : <span className="ui-tag warn">不足 {Math.ceil(r.required_months / 12)} 年</span>}</td></tr>)}</tbody></table></article>;
}

function Params({ overrides, region }: { overrides: Overrides; region: ReturnType<typeof effectiveParams> }) {
  const shown = (key: ParamKey) => key.endsWith('rate_hundredths') ? rateText(region[key] as number) : money(region[key] as string);
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>参数表（{region.name}）</h3><span>每年更新；可在个人资料里改</span></div>
    <table className="ui-table plan-params"><thead><tr><th>参数</th><th className="amount">取值</th><th>依据与核对状态</th></tr></thead>
      <tbody>{paramSources.map(s => <tr key={s.key}><td>{s.label}</td><td className="amount">{shown(s.key)}{isOverridden(s.key, overrides) && <span className="ui-tag"> 自定</span>}</td>
        <td><span className={'ui-tag' + (s.verified === 'official' ? '' : ' warn')}>{isOverridden(s.key, overrides) ? '用户自定值' : verifiedText[s.verified]}</span><small className="muted plan-source">{s.source}{s.effective ? `（${s.effective} 起）` : ''}</small><small className="muted plan-source"><a href={s.url} target="_blank" rel="noreferrer">{s.verified === 'derived' ? '查看推算依据' : s.verified === 'assumption' ? '查看利率公布规则' : '查看官方来源'}</a> · 核对 {s.checked_on}</small>{isOverridden(s.key, overrides) && <small className="muted plan-source">来源说明内置参考值；当前自定值未作官方核验。</small>}</td></tr>)}</tbody></table>
    <p className="muted small">法定退休年龄按国务院《渐进式延迟法定退休年龄的办法》，计发月数按国发〔2005〕38 号附表，个人养老金年缴上限 12000 元、领取按 3% 计税。</p></article>;
}

type Form = { birth: string; worker: Worker; paid: string; balance: string; base: string; past: string; flex: string; pp: string; tax: string; infl: string; wage: string; ppReturn: string;
  oWage: string; oLower: string; oUpper: string; oNotional: string; oHpf: string };
const toForm = (p: StoredProfile | null): Form => ({
  birth: p ? p.birth_month + '-01' : '', worker: p?.worker ?? 'male', paid: p ? String(p.paid_months) : '', balance: p?.account_balance_cents ?? '', base: p?.base_cents ?? '',
  past: p?.past_index_hundredths == null ? '' : String(p.past_index_hundredths / 100), flex: String(p?.flex_months ?? 0), pp: p?.personal_pension_annual_cents ?? '0', tax: String(p?.marginal_tax_hundredths ?? 1000),
  infl: hundredthsToPct((p?.assumptions ?? defaultAssumptions).inflation_hundredths), wage: hundredthsToPct((p?.assumptions ?? defaultAssumptions).wage_growth_hundredths), ppReturn: hundredthsToPct((p?.assumptions ?? defaultAssumptions).pp_return_hundredths),
  oWage: p?.overrides.avg_wage_cents ?? '', oLower: p?.overrides.base_lower_cents ?? '', oUpper: p?.overrides.base_upper_cents ?? '',
  oNotional: p?.overrides.notional_rate_hundredths == null ? '' : hundredthsToPct(p.overrides.notional_rate_hundredths), oHpf: p?.overrides.hpf_rate_hundredths == null ? '' : hundredthsToPct(p.overrides.hpf_rate_hundredths),
});

function ProfileDialog({ saved, generation, today, onClose }: { saved: ProfileState['saved']; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<Form>(toForm(saved?.profile ?? null));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('profile-birth')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  async function save() {
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birth)) return stop('出生日期', '请选择出生日期。');
    if (f.birth.slice(0, 7) >= today.slice(0, 7)) return stop('出生日期', '出生日期须早于本月。');
    if (!/^\d{1,4}$/.test(f.paid)) return stop('累计缴费月数', '请填写累计缴费月数（社保 App 可查），没有就填 0。');
    if (f.balance === '') return stop('个人账户余额', '请填写个人账户余额，没有就填 0。');
    if (f.base === '') return stop('当前月缴费基数', '请填写当前月缴费基数。');
    const infl = pctToHundredths(f.infl), wage = pctToHundredths(f.wage), ppr = pctToHundredths(f.ppReturn);
    if (infl === null) return stop('通胀率', '通胀率请填百分数，例如 2 或 2.5。');
    if (wage === null) return stop('工资增长率', '工资增长率请填百分数，例如 3。');
    if (ppr === null) return stop('个人养老金收益率', '个人养老金收益率请填百分数，例如 2。');
    const flex = Number(f.flex);
    if (!Number.isInteger(flex) || flex < -36 || flex > 36) return stop('弹性领取月数', '弹性提前或延后须是 −36 到 36 之间的整数月。');
    const past = f.past.trim() === '' ? null : Math.round(Number(f.past) * 100);
    if (past !== null && !(past >= 1 && past <= 1000)) return stop('历史平均缴费指数', '历史平均缴费指数请填 0.01 到 10 之间的数，或留空。');
    const rateOrNull = (text: string, label: string): number | null | undefined => { if (text.trim() === '') return null; const v = pctToHundredths(text); if (v === null) { stop(label, `${label}请填百分数，或留空使用内置值。`); return undefined; } return v; };
    const notional = rateOrNull(f.oNotional, '记账利率'); if (notional === undefined) return;
    const hpf = rateOrNull(f.oHpf, '公积金利率'); if (hpf === undefined) return;
    const profile: StoredProfile = {
      birth_month: f.birth.slice(0, 7), worker: f.worker, region: 'beijing', paid_months: Number(f.paid), account_balance_cents: f.balance, base_cents: f.base, past_index_hundredths: past, flex_months: flex,
      personal_pension_annual_cents: f.pp, marginal_tax_hundredths: Number(f.tax), assumptions: { inflation_hundredths: infl, wage_growth_hundredths: wage, pp_return_hundredths: ppr },
      overrides: { ...noOverrides, avg_wage_cents: f.oWage || null, base_lower_cents: f.oLower || null, base_upper_cents: f.oUpper || null, notional_rate_hundredths: notional, hpf_rate_hundredths: hpf },
      retire: saved?.profile.retire ?? defaultRetire,
    };
    const input: ProfileSave = { request_id: crypto.randomUUID(), generation, expected_revision: saved?.revision ?? null, profile };
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_profile_save', input, label: '个人资料' }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="profile-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 养老金</p><h2 id="profile-heading">个人资料</h2><p className="muted">按社保 App 当前显示的数字填写；未来利率和增长率属于测算假设。</p></div><CloseButton type="button" aria-label="关闭个人资料表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存资料'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="出生日期" hint="点日历选择；只用到年和月"><DateInput id="profile-birth" label="出生日期" value={f.birth} max={today} disabled={frozen} onChange={v => set('birth', v)}/></FormRow>
      <FormRow label="性别与职工类型" hint="决定法定退休年龄的延迟节奏：男职工原 60 岁；女干部（干部、管理、专业技术岗位）原 55 岁；女工人（一线工人）原 50 岁。拿不准就看劳动合同或问单位人事"><select aria-label="性别与职工类型" value={f.worker} disabled={frozen} onChange={e => set('worker', e.target.value as Worker)}>{(Object.keys(workerText) as Worker[]).map(k => <option key={k} value={k}>{workerText[k]}</option>)}</select></FormRow>
      <FormRow label="累计缴费月数" hint="京通「社保缴费信息」里，数缴了养老保险的月数"><input aria-label="累计缴费月数" inputMode="numeric" value={f.paid} disabled={frozen} onChange={e => set('paid', e.target.value)} placeholder="例如 48"/></FormRow>
      <FormRow label="个人账户余额" hint="把每月个人缴的养老里记入账户的部分加起来（单位上班是 8% 的基数，灵活就业也只有 8% 进账户）；查不到可先估算，不知道就填 0"><span className="account-estimate"><CentInput label="个人账户余额" value={f.balance} disabled={frozen} placeholder="0.00" onChange={v => set('balance', v)}/><button type="button" className="ui-btn" disabled={frozen || !/^\d+$/.test(f.paid) || f.base === ''} onClick={() => set('balance', estimateAccountCents(Number(f.paid), f.base))}>帮我估算</button></span></FormRow>
      <FormRow label="当前月缴费基数" hint="按你接下来打算缴的填：回去上班填上班的基数，继续灵活就业填灵活的；超出当地上下限按上下限计"><CentInput label="当前月缴费基数" value={f.base} disabled={frozen} placeholder="0.00" onChange={v => set('base', v)}/></FormRow>
    </section>
    <details className="form-block" open={f.past !== '' || f.flex !== '0'}><summary>更多（一般不用填）</summary>
      <FormRow label="历史平均缴费指数" hint="过去各月缴费基数 ÷ 当年社平的平均；留空表示与当前基数相同。只有过去的基数和现在差得很多时才需要填"><input aria-label="历史平均缴费指数" inputMode="decimal" value={f.past} disabled={frozen} onChange={e => set('past', e.target.value)} placeholder="例如 2.5"/></FormRow>
      <FormRow label="弹性领取月数" hint="保持 0 即可；想比较提前或延后领取时才改：提前为负、延后为正，最多 36 个月"><input aria-label="弹性领取月数" inputMode="numeric" value={f.flex} disabled={frozen} onChange={e => set('flex', e.target.value)}/></FormRow>
    </details>
    <section className="form-block">
      <FormRow label="个人养老金每年缴存" hint={`没有开户填 0；每年最多 ${money(String(PERSONAL_PENSION_CAP_CENTS))}`}><CentInput label="个人养老金每年缴存" value={f.pp} disabled={frozen} placeholder="0.00" onChange={v => set('pp', v)}/></FormRow>
      <FormRow label="个税边际税率" hint="用于估算个人养老金每年省多少税"><select aria-label="个税边际税率" value={f.tax} disabled={frozen} onChange={e => set('tax', e.target.value)}>{taxRates.map(r => <option key={r} value={r}>{rateText(r)}</option>)}</select></FormRow>
    </section>
    <details className="form-block" open={f.infl !== hundredthsToPct(defaultAssumptions.inflation_hundredths) || f.wage !== hundredthsToPct(defaultAssumptions.wage_growth_hundredths) || f.ppReturn !== hundredthsToPct(defaultAssumptions.pp_return_hundredths)}><summary>假设（有默认值，一般不用改）</summary>
      <p className="muted small">下面是假设，不是事实；预填值只是占位，请按自己的判断修改。</p>
      <FormRow label="通胀率（年）" hint="这是假设"><input aria-label="通胀率" inputMode="decimal" value={f.infl} disabled={frozen} onChange={e => set('infl', e.target.value)}/></FormRow>
      <FormRow label="工资与社平增长率（年，名义）" hint="这是假设"><input aria-label="工资增长率" inputMode="decimal" value={f.wage} disabled={frozen} onChange={e => set('wage', e.target.value)}/></FormRow>
      <FormRow label="个人养老金收益率（年，名义）" hint="这是假设"><input aria-label="个人养老金收益率" inputMode="decimal" value={f.ppReturn} disabled={frozen} onChange={e => set('ppReturn', e.target.value)}/></FormRow>
    </details>
    <details className="form-block"><summary>参数覆盖（留空使用内置值）</summary>
      <FormRow label="上年度月平均工资"><CentInput label="上年度月平均工资" value={f.oWage} disabled={frozen} placeholder={(Number(beijing.avg_wage_cents) / 100).toFixed(2)} onChange={v => set('oWage', v)}/></FormRow>
      <FormRow label="缴费基数下限"><CentInput label="缴费基数下限" value={f.oLower} disabled={frozen} placeholder={(Number(beijing.base_lower_cents) / 100).toFixed(2)} onChange={v => set('oLower', v)}/></FormRow>
      <FormRow label="缴费基数上限"><CentInput label="缴费基数上限" value={f.oUpper} disabled={frozen} placeholder={(Number(beijing.base_upper_cents) / 100).toFixed(2)} onChange={v => set('oUpper', v)}/></FormRow>
      <FormRow label="记账利率（%）"><input aria-label="记账利率" inputMode="decimal" value={f.oNotional} disabled={frozen} placeholder={hundredthsToPct(beijing.notional_rate_hundredths)} onChange={e => set('oNotional', e.target.value)}/></FormRow>
      <FormRow label="公积金利率（%）"><input aria-label="公积金利率" inputMode="decimal" value={f.oHpf} disabled={frozen} placeholder={hundredthsToPct(beijing.hpf_rate_hundredths)} onChange={e => set('oHpf', e.target.value)}/></FormRow>
    </details>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
