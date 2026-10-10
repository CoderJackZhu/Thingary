import { useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { Info } from './FormControls';
import { PlanningProfileFields } from './PlanningProfileFields';
import { pensionFormOf, pensionInput } from './planning-basic-forms';
import type { PensionForm } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { hasPensionProfile, STALE_MONTHS, ageText, quitAges, rateText, staleMonths } from './plan';
import type { PlanningSources, ProfileState, StoredProfile, CompletePensionProfile } from './plan';
import { paramsFor, isOverridden, paramSources, verifiedText } from './plan-params';
import type { ParamKey, Overrides } from './plan-params';
import { ageMonthsAt, byQuitAge, project, startAgeMonths } from './plan-pension';
import type { Projection } from './plan-pension';
import { normalizeFunds } from './plan-core';
import './planning.css';

const yuan = (c: number) => money(String(c));

/** 个人资料与养老金估算。资料只含输入与假设；结果每次打开重算，不存库。只问养老金自己的事实，不要求目标或未来投入。 */
export function PlanningPension({ focus = false, onFocusDone, today, sources, reload, onEditingChange, onPending }: { focus?: boolean; onFocusDone: () => void; today: string; sources: PlanningSources; reload: () => void; onEditingChange: (v: boolean) => void; onPending: () => void }) {
  const [editing, setEditing] = useState(false), [quit, setQuit] = useState<number | 'start'>('start');
  const state = sources.profile.status === 'ready' ? sources.profile.value : null;
  const snapshot = sources.snapshot.status === 'ready' ? sources.snapshot.value : null;
  const entry = useRef<HTMLButtonElement | null>(null);
  // Wait for the real entry to render; navigation away drops the parent's intent.
  useEffect(() => {
    if (!focus || !state) return;
    const el = document.getElementById('plan-profile-edit');
    if (el) { el.focus(); onFocusDone(); }
  }, [focus, state, onFocusDone]);
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);

  const saved = state?.saved ?? null;
  const calc = useMemo(() => {
    if (!saved) return null;
    const p = saved.profile;
    if (!hasPensionProfile(p)) return null;
    const region = paramsFor(p, today);
    if (!region) return null;
    const core = p.retire.core, normalized = normalizeFunds(snapshot, core), anchor = snapshot?.date ?? today;
    const basisFactor = (1 + p.assumptions.inflation_hundredths / 10000) ** ((Date.parse(anchor) - Date.parse(core?.monetary_basis_date ?? anchor)) / (86400000 * 365.25));
    const restricted = (id: string) => core?.fund_rules.some(f => f.account_id === id && f.availability === 'restricted' && f.share_hundredths === 10000);
    const funds = { hpf_balance_cents: String(normalized.housingFund), hpf_monthly_cents: String(Math.round(Number(core?.hpf_monthly_cents ?? 0) * basisFactor)), personal_pension_balance_cents: snapshot?.entries.find(e => e.account_id === core?.personal_pension_account_id && restricted(e.account_id) && e.kind !== 'housing_fund')?.amount_cents ?? '0', first_month_fraction: snapshot ? (new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).getUTCDate() - +anchor.slice(8,10)) / new Date(Date.UTC(+anchor.slice(0,4),+anchor.slice(5,7),0)).getUTCDate() : 1, hpf_growth_hundredths: p.assumptions.inflation_hundredths };
    const notes = [...normalized.missing, ...(saved.reference_issues ?? []), `从 ${anchor} 的盘点开始算，本页金额按那天的物价。`];
    if ((Number(p.personal_pension_annual_cents) > 0 || !!core?.personal_pension_account_id) && !core?.personal_pension_balance_confirmed) notes.push('已有的个人养老金余额还没核对，这部分只是粗略估算。');
    if (core?.hpf_monthly_cents == null) notes.push('未来公积金待确认，当前只是未计未来缴存的部分估算；请到目标页核对资金。');
    const now = ageMonthsAt(p.birth_month, anchor), start = startAgeMonths(p);
    const ages = quitAges(now, start);
    const chosen = quit === 'start' || !ages.includes(quit) ? start : quit * 12;
    return { p, region, funds, notes, now, start, ages, main: project(p, region, anchor, chosen, funds), rows: byQuitAge(p, region, anchor, ages, funds).concat(project(p, region, anchor, start, funds)) };
  }, [saved, snapshot, today, quit]);

  const missing = saved ? missingFacts(saved.profile) : [];
  return <>
    {sources.profile.status === 'error' ? <article className="ui-card ui-content" role="alert"><p>个人资料读取失败：{sources.profile.value.message}</p><button onClick={reload}>重新读取</button></article>
      : !saved || !calc ? <div className="empty"><span className="empty-mark">¥</span><h2>{saved ? '养老金估算还缺一些资料' : '还没有个人资料'}</h2><p>填写出生年月、缴费情况和个人账户余额（社保 App 里可查），就能估算法定退休年龄和退休时的养老金。不需要先设置退休目标；资料只存在本机，估算结果不会保存。</p>{missing.length > 0 && <p className="muted small">还缺：{missing.join('、')}。留空的项目保持未知，不会按 0 计算。</p>}<button id="plan-profile-edit" ref={entry} className="primary" onClick={() => setEditing(true)}>{saved ? '补全个人资料' : '填写个人资料'}</button></div>
      : <>
        <Result calc={calc} quit={quit} onQuit={setQuit} onEdit={() => setEditing(true)} updatedAt={saved.updated_at} today={today}/>
        <Table calc={calc}/>
        <Params overrides={calc.p.overrides} region={calc.region}/>
      </>}
    {editing && sources.profile.status === 'ready' && <ProfileDialog sources={sources} saved={saved} today={today} reload={reload} onPending={onPending} onClose={() => { setEditing(false); requestAnimationFrame(() => document.getElementById('plan-profile-edit')?.focus()); }}/>}
  </>;
}

