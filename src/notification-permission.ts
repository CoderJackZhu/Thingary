export function reminderPermissionMessage(pending:boolean,error:string,mac:boolean,ios=/iPhone|iPad|iPod/i.test(globalThis.navigator?.userAgent ?? '')):string {
  if(ios) return pending
    ? '正在等待 iOS 通知许可；可继续填写资料。保存后，允许通知才会收到提醒。'
    : error ? error+' 已保存的提醒需在 iPhone 设置 › 通知 › 物谱 中允许通知后才能送达。' : '';
  if(pending)return mac
    ? '正在等待 macOS 通知许可；可继续填写资料。保存后，允许通知才会收到提醒。'
    : '正在检查 Windows 通知设置；可继续填写资料。保存后，开启通知才会收到提醒。';
  return error ? error+(mac
    ? ' 已保存的提醒需在 macOS 中允许通知后才能送达。'
    : ' 已保存的提醒需在 Windows 设置 › 系统 › 通知 中开启物谱通知后才能送达。') : '';
}
export function notificationNeedsSettings(message:string):boolean {
  return message.includes('权限')||message.includes('通知未开启');
}
