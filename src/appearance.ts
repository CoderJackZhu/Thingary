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
export function applyAppearance(style: Style, mode: Mode) {
  const root = document.documentElement;
  root.dataset.style = style; root.dataset.theme = mode; root.dataset.mode = resolveMode(mode);
  localStorage.setItem('possio.style', style); localStorage.setItem('possio.theme', mode);
}
// 「跟随系统」时随系统外观实时切换。
export function watchSystemMode(onChange: () => void) { const q = darkQuery(); q.addEventListener('change', onChange); return () => q.removeEventListener('change', onChange); }
