import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('each P0 shortcut is a native menu item that reaches the page', () => {
  const forwarded = menu.slice(menu.indexOf('.on_menu_event'), menu.indexOf(') {', menu.indexOf('.on_menu_event')));
  for (const [id, key] of [['new-asset', 'N'], ['find-asset', 'F'], ['edit-asset', 'E'], ['open-settings', ','], ['toggle-appearance', 'Shift+D']]) {
    assert.ok(menu.includes(`"${id}"`) && menu.includes(`Some("CmdOrCtrl+${key}")`), id);
    assert.ok(app.includes(`action === '${id}'`), id);
    assert.ok(forwarded.includes(`"${id}"`), id + ' is forwarded to the page');
  }
});
