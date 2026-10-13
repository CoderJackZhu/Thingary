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
