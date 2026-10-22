import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Direction B "floating glass" tokens live in src/mobile/mobile.css (mobile entry only). Text must stay WCAG AA (4.5:1).
const css = readFileSync(new URL('../src/mobile/mobile.css', import.meta.url), 'utf8');
const block = selector => { const m = css.match(new RegExp(selector.replace(/[[\]=]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, selector); return Object.fromEntries([...m[1].matchAll(/--([\w-]+):(#[0-9a-f]{6})\b/gi)].map(t => [t[1], t[2]])); };
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('mobile glass tokens keep text at 4.5:1 in light and dark', () => {
  const light = block(':root[data-style=bento]'), dark = { ...light, ...block(':root[data-style=bento][data-mode=dark]') };
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    for (const fg of ['text', 'muted', 'accent', 'positive', 'warn', 'error']) for (const bg of ['bg', 'card', 'soft', 'selected'])
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name} ${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    assert.ok(ratio(t['button-text'], t['button-bg']) >= 4.5, `${name} primary button ${ratio(t['button-text'], t['button-bg']).toFixed(2)}`);
    assert.ok(ratio(t.accent, t['m-pill-bg']) >= 4.5, `${name} active tab label ${ratio(t.accent, t['m-pill-bg']).toFixed(2)}`);
    assert.ok(ratio(t.muted, t['m-pill-bg']) >= 4.5 || name === 'dark', `${name} muted on pill`);
  }
});
