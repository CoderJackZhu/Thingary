// Turns the calculator answers into a basic planning-engine request and reads the result.
// Pure: the caller passes `run(request)`, so Node tests and the browser use the same code.

export const RETURN_PRESETS = [
  { key: 'low', label: '保守', before: 0, after: 0, note: '只跑平通胀' },
  { key: 'mid', label: '中性', before: 200, after: 100, note: '每年比通胀多 2%，退休后 1%' },
  { key: 'high', label: '积极', before: 400, after: 300, note: '每年比通胀多 4%，退休后 3%' },
];
export const DEFAULTS = { age: null, assets_wan: null, spend: null, saving: null, income: 0, income_age: 60, end_age: 90, wish_age: null, preset: 'mid', inflation: 2, events: [], flows: [], costs: [], incomes: [] };
/** Optional repeatable rows. `req` fields must all be filled once any field in the row is; `dir` is a choice, not a number. */
export const ROW_KINDS = {
  events: { label: '一次性大笔开销', fields: [['age', '几岁时'], ['wan', '花多少万']], req: ['age', 'wan'] },
  flows: { label: '存款的阶段变化', fields: [['from', '从几岁'], ['to', '到几岁'], ['monthly', '每月'], ['dir', '']], req: ['from', 'to', 'monthly'] },
  costs: { label: '不上班后的阶段性支出', fields: [['from', '从几岁'], ['to', '到几岁（可空）'], ['monthly', '每月']], req: ['from', 'monthly'] },
  incomes: { label: '再加一笔不上班后的收入', fields: [['monthly', '每月'], ['age', '从几岁开始']], req: ['monthly', 'age'] },
};
const ROW_LIMIT = 6;
/** Rows with nothing typed are ignored, so an empty template row costs nothing. */
export const usedRows = (rows) => (rows ?? []).filter(r => Object.entries(r).some(([k, x]) => k !== 'dir' && x !== null && x !== undefined));
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
  for (const [kind, spec] of Object.entries(ROW_KINDS)) {
    const rows = v[kind] ?? [];
    if (rows.length > ROW_LIMIT) issues.push({ key: `${kind}.0.${spec.fields[0][0]}`, message: `${spec.label}最多 ${ROW_LIMIT} 条` });
    rows.forEach((row, i) => {
      if (!usedRows([row]).length) return;
      const at = k => `${kind}.${i}.${k}`;
      for (const k of spec.req) if (row[k] === null || row[k] === undefined || !Number.isFinite(row[k])) issues.push({ key: at(k), message: `${spec.label}：请填完整` });
      for (const k of ['age', 'from', 'to']) if (Number.isFinite(row[k]) && (!Number.isInteger(row[k]) || row[k] < 16 || row[k] > 110)) issues.push({ key: at(k), message: '年龄请填 16 到 110 之间的整数' });
      for (const k of ['wan', 'monthly']) if (Number.isFinite(row[k]) && (row[k] < 0 || Math.abs(k === 'wan' ? row[k] * 1e4 : row[k]) > YUAN_LIMIT)) issues.push({ key: at(k), message: '金额请填 0 以上的合理数字' });
      if (Number.isFinite(row.to) && Number.isFinite(row.from) && row.to <= row.from) issues.push({ key: at('to'), message: '结束年龄要大于开始年龄' });
      if (kind === 'events' && Number.isFinite(row.age) && Number.isFinite(v.age) && row.age < v.age) issues.push({ key: at('age'), message: '不能早于现在的年龄' });
    });
  }
  return issues;
}

const months = (v, age) => Math.max(0, Math.round((age - v.age) * 12));

/** `today` is a local YYYY-MM-DD date; amounts are yuan in today's money. */
export function buildPlan(v, today, overrides = {}) {
  const preset = RETURN_PRESETS.find(p => p.key === v.preset) ?? RETURN_PRESETS[1];
  const anchor = monthIndex(today), horizon = (v.end_age - v.age) * 12;
  const day = Number(today.slice(8, 10)), y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pension = { monthly_cents: 0, lump_cents: 0, unlock_age_months: horizon + 1, income_start_age_months: null, eligible: false, short_months: 0 };
  return {
    input_mode: 'basic', now_months: 0, target_months: 0, horizon_months: horizon, search_cap_months: horizon - 1, mode: 'fire',
    assets_cents: Math.round(v.assets_wan * 1e6), saving_cents: Math.round(v.saving * 100), saving_growth_hundredths: 0,
    saving_phases: [], spend_flows: [],
    saving_flows: usedRows(v.flows).map(r => ({ source_id: null, label: '阶段变化', from_month: months(v, r.from), to_month: months(v, r.to), cents: Math.round(r.monthly * 100) * (r.dir === 'cost' ? -1 : 1), nominal: false, essential: false })),
    r_before_hundredths: preset.before, r_after_hundredths: preset.after,
    inflation_hundredths: Math.round((v.inflation ?? 2) * 100), volatility_hundredths: 500,
    items: [{ id: 'living', label: '生活费', monthly_cents: Math.round(v.spend * 100), start_age: null, end_age: null, inflation_hundredths: null, essential: true },
      ...usedRows(v.costs).map((r, i) => ({ id: `cost-${i}`, label: '阶段性支出', monthly_cents: Math.round(r.monthly * 100), start_age: r.from - v.age, end_age: r.to === null || r.to === undefined ? null : r.to - v.age, inflation_hundredths: null, essential: true }))],
    incomes: [],
    future_incomes: [...(v.income > 0 ? [{ monthly: v.income, age: v.income_age }] : []), ...usedRows(v.incomes)].map((r, i) => ({
      id: `retire-income-${i}`, name: '退休后收入', role: 'pension', included: true, monthly_cents: String(Math.round(r.monthly * 100)),
      start_month: monthText(anchor + months(v, r.age)), end_month: null, basis: 'reference_month', basis_month: monthText(anchor), growth: 'constant_purchasing_power',
      source: null, source_checked_on: null, notes: '' })),
    spends: usedRows(v.events).map(r => ({ offset_months: months(v, r.age), cents: Math.round(r.wan * 1e6) })),
    transfers: [], loans: [], pensions: [pension],
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
  // The same answers under every return assumption, so one guess is not mistaken for a promise.
  result.compare = RETURN_PRESETS.map(p => {
    const w = v.preset === p.key ? { plan, month } : earliest(run, { ...v, preset: p.key }, today);
    const m = w.month;
    return { key: p.key, label: p.label, months: m, stop_age: m === null ? null : v.age + m / 12,
      need_yuan: m === null || m === 0 ? null : run({ op: 'required', plan: w.plan, from: m, retire: m }) / 100 };
  });
  // Spending 1000 less a month: often moves the date more than saving 1000 more.
  if (month !== null && month > 0 && v.spend > 1000) {
    const cheaper = earliest(run, { ...v, spend: v.spend - 1000 }, today).month;
    result.less_1000_months = cheaper === null ? null : month - cheaper;
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
