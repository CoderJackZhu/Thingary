import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { desktopShortcutAction, handleDesktopShortcut, handleContextMenu, modKey, selectionModifier, shiftModKey } from '../src/undo-shortcut.ts';
import { nextSelection } from '../src/batch-select.ts';

const ready = { newLabel: '新增物品', findLabel: '搜索物品', blocked: false, dialogOpen: false };
function keyEvent(key, extra = {}) {
  return { key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, ...extra };
}
function press(event, menu = ready, mac = false) {
  const dispatched = [];
  const handled = handleDesktopShortcut(event, menu, action => dispatched.push(action), mac);
  return { dispatched, handled, prevented: event.defaultPrevented };
}

test('Windows keyboard events send the same eight native-menu action IDs once', () => {
  for (const [key, shiftKey, action] of [
    ['n', false, 'new-asset'], ['f', false, 'find-asset'], ['F', true, 'global-search'],
    ['e', false, 'edit-asset'], [',', false, 'open-settings'], ['D', true, 'toggle-appearance'],
    ['z', false, 'undo'], ['a', false, 'select-all'],
  ]) {
    assert.deepEqual(press(keyEvent(key, { shiftKey })), { dispatched: [action], handled: true, prevented: true });
    const event = keyEvent(key, { shiftKey });
    const calls = [];
    handleDesktopShortcut(event, ready, action => calls.push(action), false);
    handleDesktopShortcut(event, ready, action => calls.push(action), false);
    assert.deepEqual(calls, [action], 'an already handled event cannot dispatch twice');
  }
});

test('PageMenu availability prevents background new/find on pages without those actions', () => {
  assert.deepEqual(press(keyEvent('n'), { ...ready, newLabel: null }).dispatched, []);
  assert.deepEqual(press(keyEvent('f'), { ...ready, findLabel: null }).dispatched, []);
  assert.equal(press(keyEvent('n'), { ...ready, newLabel: '新增记录…' }).handled, true, 'combined pages open their existing menu');
});

test('editing, pending results and dialogs block app actions while appearance retains its menu behavior', () => {
  for (const state of [{ blocked: true }, { dialogOpen: true }]) {
    for (const key of ['n', 'f', 'e', ',', 'a', 'z']) {
      const result = press(keyEvent(key), { ...ready, ...state });
      assert.deepEqual(result, { dispatched: [], handled: false, prevented: false });
    }
    assert.deepEqual(press(keyEvent('f', { shiftKey: true }), { ...ready, ...state }).dispatched, []);
    assert.deepEqual(press(keyEvent('d', { shiftKey: true }), { ...ready, ...state }).dispatched, ['toggle-appearance']);
  }
});

test('text inputs, textareas and editable descendants retain native text editing and app selection is untouched', () => {
  for (const target of [{ closest: () => ({}) }, { isContentEditable: true }, { closest: selector => selector.includes('contenteditable') ? {} : null }]) {
    for (const key of ['z', 'a', 'n', 'e', 'f']) {
      assert.deepEqual(press(keyEvent(key, { target })), { dispatched: [], handled: false, prevented: false });
    }
  }
});

test('IME composition, legacy 229, repeats and unrelated chords do not dispatch or prevent browser editing', () => {
  for (const extra of [
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true },
    { altKey: true }, { metaKey: true }, { ctrlKey: false }, { shiftKey: true },
  ]) assert.deepEqual(press(keyEvent('n', extra)).dispatched, []);
  for (const key of ['p', 'r', '+', '-', 'c', 'v', 'x', 'y', 'F5']) assert.equal(desktopShortcutAction(keyEvent(key), false), null);
});

test('macOS native accelerator events are never duplicated by the production frontend', () => {
  assert.deepEqual(press(keyEvent('n', { ctrlKey: false, metaKey: true }), ready, true), { dispatched: [], handled: false, prevented: false });
  assert.equal(desktopShortcutAction(keyEvent('n', { ctrlKey: false, metaKey: true }), true), 'new-asset', 'Mac browser preview can model its native menu');
  assert.equal(desktopShortcutAction(keyEvent('n'), true), null, 'Control is not the Mac command key');
});

test('Windows Ctrl-click toggles and Shift-click ranges without changing Mac Control-click semantics', () => {
  const ctrl = { ctrlKey: true, metaKey: false };
  assert.equal(selectionModifier(ctrl, false), true);
  assert.equal(selectionModifier(ctrl, true), false);
  assert.equal(selectionModifier({ ctrlKey: false, metaKey: true }, true), true);
  assert.equal(selectionModifier({ ctrlKey: false, metaKey: true }, false), false);
  const order = ['a', 'b', 'c', 'd'];
  const first = nextSelection([], 'a', 'c', order, { meta: selectionModifier(ctrl, false), shift: false, toggle: false }, 'a');
  assert.deepEqual(first.ids, ['a', 'c']);
  assert.deepEqual(nextSelection(first.ids, first.anchor, 'a', order, { meta: true, shift: false, toggle: false }, 'a').ids, ['c']);
  assert.deepEqual(nextSelection(first.ids, first.anchor, 'd', order, { meta: false, shift: true, toggle: false }, 'a').ids, ['a', 'c', 'd']);
});

