import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('build:engine leaves the committed WASM untouched when the Rust inputs have not changed', () => {
  const file = new URL('../src/planning-engine-wasm.ts', import.meta.url);
  const before = readFileSync(file);
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-planning-engine.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, PATH: '/nonexistent' } });
  assert.match(out, /up to date/, 'no cargo is needed, so a missing toolchain cannot change the artifact');
  assert.ok(before.equals(readFileSync(file)));
});
