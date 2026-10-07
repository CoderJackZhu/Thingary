import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { Info } from './FormControls';
import { PlanningProfileFields } from './PlanningProfileFields';
import { toForm, profileFromForm } from './planning-profile';
import type { Form } from './planning-profile';
import { STALE_MONTHS, ageText, quitAges, rateText, staleMonths } from './plan';
import type { Income, ProfileSave, ProfileState, StoredProfile } from './plan';
import { beijing, effectiveParams, isOverridden, paramSources, verifiedText } from './plan-params';
import type { ParamKey, Overrides } from './plan-params';
import { ageMonthsAt, byQuitAge, project, startAgeMonths } from './plan-pension';
import type { Projection } from './plan-pension';
import { storedPending, submit, Unresolved } from './wealth';
import type { Snapshot, Summary } from './wealth';
import { normalizeFunds } from './plan-core';
import './planning.css';

const yuan = (c: number) => money(String(c));

/** 个人资料与养老金估算。资料只含输入与假设；结果每次打开重算，不存库。 */
export function PlanningPension({ focus = false, onFocusDone, today, incomes, onEditingChange, onPending }: { focus?: boolean; onFocusDone: () => void; today: string; incomes: Income[]; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const [state, setState] = useState<ProfileState | null>(null), [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [editing, setEditing] = useState(false);
  const [quit, setQuit] = useState<number | 'start'>('start');
  // Wait for the real entry to render; navigation away drops the parent's intent.
  useEffect(() => {
    if (!focus || !state || snapshot === undefined || error) return;
    const entry = document.getElementById('plan-profile-edit');
    if (entry) { entry.focus(); onFocusDone(); }
  }, [focus, state, snapshot, error, onFocusDone]);
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
    const core = p.retire.core, normalized = normalizeFunds(snapshot ?? null, core), anchor = snapshot?.date ?? today;
    const basisFactor = (1 + p.assumptions.inflation_hundredths / 10000) ** ((Date.parse(anchor) - Date.parse(core?.monetary_basis_date ?? anchor)) / (86400000 * 365.25));
    const restricted = (id: string) => core?.fund_rules.some(f => f.account_id === id && f.availability === 'restricted' && f.share_hundredths === 10000);
    const funds = { hpf_balance_cents: String(normalized.housingFund), hpf_monthly_cents: String(Math.round(Number(core?.hpf_monthly_cents ?? 0) * basisFactor)), personal_pension_balance_cents: snapshot?.entries.find(e => e.account_id === core?.personal_pension_account_id && restricted(e.account_id) && e.kind !== 'housing_fund')?.amount_cents ?? '0', first_month_fraction: snapshot ? (new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).getUTCDate() - +anchor.slice(8,10)) / new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).getUTCDate() : 1, hpf_growth_hundredths: p.assumptions.inflation_hundredths };
    const notes = [...normalized.missing, ...(saved.reference_issues ?? []), `资金起点为 ${anchor} 收盘；本页实际金额按该日购买力展示。`];
    if ((Number(p.personal_pension_annual_cents) > 0 || !!core?.personal_pension_account_id) && !core?.personal_pension_balance_confirmed) notes.push('已有个人养老金余额待核对，受限池只是部分估算。');
    if (core?.hpf_monthly_cents == null) notes.push('未来公积金待确认，当前只是未计未来缴存的部分估算；请到目标页核对资金。');
    const now = ageMonthsAt(p.birth_month, anchor), start = startAgeMonths(p);
    const ages = quitAges(now, start);
    const chosen = quit === 'start' || !ages.includes(quit) ? start : quit * 12;
    return { p, region, funds, notes, now, start, ages, main: project(p, region, anchor, chosen, funds), rows: byQuitAge(p, region, anchor, ages, funds).concat(project(p, region, anchor, start, funds)) };
  }, [saved, snapshot, incomes, today, quit]);

  return <>
    {error ? <article className="ui-card ui-content" role="alert"><p>个人资料读取失败：{error}</p><button onClick={() => setRetry(n => n + 1)}>重新读取</button></article>
      : !state || snapshot === undefined ? <p role="status" className="muted">正在读取个人资料…</p>
      : !saved || !calc ? <div className="empty"><span className="empty-mark">¥</span><h2>还没有个人资料</h2><p>填写出生年月、缴费情况和个人账户余额（社保 App 里可查），就能估算法定退休年龄和退休时的养老金。资料只存在本机，估算结果不会保存。</p><button id="plan-profile-edit" className="primary" onClick={() => setEditing(true)}>填写个人资料</button></div>
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
    <div className="ui-section-head"><h3>养老金估算</h3><span><button type="button" id="plan-profile-edit" className="ui-btn" onClick={onEdit}>编辑个人资料</button></span></div>
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


function ProfileDialog({ saved, generation, today, onClose }: { saved: ProfileState['saved']; generation: string; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<Form>(toForm(saved?.profile ?? null));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('profile-birth')?.focus(); return () => dialog.current?.close(); }, []);
  const frozen = busy || stuck;
  async function save() {
    let profile: StoredProfile;
    try { profile = profileFromForm(f, saved?.profile ?? null, today); }
    catch (e) { setNotice(e instanceof Error ? e.message : errorMessage(e)); return; }
    const input: ProfileSave = { request_id: crypto.randomUUID(), generation, expected_revision: saved?.revision ?? null, profile };
    setBusy(true); setNotice('');
    try { await submit({ command: 'plan_profile_save', input, label: '个人资料' }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="profile-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 养老金</p><h2 id="profile-heading">个人资料</h2><p className="muted">按社保 App 当前显示的数字填写；未来利率和增长率属于测算假设。</p></div><CloseButton type="button" aria-label="关闭个人资料表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存资料'}</button>}</div></header>
    <PlanningProfileFields f={f} setF={setF} today={today} frozen={frozen}/>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