const factLabels: [keyof StoredProfile, string][] = [['region', '参保地'], ['birth_month', '出生年月'], ['worker', '职工类型'], ['paid_months', '累计缴费月数'], ['account_balance_cents', '个人账户余额'], ['base_cents', '当前缴费基数'], ['flex_months', '弹性领取月数'], ['personal_pension_annual_cents', '个人养老金年缴'], ['marginal_tax_hundredths', '个税边际税率']];
const missingFacts = (p: StoredProfile) => factLabels.filter(([k]) => p[k] === null).map(([, l]) => l).concat(p.region === 'custom' && !p.overrides.avg_wage_cents ? ['当地养老金计发基数'] : []);

type Calc = { p: CompletePensionProfile; region: NonNullable<ReturnType<typeof paramsFor>>; funds: { hpf_balance_cents: string; hpf_monthly_cents: string }; notes: string[]; now: number; start: number; ages: number[]; main: Projection; rows: Projection[] };

function Result({ calc, quit, onQuit, onEdit, updatedAt, today }: { calc: Calc; quit: number | 'start'; onQuit: (v: number | 'start') => void; onEdit: () => void; updatedAt: string; today: string }) {
  const r = calc.main;
  const stale = staleMonths(updatedAt, today);
  return <article className="ui-card ui-content plan-steps" aria-label="养老金估算">
    <div className="ui-section-head"><h3>养老金估算</h3><span><button type="button" id="plan-profile-edit" className="ui-btn" onClick={onEdit}>编辑个人资料</button></span></div>
    {stale >= STALE_MONTHS && <p className="notice" role="status">个人资料更新于 {updatedAt.slice(0, 10)}，已经 {stale} 个月没更新。累计缴费月数和个人账户余额会随缴费变化，请核对当地社保查询记录再改。</p>}
    <section aria-labelledby="pension-start"><h4 id="pension-start">领取年龄</h4>
      <p><strong>{ageText(r.start_age_months)}</strong>（{r.start_month}）{calc.p.flex_months !== 0 && <span className="muted">，含弹性{calc.p.flex_months > 0 ? '延后' : '提前'} {Math.abs(calc.p.flex_months)} 个月</span>}</p>
      <label className="plan-quit">假设在这个年龄停止缴费：<select aria-label="停止缴费的年龄" value={quit === 'start' ? 'start' : String(quit)} onChange={e => onQuit(e.target.value === 'start' ? 'start' : Number(e.target.value))}>
        <option value="start">缴到领取年龄</option>{calc.ages.map(a => <option key={a} value={a}>{a} 岁</option>)}</select></label>
      <p className="muted small">缴费 {Math.floor(r.total_paid_months / 12)} 年 {r.total_paid_months % 12} 个月，其中今后还缴 {r.contribution_months} 个月。停缴不改变法定领取年龄，但缴费年限、个人账户和公积金都会变少。</p>
      {!r.eligible && <p className="notice" role="status">本次按 {r.required_year} 年的最低缴费要求核对{calc.p.flex_months > 0 ? '（弹性延迟按法定退休年份）' : ''}：至少 {Math.floor(r.required_months / 12)} 年{r.required_months % 12 ? ` ${r.required_months % 12} 个月` : ''}，当前不足。能否续缴、转移或办理领取须按适用规定确认；下面仅展示公式金额，不代表已具备按月领取资格。</p>}
    </section>
    <section aria-labelledby="pension-amount"><h4 id="pension-amount">退休首月养老金</h4>
      <dl className="plan-facts">
        <div><dt>基础养老金</dt><dd>{yuan(r.base_pension_today_cents)}</dd><small className="muted">名义 {yuan(r.base_pension_nominal_cents)}</small></div>
        <div><dt>个人账户养老金</dt><dd>{yuan(r.account_pension_today_cents)}</dd><small className="muted">名义 {yuan(r.account_pension_nominal_cents)}</small></div>
        <div><dt>合计（今天的钱）</dt><dd>{yuan(r.total_today_cents)}</dd><small className="muted">名义 {yuan(r.total_nominal_cents)}</small></div>
        <div><dt>替代率</dt><dd>{rateText(r.replacement_hundredths)}</dd><small className="muted">养老金 ÷ 停缴时月缴费基数</small></div>
      </dl>
      <p className="muted small">「今天的钱」按通胀假设折现；个人账户余额领取时约 {yuan(r.account_at_start_cents)}，计发月数 {r.disbursement_months.toFixed(1)}（非整岁按月插值，官方修订表出台前是近似）。这些都是估算，不是承诺。</p>
      <p className="muted small">按全国统一公式简化估算，未计过渡性养老金（视同缴费）等特殊情形，不能作为待遇核定结果。</p>
      {calc.p.region === 'beijing' && <p className="muted small">北京断缴指数、待遇计发基数与起领月份尚未完整校准。</p>}
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

function Params({ overrides, region }: { overrides: Overrides; region: NonNullable<ReturnType<typeof paramsFor>> }) {
  if (region.region === 'custom') return <article className="ui-card ui-content"><div className="ui-section-head"><h3>参数表（自填地区）</h3><span>你填写的参数</span></div>
    <table className="ui-table plan-params"><thead><tr><th>参数</th><th className="amount">取值</th><th>依据与核对状态</th></tr></thead><tbody>
      {([['avg_wage_cents', `养老金计发基数（${region.avg_wage_year} 年度，假设）`], ['base_lower_cents', '月缴费基数下限'], ['base_upper_cents', '月缴费基数上限'], ['notional_rate_hundredths', '个人账户未来记账利率'], ['hpf_rate_hundredths', '公积金账户存款利率']] as [ParamKey, string][]).map(([key, label]) => <tr key={key}><td>{label}</td><td className="amount">{key.endsWith('rate_hundredths') ? rateText(region[key] as number) : money(region[key] as string)}</td><td><span className="ui-tag">用户自定值</span><small className="muted plan-source">{isOverridden(key, overrides) ? '你填写的参数，未作官方核验。' : key === 'base_lower_cents' ? '按计发基数 60% 假设。' : key === 'base_upper_cents' ? '按计发基数 300% 假设。' : '全国统一利率沿用内置值；未来利率为测算假设。'}</small></td></tr>)}
    </tbody></table><p className="muted small">计发基数按上一年度作为假设；默认上下限和未来利率均可在个人资料里覆盖。</p></article>;
  const shown = (key: ParamKey) => key.endsWith('rate_hundredths') ? rateText(region[key] as number) : money(region[key] as string);
  return <article className="ui-card ui-content"><div className="ui-section-head"><h3>参数表（{region.name}）</h3><span>每年更新；可在个人资料里改</span></div>
    <table className="ui-table plan-params"><thead><tr><th>参数</th><th className="amount">取值</th><th>依据与核对状态</th></tr></thead>
      <tbody>{paramSources.map(s => <tr key={s.key}><td>{s.label}</td><td className="amount">{shown(s.key)}{isOverridden(s.key, overrides) && <span className="ui-tag"> 自定</span>}</td>
        <td><span className={'ui-tag' + (s.verified === 'official' ? '' : ' warn')}>{isOverridden(s.key, overrides) ? '用户自定值' : verifiedText[s.verified]}</span><small className="muted plan-source">{s.source}{s.effective ? `（${s.effective} 起）` : ''}</small><small className="muted plan-source"><a href={s.url} target="_blank" rel="noreferrer">{s.verified === 'derived' ? '查看推算依据' : s.verified === 'assumption' ? '查看利率公布规则' : '查看官方来源'}</a> · 核对 {s.checked_on}</small>{isOverridden(s.key, overrides) && <small className="muted plan-source">来源说明内置参考值；当前自定值未作官方核验。</small>}</td></tr>)}</tbody></table>
    <p className="muted small">法定退休年龄按国务院《渐进式延迟法定退休年龄的办法》，计发月数按国发〔2005〕38 号附表，个人养老金年缴上限 12000 元、领取按 3% 计税。</p></article>;
}


function ProfileDialog({ sources, saved, today, reload, onPending, onClose }: { sources: PlanningSources; saved: ProfileState['saved']; today: string; reload: () => void; onPending: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [f, setF] = useState<PensionForm>(() => pensionFormOf(saved)), [notice, setNotice] = useState('');
  useEffect(() => { dialog.current?.showModal(); document.getElementById('profile-birth')?.focus(); return () => dialog.current?.close(); }, []);
  const frozen = saver.busy || saver.stuck;
  async function save() {
    let input; try { input = pensionInput(f); } catch (e) { setNotice(e instanceof Error ? e.message : errorMessage(e)); return; }
    setNotice('');
    if (await saver.save(input)) onClose();
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="profile-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 养老金</p><h2 id="profile-heading">个人资料</h2><p className="muted">按社保 App 当前显示的数字填写；不知道的留空，不会按 0 计算。未来利率和增长率属于测算假设。</p></div><CloseButton type="button" aria-label="关闭个人资料表单" disabled={saver.busy} onClick={onClose}/><div className="editor-header-actions">{saver.stuck ? <button type="button" onClick={onClose}>关闭，稍后核对</button> : <button className="primary" disabled={saver.busy}>{saver.busy ? '保存中…' : '保存资料'}</button>}</div></header>
    <PlanningProfileFields f={f} setF={setF} today={today} frozen={frozen}/>
    {(notice || saver.notice) && <p className="notice" role="status">{notice || saver.notice}</p>}
  </form></dialog>;
}
