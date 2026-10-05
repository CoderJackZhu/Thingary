import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('C01: replacement relation is separate from the purchase link end to end', () => {
  const sql = readFileSync(new URL('../src-tauri/src/wishlist_replacement.sql', import.meta.url), 'utf8');
  // 独立列，不复用 converted_asset_id。
  assert.match(sql, /ADD COLUMN replacement_asset_id TEXT REFERENCES assets\(id\)/);
  assert.match(sql, /replacement_asset_name TEXT NOT NULL DEFAULT ''/);
  const rust = readFileSync(new URL('../src-tauri/src/wish_plan.rs', import.meta.url), 'utf8');
  // 校验目标必须是在册未删除物品；写命令不修改该物品。
  assert.match(rust, /SELECT EXISTS\(SELECT 1 FROM assets WHERE id=\?1 AND deleted_at IS NULL\)/);
  assert.match(rust, /"这件物品已删除或不存在，请重新选择"/);
  assert.match(rust, /replacement_asset_id=\?2,replacement_asset_name=''/);
  const purge = readFileSync(new URL('../src-tauri/src/purge.rs', import.meta.url), 'utf8');
  // 永久删除清空外键并保存最小历史名称；关系不阻止删除。
  assert.match(purge, /UPDATE wishlist_items SET replacement_asset_id=NULL,replacement_asset_name=\(SELECT name FROM assets WHERE id=\?1\),revision=revision\+1 WHERE replacement_asset_id=\?1/);
  const validation = readFileSync(new URL('../src-tauri/src/wishlist.rs', import.meta.url), 'utf8');
  assert.match(validation, /待替换物品关系无效/);
});

test('C01: editor picker searches paged candidates and detail shows investment or stale history', () => {
  const editor = readFileSync(new URL('../src/WishEditor.tsx', import.meta.url), 'utf8');
  // 选择器复用共享分页搜索；同名按 ID 区分；可清空。
  assert.match(editor, /loadAssetCandidates\(null,replaceQuery,replaceNext\)/);
  assert.match(editor, /c\.id\.slice\(0,8\)/);
  assert.match(editor, /remember\(\{\.\.\.draft,replacementAssetId:null\}\)/);
  assert.match(editor, /考虑替换的物品/);
  assert.match(editor, /replacement_asset_id:replacementId,/);
  const detail = readFileSync(new URL('../src/WishDetail.tsx', import.meta.url), 'utf8');
  // 详情展示日期、状态与已有总投入（未知口径沿用原计算）。
  assert.match(detail, /考虑替换的物品：/);
  assert.match(detail, /已有总投入 \{replacementRecord\.costs\.total_investment_cents===null\?'未知':money\(replacementRecord\.costs\.total_investment_cents\)\}/);
  assert.match(detail, /unknown_maintenance_count>0/);
  assert.match(detail, /原物品在最近删除/);
  // 失效关系显示历史名称，不按同名重绑定。
  assert.match(detail, /「\{item\.replacement_asset_name\}」已永久删除/);
  const picker = readFileSync(new URL('../src/asset-picker.ts', import.meta.url), 'utf8');
  assert.match(picker, /next < page\.total \? next : null/);
});

