import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

process.env.TZ = 'Asia/Shanghai';

// Compile just the helper from the component source so the test runs the real code.
const source = readFileSync(new URL('../src/Trash.tsx', import.meta.url), 'utf8');
const match = source.match(/export function deletedDay[\s\S]*?\n}\n/);
assert.ok(match, 'deletedDay helper exists');
const js = ts.transpileModule(match[0] + '\nmodule.exports = { deletedDay };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const localDay = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const module_ = { exports: {} };
new Function('module', 'exports', 'localDay', js)(module_, module_.exports, localDay);
const { deletedDay } = module_.exports;

test('the trash date is the local calendar day, not the UTC prefix', () => {
  const stamp = '2026-10-15T17:38:00+00:00';
  assert.equal(deletedDay(stamp), '2026-10-16');
  assert.notEqual(deletedDay(stamp), stamp.slice(0, 10));
});
test('an unparseable stamp falls back to its first ten characters', () => {
  assert.equal(deletedDay('2026-10-15 garbled'), '2026-10-15');
});
