import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptySearchSession, searchDebounceMs, searchFilterList, searchKindLabel, searchKindModule, searchKindOrder, searchPageSize } from '../src/search.ts';

test('filter list follows the fixed kind order and module gating', () => {
  const allOn = () => true;
  const counts = [['asset', 2], ['wish', 1], ['account', 0], ['snapshot', 3], ['expense', 0], ['plan', 1], ['payment', 5], ['virtual', 0], ['topup', 0]];
  const list = searchFilterList(counts, allOn);
  assert.deepEqual(list.map(f => f.value), ['all', ...searchKindOrder]);
  assert.equal(list[0].count, 12);
  assert.equal(list.find(f => f.value === 'snapshot')?.count, 3);
  // Closed modules drop their types from the list; the backend already zeroes
  // their counts, so 全部 mirrors the response it produced.
  const wishlistOff = kind => searchKindModule(kind) !== 'wishlist';
  const backendCounts = counts.map(([k, n]) => [k, searchKindModule(k) === 'wishlist' ? 0 : n]);
  const gated = searchFilterList(backendCounts, wishlistOff);
  assert.equal(gated.some(f => f.value === 'wish'), false);
  assert.equal(gated[0].count, 11, 'closed-module counts left the 全部 total');
  // No counts yet (still loading): labels still render without numbers.
  const pending = searchFilterList(null, allOn);
  assert.equal(pending[0].count, null);
  assert.equal(pending.length, 10);
});

test('labels and constants match the design', () => {
  assert.equal(searchKindLabel('payment'), '周期付款记录');
  assert.equal(searchKindLabel('topup'), '储值充值');
  assert.equal(searchKindModule('asset'), null);
  assert.equal(searchKindModule('snapshot'), 'wealth');
  assert.equal(searchDebounceMs, 200);
  assert.equal(searchPageSize, 30);
  assert.deepEqual(emptySearchSession(), { keyword: '', typeFilter: 'all', offset: 0, scrollTop: 0, revision: null, open: false });
});

test('app shell wiring keeps ⌘F/⌘N meanings and isolates the session (B01/B05/B07)', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  // ⌘⇧F only opens the global search; ⌘F keeps its page meaning.
  assert.match(main, /e\.shiftKey && \(e\.key === 'F' \|\| e\.key === 'f'\)\) \{ e\.preventDefault\(\); openGlobalSearch\(\); \}/);
  assert.match(main, /action === 'global-search'\) \{ openGlobalSearch\(\); return; \}/);
  assert.match(main, /action === 'find-asset'/);
  assert.match(main, /action === 'new-asset'/);
  // The public toolbar entry is always rendered, narrow windows keep the name.
  assert.match(main, /className="global-search-open"/);
  assert.match(main, /搜索全部资料/);
  // Library switch / module toggles clear the session.
  assert.match(main, /useEffect\(\(\) => \{ setSearchSession\(emptySearchSession\(\)\); \}, \[libraryGeneration, modules\.wishlist/);
  // Blocked flows are not bypassed by search (B09).
  assert.match(main, /modeBlocked \|\| document\.querySelector\('dialog\[open\]'\)\) \{ setNotice\('请先完成当前编辑或核对保存结果，再打开搜索。'\)/);
});

test('menu and account routing reach the native layer', () => {
  const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(lib, /"global-search"/);
  assert.match(lib, /搜索全部资料/);
  assert.match(lib, /CmdOrCtrl\+Shift\+F/);
  assert.match(lib, /\| "global-search"/);
  const source = readFileSync(new URL('../src/source.ts', import.meta.url), 'utf8');
  assert.match(source, /'plan' \| 'account'; id: string \}/);
  assert.match(source, /account: 'wealth'/);
  const rust = readFileSync(new URL('../src-tauri/src/source.rs', import.meta.url), 'utf8');
  assert.match(rust, /Account \{\s*id: String,/);
  assert.match(rust, /Target::Account \{ id \} => \("fin_accounts", id\),/);
});
