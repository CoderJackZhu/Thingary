// U15a 外观：主题（data-style）与浅色／深色（data-theme 为用户选择，data-mode 为解析结果）。
export type Mode = 'light' | 'dark' | 'system';
export type Style = 'native' | 'paper' | 'bento';
export const styles: readonly { value: Style; label: string; note: string }[] = [
  { value: 'native', label: '清新原生', note: '简洁 · 蓝色' },
  { value: 'paper', label: '纸本档案', note: '衬线 · 暖色' },
  { value: 'bento', label: '柔和卡片', note: '圆角 · 彩色 · 默认' },
];
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');
export function readMode(): Mode { const v = localStorage.getItem('possio.theme'); return v === 'light' || v === 'dark' ? v : 'system'; }
export function readStyle(): Style { const v = localStorage.getItem('possio.style'); return v === 'paper' || v === 'native' ? v : 'bento'; } // 默认柔和卡片（D27）；已保存的选择不变
export const resolveMode = (mode: Mode): 'light' | 'dark' => mode === 'system' ? (darkQuery().matches ? 'dark' : 'light') : mode;
// 侧栏按钮与 ⌘⇧D：切到与当前显示相反的一侧，「跟随系统」也按实际显示判断。
export const toggledMode = (mode: Mode): Mode => resolveMode(mode) === 'dark' ? 'light' : 'dark';
// 最近一次指针按下的位置：切换主题时从这里圆形展开；键盘或系统触发的切换没有位置，改用淡入淡出。
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof document !== 'undefined') document.addEventListener('pointerdown', e => { lastPress = { x: e.clientX, y: e.clientY, at: Date.now() }; }, true);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function write(style: Style, mode: Mode) {
  const root = document.documentElement;
  root.dataset.style = style; root.dataset.theme = mode; root.dataset.mode = resolveMode(mode);
  localStorage.setItem('possio.style', style); localStorage.setItem('possio.theme', mode);
}
export function applyAppearance(style: Style, mode: Mode) {
  const root = document.documentElement;
  const changed = root.dataset.mode !== undefined && (root.dataset.style !== style || root.dataset.mode !== resolveMode(mode));
  const start = (document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } }).startViewTransition;
  if (!changed || !start || reduceMotion()) { write(style, mode); return; }
  const press = lastPress && Date.now() - lastPress.at < 800 ? lastPress : null;
  if (press) root.classList.add('theme-reveal');
  const transition = start.call(document, () => write(style, mode));
  const finish = () => root.classList.remove('theme-reveal');
  transition.ready.then(() => {
    if (!press) return;
    const r = Math.hypot(Math.max(press.x, innerWidth - press.x), Math.max(press.y, innerHeight - press.y));
    root.animate({ clipPath: [`circle(0px at ${press.x}px ${press.y}px)`, `circle(${r}px at ${press.x}px ${press.y}px)`] }, { duration: 560, easing: 'cubic-bezier(.4,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
  }).catch(() => {});
  (transition as unknown as { finished: Promise<void> }).finished.then(finish, finish);
}
// 「跟随系统」时随系统外观实时切换。
export function watchSystemMode(onChange: () => void) { const q = darkQuery(); q.addEventListener('change', onChange); return () => q.removeEventListener('change', onChange); }
