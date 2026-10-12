import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow } from './FormControls';
import type { Income, IncomeFields, IncomeSave } from './plan';
import type { Account } from './wealth';
import { submit, Unresolved } from './wealth';
import { DeleteButton } from './WealthPage';
import { classifyIncome, incomeCategories, incomeClassificationIssue, isInvestmentIncome } from './income-classification';

const blank = (today: string): IncomeFields => ({ date: today, net_cents: '', hpf_cents: null, notes: '', category: 'unclassified', source_account_id: null, destination: null, receiving_account_id: null });

export function IncomeDialog({ income, generation, today, hpfDefault, accounts = [], accountsEnabled = true, onSavedIncome, onClose }: { income: Income | null; generation: string; today: string; hpfDefault: string; accounts?: Account[]; accountsEnabled?: boolean; onSavedIncome?: (income: Income) => void; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false), alive = useRef(true);
  // 新增只带入最新记录的已知缴存；最新未知时留空，不回溯。
  const [f, setF] = useState<IncomeFields>(income?.fields ?? { ...blank(today), hpf_cents: hpfDefault || null });
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { alive.current = true; dialog.current?.showModal(); document.getElementById('income-date')?.focus(); return () => { alive.current = false; dialog.current?.close(); }; }, []);
  const set = <K extends keyof IncomeFields>(k: K, v: IncomeFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  const investment = isInvestmentIncome(f);
  const [depositConfirmed, setDepositConfirmed] = useState(false);
  const [depositEdited, setDepositEdited] = useState(false);
  const changedToInvestment = investment && !isInvestmentIncome(income?.fields ?? {}) && f.hpf_cents !== null;
  const accountOptions = (selected: string | null | undefined) => <>
    <option value="">未指定</option>
    {selected && !accounts.some(a => a.id === selected) && <option value={selected}>原关联账户（当前不可用）</option>}
    {accounts.filter(a => a.fields.side === 'asset' && (a.id === selected || ((!a.fields.closed_on || a.fields.closed_on >= f.date) && a.fields.opened_on <= f.date))).map(a => <option key={a.id} value={a.id}>{a.fields.name}{a.fields.closed_on ? '（已关闭）' : ''}</option>)}
  </>;
  async function save() {
    if (saving.current || frozen) return;
    const stop = (label: string, message: string) => { setNotice(message); document.querySelector<HTMLElement>(`dialog [aria-label="${label}"]`)?.focus(); };
    if (!f.date) return stop('到账日期', '请填写到账日期。');
    if (incomeClassificationIssue(f)) { setNotice(incomeClassificationIssue(f)!); return; }
    if (changedToInvestment && !depositConfirmed) { setNotice('请确认保留这笔收入已有的公积金缴存事实，或更正该金额。'); return; }
    if (f.net_cents === '') return stop('税后到账', '请填写税后到账金额；没有到账就填 0。');
    const input: IncomeSave = { request_id: crypto.randomUUID(), generation, id: income?.id ?? null, expected_revision: income?.revision ?? null, fields: f };
    saving.current = true; setBusy(true); setNotice('');
    try { const saved = await submit<Income>({ command: 'plan_income_save', input, label: `收入 ${f.date}` }); if (alive.current) { onSavedIncome?.(saved); onClose(true); } }
    catch (e) { if (alive.current) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); } }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="income-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">收支记录 · 实际收入</p><h2 id="income-heading">{income ? '编辑收入' : '记一笔收入'}</h2><p className="muted">记录实际到账的税后收入和公积金缴存，同日可多笔。缴存留空表示未知，填 0 表示明确没有。</p></div><CloseButton type="button" aria-label="关闭收入表单" disabled={busy} onClick={() => onClose(false)}/><div className="editor-header-actions">{income && !stuck && <DeleteButton label="删除" disabled={busy} kind="income" id={income.id} revision={income.revision} generation={generation} name={`收入 ${income.fields.date}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存收入'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="到账日期" hint="同一天可以有多行，例如工资与奖金分开发放"><DateInput yearIntent="past" id="income-date" value={f.date} max={today} disabled={frozen} onChange={v => set('date', v)}/></FormRow>
      <FormRow label="来源分类" hint="旧记录保留未分类，不自动判断为工资"><select aria-label="来源分类" value={f.category ?? 'unclassified'} disabled={frozen} onChange={e => {
        const category = e.target.value as NonNullable<IncomeFields['category']>;
        if (!accountsEnabled && f.destination && !isInvestmentIncome({ category })) { setNotice('账户模块已关闭；此分类变更会移除已有账户去向，请先启用账户模块后更正。'); return; }
        const next = classifyIncome(f, category);
        if (!accountsEnabled) { next.source_account_id = f.source_account_id; next.receiving_account_id = f.receiving_account_id; next.destination = f.destination; }
        // A suggested deposit is not a user-entered fact; investment income does not inherit it.
        if (!income && !depositEdited && isInvestmentIncome(next)) next.hpf_cents = null;
        setF(next); setDepositConfirmed(false);
      }}>{Object.entries(incomeCategories).map(([key, label]) => <option key={key} value={key} disabled={!accountsEnabled && !!f.destination && !isInvestmentIncome({ category: key as NonNullable<IncomeFields['category']> })}>{label}</option>)}</select></FormRow>
      <FormRow label="税后到账" hint="实际收到的净额；转入本金不属于收入，账户涨跌也不记在这里"><CentInput label="税后到账" value={f.net_cents} disabled={frozen} placeholder="0.00" onChange={v => set('net_cents', v)}/></FormRow>
      {(!investment || f.hpf_cents !== null) && <FormRow label="公积金缴存" hint={!income && hpfDefault ? '已带入最新一条的已知金额，可改；留空表示未知，填 0 表示明确没有' : '个人与单位合计；留空表示未知，填 0 表示明确没有'}><CentInput label="公积金缴存" value={f.hpf_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => { set('hpf_cents', v === '' ? null : v); setDepositEdited(true); setDepositConfirmed(false); }}/></FormRow>}
      {changedToInvestment && <label><input type="checkbox" checked={depositConfirmed} disabled={frozen} onChange={e => setDepositConfirmed(e.target.checked)}/>确认保留已有公积金缴存事实，不因分类变化删除</label>}
      <details><summary>关联账户（选填）</summary>{!accountsEnabled && <p className="muted small">账户模块已关闭；保留已有引用，暂不可编辑账户关联。</p>}
        <FormRow label="来源账户" hint="不确定可以留空；不会据此更改账户余额"><select aria-label="来源账户" value={f.source_account_id ?? ''} disabled={frozen || !accountsEnabled} onChange={e => set('source_account_id', e.target.value || null)}>{accountOptions(f.source_account_id)}</select></FormRow>
        {investment && <><FormRow label="收入去向"><select aria-label="收入去向" value={f.destination ?? 'unknown'} disabled={frozen || !accountsEnabled} onChange={e => setF(x => ({ ...x, destination: e.target.value as IncomeFields['destination'], receiving_account_id: e.target.value === 'transferred' ? x.receiving_account_id : null }))}><option value="unknown">去向未确认</option><option value="retained">留在来源账户（包括再投资）</option><option value="transferred">转到其他账户</option></select></FormRow>
        {f.destination === 'transferred' && <FormRow label="接收账户"><select aria-label="接收账户" value={f.receiving_account_id ?? ''} disabled={frozen || !accountsEnabled} onChange={e => set('receiving_account_id', e.target.value || null)}>{accountOptions(f.receiving_account_id)}</select></FormRow>}
        <p className="muted small">利息与现金分红用于核对收入构成，不重复加到投资损益。未关联账户的记录保留在未归属明细。</p></>}
      </details>
    </section>
    <section className="form-block form-notes"><label htmlFor="income-notes">备注</label><textarea id="income-notes" maxLength={500} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
