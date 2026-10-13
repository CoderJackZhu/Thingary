import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { collectionNavigation } from '../src/collection-navigation.ts';

test('item titles and selected segments agree for every status and warranty scope', () => {
  const statusTitles = { all: '全部物品', active: '使用中', retired: '已退役', sold: '已售出', missing_price: '全部物品', missing_date: '全部物品' };
  for (const [filter, defaultTitle] of Object.entries(statusTitles)) {
    for (const warranty of [undefined, 'all', 'covered', 'expiring', 'lapsed', 'none']) {
      assert.deepEqual(collectionNavigation({ filter, warranty }), {
        title: filter === 'all' && warranty === 'covered' ? '保障中' : defaultTitle,
        selected: filter.startsWith('missing_') ? null : filter,
      }, `${filter} × ${warranty}`);
    }
  }
});

test('changing an item segment replaces missing-information scope and resets pagination while preserving other filters', () => {
  // Execute the real list transition, including selection and stale-summary guards.
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const functionSource = main.match(/  function adjust\(part: Partial<Query>\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(functionSource, 'the list query handler must be available');
  const compiled = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const missing of ['missing_price', 'missing_date']) {
    const original = { filter: missing, warranty: 'covered', category: { mode: 'id', id: 'fictional-category' }, label: 'fictional-label', search: '虚构', sort: 'price', descending: false, offset: 100 };
    let query = original;
    let selected = { asset: { id: 'fictional' } }, multi = ['fictional'], anchor = 'fictional', detailError = '旧错误', detailLoading = true;
    const detailTicket = { current: 7 };
    const change = new Function('setQuery', 'setMulti', 'setAnchor', 'detailTicket', 'setSelected', 'setDetailError', 'setDetailLoading', `${compiled}; return adjust;`)(
      update => { query = update(query); }, value => { multi = value; }, value => { anchor = value; }, detailTicket,
      value => { selected = value; }, value => { detailError = value; }, value => { detailLoading = value; },
    );
    change({ filter: 'retired' });
    assert.deepEqual(query, { ...original, filter: 'retired', offset: 0 });
    assert.deepEqual(collectionNavigation(query), { selected: 'retired', title: '已退役' });
    assert.deepEqual([multi, anchor, selected, detailError, detailLoading, detailTicket.current], [[], null, null, '', false, 8]);
    change({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all', label: null });
    assert.deepEqual(query, { ...original, search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all', label: null, offset: 0 });
    assert.deepEqual(collectionNavigation(query), { selected: 'all', title: '全部物品' });
    assert.deepEqual(original.filter, missing, 'the previous query is not mutated');
  }
});
