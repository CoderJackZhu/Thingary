import test from 'node:test';
import assert from 'node:assert/strict';
import { cardView, categoryName, detailActions, mergePages, newPurchaseDraft, newWishDraft, editWishDraft, overdueBanner, purchaseSave, sortLabel, summaryParts, defaultDescending, yuanText, planOverdue, reasonSummary, replacementLine, isFiltered, initialQuery } from '../src/mobile/wishes/model.ts';
import { wishHeaderSummary } from '../src/wishlist.ts';
import { wishPlanSave } from '../src/wish-save.ts';

const wish = (id, over = {}, fields = {}) => ({ id, fields: { name: id, category_id: null, estimated_price_cents: '100000', priority: null, target_date: '', external_link: '', notes: '', ...fields }, status: 'ongoing', decision_state: 'considering', decision_note: '', purchase_source: null, revision: 3, created_at: '2026-09-01T09:00:00.000Z', updated_at: '', abandoned_at: null, achieved_at: null, converted_asset: null, cover: null, photos: [], ...over });

test('页头合计拆分后与电脑端文字一致，价格未知不当成零', () => {
  for (const [page, n] of [[{ considering_known_cents: '1860000', considering_unknown_count: 1, legacy_achieved_count: 1 }, 5], [{ considering_known_cents: '0', considering_unknown_count: 2, legacy_achieved_count: 0 }, 2], [{ considering_known_cents: '0', considering_unknown_count: 0, legacy_achieved_count: 0 }, 0]]) {
    const parts = summaryParts(page, n), desktop = wishHeaderSummary(page, n);
    // 手机端整数元不带 .00（电脑端 wishHeaderSummary 固定两位小数），其余文字一致。
    assert.equal(`${parts.count} · 预计价格合计 ${parts.amount}${parts.unknown}`, desktop.main.replace(/(\d)\.00(?!\d)/g, '$1'));
    assert.equal(parts.main, `${parts.count} · 预计价格合计 ${parts.amount}${parts.unknown}`);
    assert.equal(parts.legacy, desktop.legacy);
  }
  assert.equal(summaryParts({ considering_known_cents: '1860000', considering_unknown_count: 0, legacy_achieved_count: 0 }, 5).amount, '¥18,600');
  assert.equal(summaryParts({ considering_known_cents: '1860050', considering_unknown_count: 0, legacy_achieved_count: 0 }, 5).amount, '¥18,600.50');
  assert.equal(summaryParts({ considering_known_cents: '0', considering_unknown_count: 2, legacy_achieved_count: 0 }, 2).amount, '未知');
  assert.equal(summaryParts({ considering_known_cents: '0', considering_unknown_count: 2, legacy_achieved_count: 0 }, 2).allUnknown, true);
});
test('排序默认方向与标签沿用电脑端规则', () => {
  assert.equal(defaultDescending('target'), false); assert.equal(defaultDescending('created'), true); assert.equal(defaultDescending('price'), true);
  assert.equal(sortLabel('created', true), '加入日期 新 → 旧');
  assert.equal(isFiltered(initialQuery), false); assert.equal(isFiltered({ ...initialQuery, filter: 'dropped' }), true);
});
test('分页追加去重，后读到的为准', () => {
  const merged = mergePages([wish('a'), wish('b')], [wish('b', { revision: 9 }), wish('c')]);
  assert.deepEqual(merged.map(w => w.id), ['a', 'b', 'c']); assert.equal(merged[1].revision, 9);
});
test('卡片：未知价格、计划日期已过只提示考虑中、置顶与分类', () => {
  const late = wish('late', {}, { target_date: '2026-10-01', estimated_price_cents: null, notes: '第一行\n第二行' });
  const view = cardView(late, '2026-10-21', [{ id: 'x', name: 'X' }]);
  assert.equal(view.price, null); assert.equal(view.overdue, true); assert.equal(view.reason, '第一行'); assert.equal(view.category, '未分类');
  assert.equal(planOverdue(wish('p', { decision_state: 'purchased' }, { target_date: '2026-01-01' }), '2026-10-21'), false);
  assert.equal(cardView(wish('z', { preferences: { pinned: true } }, { category_id: 'x' }), '2026-10-21', [{ id: 'x', name: 'X' }]).pinned, true);
  assert.equal(categoryName(wish('c', {}, { category_id: 'x' }), null), null);
  assert.equal(reasonSummary('一'.repeat(50)).length, 41);
});
test('逾期提醒取最早一条并计数', () => {
  const items = [wish('a', {}, { target_date: '2026-10-10' }), wish('b', {}, { target_date: '2026-09-01' }), wish('c', {}, { target_date: '2027-01-01' })];
  const banner = overdueBanner(items, '2026-10-21');
  assert.equal(banner.id, 'b'); assert.equal(banner.count, 2); assert.equal(overdueBanner([items[2]], '2026-10-21'), null);
});
test('详情操作按状态给出，历史待核实无原物品时也可记录购入', () => {
  assert.deepEqual(Object.entries(detailActions(wish('a'))).filter(([, v]) => v).map(([k]) => k), ['record', 'link', 'drop']);
  assert.equal(detailActions(wish('d', { decision_state: 'dropped' })).reconsider, true);
  assert.equal(detailActions(wish('p', { decision_state: 'purchased', converted_asset: { id: 'x', name: 'x', deleted: false } })).viewAsset, true);
  assert.equal(detailActions(wish('p', { decision_state: 'purchased', converted_asset: { id: 'x', name: 'x', deleted: true } })).trashHint, true);
  const legacy = detailActions(wish('l', { decision_state: 'legacy_achieved' }));
  assert.equal(legacy.verify, true); assert.equal(legacy.record, true);
  assert.equal(detailActions(wish('l', { decision_state: 'legacy_achieved', legacy_generated_asset: { id: 'g', name: 'g', deleted: false } })).record, false);
});
test('替换物品一行：购入日期、状态、已有总投入与未知维护提示', () => {
  const record = { asset: { purchase_date: null }, lifecycle: { state: 'retired' }, costs: { total_investment_cents: '128000', unknown_maintenance_count: 2 } };
  const line = replacementLine(record);
  assert.equal(line.text, '购入日期未知 · 已退役'); assert.equal(line.investment, '已有总投入 ¥1,280（2 笔维护金额未知）');
  assert.equal(replacementLine({ ...record, costs: { total_investment_cents: null, unknown_maintenance_count: 0 } }).investment, '已有总投入 未知');
});
test('编辑心愿：金额文本不走浮点；保存请求与电脑端规则一致', () => {
  assert.equal(yuanText('1234567'), '12345.67'); assert.equal(yuanText('880000'), '8800'); assert.equal(yuanText(null), '');
  const draft = newWishDraft('g1', '2026-10-21');
  assert.equal(wishPlanSave(draft, 'r').input, null);
  draft.fields.name = '耳机'; draft.fields.estimated_price = '12.5';
  const ok = wishPlanSave(draft, 'r1');
  assert.equal(ok.input.fields.estimated_price_cents, '1250'); assert.equal('estimated_price' in ok.input.fields, false);
  assert.equal(ok.input.id, null); assert.equal(ok.input.preferences.added_date, '2026-10-21'); assert.equal(ok.input.fields.target_date, null);
  draft.fields.estimated_price = ''; assert.equal(wishPlanSave(draft, 'r2').input.fields.estimated_price_cents, null);
  draft.fields.estimated_price = 'abc'; assert.ok(wishPlanSave(draft, 'r3').errors.estimated_price);
  draft.fields.estimated_price = ''; draft.preferences.reminder = true;
  assert.ok(wishPlanSave(draft, 'r4').errors.target_date, '开启提醒需要计划日期');
  draft.fields.external_link = 'ftp://x'; assert.ok(wishPlanSave(draft, 'r5').errors.external_link);
});
test('编辑已有心愿：带 revision，清除替换物品会带 clear_replacement', () => {
  const item = wish('w', { replacement_asset: { id: 'old', name: '旧', deleted: false }, preferences: { added_date: '2026-09-01', channel_id: null, mode: null, saved_cents: '0', achievement_source: null, pinned: false, reminder: false } });
  const draft = editWishDraft(item, 'g1');
  const keep = wishPlanSave(draft, 'r').input;
  assert.equal(keep.expected_revision, 3); assert.equal(keep.replacement_asset_id, 'old'); assert.equal('clear_replacement' in keep, false);
  const cleared = wishPlanSave({ ...draft, replacementAssetId: null }, 'r').input;
  assert.equal(cleared.replacement_asset_id, null); assert.equal(cleared.clear_replacement, true);
});
test('记录购入：预填名称与分类，预计价格不当作实付，购入日期不能晚于今天', () => {
  const item = wish('w', {}, { name: '吸尘器', category_id: 'home' });
  const draft = newPurchaseDraft(item, 'g1', '2026-10-21', { id: 'cover', name: 'c' });
  assert.equal(draft.fields.name, '吸尘器'); assert.equal(draft.fields.price, ''); assert.equal(draft.classification.category_id, 'home'); assert.equal(draft.cover, 'cover');
  const built = purchaseSave(draft, '2026-10-21', 'req');
  assert.equal(built.input.base.price_cents, null); assert.equal(built.input.base.asset_id, null); assert.deepEqual(built.input.photos, { ids: ['cover'], cover_id: 'cover' });
  draft.fields.date = '2026-12-01'; assert.ok(purchaseSave(draft, '2026-10-21', 'req').errors.date);
  draft.fields.date = '2026-10-01'; draft.fields.price = '3500';
  assert.equal(purchaseSave(draft, '2026-10-21', 'req').input.base.price_cents, '350000');
});
