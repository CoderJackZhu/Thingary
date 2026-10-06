import test from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../src/plan-ledger.ts';
import { classifyWishes, counted, impactOf, impactSentence, isReady } from '../src/plan-wishes.ts';

const TODAY = '2026-10-06';
const wish = (id, price, date, state = 'considering') => ({ id, name: '虚构心愿 ' + id, price_cents: price, target_date: date, decision_state: state });
const none = () => ({ monthly_cents: 0, lump_cents: 0, unlock_age_months: 756 });
const ledger = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 840, target_months: 360, mode: 'fire', assets_cents: 0, saving_cents: 1000, saving_growth_hundredths: 0,
  r_before_hundredths: 0, r_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 0,
  items: [{ id: 'l', label: '生活', monthly_cents: 1000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }], incomes: [], pension_at: none, spends: [], ...over,
});
const calc = (plan = ledger()) => ({ plan, saving: 1000, missing: [], r: { emergency_months: 6 } });
const fire = (plan, spends = []) => project({ ...plan, spends }, 2026).fi_month - plan.now_months;

test('only considering wishes count; dates decide the month, expired and unpriced ones stay out', () => {
  const spends = classifyWishes([
    wish('a', '3000000', '2027-10-06'), wish('b', '500000', ''), wish('c', '800000', '2026-01-01'), wish('d', null, '2027-01-01'),
    wish('e', '100', '2026-10-31'), wish('f', '100', '2026-11-01'), wish('g', '100', '2027-01-01', 'purchased'), wish('h', '100', null, 'dropped'),
  ], TODAY);
  assert.deepEqual(spends.map(s => [s.id, s.status, s.offset_months]), [['a', 'dated', 12], ['b', 'today', 0], ['c', 'expired', null], ['d', 'no_price', null], ['e', 'dated', 0], ['f', 'dated', 1]]);
  // 没填计划日期的（b）只作假设，不计入合计。
  assert.deepEqual(counted(spends).map(s => s.id), ['a', 'e', 'f']);
});

test('a one-time spend moves the FIRE date by the extra months of saving it needs', () => {
  // 基线 360 个月；12 个月后花 36 000：2000t ≥ 756 000，t = 378。
  assert.equal(fire(ledger()), 360);
  assert.equal(fire(ledger(), [{ offset_months: 12, cents: 36_000 }]), 378);
  // 当月花的钱也要算（offset 0）。
  assert.equal(fire(ledger(), [{ offset_months: 0, cents: 10_000 }]) > 360, true);
});

test('the projection reports assets after each month, including one-time spends', () => {
  const p = project({ ...ledger({ assets_cents: 5000, horizon_months: 364, mode: 'traditional', target_months: 2000 }), spends: [{ offset_months: 2, cents: 1500 }] }, 2026);
  assert.deepEqual(Array.from(p.assets), [5000, 6000, 5500, 6500, 7500]);
});

test('impact of a wish: delay, assets around the date, emergency line', () => {
  const [w] = classifyWishes([wish('a', '36000', '2027-10-06')], TODAY);
  assert.equal(isReady(calc()), true);
  const i = impactOf(calc(), [w]);
  assert.deepEqual([i.base_offset, i.with_offset, i.delay_months], [360, 378, 18]);
  assert.deepEqual([i.assets_before_cents, i.assets_after_cents], [12_000, -24_000]);
  assert.equal(i.breaches_emergency, true);
  // 小额支出：不击穿应急金线，也几乎不推迟。
  const small = impactOf(calc(ledger({ assets_cents: 100_000 })), classifyWishes([wish('b', '500', '2027-10-06')], TODAY));
  assert.equal(small.breaches_emergency, false);
  assert.ok(small.delay_months >= 0 && small.delay_months <= 1);
});

test('several wishes add up; unreachable and missing inputs are stated, not faked', () => {
  const spends = classifyWishes([wish('a', '10000', '2027-10-06'), wish('b', '10000', '2028-10-06')], TODAY);
  const both = impactOf(calc(), spends);
  const one = impactOf(calc(), [spends[0]]);
  assert.ok(both.delay_months > one.delay_months);
  // 存得太慢，加上支出后 70 岁前达不到：with_offset 为 null，没有「推迟月数」。
  const slow = impactOf({ ...calc(ledger({ search_cap_months: 730 })) }, classifyWishes([wish('a', '300000', '2027-10-06')], TODAY));
  assert.deepEqual([slow.base_offset, slow.with_offset, slow.delay_months], [360, null, null]);
  // 缺少输入时不可用。
  assert.equal(isReady({ missing: ['x'], plan: undefined, saving: null }), false);
  assert.equal(isReady(null), false);
  // 没有任何计入的心愿：影响为零。
  const zero = impactOf(calc(), classifyWishes([wish('c', '100', '2020-01-01')], TODAY));
  assert.equal(zero.delay_months, 0);
  assert.equal(zero.breaches_emergency, false);
  // 合计只传 counted()：没填日期的不会混进去。
  const mixed = classifyWishes([wish('a', '10000', '2027-10-06'), wish('b', '10000', null)], TODAY);
  assert.equal(impactOf(calc(), counted(mixed)).delay_months, impactOf(calc(), [mixed[0]]).delay_months);
});

test('the one-line sentence names the date, the assets, the delay and the emergency line', () => {
  const m = c => `¥${c}`;
  const [dated] = classifyWishes([wish('a', '36000', '2027-10-06')], TODAY);
  const i = impactOf(calc(), [dated]);
  assert.equal(impactSentence(dated, i, 6, m), '如果按计划在 2027-10-06 买下，按当前储蓄那时可支配资产约 ¥12000；买下后 FIRE 推迟约 18 个月；买下后可支配资产会低于 6 个月支出的应急金线。');
  const [today] = classifyWishes([wish('b', '500', null)], TODAY);
  assert.match(impactSentence(today, impactOf(calc(ledger({ assets_cents: 1e7 })), [today]), 6, m), /^未设计划日期，只作假设：如果今天买下，可支配资产约 ¥10000000；买下后(对 FIRE 日期几乎没有影响|FIRE 推迟约 \d+ 个月)。$/);
  const [expired] = classifyWishes([wish('c', '100', '2020-01-01')], TODAY);
  assert.match(impactSentence(expired, impactOf(calc(), [expired]), 6, m), /计划日期已过，规划没有计入/);
  const [noPrice] = classifyWishes([wish('d', null, '2027-01-01')], TODAY);
  assert.equal(impactSentence(noPrice, impactOf(calc(), [noPrice]), 6, m), '');
  // 基线本来就达不到、或买下后达不到，都如实说。
  const never = impactOf(calc(ledger({ search_cap_months: 400 })), [dated]);
  assert.match(impactSentence(dated, never, 6, m), /70 岁前本来就达不到 FIRE|买下后 FIRE 在 70 岁前达不到/);
});
