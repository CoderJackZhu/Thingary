import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import { moneyText } from '../format';
import type { Overview, SubscriptionDetailData } from '../../recurring';
import { periodLabel } from '../../recurring-model';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { DateField, FormGroup, FormRow, MoneyField, SegmentedControl, TextAreaField } from '../ui';
import { paymentDraft, paymentSave, validatePayment } from './forms';
import type { PaymentDraft } from './forms';
import { EditorFrame, Loaded } from './parts';
import { useRead, useSaver } from './read';

/** spending.payment: confirm, skip or correct one payment period. */
export default function PaymentEdit({ params }: PageProps) {
  const plan = String(params.plan ?? ''), due = String(params.due ?? '');
  const read = useRead(async () => {
    const [overview, detail] = await Promise.all([invoke<Overview>('recurring_overview'), invoke<SubscriptionDetailData>('recurring_detail', { planId: plan })]);
    if (overview.generation !== detail.generation) throw new Error('资料刚刚发生变化，请重试。');
    return { overview, detail };
  }, `${plan}:${due}`);
  return <Loaded nav read={read} what="付款期次">{({ overview, detail }) => <Form overview={overview} detail={detail} due={due}/>}</Loaded>;
}

function Form({ overview, detail, due }: { overview: Overview; detail: SubscriptionDetailData; due: string }) {
  const { today } = useSession(), saver = useSaver(), plan = detail.plan;
  const record = detail.payments.find(p => p.due_date === due) ?? null;
  const item = [...overview.due, ...overview.upcoming].find(d => d.plan_id === plan.id && d.due_date === due) ?? null;
  const [d, setD] = useState<PaymentDraft>(() => paymentDraft(record, due, item?.amount_cents ?? plan.fields.amount_cents, today)), [problem, setProblem] = useState('');
  useDirtyGuard(useFormChanged(d));
  const set = (patch: Partial<PaymentDraft>) => { setProblem(''); setD(x => ({ ...x, ...patch })); };
  const coverage = record?.coverage_start && record.coverage_end ? [record.coverage_start, record.coverage_end] : item?.coverage_start && item.coverage_end ? [item.coverage_start, item.coverage_end] : null;
  function save() {
    const check = validatePayment(d);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'recurring_payment_save', input: paymentSave(d, { plan_id: plan.id, due_date: due }, record, detail.generation, requestId), label: `${plan.fields.name} ${due}` }), { close: true });
  }
  return <EditorFrame title={record ? '更正付款记录' : '确认付款'} onSave={save} busy={saver.busy} error={problem || saver.error}>
    <p className="sp-note sp-note-pad">{plan.fields.name} · {due} 这一期。{record ? '按这笔记录的实际情况更正。' : `计划金额 ${moneyText(item?.amount_cents ?? plan.fields.amount_cents)}。`}{coverage ? ` 对应服务：${periodLabel(coverage[0], coverage[1])}。` : ''}实付日期填真正扣款的那一天；确认付款不会改变账户余额。</p>
    <div className="sp-pad-x"><SegmentedControl label="这一期" value={d.state} items={[{ id: 'paid', label: '已付' }, { id: 'skipped', label: '本期不付' }]} onChange={state => set({ state })}/></div>
    {d.state === 'paid' && <FormGroup>
      <DateField label="实付日期" value={d.paid} max={today} onChange={v => set({ paid: v })} disabled={saver.busy}/>
      <MoneyField label="实付金额" value={d.amount} onChange={amount => set({ amount })} disabled={saver.busy}/>
    </FormGroup>}
    {d.state === 'skipped' && <FormGroup><FormRow label="说明"><span className="sp-note">不计入重要支出，也不再出现在待确认里。</span></FormRow></FormGroup>}
    <FormGroup><TextAreaField label="备注" value={d.notes} onChange={notes => set({ notes })} disabled={saver.busy}/></FormGroup>
  </EditorFrame>;
}
