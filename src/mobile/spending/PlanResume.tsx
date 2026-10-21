import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { pendingSubscriptionStart } from '../../recurring';
import type { Plan, SubscriptionDetailData } from '../../recurring';
import type { LinkView } from '../../link';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { DateField, FormGroup, FormRow, MoneyField, SelectField, Switch } from '../ui';
import { resumeContext, resumeCycles, resumeDraft, resumeSave, validateResume } from './forms';
import type { ResumeDraft } from './forms';
import { readLink } from './PlanActions';
import { EditorFrame, Loaded } from './parts';
import { useRead, useSaver } from './read';

/** spending.planResume: resubscribe an ended subscription in its original archive. */
export default function PlanResume({ params }: PageProps) {
  const id = String(params.id ?? '');
  const read = useRead(async () => {
    const [detail, link] = await Promise.all([invoke<SubscriptionDetailData>('recurring_detail', { planId: id }), readLink('plan', id)]);
    if (detail.generation !== link.generation) throw new Error('资料刚刚发生变化，请重试。');
    return { plan: detail.plan, link };
  }, id);
  return <Loaded read={read} what="订阅">{({ plan, link }) => <Form plan={plan} link={link}/>}</Loaded>;
}

function Form({ plan, link }: { plan: Plan; link: LinkView }) {
  const { today } = useSession(), saver = useSaver(), pending = pendingSubscriptionStart(plan, today);
  const [d, setD] = useState<ResumeDraft>(() => resumeDraft(plan, pending, today)), [problem, setProblem] = useState('');
  const set = (patch: Partial<ResumeDraft>) => { setProblem(''); setD(x => ({ ...x, ...patch })); };
  const { minimum } = resumeContext(plan, pending);
  function save() {
    const check = validateResume(plan, pending, d);
    if (!check.ok) { setProblem(check.message); return; }
    void saver.run(requestId => submit({ command: 'recurring_resume', input: resumeSave(plan, link, pending, d, requestId), label: `重新订阅 ${plan.fields.name}` }), { close: true });
  }
  return <EditorFrame title="重新订阅" onSave={save} busy={saver.busy} error={problem || saver.error}>
    <p className="sp-note sp-note-pad">「{plan.fields.name}」在原档案里开始新的一段服务；上一段与它的付款保持原样，中间停订的时间不计入费用估算。</p>
    <FormGroup>
      <DateField label="服务生效日期" value={d.start} min={minimum} onChange={v => set({ start: v })} disabled={saver.busy} hint="须晚于上段最后使用日"/>
      <SelectField label="付款周期" value={d.cycle} onChange={cycle => set({ cycle })} options={resumeCycles(plan)} disabled={saver.busy}/>
      <MoneyField label="每期价格" value={d.amount} onChange={amount => set({ amount })} disabled={saver.busy}/>
      <FormRow label="首期付款日另算"><Switch label="首期付款日另算" checked={d.separateDue} onChange={separateDue => set({ separateDue })} disabled={saver.busy}/></FormRow>
      {d.separateDue && <DateField label="首期计划付款日" value={d.due} min={minimum} onChange={v => set({ due: v })} disabled={saver.busy}/>}
    </FormGroup>
  </EditorFrame>;
}
