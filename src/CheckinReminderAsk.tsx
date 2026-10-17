import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import { choiceStorage } from './start-choice';
import { applyCheckinReminderInterval, checkinIntervals, checkinReminderAsked, checkinReminderAskVisible, checkinReminderSummary, markCheckinReminderAsked, type CheckinReminderStatus } from './checkin-reminder';

const askIntervals = checkinIntervals.filter(i => i.value !== '0');

/** One-time ask after this library's first complete check-in, only while the
 * reminder is off and this machine has not asked. Choosing an interval follows
 * the same flow as the settings card; the asked marker is machine-local like
 * the preference itself and never enters library data or backups. */
export function CheckinReminderAsk({ savedComplete, completeCount, wealthOn, today }: { savedComplete: boolean; completeCount: number; wealthOn: boolean; today: string }) {
  const [status, setStatus] = useState<CheckinReminderStatus | null>(null);
  const [asked, setAsked] = useState(() => checkinReminderAsked(choiceStorage()));
  const [answer, setAnswer] = useState<{ line: string; warning: string | null } | 'skip' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const reload = () => invoke<CheckinReminderStatus>('checkin_reminder_status').then(setStatus).catch(() => setStatus(null));
  useEffect(() => { void reload(); }, []);
  // The settings card at the page bottom stays usable while this ask is up; its
  // changes must hide or update this card in the same view.
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener('thingary-reminders-changed', refresh);
    return () => window.removeEventListener('thingary-reminders-changed', refresh);
  }, []);
  // Reserve this visit before the asynchronous preference read finishes, so
  // the update invitation cannot flash first or stack with this business ask.
  const reserved = !answer && savedComplete && completeCount === 1 && !asked;
  useEffect(() => {
    if (!reserved) return;
    window.dispatchEvent(new CustomEvent('thingary-ask-card-shown', { detail: { kind: 'checkin' } }));
  }, [reserved]);
  if (answer === 'skip') return null;
  if (answer) return <>
    <p className="muted checkin-reminder-summary" role="status">{answer.line}</p>
    {answer.warning && <p className="notice" role="alert">{answer.warning}</p>}
  </>;
  const visible = !!status && checkinReminderAskVisible(savedComplete, completeCount, status.months, asked);
  if (!visible) return null;
  async function choose(months: number) {
    setBusy(true); setError('');
    try {
      const { status: saved, warning } = await applyCheckinReminderInterval(months, invoke, () => window.dispatchEvent(new Event('thingary-reminders-changed')));
      markCheckinReminderAsked(choiceStorage());
      setAsked(true);
      setAnswer({ line: checkinReminderSummary(saved, wealthOn, today), warning });
    } catch (e) {
      // A failed save leaves the ask unanswered so it can be retried.
      setError('盘点提醒未保存：' + errorMessage(e));
    } finally { setBusy(false); }
  }
  return <section className="ui-card ui-content checkin-reminder-ask" aria-labelledby="checkin-reminder-ask-heading">
    <div className="data-heading"><div><p className="eyebrow">提醒</p><h2 id="checkin-reminder-ask-heading">要不要每月提醒你盘一次？</h2></div></div>
    <p className="data-intro">每月盘一次最容易忘。开启后用系统通知提醒，只保存在这台电脑，不进入资料与备份。</p>
    <div className="checkin-reminder-ask-actions">
      {askIntervals.map(o => <button key={o.value} type="button" disabled={busy} onClick={() => void choose(Number(o.value))}>{o.label}</button>)}
      <button type="button" disabled={busy} onClick={() => { markCheckinReminderAsked(choiceStorage()); setAsked(true); setAnswer('skip'); }}>先不用</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
