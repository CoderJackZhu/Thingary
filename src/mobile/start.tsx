import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import type { InitialRoute } from './nav-context';
import '../theme.css';
import './mobile.css';
import './ui/ui.css';

const media = matchMedia('(prefers-color-scheme: dark)');
function appearance() {
  document.documentElement.dataset.style = 'bento';
  document.documentElement.dataset.mode = media.matches ? 'dark' : 'light';
}
/** Mount the app. `initial` opens a specific tab or route and is only passed by the development preview. */
export function startMobile(initial?: InitialRoute) {
  appearance();
  media.addEventListener('change', appearance);
  createRoot(document.getElementById('root')!).render(<MobileApp initial={initial}/>);
}
