import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { submit } from '../../wealth';
import { linkDeletePreview } from '../../link';
import type { LinkPreview, LinkTrashInput, LinkView } from '../../link';
import { previewText } from '../../LinkDialogs';
import type { Plan } from '../../recurring';
import { dayLabel } from '../format';
import { ConfirmSheet, DateField, DeleteSheet, ErrorState, Loading } from '../ui';
import { endFields, endSuggestion, planSave, validateEnd } from './forms';
import { useRead, useSaver } from './read';
import { t } from '../../i18n.ts';
/** 整组删除：先读预览，再用同一份预览确认（关联订阅的服务档案和计划一起进最近删除）。 */
export function GroupDeleteSheet({ side, id, name, partnerId, generation, onClose }: { side: 'virtual' | 'plan'; id: string; name: string; partnerId?: string | null; generation: string; onClose: () => void }) {
  const saver = useSaver();
  const read = useRead(() => linkDeletePreview(side, id, partnerId), `${side}:${id}`);
  const preview: LinkPreview | null = read.data;
  function confirm() {
    if (!preview) return;
    const input: LinkTrashInput = { request_id: '', generation, side, id, partner_id: partnerId ?? null, asset_expected_revision: preview.asset_revision, plan_expected_revision: preview.plan_revision, preview: preview.preview };
    void saver.run(requestId => submit<string>({ command: 'link_trash', input: { ...input, request_id: requestId }, label: '删除 ' + preview.asset_name }), { close: true });
  }
  return <DeleteSheet name={name} busy={saver.busy} error={saver.error || read.error} disabled={!preview} onClose={onClose} onConfirm={confirm}>
    {read.loading && <Loading label={t('正在读取影响范围…')}/>}
    {read.error && <ErrorState title={t('读取失败')} message={read.error} onRetry={read.reload}/>}
    {preview && <ul className="sp-rows sp-facts">{previewText(preview).map(text => <li key={text}>{text}</li>)}</ul>}
  </DeleteSheet>;
}

/** 结束计划：确认最后使用日并关闭后续续费；已有付款记录保留。 */
export function EndPlanSheet({ plan, link, generation, today, onClose, onDone }: { plan: Plan; link: LinkView | null; generation: string; today: string; onClose: () => void; onDone: (message: string) => void }) {
  const saver = useSaver();
  const [day, setDay] = useState(endSuggestion(plan, link) ?? today), [problem, setProblem] = useState('');
  const name = plan.fields.name;
  function confirm() {
    const check = validateEnd(plan.fields, day);
    if (!check.ok) { setProblem(check.message); return; }
    const fields = endFields(plan.fields, day);
    void saver.run(requestId => link?.asset
      ? submit({ command: 'link_save', input: { request_id: requestId, generation: link.generation, asset_id: link.asset.id, asset_expected_revision: link.asset.revision, plan_id: plan.id, plan_expected_revision: plan.revision, fields }, label: '取消续费 ' + name })
      : submit({ command: 'recurring_plan_save', input: planSave(fields, plan, generation, requestId), label: '取消续费 ' + name }),
    { onDone: () => { onDone(`「${name}」将使用至 ${dayLabel(day, today)}，后续续费已关闭；历史付款与估算依据保留。`); onClose(); } });
  }
  return <ConfirmSheet title={t('结束计划')} confirm={t('确认结束')} danger busy={saver.busy} error={problem || saver.error} onClose={onClose} onConfirm={confirm}
    message={t('「{name}」最后使用到哪一天？确认后不再生成新的付款期，已记录的付款保留。', { name })}>
    <div className="m-card m-form-card"><DateField label={t('最后使用日')} value={day} onChange={v => { setProblem(''); setDay(v); }} disabled={saver.busy}/></div>
  </ConfirmSheet>;
}

export const readLink = (kind: 'virtual' | 'plan', id: string) => invoke<LinkView>('link_view', { kind, id });
