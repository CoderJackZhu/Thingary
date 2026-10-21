// Turns the calculator answers into a basic planning-engine request and reads the result.
// Pure: the caller passes `run(request)`, so Node tests and the browser use the same code.

export const RETURN_PRESETS = [
  { key: 'low', label: '保守', before: 0, after: 0, note: '只跑平通胀' },
  { key: 'mid', label: '中性', before: 200, after: 100, note: '每年比通胀多 2%，退休后 1%' },
  { key: 'high', label: '积极', before: 400, after: 300, note: '每年比通胀多 4%，退休后 3%' },
];
export const DEFAULTS = { age: null, assets_wan: null, spend: null, saving: null, income: 0, income_age: 60, end_age: 90, wish_age: null, preset: 'mid', inflation: 2 };
export const LIMITS = { age: [16, 85], end_age: [50, 110], income_age: [40, 100], wish_age: [18, 100], inflation: [0, 10] };
const YUAN_LIMIT = 1e9;

const pad = n => String(n).padStart(2, '0');
export const monthText = (index) => `${Math.floor(index / 12)}-${pad(index % 12 + 1)}`;
const monthIndex = (text) => Number(text.slice(0, 4)) * 12 + Number(text.slice(5, 7)) - 1;

/** Returns a list of problems in plain words; empty when the answers can be calculated. */
export function validate(v) {
  const issues = [];
  const need = (key, label) => { if (v[key] === null || v[key] === undefined || !Number.isFinite(v[key])) issues.push({ key, message: `请填写${label}` }); };
  need('age', '现在的年龄'); need('assets_wan', '现在有多少钱'); need('spend', '每月生活费'); need('saving', '每月能存多少');
  const range = (key, label) => { const [lo, hi] = LIMITS[key]; if (Number.isFinite(v[key]) && (v[key] < lo || v[key] > hi || !Number.isInteger(v[key]))) issues.push({ key, message: `${label}请填 ${lo} 到 ${hi} 之间的整数` }); };
  range('age', '年龄'); range('end_age', '算到几岁'); range('income_age', '开始领取的年龄');
  if (v.wish_age !== null) range('wish_age', '希望几岁不上班');
  if (Number.isFinite(v.inflation) && (v.inflation < LIMITS.inflation[0] || v.inflation > LIMITS.inflation[1])) issues.push({ key: 'inflation', message: '通胀请填 0 到 10 之间' });
  for (const [key, label] of [['assets_wan', '现有的钱'], ['spend', '每月生活费'], ['income', '退休后每月收入']]) if (Number.isFinite(v[key]) && v[key] < 0) issues.push({ key, message: `${label}不能是负数` });
  for (const key of ['assets_wan', 'spend', 'saving', 'income']) if (Number.isFinite(v[key]) && Math.abs(key === 'assets_wan' ? v[key] * 1e4 : v[key]) > YUAN_LIMIT) issues.push({ key, message: '金额太大了，请检查单位' });
  if (Number.isFinite(v.age) && Number.isFinite(v.end_age) && v.end_age <= v.age) issues.push({ key: 'end_age', message: '算到的年龄要大于现在的年龄' });
  if (v.wish_age !== null && Number.isFinite(v.age) && v.wish_age <= v.age) issues.push({ key: 'wish_age', message: '希望不上班的年龄要大于现在的年龄' });
  if (Number.isFinite(v.wish_age) && Number.isFinite(v.end_age) && v.wish_age >= v.end_age) issues.push({ key: 'wish_age', message: '希望不上班的年龄要小于算到的年龄' });
  return issues;
}

