import { useState } from 'react';
import type { CSSProperties } from 'react';
import { applyAppearance, readMode, readStyle, styles } from '../../../appearance';
import type { Mode, Style } from '../../../appearance';
import { FormGroup, SegmentedControl } from '../../ui';
import { SettingsShell } from './Shell';

// Same swatches as the desktop theme cards: colors are taken from each theme's light version.
const swatch: Record<Style, { bg: string; side: string; ink: string; accent: string; card: CSSProperties }> = {
  native: { bg: '#fff', side: '#f4f4f6', ink: '#1d1d1f', accent: '#0a6cff', card: { border: '1px solid #e3e3e8' } },
  olive: { bg: '#f6f2ea', side: '#f1ece2', ink: '#26231d', accent: '#4f6b3a', card: { background: '#fffdf9', border: '1px solid #e4dccb' } },
  bento: { bg: '#f2f2f7', side: '#f2f2f7', ink: '#1c1c1e', accent: '#5e5ce6', card: { background: '#fff', boxShadow: '0 2px 6px #0000001a' } },
};
const modes: { id: Mode; label: string }[] = [{ id: 'light', label: '浅色' }, { id: 'dark', label: '深色' }, { id: 'system', label: '跟随系统' }];

/** 外观: 主题风格 and 浅色／深色／跟随系统, applied and saved by the desktop `applyAppearance`. */
export default function AppearancePage() {
  const [style, setStyle] = useState<Style>(readStyle), [mode, setMode] = useState<Mode>(readMode);
  const change = (nextStyle: Style, nextMode: Mode) => { setStyle(nextStyle); setMode(nextMode); applyAppearance(nextStyle, nextMode); };
  return <SettingsShell title="外观" lead="主题风格和浅色、深色分开保存，只影响这台手机。">
    <FormGroup title="浅色／深色"><div className="me-pad"><SegmentedControl label="浅色或深色" items={modes} value={mode} onChange={next => change(style, next)}/></div></FormGroup>
    <section className="m-form-group" aria-label="主题风格">
      <h2 className="m-group-title">主题风格</h2>
      <div className="me-themes" role="radiogroup" aria-label="主题风格">{styles.map(item => {
        const c = swatch[item.value];
        return <button key={item.value} type="button" role="radio" aria-checked={style === item.value} className="me-theme" onClick={() => change(item.value, mode)}>
          <span className="me-theme-preview" aria-hidden="true" style={{ background: c.bg }}>
            <span style={{ background: c.side }}><i style={{ background: c.ink, width: '55%' }}/><i style={{ background: c.ink, opacity: .15 }}/><i style={{ background: c.ink, opacity: .15, width: '70%' }}/></span>
            <span><i style={{ background: c.ink, width: '45%' }}/><b style={c.card}/><i style={{ background: c.accent, width: '32%' }}/></span>
          </span>
          <span className="me-theme-name"><strong>{item.label}</strong><small>{item.note}</small></span>
        </button>;
      })}</div>
    </section>
  </SettingsShell>;
}
