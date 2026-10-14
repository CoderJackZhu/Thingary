import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const hooks = read('../src-tauri/windows/nsis-hooks.nsh');
const toast = read('../src-tauri/src/toast_activation.rs');
const config = JSON.parse(read('../src-tauri/tauri.windows.conf.json'));
const has = (text, fragment) => assert.ok(text.includes(fragment), `missing: ${fragment}`);

test('the Windows NSIS config installs the uninstall hook file', () => {
  assert.equal(config.bundle.windows.nsis.installerHooks, 'windows/nsis-hooks.nsh');
});

test('the uninstall hook removes exactly the keys the toast activator writes', () => {
  has(toast, String.raw`Software\Classes\AppUserModelId\{identity}`);
  has(toast, String.raw`Software\Classes\CLSID\{{{clsid}}}\LocalServer32`);
  has(hooks, '!macro NSIS_HOOK_POSTUNINSTALL');
  has(hooks, String.raw`ReadRegStr $R0 HKCU "Software\Classes\AppUserModelId\${BUNDLEID}" "CustomActivator"`);
  has(hooks, String.raw`DeleteRegKey HKCU "Software\Classes\CLSID\$R0"`);
  has(hooks, String.raw`DeleteRegKey HKCU "Software\Classes\AppUserModelId\${BUNDLEID}"`);
});

test('the uninstall hook keeps registration on updates, guards the CLSID and never touches data', () => {
  has(hooks, '${If} $UpdateMode <> 1');
  has(hooks, 'StrCpy $R1 $R0 1');
  has(hooks, '${If} $R1 == "{"');
  const code = hooks.split('\n').filter(line => !line.trimStart().startsWith(';')).join('\n');
  for (const forbidden of ['RmDir', '$APPDATA', '$LOCALAPPDATA', 'HKLM', 'SHCTX']) {
    assert.ok(!code.includes(forbidden), `must not use ${forbidden}`);
  }
});
