import { saveReminderWithPermission } from './virtual.ts';

export type CheckinReminderStatus = { months: number; last_check_in: string | null; next_date: string | null };

export const checkinIntervals = [
  { value: '0', label: '关闭' }, { value: '1', label: '每月' }, { value: '2', label: '每 2 个月' }, { value: '3', label: '每 3 个月' },
] as const;

/** One sentence under the control; never claims a notification was delivered. */
export function checkinReminderSummary(status: CheckinReminderStatus | null, wealthOn: boolean, today: string): string {
  if (!status) return '';
  if (status.months === 0) return '未开启。开启后，距上次完整盘点满设定间隔的当天 9:00 提醒一次，若届时还没盘点，一周后再提醒一次。保存新的完整盘点后自动重新计时。';
  if (!wealthOn) return '账户与盘点已关闭，提醒暂停；重新打开后恢复。';
  if (!status.last_check_in || !status.next_date) return '还没有完整盘点；完成第一次完整盘点后开始计时。';
  const passed = status.next_date < today;
  return passed
    ? `距上次完整盘点（${status.last_check_in}）已满设定间隔，提醒日期 ${status.next_date} 已过。保存新的完整盘点后会重新计时。`
    : `下次提醒：${status.next_date} 9:00（上次完整盘点 ${status.last_check_in}）；若届时还没盘点，一周后再提醒一次。`;
}

/** 本机「已问过」标记：与提醒偏好一样按机器保存，不进入资料库与备份。 */
export const checkinReminderAskedKey = 'thingary.checkin-reminder-asked.v1';
type AskStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** 存储不可用时本次会话内当作已问过（卡片隐藏，与起步卡片一致）。 */
export function checkinReminderAsked(storage: AskStorage | null): boolean {
  if (!storage) return true;
  try { return storage.getItem(checkinReminderAskedKey) === '1'; } catch { return true; }
}
export function markCheckinReminderAsked(storage: AskStorage | null): void {
  if (!storage) return;
  try { storage.setItem(checkinReminderAskedKey, '1'); } catch { /* 会话内状态仍隐藏卡片。 */ }
}

/** 询问只出现一次：这个资料库第一次完整盘点保存后，且提醒关闭、本机未问过。 */
export function checkinReminderAskVisible(savedComplete: boolean, completeCount: number, reminderMonths: number, asked: boolean): boolean {
  return savedComplete && completeCount === 1 && reminderMonths === 0 && !asked;
}

/** 设置间隔的共用流程（设置卡片与首次盘点后的询问共用）：先请求通知权限（开启时），
 * 再保存，成功后广播事件；保存失败则抛出且不广播。 */
export async function applyCheckinReminderInterval(months: number, invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>, notifyChanged: () => void): Promise<{ status: CheckinReminderStatus; warning: string | null }> {
  let status!: CheckinReminderStatus;
  const warning = await saveReminderWithPermission(months > 0, () => invoke('notification_permission'), async () => { status = await invoke('checkin_reminder_set', { months }) as CheckinReminderStatus; });
  notifyChanged();
  return { status, warning };
}
