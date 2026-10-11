// 投资区间复盘组件的纯函数层测试：载荷校验、展示格式化、核对草稿工具与夹具合法性。
// 领域计算（损益、状态判定）在 Rust 契约示例中验证，本文件不复算任何金额。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRACT_VERSION,
  MAX_CENTS,
  REVIEW_REASONS,
  centsFromYuanText,
  draftFromFlow,
  draftIssues,
  draftToFlowPatch,
  emptyFlowDraft,
  formatCents,
  formatSignedCents,
  intervalLabel,
  kindLabel,
  parseReviewInput,
  parseReviewResult,
  reasonLabel,
  validCents,
  validDate,
  yuanTextFromCents,
} from '../src/investment-review/model.ts';
import { confirmedFlowFixture, reviewFixtures } from '../src/investment-review/fixtures.ts';

const base = () => structuredClone(reviewFixtures['ready-profit'].input);

test('fixtures: every input and result payload parses strictly', () => {
  for (const [key, { input, result }] of Object.entries(reviewFixtures)) {
    const r = parseReviewResult(result);
    assert.ok(r.ok, `${key}: ${JSON.stringify(r.ok ? null : r.issues)}`);
    const i = parseReviewInput(input);
    if (key === 'invalid-input') {
      // 这个夹具故意是非法载荷（确认完整但金额为空），解析应失败并给出同款字段问题。
      assert.equal(i.ok, false);
      assert.ok(i.issues.some(x => x.code === 'confirmed_without_amount' && x.path === 'flow.inflow_cents'));
    } else {
      assert.ok(i.ok, `${key}: ${JSON.stringify(i.ok ? null : i.issues)}`);
    }
  }
});

test('unknown contract version is an explicit error, never read as v1', () => {
  for (const v of [0, 2, '1', undefined, null]) {
    const bad = parseReviewInput({ ...base(), contract_version: v });
    assert.equal(bad.ok, false);
    assert.ok(bad.issues.some(i => i.code === 'unsupported_contract_version'));
  }
});

test('payload validation: ids, dates, kinds, duplicates and interval order', () => {
  const expectIssue = (mutate, code, pathStartsWith) => {
    const input = base();
    mutate(input);
    const r = parseReviewInput(input);
    assert.equal(r.ok, false, `expected failure for ${code}`);
    assert.ok(
      r.issues.some(i => i.code === code && i.path.startsWith(pathStartsWith)),
      `${code} at ${pathStartsWith}: ${JSON.stringify(r.issues)}`,
    );
  };
  expectIssue(i => { i.from.snapshot_id = ''; }, 'invalid_id', 'from.snapshot_id');
  expectIssue(i => { i.from.revision = -1; }, 'invalid_revision', 'from.revision');
  expectIssue(i => { i.from.date = '2026-02-30'; }, 'invalid_date', 'from.date');
  expectIssue(i => { i.from.date = '2026-9-30'; }, 'invalid_date', 'from.date');
  expectIssue(i => { i.to.date = '2026-06-30'; }, 'invalid_interval', 'to.date'); // 期末不晚于期初
  expectIssue(i => { i.to.members[0].kind = 'cash'; }, 'unsupported_kind', 'to.members.acc-inv-01.kind');
  expectIssue(i => { i.to.members[0].kind = 'housing_fund'; }, 'unsupported_kind', 'to.members.acc-inv-01.kind');
  expectIssue(i => { i.to.members.push({ ...i.from.members[0] }); }, 'duplicate_account', 'to.members');
});

test('sanity guard above: unknown balance alone is a valid payload', () => {
  const input = base();
  input.from.members[0].amount_cents = null;
  assert.ok(parseReviewInput(input).ok);
});

test('payload validation: cents strings are canonical nonnegative integers', () => {
  const expectIssue = (value, code) => {
    const input = base();
    input.from.members[0].amount_cents = value;
    const r = parseReviewInput(input);
    assert.equal(r.ok, false);
    assert.ok(r.issues.some(i => i.code === code && i.path === 'from.members.acc-inv-01.amount_cents'));
  };
  expectIssue('12.3', 'invalid_cents');
  expectIssue(100, 'invalid_cents');
  expectIssue(-5, 'invalid_cents');
  expectIssue('01', 'invalid_cents');
  expectIssue('1e3', 'invalid_cents');
  expectIssue('', 'invalid_cents'); // 未知必须用 null，不是空串
  expectIssue(String(MAX_CENTS + 1), 'invalid_cents'); // 超上限
  assert.ok(validCents('0'));
  assert.ok(validCents(String(MAX_CENTS)));
  assert.ok(validCents('-10000', true)); // 输出允许带符号
  assert.ok(!validCents('-10000')); // 输入不允许
});

