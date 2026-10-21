import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../../asset';
import { notificationNeedsSettings } from '../../../notification-permission';
import { allowReminders, openNotificationSettings } from '../../../NotificationNotice';
import { Button, ErrorState, FormGroup, Loading, Notice } from '../../ui';
import { SettingsShell } from './Shell';

/** 通知: the state of the system notification permission (`notification_status`) and the ways to fix it. */
export default function NotificationsPage() {
  const [message, setMessage] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [note, setNote] = useState('');
  const refresh = () => invoke<string>('notification_status').then(next => { setMessage(next); setError(''); }).catch(() => setError('提醒状态暂不可用，请重试。'));
  useEffect(() => {
    void refresh();
    window.addEventListener('thingary-reminders-changed', refresh);
    return () => window.removeEventListener('thingary-reminders-changed', refresh);
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setNote('');
    try { await action(); await refresh(); } catch (cause) { setNote(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <SettingsShell title="通知" lead="保修到期、付款、盘点和心愿提醒都通过系统通知送达。物谱不联网，提醒在本机安排。">
    {error ? <ErrorState title="通知状态读取失败" message={error} onRetry={() => void refresh()}/> : message === null ? <Loading/> : <>
      <FormGroup title="当前状态"><p className="me-pad me-status" role="status">{message || '提醒已就绪，没有需要处理的通知问题。'}</p></FormGroup>
      <div className="me-stack me-pad-x">
        <Button variant="primary" block disabled={busy} onClick={() => void run(allowReminders)}>允许提醒</Button>
        {(notificationNeedsSettings(message) || !!note) && <Button block disabled={busy} onClick={() => void run(openNotificationSettings)}>打开系统通知设置</Button>}
        <Button variant="plain" block disabled={busy} onClick={() => void refresh()}>重试提醒</Button>
      </div>
      {note && <Notice tone="danger">{note}</Notice>}
    </>}
  </SettingsShell>;
}
