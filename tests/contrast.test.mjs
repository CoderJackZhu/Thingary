import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// All colors live in theme.css (U15a). AC40: body and secondary text stay WCAG AA (4.5:1) in every theme and mode.
const css = [readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8')];
const tokens = selector => Object.fromEntries(css.flatMap(s => [...s.matchAll(new RegExp(selector.replace(/[[\]]/g, '\\$&') + '\\{([^}]*)\\}', 'g'))]
  .flatMap(m => [...m[1].matchAll(/--([\w-]+):(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map(t => [t[1], t[2]]))));
const lum = hex => {
  const h = hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('text and muted text meet 4.5:1 on every surface in every theme, light and dark', () => {
  const base = tokens(':root'), combos = [['native light', base], ['native dark', { ...base, ...tokens(':root[data-mode=dark]') }]];
  for (const style of ['olive', 'bento']) {
    const light = { ...base, ...tokens(`:root[data-style=${style}]`) };
    combos.push([`${style} light`, light], [`${style} dark`, { ...light, ...tokens(`:root[data-style=${style}][data-mode=dark]`) }]);
  }
  for (const [name, t] of combos)
  {
    for (const fg of ['text', 'muted', 'accent', 'positive', 'warn', 'error']) for (const bg of ['bg', 'side', 'card', 'soft', 'selected'])
      assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name} ${fg} on ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
    assert.ok(ratio(t['button-text'], t['button-bg']) >= 4.5, `${name} primary button: ${ratio(t['button-text'], t['button-bg']).toFixed(2)}`);
  }
});
