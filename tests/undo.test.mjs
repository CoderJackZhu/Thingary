import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { undoTarget } from '../src/undo-shortcut.ts';

const plain = { closest: () => null };
const field = { closest: () => ({}) };

test('⌘Z keeps text undo in fields and undoes an offered deletion elsewhere', () => {
  assert.equal(undoTarget(field, false, true), 'text');
  assert.equal(undoTarget(field, true, false), 'text', 'fields inside forms keep text undo');
  assert.equal(undoTarget({ isContentEditable: true, closest: () => null }, false, false), 'text');
  assert.equal(undoTarget(plain, false, true), 'deletion');
  assert.equal(undoTarget(null, false, true), 'deletion');
  assert.equal(undoTarget(plain, true, true), null, 'an open form is left alone');
  assert.equal(undoTarget(plain, false, false), null, 'nothing to undo once the bar is gone');
});

test('⌘Z is a native menu item that reaches the page', () => {
  const menu = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(menu, /MenuItem::with_id\(app, "undo", "撤销", true, Some\("CmdOrCtrl\+Z"\)\)/);
  assert.match(menu, /\| "undo"/);
  assert.match(readFileSync(new URL('../src/undo.tsx', import.meta.url), 'utf8'), /payload !== 'undo'/);
});
