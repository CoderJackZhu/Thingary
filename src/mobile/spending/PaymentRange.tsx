import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import type { Overview } from '../../recurring';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { FormGroup, FormRow, MoneyField, SelectField, Switch } from '../ui';
import { rangeCount, rangeDates, rangeSave, validateRange } from './forms';
import type { RangeDraft } from './forms';
import { EditorFrame, Loaded } from './parts';
import { useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
/** spending.paymentRange: record several past periods as paid in one step. */
export default function PaymentRange({ params }: PageProps) {
  const id = String(params.plan ?? '');
  const read = useRead(() => invoke<Overview>('recurring_overview'), id);
  return <Loaded nav read={read} what={t('计划')}>{overview => {
    const plan = overview.plans.find(p => p.id === id);
    return plan ? <Form overview={overview} planId={id}/> : <p className="sp-note sp-note-pad">{t('这个计划已不存在。')}</p>;
  }}</Loaded>;
}

function Form({ overview, planId }: { overview: Overview; planId: string }) {
  const { today } = useSession(), saver = useSaver(), plan = overview.plans.find(p => p.id === planId)!;
  const dates = rangeDates(plan, today);
  const [d, setD] = useState<RangeDraft>({ from: dates[0] ?? '', to: dates.at(-1) ?? '', amount: plan.fields.amount_cents, confirmed: false }), [problem, setProblem] = useState('');
  useDirtyGuard(useFormChanged(d));
  const set = (patch: Partial<RangeDraft>) => { setProblem(''); setD(x => ({ ...x, ...patch })); };
  const count = rangeCount(dates, d), options = dates.map(x => ({ id: x, label: x }));
  function save() {
    const check = validateRange(dates, d);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'recurring_payment_range_save', input: rangeSave(plan, d, overview.generation, requestId), label: t('{name} 往期付款补记', { name: plan.fields.name }) }), { close: true });
  }
  return <EditorFrame title={t('补记往期付款')} onSave={save} busy={saver.busy} canSave={dates.length > 0} error={problem || saver.error}>
    <p className="sp-note sp-note-pad">{t('{name}。只补尚未记录的期，不覆盖已付或跳过的记录；实付日期按每期付款日记录，之后可单独更正。', { name: plan.fields.name })}</p>
    {!dates.length ? <p className="sp-note sp-note-pad">{t('暂无可补记的期次。')}</p> : <>
      <FormGroup footer={t('选中 {count} 期。', { count })}>
        <SelectField label={t('从')} value={d.from} onChange={from => set({ from })} options={options} disabled={saver.busy}/>
        <SelectField label={t('到')} value={d.to} onChange={to => set({ to })} options={options} disabled={saver.busy}/>
        <MoneyField label={t('每期实付')} value={d.amount} onChange={amount => set({ amount })} disabled={saver.busy}/>
      </FormGroup>
      <FormGroup footer={t('确认后这些期次会记为已付并计入重要支出。')}>
        <FormRow label={t('我确认这些期都已实际付款')}><Switch label={t('确认已付')} checked={d.confirmed} onChange={confirmed => set({ confirmed })} disabled={saver.busy}/></FormRow>
      </FormGroup>
    </>}
  </EditorFrame>;
}
