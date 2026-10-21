import test from 'node:test';
import assert from 'node:assert/strict';
import { itemDraft, itemSaveInput, setIconSession, getIconSession, clearIconSession } from '../src/mobile/items/edit-model.ts';
import { defaultPreferences, newAssetWarranty, changeNewAssetWarrantyPurchase } from '../src/preferences.ts';

test('new item keeps unknown price/date distinct from an explicit free purchase', () => {
  const draft = itemDraft(null); draft.fields.name = '虚构台灯';
  const unknown = itemSaveInput(draft, 'preview-library', '2026-10-21', 'request-one');
  assert.equal(unknown.base.price_cents, null); assert.equal(unknown.base.purchase_date, null);
  draft.fields.price = '0';
  assert.equal(itemSaveInput(draft, 'preview-library', '2026-10-21', 'request-two').base.price_cents, '0');
});

test('editing preserves source revision, classification, exclusion and media identity', () => {
  const preferences = defaultPreferences(); preferences.exclude.daily = true; preferences.cost_mode = 'per_use'; preferences.use_count = 3;
  const record = { asset: { id: 'fixture-asset', revision: 8, name: '虚构相机', price_cents: '105099', purchase_date: '2024-02-29' }, details: { brand: '虚构品牌', model: '', serial_number: '', notes: '虚构记录' }, preferences, photos: [{ id: 'photo-two', name: '第二张' }, { id: 'photo-one', name: '第一张' }], cover_id: 'photo-one', classification: { category_id: 'category-one', channel_id: null } };
  const input = itemSaveInput(itemDraft(record), 'preview-generation', '2026-10-21', 'original-request');
  assert.deepEqual(input.base, { request_id: 'original-request', generation: 'preview-generation', asset_id: 'fixture-asset', expected_revision: 8, name: '虚构相机', price_cents: '105099', purchase_date: '2024-02-29' });
  assert.deepEqual(input.photos, { ids: ['photo-two', 'photo-one'], cover_id: 'photo-one' });
  assert.equal(input.options.preferences.exclude.daily, true); assert.equal(input.options.preferences.use_count, 3);
  assert.equal(input.classification.category_id, 'category-one');
});

test('mobile save obeys desktop validation for impossible and future dates and large amounts', () => {
  const draft = itemDraft(null); draft.fields.name = '虚构物品';
  for (const date of ['2025-02-29', '2026-10-22']) { draft.fields.date = date; assert.throws(() => itemSaveInput(draft, 'preview', '2026-10-21', 'req')); }
  draft.fields.date = ''; draft.fields.price = '1000000000'; assert.throws(() => itemSaveInput(draft, 'preview', '2026-10-21', 'req'));
});

test('warranty uses shared calendar rules and preserves an explicitly edited end', () => {
  const warranty = newAssetWarranty('2024-02-29', '2026-10-21'); assert.equal(warranty.end_date, '2025-02-28');
  const edited = { ...warranty, end_date: '2027-08-01' };
  assert.equal(changeNewAssetWarrantyPurchase(edited, '2026-10-01', '2026-10-21', true).end_date, '2027-08-01');
  assert.equal(newAssetWarranty(null, '2026-10-21').start_date, '2026-10-21');
});

test('icon picker channel is transient and cannot survive editor cleanup', () => {
  let chosen = null;
  setIconSession('fictional-editor', { generation: 'preview', photos: [], cover: null, choose: photo => { chosen = photo; } });
  getIconSession('fictional-editor').choose({ id: 'preview-photo', name: '虚构照片' }, false);
  assert.equal(chosen.id, 'preview-photo'); clearIconSession('fictional-editor'); assert.equal(getIconSession('fictional-editor'), undefined);
});
