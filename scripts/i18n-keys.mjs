// 列出界面里所有 t('…') 的中文原文（去重排序）。用法：node scripts/i18n-keys.mjs [--check]
// --check：en.ts 里有、源码里已不存在的 key 视为过期，退出码 1。
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function collectKeys() {
  const keys = new Set();
  const walk = p => {
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, f.name);
      if (f.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\.|\.d\.ts$/.test(f.name) && !/src[\\/](i18n\.ts|locales)/.test(full)) {
        const sf = ts.createSourceFile(full, fs.readFileSync(full).toString(), ts.ScriptTarget.ES2022, true, f.name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        (function v(n) {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['t', 'tr', 'tt'].includes(n.expression.text) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) keys.add(n.arguments[0].text);
          ts.forEachChild(n, v);
        })(sf);
      }
    }
  };
  walk(path.join(root, 'src'));
  // Rust 固定错误文字：Error::new("CODE", "中文") 的字面量（不含 format!）。
  const rust = p => {
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, f.name);
      if (f.isDirectory()) rust(full);
      else if (f.name.endsWith('.rs')) {
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/Error::new\(\s*"[A-Z_0-9]+",\s*"((?:[^"\\]|\\.)*)"/g)) {
          const text = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
          if (/[\u4e00-\u9fff]/.test(text) && !/\{\}|\{:/.test(text)) keys.add(text);
        }
      }
    }
  };
  rust(path.join(root, 'src-tauri/src'));
  return [...keys].sort();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const keys = collectKeys();
  if (process.argv.includes('--check')) {
    const { en } = await import('../src/locales/en.ts');
    const live = new Set(keys), stale = Object.keys(en).filter(k => !live.has(k));
    if (stale.length) { console.error(`en.ts 有 ${stale.length} 条过期译文：\n` + stale.slice(0, 20).join('\n')); process.exit(1); }
  } else console.log(JSON.stringify(keys, null, 1));
}