test('payload validation: flow rules (confirmed needs explicit amounts, notes cap, scope dup)', () => {
  const expectIssue = (mutate, code, path) => {
    const input = base();
    mutate(input);
    const r = parseReviewInput(input);
    assert.equal(r.ok, false, `expected failure for ${code}`);
    assert.ok(r.issues.some(i => i.code === code && i.path === path), `${code}: ${JSON.stringify(r.issues)}`);
  };
  expectIssue(i => { i.flow.inflow_cents = null; }, 'confirmed_without_amount', 'flow.inflow_cents');
  expectIssue(i => { i.flow.confirmed_complete = false; i.flow.outflow_cents = null; i.flow.inflow_cents = null; i.flow.notes = 'x'.repeat(501); }, 'invalid_notes', 'flow.notes');
  expectIssue(i => { i.flow.from_value_key = ''; }, 'invalid_value_key', 'flow.from_value_key');
  expectIssue(i => { i.flow.from_date = '2026-09-30'; }, 'invalid_interval', 'flow.to_date'); // 流动区间同样要求顺序
  expectIssue(i => { i.flow.scope_account_ids.push('acc-inv-01'); }, 'duplicate_account', 'flow.scope_account_ids');
  // 取消确认后，未知金额是合法载荷（待复核是领域状态，不是载荷错误）。
  const input = base();
  input.flow.inflow_cents = null;
  input.flow.confirmed_complete = false;
  assert.ok(parseReviewInput(input).ok);
});

test('parseReviewResult: shape checks without recomputation', () => {
  assert.ok(parseReviewResult(reviewFixtures['ready-profit'].result).ok);
  assert.ok(parseReviewResult(reviewFixtures['stale-endpoints'].result).ok); // 负 change_cents? 正; 下面专门验负号
  assert.ok(parseReviewResult(reviewFixtures['ready-negative'].result).ok); // 负 profit_cents 合法
  assert.ok(parseReviewResult(reviewFixtures['invalid-input'].result).ok);
  assert.equal(parseReviewResult({ status: 'mystery' }).ok, false);
  assert.equal(parseReviewResult({ status: 'ready', value: { opening_cents: 100 } }).ok, false);
  assert.equal(parseReviewResult({ status: 'needs_review', reasons: 'missing_flow' }).ok, false);
  assert.equal(parseReviewResult({ status: 'not_recorded', reasons: ['missing_flow'], change_cents: '+1200' }).ok, false);
  assert.equal(parseReviewResult({ status: 'not_comparable', reasons: [], change_cents: null }).ok, true);
});

test('formatCents: BigInt grouping, no Number round-trip, negatives and huge values exact', () => {
  assert.equal(formatCents('0'), '¥0');
  assert.equal(formatCents('5'), '¥0.05');
  assert.equal(formatCents('1200'), '¥12');
  assert.equal(formatCents('10000000'), '¥100,000');
  assert.equal(formatCents('-10000'), '−¥100');
  assert.equal(formatCents('200000'), '¥2,000');
  assert.equal(formatCents('100001'), '¥1,000.01');
  assert.equal(formatCents('99999999999'), '¥999,999,999.99');
  assert.equal(formatCents('123456789012345678901'), '¥1,234,567,890,123,456,789.01');
  assert.equal(formatSignedCents(null), null);
  assert.equal(formatSignedCents('0'), '+¥0');
  assert.equal(formatSignedCents('-10000'), '−¥100');
});

test('reason labels cover the stable vocabulary from the contract', () => {
  assert.equal(REVIEW_REASONS.length, 8);
  for (const code of REVIEW_REASONS) {
    assert.equal(typeof reasonLabel[code], 'string', code);
    assert.ok(reasonLabel[code].length > 0);
  }
  assert.equal(intervalLabel('2026-06-30', '2026-09-30'), '（2026-06-30, 2026-09-30]');
  assert.equal(kindLabel.investment, '投资账户');
  assert.equal(kindLabel.bond, '债券账户');
  assert.ok(validDate('2024-02-29'));
  assert.ok(!validDate('2026-02-29'));
});

