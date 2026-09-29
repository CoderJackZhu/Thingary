import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildNewMenu, searchSections, emptySearches } from '../src/topbar-model.ts';

const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const topbar = readFileSync(new URL('../src/topbar.tsx', import.meta.url), 'utf8');

test('新增记录 menu keeps the fixed order and only lists switched-on modules', () => {
  const targets = [];
  const menu = buildNewMenu({ wishlist: true, wealth: true, expenses: true, recurring: true, virtual: true }, t => targets.push(t));
  assert.deepEqual(menu.items.map(i => i.label), ['新增物品', '新增心愿', '新增账户', '记一笔支出', '新增计划', '新增虚拟资产']);
  assert.deepEqual(targets, []);
  for (const item of menu.items) item.run();
  assert.deepEqual(targets, ['asset', 'wishlist', 'wealth', 'expenses', 'recurring', 'virtual']);
});

test('switched-off modules never appear in the menu, so no shortcut can reach them', () => {
  const menu = buildNewMenu({ wishlist: false, wealth: false, expenses: false, recurring: false, virtual: false }, () => {});
  assert.deepEqual(menu.items.map(i => i.key), ['asset']);
});

test('every searchable page has a session search slot and clearing resets all of them', () => {
  assert.deepEqual(Object.keys(emptySearches).sort(), [...searchSections].sort());
  for (const value of Object.values(emptySearches)) assert.equal(value, '');
});

test('⌘N/⌘F dispatch to the current page and never through an open modal', () => {
  // The dispatcher consults the page bar (menu pages open the menu), and both
  // shortcuts carry the same modal guard ⌘A already used.
  assert.ok(app.includes("if (action === 'new-asset')"), '⌘N branch');
  assert.match(app, /action === 'new-asset'[\s\S]{0,240}document\.querySelector\('dialog\[open\]'\)/);
  assert.ok(app.includes("if (action === 'find-asset')"), '⌘F branch');
  assert.match(app, /action === 'find-asset'[\s\S]{0,240}document\.querySelector\('dialog\[open\]'\)/);
  assert.match(app, /if \(!topbarFor\(section\)\.search\) return;/, '⌘F stays put on pages without search');
  assert.match(app, /if \(bar\.menu\) \{ setMenuOpen\(true\); return; \}/, '⌘N opens the menu on the combined/timeline page');
});

test('the topbar renders one primary entry, an optional secondary and the page search', () => {
  // Single source: the default bar per section, overridden by page registration.
  assert.match(app, /function topbarFor\(sec: Section\): PageBar \{\s*const provided = pageBars\[sec\]\?\.\(\);/, 'page registration overrides the default');
  // No page keeps its own top action row or a duplicate global topbar.
  assert.ok(!app.includes("section !== 'wishlist' && <div className=\"topbar-actions\""), 'old global topbar is gone');
  for (const file of ['WealthPage', 'ExpensesPage', 'RecurringPage', 'VirtualPage']) {
    const src = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), 'utf8');
    assert.ok(!src.includes('wealth-actions'), `${file} no longer carries its own top action row`);
    assert.match(src, /usePageBar\(/, `${file} publishes its actions to the topbar`);
  }
});

test('dataset changes and module switches clear session search words', () => {
  assert.match(app, /lastGeneration\.current !== generation[\s\S]{0,400}setSearches\(\{ \.\.\.emptySearches \}\)/, 'generation change clears every search word');
  assert.match(app, /!modules\[key\] && next\[key\]/, 'a switched-off module drops its search word');
  assert.ok(!topbar.includes('localStorage') && !readFileSync(new URL('../src/topbar-model.ts', import.meta.url), 'utf8').includes('localStorage'), 'search words stay in memory only');
});

test('search boxes are accessible, clearable and IME-safe', () => {
  assert.match(topbar, /aria-label=\{search\.placeholder\}/);
  assert.match(topbar, /search-clear/);
  assert.match(topbar, /!e\.nativeEvent\.isComposing/, 'Escape during IME composition is left alone');
  assert.match(topbar, /type="button" className="search-clear"/, 'the clear button never submits a form');
});
