import test from 'node:test';
import assert from 'node:assert/strict';
import { nextListSort, moneySortValue, sortRecords } from '../src/list-sort.ts';

test('switching a column begins ascending and repeated clicks toggle the same column', () => {
  const date = { key: 'date', descending: true };
  const name = nextListSort(date, 'name');
  assert.deepEqual(name, { key: 'name', descending: false });
  assert.deepEqual(nextListSort(name, 'name'), { key: 'name', descending: true });
  assert.deepEqual(nextListSort(date, 'date'), { key: 'date', descending: false });
});

test('numeric record sorting preserves zero, negative amounts, unknowns and integer precision', () => {
  const rows = [{id:'unknown',value:null},{id:'zero',value:'0'},{id:'refund',value:'-1200'},{id:'large-b',value:'9007199254740993'},{id:'large-a',value:'9007199254740992'}];
  const original = structuredClone(rows);
  const value = r => moneySortValue(r.value), id = r => r.id;
  assert.deepEqual(sortRecords(rows,{key:'amount',descending:false},value,id).map(id),['refund','zero','large-a','large-b','unknown']);
  assert.deepEqual(sortRecords(rows,{key:'amount',descending:true},value,id).map(id),['large-b','large-a','zero','refund','unknown']);
  assert.deepEqual(rows,original);
});

test('pinned records stay first and ties have stable IDs without changing records', () => {
  const rows = [{id:'b',name:'same',pinned:false},{id:'a',name:'SAME',pinned:false},{id:'z',name:'Z',pinned:true}];
  for (const descending of [false,true]) {
    const sorted=sortRecords(rows,{key:'name',descending},r=>r.name,r=>r.id,r=>r.pinned);
    assert.deepEqual(sorted.map(r=>r.id),['z','a','b']);
    assert.strictEqual(sorted[1],rows[1]);
  }
});