test('draft helpers: unknown is empty string, zero is explicit, yuan↔cents via BigInt', () => {
  assert.deepEqual(emptyFlowDraft(), { inflow: '', outflow: '', confirmed: false, unsupported: false, notes: '' });
  assert.deepEqual(draftFromFlow(null), emptyFlowDraft());
  const draft = draftFromFlow(confirmedFlowFixture());
  assert.deepEqual(draft, { inflow: '1000000', outflow: '0', confirmed: true, unsupported: false, notes: '转入含一笔季度结余' });
  assert.deepEqual(draftToFlowPatch(emptyFlowDraft()), {
    inflow_cents: null,
    outflow_cents: null,
    confirmed_complete: false,
    unsupported_movements: false,
    notes: '',
  });
  const explicitZero = draftToFlowPatch({ inflow: '0', outflow: '0', confirmed: true, unsupported: false, notes: '' });
  assert.equal(explicitZero.inflow_cents, '0');
  assert.equal(explicitZero.confirmed_complete, true);

  assert.equal(centsFromYuanText(''), '');
  assert.equal(centsFromYuanText('0'), '0');
  assert.equal(centsFromYuanText('12'), '1200');
  assert.equal(centsFromYuanText('0.05'), '5');
  assert.equal(centsFromYuanText('12.3'), '1230');
  assert.equal(centsFromYuanText('12.'), '1200');
  assert.equal(centsFromYuanText('.'), null);
  assert.equal(centsFromYuanText('-5'), null);
  assert.equal(centsFromYuanText('12.345'), null);
  assert.equal(centsFromYuanText('1234567890'), null); // 9 位整数上限
  assert.equal(centsFromYuanText('12a'), null);

  assert.equal(yuanTextFromCents(''), '');
  assert.equal(yuanTextFromCents('0'), '0');
  assert.equal(yuanTextFromCents('5'), '0.05');
  assert.equal(yuanTextFromCents('1200'), '12');
  assert.equal(yuanTextFromCents('1235'), '12.35');
  for (const cents of ['0', '5', '1200', '99999999999']) {
    assert.equal(centsFromYuanText(yuanTextFromCents(cents)), cents);
  }
});

test('draftIssues: confirmation gates (unknown vs zero, unsupported, note cap)', () => {
  assert.deepEqual(draftIssues(emptyFlowDraft()), []);
  assert.deepEqual(draftIssues({ inflow: '0', outflow: '0', confirmed: true, unsupported: false, notes: '' }), []);
  // 确认完整但金额未知：拒绝；显式 0 才算明确。
  const unknown = draftIssues({ inflow: '', outflow: '0', confirmed: true, unsupported: false, notes: '' });
  assert.ok(unknown.some(i => i.code === 'confirmed_without_amount'));
  // 有未支持情形时不能确认完整。
  const unsupported = draftIssues({ inflow: '0', outflow: '0', confirmed: true, unsupported: true, notes: '' });
  assert.ok(unsupported.some(i => i.code === 'confirmed_with_unsupported'));
  // 未确认 + 未知金额是可保存的草稿。
  assert.deepEqual(draftIssues({ inflow: '', outflow: '', confirmed: false, unsupported: false, notes: '' }), []);
  // 备注上限。
  const long = draftIssues({ ...emptyFlowDraft(), notes: 'x'.repeat(501) });
  assert.ok(long.some(i => i.code === 'invalid_notes'));
  // 非规范分字符串（理论上输入层已挡）仍会拒绝。
  const bad = draftIssues({ ...emptyFlowDraft(), inflow: '01' });
  assert.ok(bad.some(i => i.code === 'invalid_cents'));
});

test('contract version constant and fixture flow are self-consistent', () => {
  assert.equal(CONTRACT_VERSION, 1);
  const flow = confirmedFlowFixture();
  const input = parseReviewInput(reviewFixtures['ready-profit'].input);
  assert.ok(input.ok);
  // 流动引用与端点一致（内容键为与 Rust 相同格式的字面量）。
  assert.equal(flow.from_value_key, '["snap-2026-06-30","2026-06-30",[["acc-bond-03","bond",false,null],["acc-fund-02","fund",true,"4000000"],["acc-inv-01","investment",true,"6000000"]]]');
});
