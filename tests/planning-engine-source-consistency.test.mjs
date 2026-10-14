import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('source check rejects stale or corrupted packaged WASM without building or rewriting it', () => {
  const root = mkdtempSync(join(tmpdir(), 'thingary-engine-source-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'src'));
    cpSync(new URL('../scripts/build-planning-engine.mjs', import.meta.url), join(root, 'scripts/build-planning-engine.mjs'));
    cpSync(new URL('../crates/planning-engine/', import.meta.url), join(root, 'crates/planning-engine'), { recursive: true });
    const packagedPath = join(root, 'src/planning-engine-wasm.ts');
    const packaged = readFileSync(new URL('../src/planning-engine-wasm.ts', import.meta.url), 'utf8');
    writeFileSync(packagedPath, packaged);
    const check = () => execFileSync(process.execPath, [join(root, 'scripts/build-planning-engine.mjs'), '--check-source'], {
      // A source-only check must work without Cargo or any other external tool.
      env: { ...process.env, PATH: '' }, stdio: 'pipe',
    });
    assert.match(check().toString(), /matches Rust inputs/);
    assert.equal(readFileSync(packagedPath, 'utf8'), packaged);

    const sourcePath = join(root, 'crates/planning-engine/src/lib.rs');
    const source = readFileSync(sourcePath, 'utf8');
    writeFileSync(sourcePath, source + '\n// Fictional source change.\n');
    assert.throws(check, error => error.stderr.toString().includes('stale Rust inputs'));
    assert.equal(readFileSync(packagedPath, 'utf8'), packaged);

    writeFileSync(sourcePath, source);
    writeFileSync(packagedPath, packaged.replace(/(export const planningEngineWasm = ')(.)/, (_all, start, first) => start + (first === 'A' ? 'B' : 'A')));
    assert.throws(check, error => error.stderr.toString().includes('binary hash differs'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
