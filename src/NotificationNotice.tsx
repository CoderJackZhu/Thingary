import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
export async function allowReminders(){await invoke('notification_permission');}
export function NotificationNotice(){const [message,setMessage]=useState('');const refresh=()=>{void invoke<string>('notification_status').then(setMessage).catch(()=>setMessage('提醒状态暂不可用，请重试。'))};useEffect(()=>{refresh();const t=setInterval(refresh,60000);window.addEventListener('possio-reminders-changed',refresh);return()=>{clearInterval(t);window.removeEventListener('possio-reminders-changed',refresh)}},[]);return message?<div className="notification-notice" role="status">{message}<button onClick={refresh}>重试提醒</button></div>:null}
