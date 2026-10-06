import test from 'node:test';
import assert from 'node:assert/strict';
import { ageMonthsAt, byQuitAge, delayMonths, disbursementMonths, project, requiredContributionMonths, startAgeMonths, statutoryAgeMonths } from '../src/plan-pension.ts';
import { beijing, defaultAssumptions } from '../src/plan-params.ts';

const ym = months => `${Math.floor(months / 12)}岁${months % 12}个月`;

test('statutory retirement age follows the State Council delay schedule (no dependence on today)', () => {
  // 男职工：1965-01 起每 4 个月延 1 个月，1976-09 起满 3 年。
  const male = b => ym(statutoryAgeMonths('male', b));
  assert.deepEqual(['1964-12', '1965-01', '1965-04', '1965-05', '1976-08', '1976-09', '1990-06'].map(male), ['60岁0个月', '60岁1个月', '60岁1个月', '60岁2个月', '62岁11个月', '63岁0个月', '63岁0个月']);
  // 女干部：1970-01 起每 4 个月延 1 个月，1981-09 起满 3 年。
  const cadre = b => ym(statutoryAgeMonths('female_cadre', b));
  assert.deepEqual(['1969-12', '1970-01', '1970-05', '1981-08', '1981-09'].map(cadre), ['55岁0个月', '55岁1个月', '55岁2个月', '57岁11个月', '58岁0个月']);
  // 女工人：1975-01 起每 2 个月延 1 个月，共 5 年。
  const worker = b => ym(statutoryAgeMonths('female_worker', b));
  assert.deepEqual(['1974-12', '1975-01', '1975-02', '1975-03', '1984-11', '1984-12', '1990-01'].map(worker), ['50岁0个月', '50岁1个月', '50岁1个月', '50岁2个月', '55岁0个月', '55岁0个月', '55岁0个月']);
  assert.equal(delayMonths('male', '1900-01'), 0);
});

test('flexible start moves ±36 months but never below the original retirement age', () => {
  const p = (flex, worker = 'male', birth = '1990-06') => startAgeMonths({ worker, birth_month: birth, flex_months: flex });
  assert.deepEqual([p(0), p(36), p(-36), p(99), p(-99)], [756, 792, 720, 792, 720]);
  // 1960 年出生的男职工：法定 60 岁，不能再提前。
  assert.equal(p(-36, 'male', '1960-01'), 720);
});

test('disbursement months: table values at whole ages, linear by month in between', () => {
  assert.deepEqual([55, 58, 60, 61, 62, 63].map(a => disbursementMonths(a * 12)), [170, 152, 139, 132, 125, 117]);
  assert.equal(disbursementMonths(62 * 12 + 6), 121);
  assert.ok(Math.abs(disbursementMonths(58 * 12 + 1) - (152 + (145 - 152) / 12)) < 1e-9);
  assert.equal(disbursementMonths(39 * 12), 233);
  assert.equal(disbursementMonths(75 * 12), 56);
});

test('minimum contribution months rise 6 a year from 2030 up to 20 years', () => {
  assert.deepEqual([2026, 2029, 2030, 2031, 2039, 2040, 2060].map(requiredContributionMonths), [180, 180, 186, 192, 240, 240, 240]);
});

const profile = (over = {}) => ({
  birth_month: '1990-06', worker: 'male', paid_months: 48, account_balance_cents: '5000000', base_cents: '2000000', past_index_hundredths: null, flex_months: 0,
  personal_pension_annual_cents: '1200000', marginal_tax_hundredths: 1000,
  assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 }, ...over,
});
const flat = { ...beijing, notional_rate_hundredths: 0, hpf_rate_hundredths: 0 };
const funds = { hpf_balance_cents: '10000000', hpf_monthly_cents: '300000' };
const TODAY = '2026-10-06';

test('with every rate at zero the result matches the closed forms', () => {
  assert.equal(ageMonthsAt('1990-06', TODAY), 436);
  const r = project(profile(), flat, TODAY, 63 * 12, funds);
  assert.deepEqual([r.start_age_months, r.start_month, r.contribution_months, r.total_paid_months], [756, '2053-06', 320, 368]);
  // 账户 = 余额 + 8% × 基数 × 缴费月数；计发月数 117。
  assert.equal(r.account_at_start_cents, 5_000_000 + 0.08 * 2_000_000 * 320);
  assert.equal(r.account_pension_nominal_cents, 480_342);
  // 基础养老金 = (W + W·k)/2 × N × 1%，W = 12116 元，k = 2 万 ÷ 12116，N = 368 个月。
  assert.equal(r.base_pension_nominal_cents, 492_445);
  assert.equal(r.total_nominal_cents, 972_787);
  assert.equal(r.total_today_cents, 972_787, 'zero inflation: today equals nominal');
  assert.equal(r.replacement_hundredths, 4864);
  assert.equal(r.required_months, 240);
  assert.equal(r.eligible, true);
  // 公积金与个人养老金：缴存 320 个月；个人养老金税后 97%，每年省税 = 12000 × 10%。
  assert.equal(r.hpf_at_start_cents, 10_000_000 + 300_000 * 320);
  assert.equal(r.personal_pension_at_start_cents, 32_000_000);
  assert.equal(r.personal_pension_after_tax_cents, 31_040_000);
  assert.equal(r.personal_pension_tax_saved_cents, 120_000);
});

