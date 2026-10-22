import { installKeyboardViewport } from './ui/keyboard-viewport';
import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import type { InitialRoute } from './nav-context';
import '../theme.css';
import './mobile.css';
import './ui/ui.css';

const media = matchMedia('(prefers-color-scheme: dark)');
// A saved 主题／浅色／深色 is applied by installMobileRuntime (me/runtime.ts); only the unsaved default is set here.
function hasSavedAppearance() {
  try { return localStorage.getItem('thingary.theme') !== null || localStorage.getItem('thingary.style') !== null; } catch { return false; }
}
function appearance() {
  if (hasSavedAppearance()) return;
  document.documentElement.dataset.style = 'bento';
  document.documentElement.dataset.mode = media.matches ? 'dark' : 'light';
}
/** Mount the app. `initial` opens a specific tab or route and is only passed by the development preview. */
export function startMobile(initial?: InitialRoute) {
  appearance();
  installKeyboardViewport();
  media.addEventListener('change', appearance);
  createRoot(document.getElementById('root')!).render(<MobileApp initial={initial}/>);
}
