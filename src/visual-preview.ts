import { desktopShortcutAction, isMac } from './undo-shortcut';
// Development-only entry. Renders the production App with an in-memory IPC
// adapter; index.html and the production build never import this module.
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { handle } from './preview-ipc';
import { t } from './i18n.ts';
const params = new URLSearchParams(location.search);
// This preview owns its isolated origin and only removes its own reminder keys:
// records reset on reload, so pending requests from the previous fixture are stale.
for (const key of ['thingary.asset-draft.v1','thingary.trash-request.v1','thingary.record-trash-request.v1','thingary.taxonomy-request.v1','thingary.lifecycle-draft.v1','thingary.sale-draft.v1']) localStorage.removeItem(key);
if (!params.has('preserve-maintenance')) localStorage.removeItem('thingary.maintenance-draft.v1');
if (!params.has('preserve-warranty')) localStorage.removeItem('thingary.warranty-draft.v1');
if (params.has('theme')) localStorage.setItem('thingary.theme',params.get('theme') === 'dark' ? 'dark' : 'light');
if (params.has('style')) localStorage.setItem('thingary.style', params.get('style') === 'olive' || params.get('style') === 'paper' ? 'olive' : params.get('style') === 'bento' ? 'bento' : 'native');
if (params.get('preset-label')) sessionStorage.setItem('thingary.preset-label.v1', params.get('preset-label')!);
if (params.has('enter-tag') || params.has('preset-label')) document.getElementById('visual-preview-label')?.remove();
// U18 截图入口：?open-wish=<心愿ID> 走真实来源跳转打开详情；?recurring-tab=payments 直达付款记录视图。
if (params.get('open-wish')) sessionStorage.setItem('thingary.open-wish.v1', params.get('open-wish')!);
// U22 截图入口：?open-virtual=new 打开新增对话框；?open-virtual=<虚拟资产ID> 打开编辑。
if (params.get('open-virtual')) sessionStorage.setItem('thingary.open-virtual.v1', params.get('open-virtual')!);
if (params.get('recurring-tab')) sessionStorage.setItem('thingary.recurring-tab.v1', params.get('recurring-tab')!);
if (params.get('scroll-to')) sessionStorage.setItem('thingary.scroll-to.v1', params.get('scroll-to')!);
if (params.get('category-menu')) sessionStorage.setItem('thingary.category-menu.v1', params.get('category-menu')!);
mockIPC(handle,{shouldMockEvents:true});
window.addEventListener('keydown',event=>{
  if (!isMac) return;
  const action = desktopShortcutAction(event);
  if (action) { event.preventDefault(); void emit('asset-action', action); }
});
// Explicit fictional receipts reproduce restart recovery, including disabled modules.
if (params.get('receipt-recovery') === 'account') localStorage.setItem('thingary.wealth-pending.v1', JSON.stringify({ command: 'wealth_account_save', input: { request_id: 'fictional-recovery-request', generation: 'visual-fixture-only' }, label: t('虚构账户保存') }));
if (params.get('section')) sessionStorage.setItem('thingary.library-section.v1', params.get('section')!);
// 截图入口：自动进入指定标签的分析子视图（仅浏览器预览；?enter-tag=<labelId>&analysis-search=<词>）。
if (params.get('enter-tag')) {
  sessionStorage.setItem('thingary.enter-tag.v1', params.get('enter-tag')!);
  sessionStorage.setItem('thingary.enter-tag-search.v1', params.get('analysis-search') ?? '');
  sessionStorage.setItem('thingary.enter-tag-scope.v1', params.get('analysis-scope') === 'held' ? 'held' : 'all');
}
if (params.get('state') === 'components') void import('./ComponentPreview');
else void import('./main');
