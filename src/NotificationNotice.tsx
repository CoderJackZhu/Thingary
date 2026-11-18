import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {isMac} from './undo-shortcut';
import {errorMessage} from './asset';
import {reminderPermissionMessage,notificationNeedsSettings} from './notification-permission';
import { t as tr } from './i18n.ts';
export async function allowReminders(){await invoke('notification_permission');window.dispatchEvent(new Event('thingary-reminders-changed'))}
export async function openNotificationSettings(){await invoke('open_notification_settings')}
export function ReminderPermissionHelp({pending,error}:{pending:boolean;error:string}){const [openError,setOpenError]=useState('');if(!pending&&!error)return null;return <div className="reminder-permission-help" role="status"><span>{reminderPermissionMessage(pending,error,isMac)}</span>{error&&<button type="button" onClick={()=>void openNotificationSettings().catch(e=>setOpenError(errorMessage(e)))}>{tr('打开系统通知设置')}</button>}{openError&&<span>{openError}</span>}</div>}
export function NotificationNotice(){
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const retrying=useRef(false);
  const refresh=async()=>{
    if(retrying.current)return;
    try{setMessage(await invoke<string>('notification_status'))}
    catch{setMessage(tr('提醒状态暂不可用，请重试。'))}
  };
  const retry=async()=>{
    if(retrying.current)return;
    retrying.current=true;setBusy(true);
    try{
      await invoke('notification_permission');
      setMessage(await invoke<string>('notification_status'));
      window.dispatchEvent(new Event('thingary-reminders-changed'));
    }catch(error){setMessage(errorMessage(error))}
    finally{retrying.current=false;setBusy(false)}
  };
  useEffect(()=>{
    void refresh();const timer=setInterval(()=>void refresh(),60000);
    window.addEventListener('thingary-reminders-changed',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('thingary-reminders-changed',refresh)};
  },[]);
  return message?<div className="notification-notice" role="status" aria-busy={busy}>{message}<button disabled={busy} onClick={()=>void retry()}>{tr('重试提醒')}</button>{notificationNeedsSettings(message)&&<button disabled={busy} onClick={()=>void openNotificationSettings().catch(error=>setMessage(errorMessage(error)))}>{tr('打开系统通知设置')}</button>}</div>:null;
}
