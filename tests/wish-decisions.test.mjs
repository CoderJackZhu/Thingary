import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wishDecisionLabel, wishHeaderSummary } from '../src/wishlist.ts';
import { noteSummary } from '../src/wealth.ts';

test('wish header summary separates considering, unknown, zero and legacy counts', () => {
  // 已知部分 + 未知条数（A10）。
  assert.deepEqual(wishHeaderSummary({ considering_known_cents: '400000', considering_unknown_count: 1, legacy_achieved_count: 0 }, 3), { main: '考虑中 3 条 · 预计价格合计 ¥4,000.00（1 条价格未知）', legacy: '' });
  // 全部未知 → 金额显示“未知”，不是零。
  assert.deepEqual(wishHeaderSummary({ considering_known_cents: '0', considering_unknown_count: 2, legacy_achieved_count: 0 }, 2), { main: '考虑中 2 条 · 预计价格合计 未知（2 条价格未知）', legacy: '' });
  // 没有考虑中心愿时为零。
  assert.deepEqual(wishHeaderSummary({ considering_known_cents: '0', considering_unknown_count: 0, legacy_achieved_count: 1 }, 0), { main: '考虑中 0 条 · 预计价格合计 ¥0.00', legacy: '1 条历史待核实' });
  // 明确零价是已知金额。
  assert.deepEqual(wishHeaderSummary({ considering_known_cents: '0', considering_unknown_count: 0, legacy_achieved_count: 0 }, 1), { main: '考虑中 1 条 · 预计价格合计 ¥0.00', legacy: '' });
});

test('wish decision labels cover the four states including legacy verification', () => {
  assert.equal(wishDecisionLabel('considering'), '考虑中');
  assert.equal(wishDecisionLabel('purchased'), '已购入');
  assert.equal(wishDecisionLabel('dropped'), '不再考虑');
  assert.equal(wishDecisionLabel('legacy_achieved'), '历史待核实');
});

test('snapshot note summaries stay short and never fake content', () => {
  assert.equal(noteSummary(''), null);
  assert.equal(noteSummary('   \n  '), null);
  assert.equal(noteSummary('年终盘点，含奖金入账'), '年终盘点，含奖金入账');
  const long = '一'.repeat(60);
  const summarized = noteSummary(long) ?? '';
  assert.equal([...summarized].length, 41);
  assert.ok(summarized.endsWith('…'));
  // 只取首行，不把后续行拼进摘要。
  assert.equal(noteSummary('第一行\n第二行很长很长很长很长很长很长很长很长很长很长很长'), '第一行');
});

test('check-in UI carries notes through one save request and guards date switches', () => {
  const page = readFileSync(new URL('../src/WealthPage.tsx', import.meta.url), 'utf8');
  assert.match(page, /本次盘点备注（可选）/);
  assert.match(page, /备注不参与金额计算/);
  assert.match(page, /setNotes\(d\.existing\?\.notes \?\? ''\)/);
  assert.match(page, /切换日期将丢弃当前备注修改/);
  // 只读详情：按稳定 ID 读取，浏览不写资料；无备注显示“未填写备注”。
  assert.match(page, /function SnapshotDetail\(\{ id, today, onCorrect, onClose \}/);
  assert.match(page, /'wealth_snapshot', \{ id \}/);
  assert.match(page, /未填写备注/);
  assert.match(page, /更正这次盘点/);
  assert.match(page, /onOpen\(p\.snapshot_id\)/);
});

test('overview pins the complete check-in date and period scopes beside figures', () => {
  const review = readFileSync(new URL('../src/ReviewView.tsx', import.meta.url), 'utf8');
  assert.match(review, /截至 \{latest\.date\} 完整盘点 · 距今 \{daysSince\} 天/);
  assert.match(review, /—／尚无完整盘点/);
  assert.match(review, /所选期间用于重要支出与近期记录；持有物品与固定负担为当前资料，净资产取最近完整盘点/);
  assert.match(review, /考虑中心愿/);
  assert.match(review, /历史待核实/);
  assert.match(review, /当前计划/);
});

test('compare endpoints show each check-in date and its own notes', () => {
  const changes = readFileSync(new URL('../src/WealthChanges.tsx', import.meta.url), 'utf8');
  assert.match(changes, /compare-endpoint-notes/);
  assert.match(changes, /end\.notes\.trim\(\) \|\| '未填写备注'/);
});

test('timeline keeps the legacy auto-achievement label with its own date source', () => {
  const timeline = readFileSync(new URL('../src/Timeline.tsx', import.meta.url), 'utf8');
  assert.match(timeline, /旧版自动实现心愿/);
});

test('savings UI is fully retired while old receipts keep an entry point', () => {
  const detail = readFileSync(new URL('../src/WishDetail.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(detail, /SavingsRing/);
  assert.doesNotMatch(detail, /存一笔/);
  assert.doesNotMatch(detail, /快捷/);
  assert.match(detail, /核对旧请求/);
  const editor = readFileSync(new URL('../src/WishEditor.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(editor, /实现方式/);
  assert.doesNotMatch(editor, /已攒金额（元）/);
  assert.match(editor, /想买的理由与顾虑/);
  // 低频精简：分类／渠道／置顶仅旧记录有值时出现，添加时间不可在表单修改。
  assert.match(editor, /shown\.category&&/);
  assert.match(editor, /shown\.channel&&/);
  assert.match(editor, /shown\.pinned&&/);
  assert.doesNotMatch(editor, /label="添加时间"/);
  assert.doesNotMatch(editor, /<details className="more-fields" open/);
  assert.match(editor, /相关链接/);
  assert.match(editor, /计划日期/);
  assert.match(editor, /为什么想买？还有什么顾虑？以后回来时提醒自己/);
});

