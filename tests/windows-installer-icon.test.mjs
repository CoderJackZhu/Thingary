import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
const conf = file => JSON.parse(readFileSync(new URL(`../src-tauri/${file}`, import.meta.url), 'utf8'));
test('the Windows NSIS installer uses the application icon instead of the NSIS default', () => {
  const nsis = conf('tauri.windows.conf.json').bundle.windows.nsis;
  assert.equal(nsis.installerIcon, 'icons/icon.ico');
  assert.ok(existsSync(new URL('../src-tauri/icons/icon.ico', import.meta.url)));
  assert.ok(conf('tauri.conf.json').bundle.icon.includes('icons/icon.ico'));
});
