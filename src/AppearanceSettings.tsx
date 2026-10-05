import type { CSSProperties } from 'react';
import { styles, type Style } from './appearance';
// 主题卡片里的小示意：侧栏、标题条、一张卡片和一个强调色块，颜色取自该主题浅色版。
const swatch: Record<Style, { bg: string; side: string; ink: string; accent: string; card: CSSProperties }> = {
  native: { bg: '#fff', side: '#f4f4f6', ink: '#1d1d1f', accent: '#0a6cff', card: { border: '1px solid #e3e3e8' } },
  olive: { bg: '#f6f2ea', side: '#f1ece2', ink: '#26231d', accent: '#4f6b3a', card: { background: '#fffdf9', border: '1px solid #e4dccb' } },
  bento: { bg: '#f2f2f7', side: '#f2f2f7', ink: '#1c1c1e', accent: '#5e5ce6', card: { background: '#fff', boxShadow: '0 2px 6px #0000001a' } },
};
export function AppearanceSettings({ style, onStyle }: { style: Style; onStyle: (s: Style) => void }) {
  return <section className="ui-card ui-content module-settings appearance-settings" aria-labelledby="appearance-heading">
    <div className="data-heading"><div><p className="eyebrow">界面</p><h2 id="appearance-heading">外观</h2></div></div>
    <div className="theme-cards" role="radiogroup" aria-label="主题">{styles.map((s, index) => { const c = swatch[s.value]; return <button key={s.value} type="button" role="radio" aria-checked={style === s.value} tabIndex={style === s.value ? 0 : -1} className="theme-card" onClick={() => onStyle(s.value)} onKeyDown={event => {
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!direction && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? styles.length - 1 : (index + direction + styles.length) % styles.length;
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
      onStyle(styles[next].value);
    }}>
      <span className="theme-preview" aria-hidden="true" style={{ background: c.bg }}>
        <span style={{ background: c.side }}><i style={{ background: c.ink, width: '55%' }}/><i style={{ background: c.ink, opacity: .15 }}/><i style={{ background: c.ink, opacity: .15, width: '70%' }}/></span>
        <span><i style={{ background: c.ink, width: '45%' }}/><b style={c.card}/><i style={{ background: c.accent, width: '32%' }}/></span>
      </span>
      <span className="theme-name"><strong>{s.label}</strong><small>{s.note}</small></span>
    </button>; })}</div>
    <p className="data-intro">浅色、深色或跟随系统请在侧栏底部切换，与上面的主题风格分开保存；⌘⇧D 在浅色与深色间切换。</p>
  </section>;
}
