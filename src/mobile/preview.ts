// Development only: never included by mobile.html or the production build.
import { mockIPC } from '@tauri-apps/api/mocks';
import { wealthPreview } from '../wealth-preview';
mockIPC((command, args) => {
  const response = wealthPreview(command, args as Record<string, unknown>);
  if (!response) throw new Error(`手机预览未实现命令：${command}`);
  return response.value;
});
await import('./main');
const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.mode = theme;
