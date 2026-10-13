import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { Segments } from './FormControls';
import { saveReminderWithPermission } from './virtual';
import { checkinIntervals, checkinReminderSummary, type CheckinReminderStatus } from './checkin-reminder';

/** Optional reminder to repeat the check-in. The preference is machine-local;
 * it never changes library data and a saved check-in restarts the clock. */
export function CheckinReminder({ wealthOn, today }: { wealthOn: boolean; today: string }) {
  const [status, setStatus] = useState<CheckinReminderStatus | null>(null), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [warning, setWarning] = useState('');
  const reload = () => invoke<CheckinReminderStatus>('checkin_reminder_status').then(s => { setStatus(s); setLoadError(''); }).catch(e => setLoadError(errorMessage(e)));
  useEffect(() => { void reload(); }, [wealthOn]);
  async function choose(value: string) {
    const months = Number(value);
    setBusy(true); setError(''); setWarning('');
    try {
      const note = await saveReminderWithPermission(months > 0, () => invoke('notification_permission'), async () => { setStatus(await invoke<CheckinReminderStatus>('checkin_reminder_set', { months })); });
      if (note) setWarning(note);
      window.dispatchEvent(new Event('thingary-reminders-changed'));
    } catch (e) { setError('盘点提醒未保存：' + errorMessage(e)); void reload(); }
    finally { setBusy(false); }
  }
  return <section className="ui-card ui-content checkin-reminder" aria-labelledby="checkin-reminder-heading">
    <div className="data-heading"><div><p className="eyebrow">提醒</p><h2 id="checkin-reminder-heading">盘点提醒</h2></div></div>
    <p className="data-intro">每月盘一次钱最容易忘。开启后用系统通知提醒你；提醒只保存在这台电脑，不进入资料与备份。</p>
    {status && <Segments label="盘点提醒间隔" value={String(status.months)} options={checkinIntervals} disabled={busy} onChange={v => void choose(v)}/>}
    {status && <p className="muted checkin-reminder-summary" role="status">{checkinReminderSummary(status, wealthOn, today)}</p>}
    {warning && <p className="notice" role="alert">{warning}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {loadError && <p className="error" role="alert">盘点提醒读取失败：{loadError}<button type="button" onClick={() => void reload()}>重新读取</button></p>}
  </section>;
}
