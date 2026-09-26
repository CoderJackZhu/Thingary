import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Later stylesheet wins, as in the app. AC40: body and secondary text stay WCAG AA (4.5:1) in both themes.
const css = ['style.css', 'app-layout.css'].map(f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'));
const tokens = selector => Object.fromEntries(css.flatMap(s => [...s.matchAll(new RegExp(selector.replace(/[[\]]/g, '\\$&') + '\\{([^}]*)\\}', 'g'))]
  .flatMap(m => [...m[1].matchAll(/--([\w-]+):(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map(t => [t[1], t[2]]))));
const lum = hex => {
  const h = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('text and muted text meet 4.5:1 on every surface in light and dark', () => {
  const light = tokens(':root'), dark = { ...light, ...tokens(':root[data-theme=dark]') };
  for (const [name, t] of [['light', light], ['dark', dark]])
    for (const fg of ['text', 'muted']) for (const bg of ['bg', 'side', 'card', 'soft', 'selected'])
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name} ${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
});
