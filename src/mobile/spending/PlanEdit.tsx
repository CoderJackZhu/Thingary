import { useState } from 'react';
import { useDirtyGuard, useFormChanged } from '../nav-context';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import type { Overview, Plan } from '../../recurring';
import { recurringCategories } from '../../recurring';
import { submit } from '../../wealth';
import type { PageProps } from '../routes';
import { useSession } from '../session';
import { Button, DeleteSheet, FormGroup, FormRow, Notice, SelectField, Switch, TextAreaField, TextField } from '../ui';
import { backfillDefault, backfillRange, blankPlanDraft, pastDues, planDraftFrom, planFieldsFromDraft, planSave, validatePlanDraft } from './forms';
import type { PlanDraft } from './forms';
import { GroupDeleteSheet, readLink } from './PlanActions';
import { PlanFields } from './PlanFields';
import { EditorFrame, Loaded } from './parts';
import { trash, useRead, useSaver } from './read';
import type { LinkView } from '../../link';
import { t } from '../../i18n.ts';
/** spending.recurringEdit: add or edit a recurring plan (including a fixed rental term). */
export default function PlanEdit({ params }: PageProps) {
  const id = typeof params.id === 'string' ? params.id : null;
  const read = useRead(async () => {
    const overview = await invoke<Overview>('recurring_overview');
    const plan = id ? overview.plans.find(p => p.id === id) ?? null : null;
    if (id && !plan) throw new Error(t('这个计划已不存在，可能已被删除。'));
    const link = id ? await readLink('plan', id) : null;
    return { generation: overview.generation, plan, link };
  }, id ?? 'new');
  return <Loaded nav read={read} what={t('计划')}>{data => <Form generation={data.generation} plan={data.plan} link={data.link}/>}</Loaded>;
}

function Form({ generation, plan, link }: { generation: string; plan: Plan | null; link: LinkView | null }) {
  const { today } = useSession(), saver = useSaver();
  const initial = plan ? planDraftFrom(plan) : blankPlanDraft(today);
  const simple = !!initial;
  const [draft, setDraft] = useState<PlanDraft>(() => initial ?? { name: plan!.fields.name, category: plan!.fields.category, notes: plan!.fields.notes, rent: blankPlanDraft(today).rent, backfill: null });
  useDirtyGuard(useFormChanged(draft));
  const [problem, setProblem] = useState(''), [asking, setAsking] = useState(false), [late, setLate] = useState(false);
  const linked = link?.relation === 'linked' && !!link.asset;
  const set = (patch: Partial<PlanDraft>) => { setProblem(''); setDraft(d => ({ ...d, ...patch })); };
  const past = !plan ? pastDues(draft, today) : 0, backfill = backfillDefault(draft);
  const rentLabel = draft.category === 'rent';
  function save() {
    const check = simple ? validatePlanDraft(draft, today) : draft.name.trim() ? { ok: true as const } : { ok: false as const, message: t('请填写名称。') };
    if (!check.ok) { setProblem(check.message); return; }
    const fields = simple ? planFieldsFromDraft(plan?.fields ?? null, draft, today) : { ...plan!.fields, name: draft.name.trim(), notes: draft.notes, category: draft.category };
    void saver.run(async requestId => {
      if (linked && plan) return submit({ command: 'link_save', input: { request_id: requestId, generation: link!.generation, asset_id: link!.asset!.id, asset_expected_revision: link!.asset!.revision, plan_id: plan.id, plan_expected_revision: plan.revision, fields }, label: t('计划 {name}', { name: fields.name }) });
      const saved = await submit<Plan>({ command: 'recurring_plan_save', input: planSave(fields, plan, generation, requestId), label: t('计划 {name}', { name: fields.name }) });
      if (simple && !plan && backfill && past > 0) {
        // The plan is saved; a failed backfill must not save it again, so the page stops offering 保存.
        const range = backfillRange(saved, fields.amount_cents, generation, today, crypto.randomUUID());
        if (range) try { await submit({ command: 'recurring_payment_range_save', input: range, label: t('{name} 往期付款补记', { name: fields.name }) }); }
        catch (cause) { setLate(true); throw new Error('计划已保存，但自动补记没有完成：' + (cause instanceof Error ? cause.message : errorMessage(cause)) + ' 请返回后打开这条计划，用「补记往期付款」补上。'); }
      }
    }, { close: true });
  }
  function remove() { if (plan) void saver.run(requestId => trash('plan', plan.id, plan.revision, generation, `计划 ${plan.fields.name}`, requestId), { close: true }); }
  const frozen = saver.busy || late;
  return <EditorFrame title={plan ? t('编辑计划') : t('新增计划')} onSave={save} busy={saver.busy} canSave={!late} error={problem || (asking ? '' : saver.error)}>
    <p className="sp-note sp-note-pad">{t('改动只影响尚未记录的期；已确认的付款保持原样。删除计划会连同付款记录一起移入最近删除，可以恢复。')}</p>
    <FormGroup>
      <TextField label={t('名称')} value={draft.name} onChange={name => set({ name })} placeholder={t('例如：中山路房租')} maxLength={80} disabled={frozen}/>
      <SelectField label={t('分类')} value={draft.category} onChange={category => set({ category })} options={recurringCategories.map(([id, label]) => ({ id, label }))} disabled={frozen || linked} hint={linked ? t('关联订阅的分类保持原类，不能在这里更改') : undefined}/>
    </FormGroup>
    {simple ? <PlanFields value={draft.rent} onChange={rent => set({ rent })} today={today} rent={rentLabel} disabled={frozen}/>
      : <Notice>{t('这个计划用了固定天数、试用、暂停或分段价格等高级设置，手机上只能改名称、分类和备注；其余设置请在电脑上修改。')}</Notice>}
    {simple && past > 0 && <FormGroup footer={t('保存时自动补记为已付（日期按付款日、金额同每期），计入重要支出；日期或金额不同，之后单独更正。')}>
      <FormRow label={t('已过去的 {past} 期都已付清', { past })}><Switch label={t('保存后自动补记已过去的期次')} checked={backfill} onChange={on => set({ backfill: on })} disabled={frozen}/></FormRow>
    </FormGroup>}
    <FormGroup><TextAreaField label={t('备注')} value={draft.notes} onChange={notes => set({ notes })} disabled={frozen}/></FormGroup>
    {plan && <Button variant="danger" block disabled={frozen} onClick={() => setAsking(true)}>{linked ? t('整组删除…') : t('删除这个计划')}</Button>}
    {asking && plan && (linked
      ? <GroupDeleteSheet side="plan" id={plan.id} name={plan.fields.name} generation={link!.generation} onClose={() => setAsking(false)}/>
      : <DeleteSheet name={plan.fields.name} busy={saver.busy} error={saver.error} onClose={() => setAsking(false)} onConfirm={remove}>
        <p className="m-confirm-text">{t('付款记录会一起移入；其中已确认的付款暂不参与重要支出。')}</p>
      </DeleteSheet>)}
  </EditorFrame>;
}
