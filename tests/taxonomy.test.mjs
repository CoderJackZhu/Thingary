import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_ICONS,
  findCategoryIcon,
  isDuplicateName,
  normalizeName,
  applyPreviewCommand,
  previewSnapshot,
  validatePreviewName,
  validateTaxonomyName,
} from '../src/taxonomy.ts';

const entries = [
  { id: 'a', name: '电子', icon: 'computer', references: { activeAssets: 1, deletedAssets: 0 } },
  { id: 'b', name: 'Apple Store', references: { activeAssets: 2, deletedAssets: 0 } },
  { id: 'c', name: '相机', icon: 'camera', references: { activeAssets: 0, deletedAssets: 1 } },
];

test('normalizeName trims whitespace and applies NFC', () => {
  // 中文/全角空格对 NFC 没有可见差异，但周边空白必须被去掉
  assert.equal(normalizeName('  相机  '), '相机');
  // 组合字符 + NFC 应保持稳定
  assert.equal(normalizeName('\u00A0e\u0301\u00A0'), '\u00e9');
});

test('isDuplicateName is case-insensitive across ASCII and trims', () => {
  assert.ok(isDuplicateName(entries, '  apple store  '));
  assert.ok(isDuplicateName(entries, 'apple store'));
  assert.ok(isDuplicateName(entries, 'APPLE STORE'));
  assert.ok(!isDuplicateName(entries, '其他渠道'));
});

test('isDuplicateName allows same name across different entities', () => {
  // rename 同一 ID 不算冲突
  assert.ok(!isDuplicateName(entries, '电子', 'a'));
  assert.ok(isDuplicateName(entries, '电子', 'b'));
});

test('isDuplicateName compares only same-list entries', () => {
  // 空列表永不重复
  assert.ok(!isDuplicateName([], '相机'));
  // 编辑自身时即使名字匹配也不算重复
  assert.ok(!isDuplicateName(entries, '相机', 'c'));
});

test('CATEGORY_ICONS describe all six contract icons with Chinese labels', () => {
  const labels = CATEGORY_ICONS.map((icon) => icon.label);
  assert.equal(CATEGORY_ICONS.length, 6);
  assert.deepEqual(
    CATEGORY_ICONS.map((icon) => icon.value),
    ['box', 'computer', 'phone', 'camera', 'audio', 'home'],
  );
  for (const label of labels) {
    assert.match(label, /[\u4e00-\u9fff]/, `expected Chinese label, got "${label}"`);
  }
});

test('findCategoryIcon returns Chinese label even for unknown values', () => {
  // 通过类型守卫仅暴露已知值；但运行时若有未知，应回退到首项
  const fallback = findCategoryIcon('unexpected');
  assert.equal(fallback.label, findCategoryIcon('box').label);
});

const catalog = () => ({
  categories: [entries[0], entries[2]], channels: [entries[1]],
  assets: [
    { id: 'live', categoryId: 'a', channelId: 'b', deleted: false },
    { id: 'deleted', categoryId: 'a', channelId: 'b', deleted: true },
    { id: 'target', categoryId: 'c', channelId: null, deleted: false },
  ],
});
test('migration moves both live and deleted references and keeps every asset', () => {
  const original = catalog();
  const result = applyPreviewCommand(original, { type: 'remove', kind: 'category', id: 'a', targetId: 'c' });
  assert.deepEqual(result.assets.map(a => a.id), ['live', 'deleted', 'target']);
  assert.deepEqual(result.assets.map(a => a.categoryId), ['c', 'c', 'c']);
  assert.deepEqual(previewSnapshot(result).categories[0].references, { activeAssets: 2, deletedAssets: 1 });
  assert.equal(original.assets[0].categoryId, 'a');
});
test('channel migration to null preserves category and deletion state', () => {
  const result = applyPreviewCommand(catalog(), { type: 'remove', kind: 'channel', id: 'b', targetId: null });
  assert.deepEqual(result.assets.map(a => a.channelId), [null, null, null]);
  assert.deepEqual(result.assets.map(a => a.categoryId), ['a', 'a', 'c']);
  assert.equal(result.assets[1].deleted, true);
});
test('invalid migration target cannot partially remove or rewrite references', () => {
  const original = catalog(); const before = structuredClone(original);
  for (const targetId of ['a', 'b', 'missing']) {
    assert.throws(() => applyPreviewCommand(original, { type: 'remove', kind: 'category', id: 'a', targetId }));
    assert.deepEqual(original, before);
  }
});
test('rename and reorder retain IDs and references', () => {
  const renamed = applyPreviewCommand(catalog(), { type: 'rename', kind: 'category', id: 'a', name: '办公' });
  const moved = applyPreviewCommand(renamed, { type: 'move-category', id: 'a', direction: 'down' });
  assert.deepEqual(moved.categories.map(e => e.id), ['c', 'a']);
  assert.equal(moved.categories[1].name, '办公');
  assert.deepEqual(moved.assets, catalog().assets);
});
test('name policy checks NFC on both sides, ASCII folding and reserved labels', () => {
  const composed = [{ ...entries[0], name: 'e\u0301' }];
  assert.equal(isDuplicateName(composed, '\u00e9'), true);
  assert.equal(isDuplicateName([{ ...entries[0], name: '\u00c9' }], '\u00e9'), false);
  assert.ok(validatePreviewName([], 'category', ' 未分类 '));
  assert.ok(validatePreviewName([], 'channel', '未记录'));
  assert.equal(validatePreviewName([], 'channel', '电子'), null);
  assert.ok(validatePreviewName([], 'category', '  '));
});

test('production names count Unicode scalars after NFC and reject control characters', () => {
  assert.equal(validateTaxonomyName([], 'category', '😀'.repeat(80)), null);
  assert.ok(validateTaxonomyName([], 'category', '😀'.repeat(81)));
  assert.equal(validateTaxonomyName([], 'category', '\uFEFFe\u0301\uFEFF'), null);
  assert.ok(validateTaxonomyName([], 'category', 'A\u0085B'));
  assert.ok(validateTaxonomyName([], 'category', 'A\nB'));
  assert.equal(validateTaxonomyName([{...entries[0], name:'é'}], 'category', ' e\u0301 '), '已有同名项，请更换。');
});
