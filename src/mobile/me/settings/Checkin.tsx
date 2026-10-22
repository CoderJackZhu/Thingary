import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { applyCheckinReminderInterval, checkinIntervals, checkinReminderSummary } from '../../../checkin-reminder';
import type { CheckinReminderStatus } from '../../../checkin-reminder';
import { allModules } from '../../../modules';
import { useModules } from '../../modules-context';
import { useSession } from '../../session';
import { ErrorState, ListGroup, ListRow, Loading, Notice } from '../../ui';
import { MeIcon } from '../icons';
import { SettingsShell } from './Shell';
import { t } from '../../../i18n.ts';
/** 盘点提醒: the desktop reminder interval (`checkin_reminder_set`, notification permission first). */
export default function CheckinPage() {
  const { modules } = useModules(), { today } = useSession();
  const wealthOn = (modules ?? allModules).wealth;
  const [status, setStatus] = useState<CheckinReminderStatus | null>(null), [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [warning, setWarning] = useState('');
  const load = () => invoke<CheckinReminderStatus>('checkin_reminder_status').then(next => { setStatus(next); setLoadError(''); }).catch(cause => setLoadError(errorMessage(cause)));
  useEffect(() => {
    void load();
    window.addEventListener('thingary-reminders-changed', load);
    return () => window.removeEventListener('thingary-reminders-changed', load);
  }, [wealthOn]);
  async function choose(value: string) {
    setBusy(true); setError(''); setWarning('');
    try {
      const { status: saved, warning: note } = await applyCheckinReminderInterval(Number(value), invoke, () => window.dispatchEvent(new Event('thingary-reminders-changed')));
      setStatus(saved); if (note) setWarning(note);
    } catch (cause) { setError('盘点提醒未保存：' + errorMessage(cause)); void load(); }
    finally { setBusy(false); }
  }
  return <SettingsShell title={t('盘点提醒')} lead={t('每月盘一次钱最容易忘。开启后用系统通知提醒你；提醒只保存在这台手机，不进入资料与备份。')}>
    {loadError && !status ? <ErrorState title={t('盘点提醒读取失败')} message={loadError} onRetry={() => void load()}/> : !status ? <Loading/> : <>
      <ListGroup title={t('提醒间隔')} footer={checkinReminderSummary(status, wealthOn, today)}>
        {checkinIntervals.map(item => <ListRow key={item.value} icon={<MeIcon name={String(status.months) === item.value ? 'check' : 'calendar'} size={20}/>} tone={String(status.months) === item.value ? 'positive' : 'neutral'} title={item.label} disabled={busy} onClick={() => void choose(item.value)}/>)}
      </ListGroup>
      {warning && <Notice>{warning}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
    </>}
  </SettingsShell>;
}
