import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderPermissionMessage,notificationNeedsSettings} from '../src/notification-permission.ts';

test('Windows checks settings without claiming a permission prompt',()=>{
  assert.match(reminderPermissionMessage(true,'',false),/正在检查 Windows 通知设置/);
  assert.match(reminderPermissionMessage(false,'通知未开启',false),/已保存的提醒.*Windows 设置 › 系统 › 通知/);
  assert.equal(reminderPermissionMessage(false,'',false),'');
});
test('macOS retains its authorization wording',()=>{
  assert.match(reminderPermissionMessage(true,'',true),/正在等待 macOS 通知许可/);
  assert.match(reminderPermissionMessage(false,'通知权限未开启',true),/已保存的提醒需在 macOS 中允许通知/);
});
test('settings action is available for Windows disabled and macOS denied statuses',()=>{
  assert.equal(notificationNeedsSettings('通知未开启；提醒日期已保存，请在 Windows 设置中允许物谱通知'),true);
  assert.equal(notificationNeedsSettings('通知权限未开启'),true);
  assert.equal(notificationNeedsSettings('提醒尚未安排成功'),false);
});

import {runtime} from './planning-component-runtime.mjs';
import * as messages from '../src/notification-permission.ts';
import {errorMessage} from '../src/asset.ts';
function mount(invoke){
  return runtime('NotificationNotice',{},undefined,undefined,{
    components:[],
    modules:{'@tauri-apps/api/core':{invoke},'./notification-permission':messages,'./undo-shortcut':{isMac:false},'./asset':{errorMessage}},
    globals:{setInterval:()=>1,clearInterval:()=>{},window:{addEventListener(){},removeEventListener(){}}},
  });
}
test('the Windows disabled banner offers settings and reports settings-open errors as text',async()=>{
  const calls=[];
  const r=mount(async name=>{
    calls.push(name);
    if(name==='open_notification_settings')throw {code:'REMINDER',message:'无法打开 Windows 通知设置'};
    return '通知未开启；提醒日期已保存';
  });
  await r.settle();
  assert.match(r.text(r.nodes()),/通知未开启；提醒日期已保存/);
  assert.ok(r.button('打开系统通知设置'));
  r.button('打开系统通知设置').props.onClick();
  await r.settle();
  assert.ok(calls.includes('open_notification_settings'));
  assert.match(r.text(r.nodes()),/无法打开 Windows 通知设置/);
  r.unmount();
});
test('an enabled status hides the notice and a read failure offers retry',async()=>{
  const enabled=mount(async()=> '');
  await enabled.settle();
  assert.equal(enabled.find('div'),undefined);
  enabled.unmount();
  const failed=mount(async()=>{throw Error('unavailable')});
  await failed.settle();
  assert.match(failed.text(failed.nodes()),/提醒状态暂不可用，请重试/);
  assert.ok(failed.button('重试提醒'));
  failed.unmount();
});
