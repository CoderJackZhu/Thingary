import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('each P0 shortcut is a native menu item that reaches the page', () => {
  for (const [id, key] of [['new-asset', 'N'], ['find-asset', 'F'], ['edit-asset', 'E'], ['open-settings', ',']]) {
    assert.ok(menu.includes(`"${id}"`) && menu.includes(`Some("CmdOrCtrl+${key}")`), id);
    assert.ok(app.includes(`action === '${id}'`), id);
  }
  assert.match(menu, /"new-asset" \| "find-asset" \| "edit-asset" \| "open-settings"/);
});
