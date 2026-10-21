import { createRoot } from 'react-dom/client';
import { MobileApp } from './MobileApp';
import '../theme.css';
import './mobile.css';

const media = matchMedia('(prefers-color-scheme: dark)');
function appearance() {
  document.documentElement.dataset.style = 'bento';
  document.documentElement.dataset.mode = media.matches ? 'dark' : 'light';
}
appearance();
media.addEventListener('change', appearance);
createRoot(document.getElementById('root')!).render(<MobileApp/>);
