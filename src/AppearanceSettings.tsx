import type { CSSProperties } from 'react';
import { Segments } from './FormControls';
import { styles, type Mode, type Style } from './appearance';
const modes: readonly { value: Mode; label: string }[] = [{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }, { value: 'system', label: '跟随系统' }];
// 主题卡片里的小示意：侧栏、标题条、一张卡片和一个强调色块，颜色取自该主题浅色版。
const swatch: Record<Style, { bg: string; side: string; ink: string; accent: string; card: CSSProperties }> = {
  native: { bg: '#fff', side: '#f4f4f6', ink: '#1d1d1f', accent: '#0a6cff', card: { border: '1px solid #e3e3e8' } },
  paper: { bg: '#f7f3ea', side: '#efe8da', ink: '#2a2621', accent: '#9a4320', card: { borderTop: '2px solid #2a2621' } },
  bento: { bg: '#f2f2f7', side: '#f2f2f7', ink: '#1c1c1e', accent: '#5e5ce6', card: { background: '#fff', boxShadow: '0 2px 6px #0000001a' } },
};
export function AppearanceSettings({ style, mode, onStyle, onMode }: { style: Style; mode: Mode; onStyle: (s: Style) => void; onMode: (m: Mode) => void }) {
  return <section className="card module-settings appearance-settings" aria-labelledby="appearance-heading">
    <div className="data-heading"><div><p className="eyebrow">界面</p><h2 id="appearance-heading">外观</h2></div></div>
    <div className="theme-cards" role="radiogroup" aria-label="主题">{styles.map(s => { const c = swatch[s.value]; return <button key={s.value} type="button" role="radio" aria-checked={style === s.value} className="theme-card" onClick={() => onStyle(s.value)}>
      <span className="theme-preview" aria-hidden="true" style={{ background: c.bg }}>
        <span style={{ background: c.side }}><i style={{ background: c.ink, width: '55%' }}/><i style={{ background: c.ink, opacity: .15 }}/><i style={{ background: c.ink, opacity: .15, width: '70%' }}/></span>
        <span><i style={{ background: c.ink, width: '45%' }}/><b style={c.card}/><i style={{ background: c.accent, width: '32%' }}/></span>
      </span>
      <span className="theme-name"><strong>{s.label}</strong><small>{s.note}</small></span>
    </button>; })}</div>
    <div className="appearance-mode"><span>浅色与深色</span><Segments label="浅色与深色" value={mode} options={modes} onChange={onMode}/></div>
    <p className="data-intro">侧栏「设置」旁的按钮可一键切换浅色与深色，快捷键 ⌘⇧D。</p>
  </section>;
}
