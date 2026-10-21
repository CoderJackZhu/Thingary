// Runtime pieces owned by 我的 that must be active from the first screen: the saved appearance and the privacy lock.
// The first module that loads (总览 or 我的) calls installMobileRuntime(); repeated calls do nothing.
import { applyAppearance, readMode, readStyle, watchSystemMode } from '../../appearance';
import { installPrivacy } from './privacy-runtime';
import './me.css';

let installed = false;
/** Apply the 主题 and 浅色／深色 the user picked. Nothing is touched until a choice was saved, so the system default stays. */
function installAppearance() {
  let saved = false;
  try { saved = localStorage.getItem('thingary.theme') !== null || localStorage.getItem('thingary.style') !== null; } catch { /* storage unavailable: keep the default */ }
  if (!saved) return;
  const apply = () => applyAppearance(readStyle(), readMode());
  apply();
  // Registered after the foundation's own listener, so a saved 浅色／深色 wins when the system changes.
  watchSystemMode(apply);
}
export function installMobileRuntime(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installAppearance();
  installPrivacy();
}