test('with growth, interest and inflation the result matches an independent reference', () => {
  const p = profile({ assumptions: { inflation_hundredths: 200, wage_growth_hundredths: 300, pp_return_hundredths: 200 } });
  const r = project(p, beijing, TODAY, 63 * 12, funds);
  // 参考值来自独立的 Python 逐月实现（同一公式，不同代码）。
  assert.equal(r.account_at_start_cents, 100_463_863);
  assert.equal(r.hpf_at_start_cents, 189_299_369);
  assert.equal(r.personal_pension_at_start_cents, 42_120_641);
  assert.equal(r.personal_pension_after_tax_cents, 40_857_022);
  assert.equal(r.base_pension_nominal_cents, 1_093_863);
  assert.equal(r.account_pension_nominal_cents, 858_665);
  assert.equal(r.total_nominal_cents, 1_952_529);
  assert.equal(r.total_today_cents, 1_151_488);
  assert.equal(r.replacement_hundredths, 4439);
  assert.equal(r.pots_today_cents, 135_732_899);
});

test('quitting earlier shrinks years, account, funds and pension, and loses eligibility', () => {
  const rows = byQuitAge(profile(), flat, TODAY, [40, 50, 55, 63], funds);
  assert.deepEqual(rows.map(r => r.contribution_months), [44, 164, 224, 320]);
  // 2053 年要求 240 个月：已缴 48 个月加上缴费月数，50 岁停缴只有 212 个月，55 岁停缴 272 个月。
  assert.deepEqual(rows.map(r => r.eligible), [false, false, true, true]);
  const [early, mid, , late] = rows;
  assert.equal(early.account_pension_nominal_cents, 102_906);
  assert.equal(early.base_pension_nominal_cents, 123_111);
  assert.ok(early.total_today_cents < mid.total_today_cents && mid.total_today_cents < late.total_today_cents);
  assert.ok(early.hpf_at_start_cents < mid.hpf_at_start_cents && mid.hpf_at_start_cents < late.hpf_at_start_cents);
  // 停缴不改变领取年龄：仍按法定 63 岁。
  assert.ok(rows.every(r => r.start_age_months === 756));
  // 停缴年龄超出范围时夹在「现在」与领取年龄之间。
  assert.equal(project(profile(), flat, TODAY, 20 * 12, funds).contribution_months, 0);
  assert.equal(project(profile(), flat, TODAY, 90 * 12, funds).contribution_months, 320);
});

test('basic cases: no contribution history, no personal pension, base outside the limits, already past start age', () => {
  const none = project(profile({ paid_months: 0, account_balance_cents: '0', base_cents: '0' }), flat, TODAY, 0, { hpf_balance_cents: '0', hpf_monthly_cents: '0' });
  assert.equal(none.total_nominal_cents, 0);
  assert.equal(none.replacement_hundredths, null);
  const noPp = project(profile({ personal_pension_annual_cents: '0' }), flat, TODAY, 756, funds);
  assert.deepEqual([noPp.personal_pension_at_start_cents, noPp.personal_pension_tax_saved_cents], [0, 0]);
  // 超过年缴上限 12000 元的输入按上限计。
  assert.equal(project(profile({ personal_pension_annual_cents: '9999999' }), flat, TODAY, 756, funds).personal_pension_at_start_cents, 32_000_000);
  // 基数高于上限时按上限，指数不超过 3：与恰好等于上限时结果相同。
  const capped = project(profile({ base_cents: '9999999' }), flat, TODAY, 756, funds);
  const atCap = project(profile({ base_cents: beijing.base_upper_cents }), flat, TODAY, 756, funds);
  assert.equal(capped.base_pension_nominal_cents, atCap.base_pension_nominal_cents);
  // 已过领取年龄：不再缴费，账户余额直接按计发月数分摊。
  const retired = project(profile({ birth_month: '1960-01', paid_months: 400 }), flat, TODAY, 0, funds);
  assert.deepEqual([retired.contribution_months, retired.years_to_start], [0, 0]);
  assert.equal(retired.account_at_start_cents, 5_000_000);
});

test('a past contribution index different from today changes the average index', () => {
  const same = project(profile(), flat, TODAY, 756, funds).base_pension_nominal_cents;
  const lower = project(profile({ past_index_hundredths: 80 }), flat, TODAY, 756, funds).base_pension_nominal_cents;
  assert.ok(lower < same);
  // 历史指数低于 0.6 时按 0.6 计。
  assert.equal(project(profile({ past_index_hundredths: 10 }), flat, TODAY, 756, funds).base_pension_nominal_cents, project(profile({ past_index_hundredths: 60 }), flat, TODAY, 756, funds).base_pension_nominal_cents);
});

test('default assumptions are rates in hundredths of a percent', () => {
  assert.deepEqual(defaultAssumptions, { inflation_hundredths: 200, wage_growth_hundredths: 200, pp_return_hundredths: 200 });
});
