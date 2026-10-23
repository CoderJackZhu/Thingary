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
import { t } from './i18n.ts';
function ScopeRow({ id, label, value, placeholderRef, disabled, onChange, allowIncluded = true, expand = false }: { id: string; label: string; value: ScopeDraft; placeholderRef: string; disabled: boolean; onChange: (v: ScopeDraft) => void; allowIncluded?: boolean; expand?: boolean }) {
  const locked = mustStayInLedger(id);
  if (locked && value.treatment === 'excluded') value = { treatment: '', ref: '' };
  return <FormRow label={label}><span className="plan-scope-row"><select aria-label={t('{label}是否已含在生活费里', { label })} value={value.treatment} disabled={disabled} onChange={e => { const treatment = e.target.value as ScopeDraft['treatment']; onChange({ treatment, ref: treatment === 'included' && value.ref === '' ? placeholderRef : treatment === 'included' ? value.ref : '' }); }}><option value="">{t('请选择')}</option><option value="included" disabled={!allowIncluded}>{t('已包含，不再重复算')}</option><option value="extra">{t('另外加上这笔费用')}</option>{!locked && <option value="excluded">{t('这次先不算')}</option>}</select>{value.treatment === 'included' && <details className="plan-scope-amount" open={expand || value.ref === ''}><summary>{t('核对已包含的金额：')}{value.ref === '' ? t('待填写') : money(value.ref)}</summary><CentInput label={t('{label}已含金额', { label })} value={value.ref} disabled={disabled} onChange={v => onChange({ ...value, ref: v })}/></details>}</span></FormRow>;
}


/** Both inclusion scopes are reviewed together, without reopening the complete setup. */
export function CostsEditor({ d, patch, frozen, retire, completion = false, issue }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; retire: RetireInputs; completion?: boolean; issue?: ConfirmationIssue | null }) {
  const [all, setAll] = useState(false);
  const { pre, post, active, included, overBudget, pendingRows, missingCount } = costReviewRows(d, retire);
  const [pending] = useState(() => new Set(pendingRows.map(s => s.key)));
  return <>
    <p role="status">{missingCount ? t('还有 {missingCount} 项费用关系需要确认。', { missingCount }) : overBudget ? t('已包含的费用金额超过生活费总预算，请核对下方金额。') : t('费用关系已填齐，可以保存。')}{t('已确认的设置会保留。')}</p>
    {overBudget && <p className="notice" role="alert">{t('已包含合计 {v1}，超过每月生活费 {v2}。', { v1: money(String(included)), v2: money(d.budget) })}</p>}
    <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)}/> {t('显示已确认的费用')}</label>
    {([{ title: t('退休前：每月存的钱'), list: pre, key: 'conScopes', before: true, hint: t('每月能存的钱是否已经扣除了这笔费用？尚未发生的计划请选择另外加上或本次不算。'), amount: d.contribution }, { title: t('退休后：每月生活费'), list: post, key: 'retScopes', before: false, hint: t('生活费总额是否已经包含这笔费用？已包含时核对其中的金额。'), amount: d.budget }] as const).map(group => <fieldset className="form-block plan-scope" key={group.key}><legend>{group.title}</legend><p>{t('当前')}{group.before ? t('每月存的钱') : t('每月生活费')}：{group.amount === '' ? t('尚未填写') : money(group.amount)}</p><p className="muted small">{group.hint}</p>
      {group.list.filter(s => all || pending.has(group.key + ':' + s.id)).map(s => {
        const value = d[group.key][s.id] ?? { treatment: '', ref: '' };
        const inactive = !active(s.id);
        return <ConfirmationField key={s.id} label={group.key + ':' + s.id} attention={completion && pending.has(group.key + ':' + s.id)} issue={issue} controlLabel={issue?.label === group.key + ':' + s.id && value.treatment === 'included' ? t('{label}已含金额', { label: s.label }) : undefined}><ScopeRow expand={issue?.label === group.key + ':' + s.id} allowIncluded={!group.before || !s.id.startsWith('event:') || !!retire.core?.occurrences.some(o => o.status === 'occurred' && s.id.startsWith(`event:${o.event_id}:`))} id={s.id} label={s.label} value={value} placeholderRef={s.cents ?? ''} disabled={frozen} onChange={v => patch({ [group.key]: { ...d[group.key], [s.id]: v } })}/>{inactive && <p className="muted small">{t('计划未纳入，本次不计费用；核对结果保留供重新开启使用。')}</p>}</ConfirmationField>;
      })}
      {!group.list.length && <p className="muted">{t('没有需要核对的费用。')}</p>}
    </fieldset>)}
  </>;
}

export function CostsDialog({ sources, saved, reload, onPending, onClose, completion = false }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; reload: () => void; onPending: () => void; onClose: () => void; completion?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const [d, setD] = useState(() => draftOf(saved, null)), [error, setError] = useState('');
  const [issue, setIssue] = useState<ConfirmationIssue | null>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const r = saved.profile.retire, b = r.basic!;
  const obsolete = ([['contribution_costs', contributionSources(r)], ['retirement_costs', retirementSources(r)]] as const).reduce((n, [key, list]) => { const seen = new Set<string>(); return n + b[key].filter(c => { const bad = !list.some(s => s.id === c.source_id) || seen.has(c.source_id); seen.add(c.source_id); return bad; }).length; }, 0);
  async function save() {
    if (saver.busy || saver.stuck) return;
    const pending = costReviewRows(d, r).pendingRows[0];
    if (completion && pending) { setIssue(old => ({ label: pending.key, attempt: (old?.attempt ?? 0) + 1 })); return; }
    setIssue(null);
    try { if (await saver.save(costsInput(d, saved))) onClose(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="costs-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">{t('规划 · 费用核对')}</p><h2 id="costs-heading">{t('核对有没有重复费用')}</h2></div><CloseButton type="button" aria-label={t('关闭费用核对')} disabled={saver.busy} onClick={onClose}/><button className="primary" disabled={saver.busy || saver.stuck}>{saver.busy ? t('保存中…') : t('确认并保存')}</button></header>
    {obsolete > 0 && <p className="notice">{t('有 {obsolete} 条失效或重复的旧费用关系。核对下面的有效费用后，确认保存会清理这些旧关系。', { obsolete })}</p>}
    <CostsEditor completion={completion} issue={issue} d={d} patch={v => setD(x => ({ ...x, ...v }))} frozen={saver.busy || saver.stuck} retire={saved.profile.retire}/>
    {(error || saver.notice) && <p role="alert" className="notice">{error || saver.notice}</p>}
  </form></dialog>;
}
