import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8');
// test:ui unwraps tt('…') in loaded source, so accept both spellings.
const has = (part, label) => part.includes(`label={tt('${label}')}`) || part.includes(`label="${label}"`);
const dialog = source.slice(source.indexOf('function AccountDialog'), source.indexOf('/** Two-step soft delete'));

test('new account asks for name, currency and type first; the rest sits in a closed 更多选项', () => {
  const [primary, more] = dialog.split('<details className="more-fields"');
  assert.ok(more, 'secondary fields live in a details block');
  for (const label of ['名称', '币种', '类型', '计入金融净资产']) assert.ok(has(primary, label), `${label} stays visible`);
  for (const label of ['平台', '分组', '启用日期']) assert.ok(has(more, label) && !has(primary, label), `${label} is under 更多选项`);
  assert.ok(more.includes('wealth-account-notes'), 'notes are under 更多选项');
  assert.match(dialog, /useState\(!!account\)/, 'closed when creating, open when editing');
});
