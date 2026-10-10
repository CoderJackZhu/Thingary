import { useEffect, useRef, useState } from 'react';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { money } from './asset';
import { CloseButton } from './CloseButton';
import { CentInput, FormRow } from './FormControls';
import { mustStayInLedger } from './plan-core';
import type { PlanningSources, ProfileState, RetireInputs } from './plan';
import { costsInput, contributionSources, draftOf, retirementSources } from './planning-basic-forms';
import type { Draft, ScopeDraft } from './planning-basic-forms';
import { useSectionSaver } from './planning-basic-data';
import { costReviewRows } from './planning-cost-review';

function ScopeRow({ id, label, value, placeholderRef, disabled, onChange, allowIncluded = true, expand = false }: { id: string; label: string; value: ScopeDraft; placeholderRef: string; disabled: boolean; onChange: (v: ScopeDraft) => void; allowIncluded?: boolean; expand?: boolean }) {
  const locked = mustStayInLedger(id);
  if (locked && value.treatment === 'excluded') value = { treatment: '', ref: '' };
  return <FormRow label={label}><span className="plan-scope-row"><select aria-label={`${label}是否已含在生活费里`} value={value.treatment} disabled={disabled} onChange={e => { const treatment = e.target.value as ScopeDraft['treatment']; onChange({ treatment, ref: treatment === 'included' && value.ref === '' ? placeholderRef : treatment === 'included' ? value.ref : '' }); }}><option value="">请选择</option><option value="included" disabled={!allowIncluded}>已包含，不再重复算</option><option value="extra">另外加上这笔费用</option>{!locked && <option value="excluded">这次先不算</option>}</select>{value.treatment === 'included' && <details className="plan-scope-amount" open={expand || value.ref === ''}><summary>核对已包含的金额：{value.ref === '' ? '待填写' : money(value.ref)}</summary><CentInput label={`${label}已含金额`} value={value.ref} disabled={disabled} onChange={v => onChange({ ...value, ref: v })}/></details>}</span></FormRow>;
}


/** Both inclusion scopes are reviewed together, without reopening the complete setup. */
export function CostsEditor({ d, patch, frozen, retire, annualPension, completion = false, issue }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; retire: RetireInputs; annualPension: string | null; completion?: boolean; issue?: ConfirmationIssue | null }) {
  const [all, setAll] = useState(false);
  const { pre, post, active, included, overBudget, pendingRows, missingCount } = costReviewRows(d, retire, annualPension);
  const [pending] = useState(() => new Set(pendingRows.map(s => s.key)));
  return <>
    <p role="status">{missingCount ? `还有 ${missingCount} 项费用关系需要确认。` : overBudget ? '已包含的费用金额超过生活费总预算，请核对下方金额。' : '费用关系已填齐，可以保存。'}已确认的设置会保留。</p>
    {overBudget && <p className="notice" role="alert">已包含合计 {money(String(included))}，超过每月生活费 {money(d.budget)}。</p>}
    <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/> 显示已确认的费用</label>
    {([{ title: '退休前：每月存的钱', list: pre, key: 'conScopes', before: true, hint: '每月能存的钱是否已经扣除了这笔费用？尚未发生的计划请选择另外加上或本次不算。', amount: d.contribution }, { title: '退休后：每月生活费', list: post, key: 'retScopes', before: false, hint: '生活费总额是否已经包含这笔费用？已包含时核对其中的金额。', amount: d.budget }] as const).map(group => <fieldset className="form-block plan-scope" key={group.key}><legend>{group.title}</legend><p>当前{group.before ? '每月存的钱' : '每月生活费'}：{group.amount === '' ? '尚未填写' : money(group.amount)}</p><p className="muted small">{group.hint}</p>
      {group.list.filter(s => all || pending.has(group.key + ':' + s.id)).map(s => {
        const value = d[group.key][s.id] ?? { treatment: '', ref: '' };
        const inactive = !active(s.id);
        return <ConfirmationField key={s.id} label={group.key + ':' + s.id} attention={completion && pending.has(group.key + ':' + s.id)} issue={issue} controlLabel={issue?.label === group.key + ':' + s.id && value.treatment === 'included' ? `${s.label}已含金额` : undefined}><ScopeRow expand={issue?.label === group.key + ':' + s.id} allowIncluded={!group.before || !s.id.startsWith('event:') || !!retire.core?.occurrences.some(o => o.status === 'occurred' && s.id.startsWith(`event:${o.event_id}:`))} id={s.id} label={s.label} value={value} placeholderRef={s.cents ?? ''} disabled={frozen} onChange={v => patch({ [group.key]: { ...d[group.key], [s.id]: v } })}/>{inactive && <p className="muted small">计划未纳入，本次不计费用；核对结果保留供重新开启使用。</p>}</ConfirmationField>;
      })}
      {!group.list.length && <p className="muted">没有需要核对的费用。</p>}
    </fieldset>)}
  </>;
}

export function CostsDialog({ sources, saved, today, reload, onPending, onClose, completion = false }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; today: string; reload: () => void; onPending: () => void; onClose: () => void; completion?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => draftOf(saved, null, today)), [error, setError] = useState('');
  const [issue, setIssue] = useState<ConfirmationIssue | null>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const r = saved.profile.retire, b = r.basic!;
  const obsolete = ([['contribution_costs', contributionSources(r, saved.profile.personal_pension_annual_cents)], ['retirement_costs', retirementSources(r, saved.profile.personal_pension_annual_cents)]] as const).reduce((n, [key, list]) => { const seen = new Set<string>(); return n + b[key].filter(c => { const bad = !list.some(s => s.id === c.source_id) || seen.has(c.source_id); seen.add(c.source_id); return bad; }).length; }, 0);
  async function save() {
    if (saver.busy || saver.stuck) return;
    const pending = costReviewRows(d, r, saved.profile.personal_pension_annual_cents).pendingRows[0];
    if (completion && pending) { setIssue(old => ({ label: pending.key, attempt: (old?.attempt ?? 0) + 1 })); return; }
    setIssue(null);
    try { if (await saver.save(costsInput(d, saved))) onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="costs-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 费用核对</p><h2 id="costs-heading">核对有没有重复费用</h2></div><CloseButton type="button" aria-label="关闭费用核对" disabled={saver.busy} onClick={onClose}/><button className="primary" disabled={saver.busy || saver.stuck}>{saver.busy ? '保存中…' : '确认并保存'}</button></header>
    {obsolete > 0 && <p className="notice">有 {obsolete} 条失效或重复的旧费用关系。核对下面的有效费用后，确认保存会清理这些旧关系。</p>}
    <CostsEditor completion={completion} issue={issue} d={d} patch={v => setD(x => ({ ...x, ...v }))} frozen={saver.busy || saver.stuck} retire={saved.profile.retire} annualPension={saved.profile.personal_pension_annual_cents}/>
    {(error || saver.notice) && <p role="alert" className="notice">{error || saver.notice}</p>}
  </form></dialog>;
}
