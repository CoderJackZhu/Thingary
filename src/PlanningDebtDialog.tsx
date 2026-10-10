import { useEffect, useRef, useState } from 'react';
import type { PlanningSources, ProfileState } from './plan';
import type { Account, Snapshot } from './wealth';
import type { DebtRepayment, DebtTreatment } from './plan-core';
import { debtFirstMonth, debtMonth, debtMonthIndex, debtReview, debtTreatmentLabel, validateDebtRepayment } from './plan-debt';
import { CloseButton } from './CloseButton';
import { MonthInput } from './DateInput';
import { CentInput, FormRow } from './FormControls';
import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import { money } from './asset';
import { useSectionSaver } from './planning-basic-data';

type Draft = DebtRepayment & { touched: boolean; term: 'count' | 'last'; count: string };
export function PlanningDebtDialog({ sources, saved, snapshot, accounts, today, reload, onPending, onClose, completion = false }: { sources: PlanningSources; saved: NonNullable<ProfileState['saved']>; snapshot: Snapshot | null; accounts: Account[]; today: string; reload: () => void; onPending: () => void; onClose: () => void; completion?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), saver = useSectionSaver(sources, reload, onPending);
  const review = debtReview(snapshot, saved.profile.retire.core, saved.profile.retire.life_events, undefined, undefined, accounts);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(review.rows.map(r => [r.entry.account_id, { account_id: r.entry.account_id, recorded_on: today, as_of: snapshot!.date, balance_cents: r.entry.amount_cents ?? '', start_month: debtFirstMonth(snapshot!.date), last_month: null, monthly_cents: null, before: null, after: null, ...r.saved, touched: false, term: 'last' as const, count: '' }])));
  const inactive = (saved.profile.retire.core?.debt_repayments ?? []).filter(d => !review.rows.some(r => r.entry.account_id === d.account_id));
  const [remove, setRemove] = useState<string[]>([]), [error, setError] = useState('');
  const [issue, setIssue] = useState<ConfirmationIssue | null>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const frozen = saver.busy || saver.stuck;
  function patch(id: string, fields: Partial<Draft>) { setDrafts(old => ({ ...old, [id]: { ...old[id], ...fields, touched: true } })); }
  async function save() {
    if (frozen) return;
    if (completion) {
      for (const r of review.rows.filter(r => !r.linked && (r.pending.length || r.changed))) {
        const d = drafts[r.entry.account_id];
        const missing = !d.before || !d.after || r.changed && !d.touched ? '还款方式' : (d.before === 'scheduled' || d.after === 'scheduled') && d.monthly_cents === null ? '每月还款' : (d.before === 'scheduled' || d.after === 'scheduled') && (d.term === 'count' ? !d.count : !d.last_month) ? '最后一期' : null;
        if (missing) { setIssue(old => ({ label: r.name + missing, attempt: (old?.attempt ?? 0) + 1 })); return; }
      }
    }
    setIssue(null);
    try {
      const updates: DebtRepayment[] = [];
      for (const r of review.rows) {
        const d = drafts[r.entry.account_id];
        if (!d.touched || r.linked) continue;
        if (r.entry.amount_cents === null) throw new Error(`${r.name}余额未知，请先补齐盘点。`);
        const { touched: _touched, term, count, ...row } = d;
        if (term === 'count') {
          if (count !== '' && (!/^\d+$/.test(count) || +count < 1 || +count > 480)) throw new Error('剩余月数请填 1 到 480 的整数。');
          row.last_month = count === '' ? null : debtMonth(debtMonthIndex(row.start_month) + +count - 1);
        }
        row.recorded_on = today; row.as_of = snapshot!.date; row.balance_cents = r.entry.amount_cents;
        validateDebtRepayment(row); updates.push(row);
      }
      if (!updates.length && !remove.length) { setError('先选择至少一个账户的处理方式，或直接关闭。'); return; }
      setError('');
      if (await saver.save({ section: 'debt_repayments', fields: { updates, remove } })) onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor planning-debt-dialog" aria-labelledby="debt-heading" onCancel={e => { e.preventDefault(); if (!saver.busy) onClose(); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">规划 · 已有贷款</p><h2 id="debt-heading">告诉我你的贷款怎么还</h2><p className="muted">逐个选择，保存后会算入还款，或按你的选择停止提醒。</p></div><CloseButton type="button" aria-label="关闭贷款还款安排" disabled={saver.busy} onClick={onClose}/></header>
    <div className="planning-debt-body">
      {!review.rows.length && <p>这次盘点没有需要安排的负债账户。</p>}
      {inactive.map(d => <label className="plan-choice" key={d.account_id}><input type="checkbox" disabled={frozen} checked={remove.includes(d.account_id)} onChange={e => setRemove(old => e.target.checked ? [...old, d.account_id] : old.filter(id => id !== d.account_id))}/><span>移除未计入本次盘点的旧安排：{accounts.find(a => a.id === d.account_id)?.fields.name ?? '负债账户'}（按你 {d.recorded_on.slice(0, 7)} 填写）</span></label>)}
      {review.rows.map(r => {
        const d = drafts[r.entry.account_id], mode = d.before === d.after ? d.before : null;
        const last = d.term === 'count' && /^\d+$/.test(d.count) && +d.count > 0 ? debtMonth(debtMonthIndex(d.start_month) + +d.count - 1) : d.last_month;
        const months = last ? debtMonthIndex(last) - debtMonthIndex(d.start_month) + 1 : null;
        return <fieldset className="form-block planning-debt-row" key={r.entry.account_id}><legend>{r.name}</legend><p>截至 {snapshot!.date} · 余额 {r.entry.amount_cents === null ? '未知' : money(r.entry.amount_cents)}</p>
          {r.saved && <p className="muted small">按你 {r.saved.recorded_on.slice(0, 7)} 填写的安排 · {r.saved.before === r.saved.after ? debtTreatmentLabel(r.saved.before) : `退休前：${debtTreatmentLabel(r.saved.before)}；退休后：${debtTreatmentLabel(r.saved.after)}`}</p>}
          {r.changed && <p className="notice">原余额 {money(r.saved!.balance_cents)}，这次余额明显变化，请复核。{r.zero && '余额已归零，独立还款已停用。'}</p>}
          {r.linked ? <p>已在“{r.linked.label}”中安排还款，这里不会重复计算。需要修改时请核对该计划。</p> : <>
            <ConfirmationField label={r.name + '还款方式'} attention={completion && (!d.before || !d.after || r.changed && !d.touched)} issue={issue}><div role="radiogroup" aria-label={`${r.name}还款方式`} className="planning-debt-choices">{([{ value: 'scheduled', label: '每月还一笔固定金额，单独算上' }, { value: 'included', label: '这笔还款已经含在我的每月开销里' }, { value: 'excluded', label: '这次先不考虑' }] as const).map(o => <label className="plan-choice" key={o.value}><input type="radio" name={`debt-${r.entry.account_id}`} aria-label={`${r.name}：${o.label}`} checked={mode === o.value} disabled={frozen || r.entry.amount_cents === null} onChange={() => patch(r.entry.account_id, { before: o.value, after: o.value })}/><span>{o.label}</span></label>)}</div></ConfirmationField>
            {(d.before === 'scheduled' || d.after === 'scheduled') && <div>
              <ConfirmationField label={r.name + '每月还款'} attention={completion && d.monthly_cents === null} issue={issue}><FormRow label="每月实际还款" hint="你每月实际付出的钱，本金加利息一起，不是剩余本金"><CentInput label={`${r.name}每月还款`} value={d.monthly_cents ?? ''} disabled={frozen} onChange={v => patch(r.entry.account_id, { monthly_cents: v === '' ? null : v })}/></FormRow></ConfirmationField>
              <p className="muted small">从 {d.start_month} 开始；起止月份固定保存，不因新盘点重新开始。</p>
              <FormRow label="剩余期限"><select aria-label={`${r.name}期限填写方式`} value={d.term} disabled={frozen} onChange={e => patch(r.entry.account_id, { term: e.target.value as Draft['term'] })}><option value="last">最后一期月份</option><option value="count">还剩多少个月</option></select></FormRow>
              <ConfirmationField label={r.name + '最后一期'} attention={completion && (d.term === 'count' ? !d.count : !d.last_month)} issue={issue}>{d.term === 'count' ? <FormRow label="还剩几个月"><input aria-label={`${r.name}剩余月数`} inputMode="numeric" value={d.count} disabled={frozen} onChange={e => patch(r.entry.account_id, { count: e.target.value })}/></FormRow> : <FormRow label="最后一期"><MonthInput label={`${r.name}最后一期`} value={d.last_month ?? ''} min={d.start_month} disabled={frozen} allowClear onChange={v => patch(r.entry.account_id, { last_month: v || null })}/></FormRow>}</ConfirmationField>
              <p className="muted small">{d.monthly_cents !== null && months !== null && months > 0 && months <= 480 ? `每月 ${money(d.monthly_cents)} × ${months} 个月 = ${money(String(BigInt(d.monthly_cents) * BigInt(months)))}，不是剩余本金。` : '未知可以留空；未填完整的还款仍会显示待核对。'}</p>
            </div>}
            {mode === 'included' && <p className="muted small">默认同时适用于退休前与退休后，不另外扣款，也不自动增加到期后的生活费。</p>}
            {mode === 'excluded' && <p className="muted small">不再催办；结果仍会说明还款未计入，所需投入可能偏低。</p>}
            <details><summary>更细：分别设置退休前与退休后</summary><p className="muted small">退休前指已从每月能存的钱里扣除；退休后指已含在生活费里。另一适用段留空仍待核对。</p>{(['before', 'after'] as const).map(phase => <FormRow key={phase} label={phase === 'before' ? '退休前' : '退休后'}><select aria-label={`${r.name}${phase === 'before' ? '退休前' : '退休后'}`} value={d[phase] ?? ''} disabled={frozen} onChange={e => patch(r.entry.account_id, { [phase]: (e.target.value || null) as DebtTreatment })}><option value="">尚未处理</option><option value="scheduled">每月还一笔固定金额，单独算上</option><option value="included">已含在每月开销里</option><option value="excluded">这次先不考虑</option></select></FormRow>)}</details>
            {r.saved && <button type="button" className="ui-link" disabled={frozen} onClick={() => patch(r.entry.account_id, {})}>确认这份安排仍适用</button>}
          </>}
        </fieldset>;
      })}
    </div>
    {(error || saver.notice) && <p className="notice" role="alert">{error || saver.notice}</p>}
    <footer><p className="muted small">可保存部分账户；关闭不保存本次填写。</p><button type="button" disabled={saver.busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={frozen || !review.rows.some(r => !r.linked) && !inactive.length}>{saver.busy ? '保存中…' : '保存，查看结果'}</button></footer>
  </form></dialog>;
}
