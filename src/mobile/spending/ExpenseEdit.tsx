import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { submit } from '../../wealth';
import type { Expense, ExpenseFields, ExpenseView } from '../../expenses';
import { expenseCategories } from '../../expenses';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, DeleteSheet, FormGroup, FormRow, MoneyField, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { blankExpense, expenseSave, toggleRefund, validateExpense } from './forms';
import { EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';

/** spending.expenseEdit: record, edit or delete a standalone important expense, with an optional refund. */
export default function ExpenseEdit({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const [view, expense] = await Promise.all([invoke<ExpenseView>('expense_view', { year: null }), id ? invoke<Expense | null>('expense', { id }) : Promise.resolve(null)]);
    if (id && !expense) throw new Error('这笔支出已不存在，可能已被删除。');
    return { generation: view.generation, expense };
  }, id ?? 'new');
  return <Loaded nav read={read} what="支出">{data => <Form generation={data.generation} expense={data.expense}/>}</Loaded>;
}

function Form({ generation, expense }: { generation: string; expense: Expense | null }) {
  const { today } = useSession(), saver = useSaver();
  const [f, setF] = useState<ExpenseFields>(() => expense?.fields ?? blankExpense(today)), [asking, setAsking] = useState(false), [problem, setProblem] = useState('');
  const set = <K extends keyof ExpenseFields>(key: K, value: ExpenseFields[K]) => { setProblem(''); setF(x => ({ ...x, [key]: value })); };
  const refund = f.refund_date !== null;
  useEffect(() => { if (!asking) saver.setError(''); }, [asking]);
  function save() {
    const check = validateExpense(f);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'expense_save', input: expenseSave(f, expense, generation, requestId), label: `支出 ${f.title.trim()}` }), { close: true });
  }
  function remove() {
    if (!expense) return;
    void saver.run(requestId => trash('expense', expense.id, expense.revision, generation, f.title, requestId), { close: true });
  }
  return <EditorFrame title={expense ? '编辑支出' : '记一笔支出'} onSave={save} busy={saver.busy} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">记录没有对应物品的大额花费。买了物品请直接新增物品，购入会自动计入。</p>
    <FormGroup>
      <TextField label="名称" value={f.title} onChange={v => set('title', v)} placeholder="例如：东京旅行" maxLength={80} disabled={saver.busy}/>
      <MoneyField label="金额" value={f.amount_cents} onChange={v => set('amount_cents', v)} disabled={saver.busy}/>
      <DateField label="日期" value={f.date} onChange={v => set('date', v)} disabled={saver.busy}/>
      <SelectField label="分类" value={f.category} onChange={v => set('category', v)} options={expenseCategories.map(([id, label]) => ({ id, label }))} disabled={saver.busy}/>
    </FormGroup>
    <FormGroup title="退款" footer="退款按退款日期计入，不改写原支出的日期。">
      <FormRow label="有退款"><Switch label="有退款" checked={refund} onChange={on => setF(x => toggleRefund(x, on, today))} disabled={saver.busy}/></FormRow>
      {refund && <>
        <MoneyField label="退款金额" value={f.refund_cents ?? ''} onChange={v => set('refund_cents', v || null)} disabled={saver.busy}/>
        <DateField label="退款日期" value={f.refund_date ?? ''} onChange={v => set('refund_date', v)} disabled={saver.busy}/>
      </>}
    </FormGroup>
    <FormGroup><TextAreaField label="备注" value={f.notes} onChange={v => set('notes', v)} disabled={saver.busy}/></FormGroup>
    {expense && <Button variant="danger" block disabled={saver.busy} onClick={() => setAsking(true)}>删除这笔支出</Button>}
    {asking && <DeleteSheet name={f.title} busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove}/>}
  </EditorFrame>;
}
