// Development only: never included by mobile.html or the production build.
// Runs the iPhone UI on the same fictional in-memory IPC as the desktop preview (src/preview-ipc.ts).
//   ?theme=light|dark  ?wealth=empty|missing|error  ?mobile-state=unknown|save-error
//   ?route=dev.gallery shows the UI kit (dev.gallery.page / .modal / .sheet for each page kind).
//   ?tab=overview|items|wealth|plan|me   ?route=<route name>[&param.<key>=<value>...]
import { mockIPC } from '@tauri-apps/api/mocks';
import { handle } from '../preview-ipc';
import { routeDef, tabs } from './routes';
import type { Params, RouteName, TabId } from './routes';
import { t } from '../i18n.ts';
const params = new URLSearchParams(location.search);
let lostReply = false, failedLookup = false;
mockIPC(async (command, args) => {
  const state = params.get('mobile-state');
  if (state === 'save-error' && (command === 'wealth_quick_update' || command === 'wealth_account_save')) throw { code: 'PREVIEW_ERROR', message: t('虚构保存失败，请核对输入后重试。') };
  if (state === 'unknown' && command === 'wealth_request_result' && lostReply && !failedLookup) { failedLookup = true; throw new Error(t('虚构回执暂不可用。')); }
  const value = await handle(command, args);
  if (state === 'unknown' && !lostReply && (command === 'wealth_quick_update' || command === 'wealth_account_save')) { lostReply = true; throw new Error(t('虚构保存响应丢失。')); }
  return value;
}, { shouldMockEvents: true });
const { startMobile } = await import('./start');
if (params.has('route') && params.get('route')!.startsWith('dev.')) (await import('./gallery')).registerGalleryRoutes();
const theme = params.get('theme');
const tab = tabs.find(item => item.id === params.get('tab'))?.id as TabId | undefined;
const route = params.get('route');
const routeParams: Params = {};
params.forEach((value, key) => { if (key.startsWith('param.')) routeParams[key.slice(6)] = value; });
startMobile({ tab, route: route && routeDef(route) ? route as RouteName : undefined, params: routeParams });
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.mode = theme;
