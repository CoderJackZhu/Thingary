import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const commands = readFileSync(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
const closeExpression = main.match(/const pageCloseBlocked = ([^;]+);/)[1];
const idle = { startChoiceBusy: false, featureEditing: false, dataBusy: false, modeBusy: false, batch: null };
const blocked = state => vm.runInNewContext(closeExpression, { ...idle, ...state });

test('Windows close guard covers account/planning/recurring/virtual forms and foreground tasks', () => {
  assert.equal(blocked({}), false);
  for (const state of [
    { featureEditing: true }, { dataBusy: true }, { startChoiceBusy: true },
    { modeBusy: true }, { batch: { action: 'classify' } },
  ]) assert.equal(blocked(state), true, 'active input or foreground work stays open');
});

test('persistent unknown receipts retain library isolation without trapping exit or clearing metadata', () => {
  assert.equal(blocked({ durablePending: true, pendingReceipt: { command: 'wealth_account_save' }, recovered: { pending: { request_id: 'fictional' } } }), false);
  assert.equal(blocked({ featureEditing: true, durablePending: true }), true, 'an open foreground editor still blocks');
  assert.match(main, /set_library_busy', \{ busy: modeBlocked, closeBlocked: pageCloseBlocked \}/);
  assert.match(main, /const modeBlocked = startChoiceBusy \|\| durablePending \|\| featureEditing \|\| dataBusy/);
});

test('Windows X and process exit consult the distinct guard while aggregate busy consumers remain intact', () => {
  const windowClose = lib.slice(lib.indexOf('WindowEvent::CloseRequested'), lib.indexOf('.build(tauri::generate_context!())'));
  const exit = lib.slice(lib.indexOf('RunEvent::ExitRequested'), lib.indexOf('RunEvent::Reopen'));
  for (const body of [windowClose, exit]) {
    assert.match(body, /#\[cfg\(target_os = "windows"\)\]/);
    assert.match(body, /LibraryGuard>\(\)\.1\.load/);
    assert.match(body, /windows_close_event/);
  }
  assert.match(windowClose, /api\.prevent_close\(\)/);
  assert.match(exit, /api\.prevent_exit\(\)/);
  assert.match(commands, /guard\.0\.store\(busy, Ordering::SeqCst\)/);
  assert.match(commands.replace(/\s+/g, ''), /guard\.1\.store\(close_blocked\.unwrap_or\(busy\),Ordering::SeqCst\)/);
  assert.match(commands, /if guard\.0\.load\(Ordering::SeqCst\) \|\| library_guard\.0\.load/);
});

test('close-blocked notice returns to current input without discard, save, navigation or finish_close', () => {
  assert.match(main, /listen\('close-blocked', \(\) => setCloseBlocked\(true\)\)/);
  const notice = main.match(/closeBlocked && <TaxonomyCloseNotice [\s\S]*?\/>/)[0];
  assert.match(notice, /请先完成或取消当前表单或处理中任务/);
  assert.match(notice, /onKeep=\{\(\) => setCloseBlocked\(false\)\}/);
  assert.doesNotMatch(notice, /finish_close|removeItem|setSection|setDraft|save/);
});
