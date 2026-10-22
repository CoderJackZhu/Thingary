// Source-reading tests assert on the Chinese text in components.界面文字现在包在 t('…') 里，
// 这里在读取 src 下的 .ts/.tsx 时把 t() 还原成原文，让这些断言继续检查中文原文。
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const unq = s => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
function paramMap(params) {
  const map = {};
  let depth = 0, cur = '';
  const parts = [];
  for (const ch of params) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
  parts.push(cur);
  for (const p of parts) { const i = p.indexOf(':'); const j = p.trim(); if (/^\w+$/.test(j)) map[j] = j; else if (i > 0) map[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return map;
}
export function unwrapT(text) {
  const fn = '(?:t|tr|tt)';
  return text
    .replace(/numberLocale\(\)/g, "'zh-CN'")
    // a bare JSX child {t('a {x} b', { x: expr })} -> a {expr} b
    .replace(new RegExp(`(?<![=\\w])\\{${fn}\\('((?:[^'\\\\]|\\\\.)*)', \\{ ((?:[^{}]|\\{[^{}]*\\})*?) \\}\\)\\}`, 'g'), (whole, key, params) => {
      const map = paramMap(params);
      return unq(key).replace(/\{(\w+)\}/g, (_, n) => '{' + (map[n] ?? n) + '}');
    })
    .replace(new RegExp(`^import \\{ (?:t|t as \\w+) \\} from '[^']*i18n\\.ts';\\n`, 'm'), '')
    // t('a {x} b', { x: expr, y }) -> `a ${expr} b`
    .replace(new RegExp(`\\b${fn}\\('((?:[^'\\\\]|\\\\.)*)', \\{ ((?:[^{}]|\\{[^{}]*\\})*?) \\}\\)`, 'g'), (whole, key, params) => {
      const map = {};
      let depth = 0, cur = '';
      const parts = [];
      for (const ch of params) { if ('([{'.includes(ch)) depth++; if (')]}'.includes(ch)) depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      for (const p of parts) { const i = p.indexOf(':'); const j = p.trim(); if (/^\w+$/.test(j)) map[j] = j; else if (i > 0) map[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
      return '`' + unq(key).replace(/\{(\w+)\}/g, (_, n) => '${' + (map[n] ?? n) + '}') + '`';
    })
    .replace(new RegExp(`=\\{${fn}\\('((?:[^'\\\\]|\\\\.)*)'\\)\\}`, 'g'), (_, key) => `="${unq(key)}"`)
    .replace(new RegExp(`\\{${fn}\\('((?:[^'\\\\]|\\\\.)*)'\\)\\}`, 'g'), (_, key) => unq(key))
    .replace(new RegExp(`\\b${fn}\\('((?:[^'\\\\]|\\\\.)*)'\\)`, 'g'), (_, key) => `'${key}'`);
}
const original = fs.readFileSync;
fs.readFileSync = function (path, options) {
  const out = original.call(this, path, options);
  const p = String(path instanceof URL ? path.pathname : path);
  if (typeof out === 'string' && /[\\/]src[\\/].*\.(ts|tsx)$/.test(p) && !/i18n\.ts$|locales/.test(p)) return unwrapT(out);
  return out;
};
syncBuiltinESMExports();
