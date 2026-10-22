import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import { moneyText } from '../format';
import type { Overview, SubscriptionDetailData } from '../../recurring';
import { periodLabel } from '../../recurring-model';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DateField, DeleteSheet, FormGroup, FormRow, MoneyField, SegmentedControl, TextAreaField } from '../ui';
import { paymentDraft, paymentSave, validatePayment } from './forms';
import type { PaymentDraft } from './forms';
import { EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
/** spending.payment: confirm, skip or correct one payment period. */
export default function PaymentEdit({ params }: PageProps) {
  const plan = String(params.plan ?? ''), due = String(params.due ?? '');
  const read = useRead(async () => {
    const [overview, detail] = await Promise.all([invoke<Overview>('recurring_overview'), invoke<SubscriptionDetailData>('recurring_detail', { planId: plan })]);
    if (overview.generation !== detail.generation) throw new Error(t('资料刚刚发生变化，请重试。'));
    return { overview, detail };
  }, `${plan}:${due}`);
  return <Loaded nav read={read} what={t('付款期次')}>{({ overview, detail }) => <Form overview={overview} detail={detail} due={due}/>}</Loaded>;
}

function Form({ overview, detail, due }: { overview: Overview; detail: SubscriptionDetailData; due: string }) {
  const { today } = useSession(), saver = useSaver(), plan = detail.plan;
  const record = detail.payments.find(p => p.due_date === due) ?? null;
  const item = [...overview.due, ...overview.upcoming].find(d => d.plan_id === plan.id && d.due_date === due) ?? null;
  const [d, setD] = useState<PaymentDraft>(() => paymentDraft(record, due, item?.amount_cents ?? plan.fields.amount_cents, today)), [problem, setProblem] = useState(''), [asking, setAsking] = useState(false);
  useDirtyGuard(useFormChanged(d));
  const set = (patch: Partial<PaymentDraft>) => { setProblem(''); setD(x => ({ ...x, ...patch })); };
  const coverage = record?.coverage_start && record.coverage_end ? [record.coverage_start, record.coverage_end] : item?.coverage_start && item.coverage_end ? [item.coverage_start, item.coverage_end] : null;
  function save() {
    const check = validatePayment(d);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'recurring_payment_save', input: paymentSave(d, { plan_id: plan.id, due_date: due }, record, detail.generation, requestId), label: `${plan.fields.name} ${due}` }), { close: true });
  }
  function remove() {
    if (!record) return;
    void saver.run(requestId => trash('payment', record.id, record.revision, detail.generation, `${plan.fields.name} ${due} 付款`, requestId), { close: true });
  }
  return <EditorFrame title={record ? t('更正付款记录') : t('确认付款')} onSave={save} busy={saver.busy} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">{t('{name} · {due} 这一期。', { name: plan.fields.name, due })}{record ? t('按这笔记录的实际情况更正。') : t('计划金额 {v1}。', { v1: moneyText(item?.amount_cents ?? plan.fields.amount_cents) })}{coverage ? t(' 对应服务：{v1}。', { v1: periodLabel(coverage[0], coverage[1]) }) : ''}{t('实付日期填真正扣款的那一天；确认付款不会改变账户余额。')}</p>
    <div className="sp-pad-x"><SegmentedControl label={t('这一期')} value={d.state} items={[{ id: 'paid', label: t('已付') }, { id: 'skipped', label: t('本期不付') }]} onChange={state => set({ state })}/></div>
    {d.state === 'paid' && <FormGroup>
      <DateField label={t('实付日期')} value={d.paid} max={today} onChange={v => set({ paid: v })} disabled={saver.busy}/>
      <MoneyField label={t('实付金额')} value={d.amount} onChange={amount => set({ amount })} disabled={saver.busy}/>
    </FormGroup>}
    {d.state === 'skipped' && <FormGroup><FormRow label={t('说明')}><span className="sp-note">{t('不计入重要支出，也不再出现在待确认里。')}</span></FormRow></FormGroup>}
    <FormGroup><TextAreaField label={t('备注')} value={d.notes} onChange={notes => set({ notes })} disabled={saver.busy}/></FormGroup>
    {record && <Button variant="danger" block disabled={saver.busy} onClick={() => setAsking(true)}>{t('删除误记，改回待确认')}</Button>}
    {asking && <DeleteSheet name={t('{due} 付款记录', { due })} busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove}/>}
  </EditorFrame>;
}
