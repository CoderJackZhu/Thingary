// Development only: never included by mobile.html or the production build.
import { mockIPC } from '@tauri-apps/api/mocks';
import { wealthPreview } from '../wealth-preview';
const params = new URLSearchParams(location.search);
let lostReply = false, failedLookup = false;
mockIPC((command, args) => {
  const state = params.get('mobile-state');
  if (state === 'save-error' && (command === 'wealth_quick_update' || command === 'wealth_account_save')) throw { code: 'PREVIEW_ERROR', message: '虚构保存失败，请核对输入后重试。' };
  if (state === 'unknown' && command === 'wealth_request_result' && lostReply && !failedLookup) { failedLookup = true; throw new Error('虚构回执暂不可用。'); }
  const response = wealthPreview(command, args as Record<string, unknown>);
  if (!response) throw new Error(`手机预览未实现命令：${command}`);
  if (state === 'unknown' && !lostReply && (command === 'wealth_quick_update' || command === 'wealth_account_save')) { lostReply = true; throw new Error('虚构保存响应丢失。'); }
  return response.value;
});
await import('./main');
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.mode = theme;