/** `today` is a local YYYY-MM-DD date; amounts are yuan in today's money. */
export function buildPlan(v, today, overrides = {}) {
  const preset = RETURN_PRESETS.find(p => p.key === v.preset) ?? RETURN_PRESETS[1];
  const anchor = monthIndex(today), horizon = (v.end_age - v.age) * 12;
  const day = Number(today.slice(8, 10)), y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const incomeStart = anchor + Math.max(0, (v.income_age - v.age) * 12);
  const pension = { monthly_cents: 0, lump_cents: 0, unlock_age_months: horizon + 1, income_start_age_months: null, eligible: false, short_months: 0 };
  return {
    input_mode: 'basic', now_months: 0, target_months: 0, horizon_months: horizon, search_cap_months: horizon - 1, mode: 'fire',
    assets_cents: Math.round(v.assets_wan * 1e6), saving_cents: Math.round(v.saving * 100), saving_growth_hundredths: 0,
    saving_phases: [], saving_flows: [], spend_flows: [],
    r_before_hundredths: preset.before, r_after_hundredths: preset.after,
    inflation_hundredths: Math.round((v.inflation ?? 2) * 100), volatility_hundredths: 500,
    items: [{ id: 'living', label: '生活费', monthly_cents: Math.round(v.spend * 100), start_age: null, end_age: null, inflation_hundredths: null, essential: true }],
    incomes: [],
    future_incomes: v.income > 0 ? [{ id: 'retire-income', name: '退休后收入', role: 'pension', included: true, monthly_cents: String(Math.round(v.income * 100)),
      start_month: monthText(incomeStart), end_month: null, basis: 'reference_month', basis_month: monthText(anchor), growth: 'constant_purchasing_power',
      source: null, source_checked_on: null, notes: '' }] : [],
    spends: [], transfers: [], loans: [], pensions: [pension],
    anchor_date: today, calculation_date: today, monetary_basis_date: today, basis_factor: 1, first_month_fraction: (days - day) / days,
    age_reference: { month: monthText(anchor), age_months: v.age * 12 },
    ...overrides,
  };
}

function earliest(run, v, today, overrides) {
  const plan = buildPlan(v, today, overrides);
  const projection = run({ op: 'project', plan, year: Number(today.slice(0, 4)) });
  return { plan, projection, month: projection.retire_month };
}

/** Everything the result screen needs, in yuan and months. */
export function calculate(run, v, today) {
  const { plan, projection, month } = earliest(run, v, today);
  const anchor = monthIndex(today);
  const result = {
    reachable: month !== null,
    months: month,
    stop_age: month === null ? null : v.age + month / 12,
    stop_month: month === null ? null : monthText(anchor + month),
    need_yuan: month === null ? null : run({ op: 'required', plan, from: month, retire: month }) / 100,
    failure_month: projection.failure_month,
    series: projection.rows.map(r => ({ age: r.age ?? null, end: r.end / 100, phase: r.phase })),
  };
  // How much one extra 1000 yuan a month moves the date; only when the base case already reaches it.
  if (month !== null && month > 0) {
    const faster = earliest(run, v, today, { saving_cents: plan.saving_cents + 100000 }).month;
    result.extra_1000_months = faster === null ? null : month - faster;
  }
  if (v.wish_age !== null) {
    const target = (v.wish_age - v.age) * 12;
    const solved = run({ op: 'solve_contribution', plan: { ...plan, mode: 'traditional', target_months: target, saving_cents: 0 }, search_limit_cents: 1e8 });
    result.wish = { age: v.wish_age, status: solved.status, monthly_yuan: solved.monthly_cents === undefined ? null : Number(solved.monthly_cents) / 100 };
  }
  return result;
}

export function durationText(months) {
  const y = Math.floor(months / 12), m = months % 12;
  if (y === 0) return `${m} 个月`;
  return m === 0 ? `${y} 年` : `${y} 年 ${m} 个月`;
}
export function yuanText(yuan) {
  const abs = Math.abs(yuan);
  if (abs >= 1e8) return `${(yuan / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(yuan / 1e4).toFixed(abs >= 1e6 ? 0 : 1)} 万`;
  return `${Math.round(yuan).toLocaleString('zh-CN')} 元`;
}
