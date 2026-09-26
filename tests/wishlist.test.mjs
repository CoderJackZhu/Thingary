import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWishlistFields, storedWishlistChange, storedWishlistDraft, validateWishlist, wishlistAbandonKey, wishlistBlocksApp, wishlistChange, wishlistDraftKey } from '../src/wishlist.ts';

test('wishlist distinguishes unknown and zero and accepts future target dates', () => {
  assert.deepEqual(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', target_date: '2099-12-31' }), {});
  assert.deepEqual(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', estimated_price: '0' }), {});
  assert.match(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', estimated_price: '-1' }).estimated_price ?? '', /非负金额/);
  assert.match(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', estimated_price: '1.001' }).estimated_price ?? '', /最多两位小数/);
  assert.deepEqual(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', estimated_price: '999999999.99' }), {});
  assert.match(validateWishlist({ ...emptyWishlistFields, name: '虚构心愿', estimated_price: '1000000000' }).estimated_price ?? '', /最高/);
  assert.match(validateWishlist({ ...emptyWishlistFields, name: '', target_date: '2026-2-01' }).target_date ?? '', /YYYY-MM-DD/);
});

test('wishlist payload has category but never a purchase channel', () => {
  const draft = { generation: 'generation-1', fields: { ...emptyWishlistFields, name: '相机', category_id: 'category-1', estimated_price: '1500', priority: 'high', target_date: '2027-01-01', external_link: 'https://example.test/item', notes: '虚构资料' }, cover: { id: 'cover-1', name: 'camera.png' }, photoError: '', pending: null };
  const change = wishlistChange(draft);
  assert.equal(change.action.type, 'add');
  assert.equal(change.action.fields.estimated_price_cents, '150000');
  assert.equal(change.action.fields.category_id, 'category-1');
  assert.equal('channel_id' in change.action.fields, false);
  assert.deepEqual(change.action.cover, { ids: ['cover-1'], cover_id: 'cover-1' });
  assert.throws(() => wishlistChange({ ...draft, fields: { ...draft.fields, estimated_price: '1.001' } }), /最多两位小数/);
});

test('stored draft preserves exact pending request and rejects malformed data', () => {
  const pending = { request_id: 'request-1', generation: 'generation-1', expected_revision: null, action: { type: 'add', fields: { name: '键盘', category_id: null, estimated_price_cents: null, priority: null, target_date: null, external_link: '', notes: '' }, cover: { ids: [], cover_id: null } } };
  const draft = { generation: 'generation-1', fields: { ...emptyWishlistFields, name: '键盘' }, cover: null, photoError: '', pending };
  const storage = { getItem: key => key === wishlistDraftKey ? JSON.stringify(draft) : null };
  assert.deepEqual(storedWishlistDraft(storage), draft);
  assert.equal(storedWishlistDraft({ getItem: () => JSON.stringify({ ...draft, pending: { request_id: 'request-1' } }) }), null);
  assert.equal(storedWishlistDraft({ getItem: () => '{bad' }), null);
  assert.equal(storedWishlistDraft({ getItem: () => JSON.stringify({ generation: 'g', fields: {} }) }), null);
});

test('wishlist recovery freezes other flows and abandon recovery keeps the exact input', () => {
  const abandon = { request_id: 'request-2', generation: 'generation-1', expected_revision: 3, action: { type: 'abandon', wishlist_id: 'wishlist-1' } };
  const storage = { getItem: key => key === wishlistAbandonKey ? JSON.stringify(abandon) : null };
  assert.deepEqual(storedWishlistChange(storage, wishlistAbandonKey), abandon);
  assert.equal(wishlistBlocksApp({ editor: null, recovered: null, abandon: null, abandonRecovery: abandon }), true);
  assert.equal(wishlistBlocksApp({ editor: null, recovered: { pending: null }, abandon: null, abandonRecovery: null }), true);
  assert.equal(wishlistBlocksApp({ editor: null, recovered: null, abandon: null, abandonRecovery: null }), false);
});

test('wishlist UI replays full receipts, exposes abandon retry, and uses category art fallback', () => {
  const panel = readFileSync(new URL('../src/WishlistPanel.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(panel, /saved_wishlist_request', \{ input: draft\.pending \}/);
  assert.match(panel, /saved_wishlist_request', \{ input: abandonRecovery \}/);
  assert.match(panel, /再次核对/);
  assert.match(panel, /categoryArt\(taxonomy\?\.categories\.find\(c => c\.id === item\.fields\.category_id\)\?\.icon\)/);
  assert.match(app, /if \(wishlistEditing \|\| !page/);
  assert.match(app, /disabled=\{wishlistEditing \|\| !!\(trashRecovery \|\| recordTrashRecovery\)\}/);
  assert.match(app, /useState\(\(\) => !!storedWishlistDraft\(localStorage\) \|\| !!storedWishlistChange\(localStorage, wishlistAbandonKey\)\)/);
  assert.match(app, /有一份心愿草稿或待确认操作，请先处理/);
});

test('grid/list and all four sorts are represented by the authoritative query contract', () => {
  const sorts = ['created', 'priority', 'price', 'target'];
  assert.equal(new Set(sorts).size, 4);
  for (const sort of sorts) assert.ok(['created', 'priority', 'price', 'target'].includes(sort));
});

test('wishlist dates render the local day, not the UTC prefix', async () => {
  process.env.TZ = 'Asia/Shanghai';
  const { localDay } = await import('../src/asset.ts');
  assert.equal(localDay(new Date('2020-01-01T20:09:16.652389+00:00')), '2020-01-02');
  assert.match(readFileSync(new URL('../src/WishlistPanel.tsx', import.meta.url), 'utf8'), /加入：\{localDay\(new Date\(item\.created_at\)\)\}.*放弃：' \+ localDay\(new Date\(item\.abandoned_at\)\)/);
});

test('conversion form never copies the estimate into the actual price and reuses receipt recovery', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../src/AssetEditor.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/WishlistPanel.tsx', import.meta.url), 'utf8');
  assert.match(main, /\{ \.\.\.emptyFields, name: wish\?\.fields\.name \?\? '', date: localDay\(\) \}/);
  assert.doesNotMatch(main, /price: [^,}]*estimated_price/);
  assert.match(editor, /conversion \? await invoke<AssetRecord>\('convert_wishlist'/);
  assert.match(editor, /invoke<AssetRecord \| null>\('saved_request', \{ request: input\.base\.request_id/);
  assert.match(panel, /item\.status === 'ongoing' && <div className="wishlist-actions">.*已购入…/);
  assert.match(panel, /item\.converted_asset\.deleted \?.*前往最近删除.*查看资产/);
});
