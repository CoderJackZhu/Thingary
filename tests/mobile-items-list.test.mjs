import test from 'node:test';
import assert from 'node:assert/strict';
import { appendPage, changeQuery, chooseSort, initialQuery } from '../src/mobile/items/list-model.ts';
const page=(ids,generation='g',today='2026-10-21')=>({generation,today,total:ids.length,items:ids.map(id=>({asset:{id}}))});
test('query edits retain backend filter semantics and reset pagination',()=>{const q=initialQuery();assert.equal(q.sort,'date');assert.equal(q.descending,true);const n=changeQuery({...q,offset:100},{filter:'missing_price',warranty:'expiring',label:'none'});assert.equal(n.offset,0);assert.equal(n.filter,'missing_price');assert.equal(n.warranty,'expiring');assert.equal(n.label,'none');assert.equal(q.filter,'all');});
test('sort choice uses desktop toggle convention',()=>{const q=initialQuery();assert.equal(chooseSort(q,'date').descending,false);assert.equal(chooseSort(q,'price').descending,false);assert.equal(chooseSort(chooseSort(q,'price'),'price').descending,true);});
test('pagination preserves server order, refuses duplicates or mixed datasets/days',()=>{const first=page(['b','a']);assert.deepEqual(appendPage(first,page(['c']),2).items.map(x=>x.asset.id),['b','a','c']);assert.throws(()=>appendPage(first,page(['a']),2),/顺序已变化/);assert.throws(()=>appendPage(first,page(['c'],'other'),2),/资料已变化/);assert.throws(()=>appendPage(first,page(['c'],'g','2026-10-22'),2));assert.throws(()=>appendPage(first,page(['c']),100));assert.equal(appendPage(first,page([]),0).items.length,0);});

import { itemsSummary, stateCaption } from '../src/mobile/items/list-model.ts';
const overview = (patch = {}, daily = {}) => ({ held_count: 7, held_known_cents: '3808700', held_unknown_price_count: 0, sold_count: 1, held_daily: { known_cents: '3182', included_count: 7, unknown_count: 0, per_use_count: 0, excluded_count: 0, ...daily }, ...patch });
test('summary: held total and counts come straight from the held overview', () => {
  const s = itemsSummary(overview());
  assert.deepEqual([s.totalCents, s.unknownPriceCount, s.dailyCents, s.heldCount, s.soldCount], ['3808700', 0, '3182', 7, 1]);
  assert.deepEqual(s.dailyNotes, []);
});
test('summary: unknown prices are reported, never counted as zero', () => {
  const s = itemsSummary(overview({ held_known_cents: '1000000', held_unknown_price_count: 2 }));
  assert.equal(s.totalCents, '1000000'); assert.equal(s.unknownPriceCount, 2);
  const none = itemsSummary(overview({ held_known_cents: '0', held_unknown_price_count: 7 }));
  assert.equal(none.totalCents, null, 'all prices unknown is unknown, not ¥0');
  assert.equal(itemsSummary(overview({ held_count: 0, held_known_cents: '0' })).totalCents, '0', 'nothing held is a true zero');
});
test('summary: daily cost unknown stays null and explains partial data', () => {
  const s = itemsSummary(overview({}, { known_cents: null, unknown_count: 3, per_use_count: 1, excluded_count: 2 }));
  assert.equal(s.dailyCents, null);
  assert.deepEqual(s.dailyNotes, ['3 件资料不全，日均仅含已知部分', '1 件按次', '2 件不计入日均']);
});
test('state caption shows category, sort and direction, and flags other filters', () => {
  const q = initialQuery();
  assert.equal(stateCaption(q, '全部'), '分类：全部 · 购入日期 ↓');
  assert.equal(stateCaption({ ...q, sort: 'price', descending: false }, '电脑与办公'), '分类：电脑与办公 · 购入金额 ↑');
  assert.equal(stateCaption({ ...q, warranty: 'expiring' }, '全部'), '分类：全部 · 购入日期 ↓ · 已筛选');
});
