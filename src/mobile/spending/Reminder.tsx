import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dayLabel } from '../format';
import { submit } from '../../wealth';
import { shiftDays } from '../../recurring-model';
import { saveReminderWithPermission } from '../../virtual';
import type { ReminderState } from '../../virtual';
import { DateField, FormGroup, FormRow, Notice, SegmentedControl, SelectField, Switch } from '../ui';
import { useSaver } from './read';
import { t } from '../../i18n.ts';
/** 备款提醒：和桌面共用同一个提醒源（virtual_reminder_save），每次改动立即保存。 */
export function ReminderGroup({ assetId, assetRevision, reminder, nextDue, hasServiceStart, generation, today, moduleEnabled, onSaved }: {
  assetId: string; assetRevision: number; reminder: ReminderState | null; nextDue: string | null; hasServiceStart: boolean; generation: string; today: string; moduleEnabled: boolean; onSaved: () => void;
}) {
  const saver = useSaver();
  const [on, setOn] = useState(!!reminder), [repeat, setRepeat] = useState(reminder ? !!reminder.repeat_every_period : hasServiceStart);
  const [lead, setLead] = useState(reminder?.lead_days ?? 3), [date, setDate] = useState(reminder?.date ?? ''), [warning, setWarning] = useState('');
  const suggestion = nextDue ? shiftDays(nextDue, -lead) : today, single = suggestion < today ? today : suggestion;
  async function persist(nextOn: boolean, day: string, repeating = repeat, advance = lead) {
    setWarning('');
    const ok = await saver.run(async requestId => {
      const note = await saveReminderWithPermission(nextOn && moduleEnabled, () => invoke('notification_permission'),
        () => submit({ command: 'virtual_reminder_save', input: { request_id: requestId, generation, asset_id: assetId, expected_revision: assetRevision, repeat_every_period: repeating, lead_days: advance, reminder: nextOn ? { date: day, notes: reminder?.notes ?? '' } : null }, label: t('备款提醒') }));
      if (note) setWarning(note);
    }, { onDone: onSaved });
    if (!ok) { setOn(!!reminder); setRepeat(reminder ? !!reminder.repeat_every_period : hasServiceStart); setLead(reminder?.lead_days ?? 3); }
  }
  const summary = reminder ? (reminder.repeat_every_period ? t('每期扣款前 {v1} 天提醒；下次 {v2}。确认真实扣款后转到下一期。', { v1: reminder.lead_days ?? 3, v2: dayLabel(reminder.date, today) }) : t('已安排 {v1}{v2}（仅本次）', { v1: dayLabel(reminder.date, today), v2: reminder.notes ? ' · ' + reminder.notes : '' })) : t('默认关闭；开启后按系统通知权限执行，关闭、停用或结束会撤销待通知。');
  return <FormGroup title={t('到期提醒')} footer={<>{summary}{!moduleEnabled && t(' 虚拟资产模块已关闭，提醒暂停；可维护设置，重新开启模块后生效。')}</>}>
    <FormRow label={t('备款提醒')}><Switch label={t('备款提醒')} checked={on} disabled={saver.busy} onChange={next => { setOn(next); const day = date || single; setDate(day); void persist(next, day); }}/></FormRow>
    {on && hasServiceStart && <div className="m-form-row m-stacked"><SegmentedControl label={t('备款提醒方式')} value={repeat ? 'period' : 'once'} items={[{ id: 'period', label: t('每期提醒') }, { id: 'once', label: t('仅本次') }]} onChange={v => { const r = v === 'period'; setRepeat(r); void persist(true, date || single, r); }}/></div>}
    {on && repeat && <SelectField label={t('扣款前提醒')} value={String(lead)} disabled={saver.busy} options={Array.from({ length: 31 }, (_, n) => ({ id: String(n), label: t('{n} 天', { n }) }))} onChange={v => { const n = Number(v); setLead(n); void persist(true, date || single, true, n); }}/>}
    {on && !repeat && <DateField label={t('提醒日期')} value={date} disabled={saver.busy} onChange={v => { setDate(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))) void persist(true, v, false); }}/>}
    {warning && <Notice>{warning}</Notice>}
    {saver.error && <Notice tone="danger">{saver.error}</Notice>}
  </FormGroup>;
}