test('editable context menus retain native cut/copy/paste while application surfaces suppress browser menus', () => {
  for (const target of [{ closest: () => ({}) }, { isContentEditable: true }]) {
    let prevented = false;
    handleContextMenu({ target, preventDefault() { prevented = true; } });
    assert.equal(prevented, false);
  }
  let prevented = false;
  handleContextMenu({ target: { closest: () => null }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('platform shortcut labels show Windows Control and retain the Mac glyphs', () => {
  assert.equal(modKey(false), 'Ctrl+'); assert.equal(shiftModKey(false), 'Ctrl+Shift+');
  assert.equal(modKey(true), '⌘'); assert.equal(shiftModKey(true), '⌘⇧');
});

test('production and fictional-preview routes share asset-action without a duplicate Windows preview listener', () => {
  const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(app, /handleDesktopShortcut\(event,[\s\S]{0,450}emit\('asset-action', action\)/);
  assert.match(app, /newLabel: topbarBar\.menu \|\| !topbarBar\.newRecord\?\.disabled \? menuNew : null/);
  const preview = readFileSync(new URL('../src/visual-preview.ts', import.meta.url), 'utf8');
  assert.match(preview, /if \(!isMac\) return;/);
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]{0,160}MenuItem::with_id\(app, "new-asset", "新增物品", true, None::<&str>\)/);
});


// Exercise the production handlers with delayed IPC, including their ticket checks.
function delayedSelection(initialId = null) {
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && ['select', 'rowClick', 'clearSelection'].includes(node.name?.text)) handlers.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(handlers.length, 3);
  const requests = [];
  const record = id => ({ asset: { id }, deleted: false });
  const context = {
    module: { exports: {} }, wishlistEditing: false, selecting: false, multi: [], anchor: null,
    active: initialId ? record(initialId) : null, selected: null, detailLoading: false,
    detailTicket: { current: 0 }, pendingSelection: { current: null },
    page: { items: ['a', 'b', 'c', 'd'].map(id => record(id)) },
    selectionModifier: event => selectionModifier(event, false), nextSelection,
    setMulti: value => { context.multi = value; }, setAnchor: value => { context.anchor = value; },
    setSelecting: value => { context.selecting = value; },
    setDetailLoading: value => { context.detailLoading = value; }, setDetailError: () => {},
    setSelected: value => { context.selected = value; context.active = value && !value.deleted ? value : null; },
    errorMessage: error => error.message,
    invoke: (command, { id }) => {
      assert.equal(command, 'read_asset');
      return new Promise((resolve, reject) => requests.push({ id, resolve: () => resolve(record(id)), reject }));
    },
  };
  const code = ts.transpileModule(`${handlers.join('\n')}\nmodule.exports = { rowClick, clearSelection };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, context);
  const click = (id, ctrl = false) => context.module.exports.rowClick({ metaKey: false, ctrlKey: ctrl, shiftKey: false }, id);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { context, requests, click, flush, clear: context.module.exports.clearSelection };
}

test('rapid Ctrl-click seeds selection from the pending row, with blank or previously loaded summaries', async () => {
  for (const initialId of [null, 'd']) {
    const { context, requests, click, flush } = delayedSelection(initialId);
    click('a'); click('b', true);
    assert.deepEqual(Array.from(context.multi), ['a', 'b']);
    requests[0].resolve(); await flush();
    assert.equal(context.selected.asset.id, 'a');
    assert.deepEqual(Array.from(context.multi), ['a', 'b'], 'late summary must not replace multiselection');
    assert.equal(context.pendingSelection.current, null);
  }
});

test('rapid Ctrl-click after collapsing multiselection uses the remaining row rather than the removed anchor', async () => {
  const { context, requests, click, flush } = delayedSelection();
  click('a'); click('b', true); click('b', true);
  assert.equal(context.anchor, 'b');
  assert.equal(requests[1].id, 'a');
  click('c', true);
  assert.deepEqual(Array.from(context.multi), ['a', 'c']);
  requests[1].resolve(); await flush();
  requests[0].resolve(); await flush();
  assert.deepEqual(Array.from(context.multi), ['a', 'c']);
  assert.equal(context.selected.asset.id, 'a');
});

test('older reads cannot clear a newer pending selection or overwrite its eventual summary', async () => {
  const { context, requests, click, flush } = delayedSelection();
  click('a'); click('c');
  requests[0].resolve(); await flush();
  assert.equal(context.detailLoading, true);
  assert.equal(context.pendingSelection.current.id, 'c');
  assert.equal(context.selected, null);
  click('b', true);
  assert.deepEqual(Array.from(context.multi), ['c', 'b']);
  requests[1].resolve(); await flush();
  assert.equal(context.selected.asset.id, 'c');
  assert.deepEqual(Array.from(context.multi), ['c', 'b']);
});

test('finished, failed and cleared reads do not leave a stale row for later additive selection', async () => {
  for (const outcome of ['finished', 'failed', 'cleared']) {
    const { context, requests, click, flush, clear } = delayedSelection();
    click('a');
    if (outcome === 'finished') requests[0].resolve();
    else if (outcome === 'failed') requests[0].reject(new Error('read failed'));
    else {
      // clearSelection ends batch selection; it does not cancel the current summary read.
      clear(); requests[0].resolve();
    }
    await flush();
    assert.equal(context.pendingSelection.current, null);
    context.setSelected({ asset: { id: 'd' }, deleted: false });
    click('b', true);
    assert.deepEqual(Array.from(context.multi), ['d', 'b'], 'non-select updates use the actual active record');
  }
});
