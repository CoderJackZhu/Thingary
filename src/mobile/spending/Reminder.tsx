import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { dayLabel } from '../format';
import { submit } from '../../wealth';
import { shiftDays } from '../../recurring-model';
import { saveReminderWithPermission } from '../../virtual';
import type { ReminderState } from '../../virtual';
import { DateField, FormGroup, FormRow, Notice, SegmentedControl, SelectField, Switch } from '../ui';
import { useSaver } from './read';

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
        () => submit({ command: 'virtual_reminder_save', input: { request_id: requestId, generation, asset_id: assetId, expected_revision: assetRevision, repeat_every_period: repeating, lead_days: advance, reminder: nextOn ? { date: day, notes: reminder?.notes ?? '' } : null }, label: '备款提醒' }));
      if (note) setWarning(note);
    }, { onDone: onSaved });
    if (!ok) { setOn(!!reminder); setRepeat(reminder ? !!reminder.repeat_every_period : hasServiceStart); setLead(reminder?.lead_days ?? 3); }
  }
  const summary = reminder ? (reminder.repeat_every_period ? `每期扣款前 ${reminder.lead_days ?? 3} 天提醒；下次 ${dayLabel(reminder.date, today)}。确认真实扣款后转到下一期。` : `已安排 ${dayLabel(reminder.date, today)}${reminder.notes ? ' · ' + reminder.notes : ''}（仅本次）`) : '默认关闭；开启后按系统通知权限执行，关闭、停用或结束会撤销待通知。';
  return <FormGroup title="到期提醒" footer={<>{summary}{!moduleEnabled && ' 虚拟资产模块已关闭，提醒暂停；可维护设置，重新开启模块后生效。'}</>}>
    <FormRow label="备款提醒"><Switch label="备款提醒" checked={on} disabled={saver.busy} onChange={next => { setOn(next); const day = date || single; setDate(day); void persist(next, day); }}/></FormRow>
    {on && hasServiceStart && <div className="m-form-row m-stacked"><SegmentedControl label="备款提醒方式" value={repeat ? 'period' : 'once'} items={[{ id: 'period', label: '每期提醒' }, { id: 'once', label: '仅本次' }]} onChange={v => { const r = v === 'period'; setRepeat(r); void persist(true, date || single, r); }}/></div>}
    {on && repeat && <SelectField label="扣款前提醒" value={String(lead)} disabled={saver.busy} options={Array.from({ length: 31 }, (_, n) => ({ id: String(n), label: `${n} 天` }))} onChange={v => { const n = Number(v); setLead(n); void persist(true, date || single, true, n); }}/>}
    {on && !repeat && <DateField label="提醒日期" value={date} disabled={saver.busy} onChange={v => { setDate(v); if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))) void persist(true, v, false); }}/>}
    {warning && <Notice>{warning}</Notice>}
    {saver.error && <Notice tone="danger">{saver.error}</Notice>}
  </FormGroup>;
}
