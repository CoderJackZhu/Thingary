import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {isMac} from './undo-shortcut';
import {errorMessage} from './asset';
import {reminderPermissionMessage,notificationNeedsSettings} from './notification-permission';
import { t as tr } from './i18n.ts';
export async function allowReminders(){await invoke('notification_permission');window.dispatchEvent(new Event('thingary-reminders-changed'))}
export async function openNotificationSettings(){await invoke('open_notification_settings')}
export function ReminderPermissionHelp({pending,error}:{pending:boolean;error:string}){const [openError,setOpenError]=useState('');if(!pending&&!error)return null;return <div className="reminder-permission-help" role="status"><span>{reminderPermissionMessage(pending,error,isMac)}</span>{error&&<button type="button" onClick={()=>void openNotificationSettings().catch(e=>setOpenError(errorMessage(e)))}>{tr('打开系统通知设置')}</button>}{openError&&<span>{openError}</span>}</div>}
export function NotificationNotice(){const [message,setMessage]=useState('');const refresh=()=>{void invoke<string>('notification_status').then(setMessage).catch(()=>setMessage(tr('提醒状态暂不可用，请重试。')))};useEffect(()=>{refresh();const t=setInterval(refresh,60000);window.addEventListener('thingary-reminders-changed',refresh);return()=>{clearInterval(t);window.removeEventListener('thingary-reminders-changed',refresh)}},[]);return message?<div className="notification-notice" role="status">{message}<button onClick={refresh}>{tr('重试提醒')}</button>{notificationNeedsSettings(message)&&<button onClick={()=>void openNotificationSettings().catch(e=>setMessage(errorMessage(e)))}>{tr('打开系统通知设置')}</button>}</div>:null}
