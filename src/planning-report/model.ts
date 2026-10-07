// 决策报告只读展示组件的纯函数层（契约 docs/PLANNING_COMPONENT_CONTRACTS.md §3）。
// 输入为只读 ReportInputV1：本模块不读取数据库、不调用退休算法补字段、不建立事实存储。
// 协议金额始终是十进制分字符串或 null，从不经过 Number 存回；显示格式化用 BigInt，Number 只用于绘图坐标。
// 隐私报告先从同一快照生成脱敏载荷（redactReport），渲染/打印/复制/文件名只接触脱敏后的视图。

export const CONTRACT_VERSION = 1;

export type Basis = 'known' | 'estimated' | 'unknown';
/** 金额：十进制分字符串或 null（未知）。hidden 只由脱敏投影写入：曾有值但被隐私隐藏。 */
export type Money = { kind: 'money'; cents: string | null; basis: Basis; hidden?: boolean };
/** 比例：万分之一百的整数（4500 = 45.00%）或 null。hidden 同 Money。 */
export type Ratio = { kind: 'ratio'; hundredths: number | null; hidden?: boolean };
export type Value =
  | Money
  | Ratio
  | { kind: 'text'; text: string }
  | { kind: 'date'; date: string | null }
  | { kind: 'unknown' };

export type ReportKind = 'current' | 'baseline' | 'comparison';
export type ReportStatus = 'complete' | 'partial';
export type ResultStatus = 'ok' | 'shortfall' | 'incomplete';

export type FundRow = {
  id: string;
  /** 自由文本，可能含姓名/账号；隐私投影别名化 */
  name: string;
  availability: 'available' | 'restricted' | 'debt';
  amount: Money;
  /** 自由备注；隐私投影隐藏 */
  note: string | null;
};
export type GoalRow = {
  id: string;
  /** 自由文本，可能含金额/姓名；隐私投影别名化 */
  name: string;
  template: 'expense' | 'milestone' | 'income_break' | 'retirement';
  date: string | null;
  result: ResultStatus;
  amount: Money;
  /** 目标相关的派生比例（如进度）；隐私投影隐藏 */
  ratio: Ratio | null;
  /** 自由备注；隐私投影隐藏 */
  note: string | null;
  missing: string[];
};
export type Assumption = {
  id: string;
  /** 标签仍是自由字符串；隐私投影使用局部别名 */
  label: string;
  value: Value;
  source: 'confirmed' | 'estimated' | 'excluded' | 'unknown';
  confirmed_on: string | null;
};
export type SeriesPoint = {
  date: string;
  kind: 'projected' | 'actual' | 'reference';
  available: Money | null;
  restricted: Money | null;
  debt: Money | null;
};
export type Difference = {
  id: string;
  label: string;
  current: Value;
  other: Value;
  /** 只展示传入的已确认差额；null 表示不可比，组件不得自行计算 */
  delta: Money | null;
  /** 生成方提供的依据说明（自由文本，隐私隐藏）；不做因果归因 */
  note: string | null;
};
export type MissingItem = {
  id: string;
  label: string;
  impact: 'blocks_headline' | 'degrades' | 'info';
  hint: string | null;
};

export type ReportInputV1 = {
  contract_version: 1;
  kind: ReportKind;
  status: ReportStatus;
  /** 方案/基准名称（自由文本，可能含金额或姓名；隐私投影别名化） */
  subject_name: string;
  /** comparison 模式的对方方案名称（自由文本；其余模式为 null） */
  other_name: string | null;
  /** 报告生成日；未知保留 null，不从当前日期猜 */
  generated_on: string | null;
  /** 事实起点日 */
  source_date: string | null;
  /** 金额基准日（今天的钱口径） */
  monetary_basis_date: string | null;
  scenario_revision: number | null;
  model_version: string | null;
  headline: { status: ResultStatus; amount: Money; date: string | null };
  next_step: { label: string; detail: string | null };
  funds: FundRow[];
  goals: GoalRow[];
  assumptions: Assumption[];
  series: SeriesPoint[];
  differences: Difference[];
  missing: MissingItem[];
};

export type ReportIssue = { path: string; code: string; message: string };
export type ParseResult = { ok: true; report: ReportInputV1 } | { ok: false; code: string; issues: ReportIssue[] };

// ---------------------------------------------------------------- 校验

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CENTS_RE = /^-?\d{1,24}$/;

/** 真实日历日检查（拒绝 2026-02-30）。 */
export function validDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const y = +d.slice(0, 4), m = +d.slice(5, 7), day = +d.slice(8, 10);
  if (m < 1 || m > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = (v: unknown, set: readonly string[]) => typeof v === 'string' && (set as readonly string[]).includes(v);

function checkMoney(v: unknown, path: string, issues: ReportIssue[]): void {
  if (!isObj(v) || v.kind !== 'money') { issues.push({ path, code: 'invalid_money', message: '金额必须是 {kind:"money"} 结构' }); return; }
  if (v.cents !== null && !(typeof v.cents === 'string' && CENTS_RE.test(v.cents)))
    issues.push({ path: path + '.cents', code: 'invalid_cents', message: '金额必须是十进制分字符串或 null' });
  if (v.hidden !== undefined && typeof v.hidden !== 'boolean') issues.push({ path: path + '.hidden', code: 'invalid_hidden', message: 'hidden 必须是布尔值' });
  if (!oneOf(v.basis, ['known', 'estimated', 'unknown']))
    issues.push({ path: path + '.basis', code: 'invalid_basis', message: '依据状态必须是 known/estimated/unknown' });
}
function checkRatio(v: unknown, path: string, issues: ReportIssue[]): void {
  if (!isObj(v) || v.kind !== 'ratio') { issues.push({ path, code: 'invalid_ratio', message: '比例必须是 {kind:"ratio"} 结构' }); return; }
  if (v.hidden !== undefined && typeof v.hidden !== 'boolean') issues.push({ path: path + '.hidden', code: 'invalid_hidden', message: 'hidden 必须是布尔值' });
  if (v.hundredths !== null && !(typeof v.hundredths === 'number' && Number.isSafeInteger(v.hundredths)))
    issues.push({ path: path + '.hundredths', code: 'invalid_hundredths', message: '比例必须是整数（万分位）或 null' });
}
function checkValue(v: unknown, path: string, issues: ReportIssue[]): void {
  if (!isObj(v) || typeof v.kind !== 'string') { issues.push({ path, code: 'invalid_value', message: '值必须带 kind' }); return; }
  if (v.kind === 'money') return checkMoney(v, path, issues);
  if (v.kind === 'ratio') return checkRatio(v, path, issues);
  if (v.kind === 'text') { if (typeof v.text !== 'string') issues.push({ path: path + '.text', code: 'invalid_text', message: 'text 值必须是字符串' }); return; }
  if (v.kind === 'date') { if (v.date !== null && !(typeof v.date === 'string' && validDate(v.date))) issues.push({ path: path + '.date', code: 'invalid_date', message: '日期必须是 YYYY-MM-DD 或 null' }); return; }
  if (v.kind === 'unknown') return;
  issues.push({ path, code: 'invalid_value_kind', message: `未知值类型 ${String(v.kind)}` });
}
const optDate = (v: unknown, path: string, issues: ReportIssue[]) => {
  if (v !== null && !(typeof v === 'string' && validDate(v))) issues.push({ path, code: 'invalid_date', message: '日期必须是 YYYY-MM-DD 或 null' });
};
const reqString = (v: unknown, path: string, issues: ReportIssue[]) => {
  if (typeof v !== 'string') issues.push({ path, code: 'invalid_string', message: '必须是字符串' });
};
const optString = (v: unknown, path: string, issues: ReportIssue[]) => {
  if (v !== null && typeof v !== 'string') issues.push({ path, code: 'invalid_string', message: '必须是字符串或 null' });
};

/** 严格校验边界输入。未知 contract_version 明确报错，不默认按 v1 读取。 */
export function parseReportInput(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, code: 'not_an_object', issues: [{ path: '', code: 'not_an_object', message: '输入必须是对象' }] };
  if (raw.contract_version !== CONTRACT_VERSION)
    return { ok: false, code: 'unsupported_contract_version', issues: [{ path: 'contract_version', code: 'unsupported_contract_version', message: `不支持的协议版本 ${String(raw.contract_version)}` }] };
  const issues: ReportIssue[] = [];
  if (!oneOf(raw.kind, ['current', 'baseline', 'comparison'])) issues.push({ path: 'kind', code: 'invalid_kind', message: 'kind 必须是 current/baseline/comparison' });
  if (!oneOf(raw.status, ['complete', 'partial'])) issues.push({ path: 'status', code: 'invalid_status', message: 'status 必须是 complete/partial' });
  reqString(raw.subject_name, 'subject_name', issues);
  optString(raw.other_name, 'other_name', issues);
  optDate(raw.generated_on, 'generated_on', issues);
  optDate(raw.source_date, 'source_date', issues);
  optDate(raw.monetary_basis_date, 'monetary_basis_date', issues);
  if (raw.scenario_revision !== null && !(typeof raw.scenario_revision === 'number' && Number.isSafeInteger(raw.scenario_revision)))
    issues.push({ path: 'scenario_revision', code: 'invalid_revision', message: '修订号必须是整数或 null' });
  optString(raw.model_version, 'model_version', issues);
  if (!isObj(raw.headline) || !oneOf(raw.headline.status, ['ok', 'shortfall', 'incomplete']))
    issues.push({ path: 'headline', code: 'invalid_headline', message: 'headline.status 必须是 ok/shortfall/incomplete' });
  else { checkMoney(raw.headline.amount, 'headline.amount', issues); optDate(raw.headline.date, 'headline.date', issues); }
  if (!isObj(raw.next_step) || typeof raw.next_step.label !== 'string')
    issues.push({ path: 'next_step', code: 'invalid_next_step', message: 'next_step.label 必须是字符串' });
  else optString(raw.next_step.detail, 'next_step.detail', issues);
  const arr = (v: unknown, path: string): Record<string, unknown>[] => {
    if (!Array.isArray(v)) { issues.push({ path, code: 'invalid_array', message: '必须是数组' }); return []; }
    return v.filter((x, i) => { if (!isObj(x)) { issues.push({ path: `${path}[${i}]`, code: 'not_an_object', message: '条目必须是对象' }); return false; } return true; });
  };
  arr(raw.funds, 'funds').forEach((f, i) => {
    const p = `funds[${i}]`;
    reqString(f.id, p + '.id', issues); reqString(f.name, p + '.name', issues);
    if (!oneOf(f.availability, ['available', 'restricted', 'debt'])) issues.push({ path: p + '.availability', code: 'invalid_availability', message: '可用性必须是 available/restricted/debt' });
    checkMoney(f.amount, p + '.amount', issues); optString(f.note, p + '.note', issues);
  });
  arr(raw.goals, 'goals').forEach((g, i) => {
    const p = `goals[${i}]`;
    reqString(g.id, p + '.id', issues); reqString(g.name, p + '.name', issues);
    if (!oneOf(g.template, ['expense', 'milestone', 'income_break', 'retirement'])) issues.push({ path: p + '.template', code: 'invalid_template', message: '目标模板未知' });
    optDate(g.date, p + '.date', issues);
    if (!oneOf(g.result, ['ok', 'shortfall', 'incomplete'])) issues.push({ path: p + '.result', code: 'invalid_result', message: '结果状态必须是 ok/shortfall/incomplete' });
    checkMoney(g.amount, p + '.amount', issues);
    if (g.ratio !== null) checkRatio(g.ratio, p + '.ratio', issues);
    optString(g.note, p + '.note', issues);
    if (!Array.isArray(g.missing) || g.missing.some(m => typeof m !== 'string')) issues.push({ path: p + '.missing', code: 'invalid_missing', message: 'missing 必须是字符串数组' });
  });
  arr(raw.assumptions, 'assumptions').forEach((a, i) => {
    const p = `assumptions[${i}]`;
    reqString(a.id, p + '.id', issues); reqString(a.label, p + '.label', issues);
    checkValue(a.value, p + '.value', issues);
    if (!oneOf(a.source, ['confirmed', 'estimated', 'excluded', 'unknown'])) issues.push({ path: p + '.source', code: 'invalid_source', message: '来源状态未知' });
    optDate(a.confirmed_on, p + '.confirmed_on', issues);
  });
  arr(raw.series, 'series').forEach((s, i) => {
    const p = `series[${i}]`;
    if (typeof s.date !== 'string' || !validDate(s.date)) issues.push({ path: p + '.date', code: 'invalid_date', message: '日期必须是 YYYY-MM-DD' });
    if (!oneOf(s.kind, ['projected', 'actual', 'reference'])) issues.push({ path: p + '.kind', code: 'invalid_series_kind', message: '序列种类必须是 projected/actual/reference' });
    for (const key of ['available', 'restricted', 'debt'] as const) if (s[key] !== null) checkMoney(s[key], `${p}.${key}`, issues);
  });
  arr(raw.differences, 'differences').forEach((d, i) => {
    const p = `differences[${i}]`;
    reqString(d.id, p + '.id', issues); reqString(d.label, p + '.label', issues);
    checkValue(d.current, p + '.current', issues); checkValue(d.other, p + '.other', issues);
    if (d.delta !== null) checkMoney(d.delta, p + '.delta', issues);
    optString(d.note, p + '.note', issues);
  });
  arr(raw.missing, 'missing').forEach((m, i) => {
    const p = `missing[${i}]`;
    reqString(m.id, p + '.id', issues); reqString(m.label, p + '.label', issues);
    if (!oneOf(m.impact, ['blocks_headline', 'degrades', 'info'])) issues.push({ path: p + '.impact', code: 'invalid_impact', message: '影响程度未知' });
    optString(m.hint, p + '.hint', issues);
  });
  if (issues.length) return { ok: false, code: 'invalid_report_input', issues };
  return { ok: true, report: projectReport(raw as unknown as ReportInputV1, false) };
}

// ---------------------------------------------------------------- 脱敏投影

/** 构造全新白名单快照；完整快照也不保留额外字段或输入对象引用。 */
function projectReport(r: ReportInputV1, privacy: boolean): ReportInputV1 {
  const money = (m: Money): Money => ({ kind: 'money', cents: privacy ? null : m.cents, basis: m.basis,
    hidden: privacy ? Boolean(m.hidden || m.cents !== null) : Boolean(m.hidden) });
  const ratio = (v: Ratio): Ratio => ({ kind: 'ratio', hundredths: privacy ? null : v.hundredths,
    hidden: privacy ? Boolean(v.hidden || v.hundredths !== null) : Boolean(v.hidden) });
  const value = (v: Value): Value => {
    switch (v.kind) {
      case 'money': return money(v);
      case 'ratio': return ratio(v);
      case 'date': return { kind: 'date', date: v.date };
      case 'text': return { kind: 'text', text: privacy ? '内容已隐藏' : v.text };
      case 'unknown': return { kind: 'unknown' };
    }
  };
  return {
    contract_version: 1, kind: r.kind, status: r.status,
    subject_name: privacy ? (r.kind === 'comparison' ? '方案 A' : r.kind === 'baseline' ? '基准 A' : '当前方案') : r.subject_name,
    other_name: privacy && r.other_name !== null ? '方案 B' : r.other_name,
    generated_on: r.generated_on, source_date: r.source_date, monetary_basis_date: r.monetary_basis_date,
    scenario_revision: r.scenario_revision, model_version: privacy ? null : r.model_version,
    headline: { status: r.headline.status, amount: money(r.headline.amount), date: r.headline.date },
    next_step: { label: privacy ? '核对计算依据与缺项' : r.next_step.label, detail: privacy ? null : r.next_step.detail },
    funds: r.funds.map((f, i) => ({ id: privacy ? `f${i + 1}` : f.id, name: privacy ? `账户 ${i + 1}` : f.name,
      availability: f.availability, amount: money(f.amount), note: privacy ? null : f.note })),
    goals: r.goals.map((g, i) => ({ id: privacy ? `g${i + 1}` : g.id, name: privacy ? `目标 ${i + 1}` : g.name,
      template: g.template, date: g.date, result: g.result, amount: money(g.amount), ratio: g.ratio === null ? null : ratio(g.ratio),
      note: privacy ? null : g.note, missing: privacy ? g.missing.map(() => '存在待核对资料') : [...g.missing] })),
    assumptions: r.assumptions.map((a, i) => ({ id: privacy ? `a${i + 1}` : a.id, label: privacy ? `依据 ${i + 1}` : a.label,
      value: value(a.value), source: a.source, confirmed_on: a.confirmed_on })),
    series: r.series.map(s => ({ date: s.date, kind: s.kind, available: s.available === null ? null : money(s.available),
      restricted: s.restricted === null ? null : money(s.restricted), debt: s.debt === null ? null : money(s.debt) })),
    differences: r.differences.map((d, i) => ({ id: privacy ? `d${i + 1}` : d.id, label: privacy ? `条件 ${i + 1}` : d.label,
      current: value(d.current), other: value(d.other), delta: d.delta === null ? null : money(d.delta), note: privacy ? null : d.note })),
    missing: r.missing.map((m, i) => ({ id: privacy ? `m${i + 1}` : m.id, label: privacy ? `待核对项 ${i + 1}` : m.label,
      impact: m.impact, hint: privacy ? null : m.hint })),
  };
}

/** 同一快照的隐私投影：自由字符串整体替换，事实状态与日期保留，金额/比例清空。 */
export function redactReport(report: ReportInputV1): ReportInputV1 {
  return projectReport(report, true);
}

// ---------------------------------------------------------------- 格式化

/** 分字符串 → ¥ 显示。BigInt 逐位分组，不经过 Number，任意大金额不丢精度；负号用 −。 */
export function formatCents(cents: string): string {
  const neg = cents.startsWith('-');
  const digits = neg ? cents.slice(1) : cents;
  const whole = digits.length > 2 ? digits.slice(0, -2) : '0';
  const frac = digits.length <= 2 ? digits.padStart(2, '0') : digits.slice(-2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}¥${grouped}${frac === '00' ? '' : '.' + frac}`;
}

/** 视图金额显示：被隐藏 → 金额已隐藏；未知 → 未知（不显示 0）。估算值带“约”。 */
export function formatMoney(m: Money): string {
  if (m.hidden) return '金额已隐藏';
  if (m.cents === null) return '未知';
  return (m.basis === 'estimated' ? '约 ' : '') + formatCents(m.cents);
}
export function formatRatio(r: Ratio): string {
  if (r.hidden) return '已隐藏';
  if (r.hundredths === null) return '未知';
  const h = r.hundredths;
  return `${h < 0 ? '−' : ''}${(Math.abs(h) / 100).toFixed(2)}%`;
}
export function formatValue(v: Value): string {
  if (v.kind === 'money') return formatMoney(v);
  if (v.kind === 'ratio') return formatRatio(v);
  if (v.kind === 'text') return v.text;
  if (v.kind === 'date') return v.date ?? '未知';
  return '未知';
}
export const basisLabel = (b: Basis) => b === 'known' ? '实际值' : b === 'estimated' ? '估算' : '未知';
export const sourceLabel = (s: Assumption['source']) => s === 'confirmed' ? '已确认' : s === 'estimated' ? '估算' : s === 'excluded' ? '本次排除' : '未知';
export const availabilityLabel = (a: FundRow['availability']) => a === 'available' ? '可用资金' : a === 'restricted' ? '受限资金' : '债务';
export const templateLabel = (t: GoalRow['template']) => t === 'expense' ? '一笔支出' : t === 'milestone' ? '余额目标' : t === 'income_break' ? '暂停工作' : '退休';
export const kindLabel = (k: ReportKind) => k === 'current' ? '当前方案' : k === 'baseline' ? '历史基准' : '方案比较';
export const impactLabel = (i: MissingItem['impact']) => i === 'blocks_headline' ? '影响主结论' : i === 'degrades' ? '部分结果缺失' : '提示';
export const seriesKindLabel = (k: SeriesPoint['kind']) => k === 'projected' ? '预计' : k === 'actual' ? '实际' : '参考';
export const dateLabel = (d: string | null) => d ?? '未知';

/** 一句结论：隐私视图保留一般结论与日期，金额显示“金额已隐藏”。 */
export function headlineSentence(report: ReportInputV1): string {
  const h = report.headline;
  if (h.status === 'ok') return h.date ? `按当前假设，截至 ${h.date} 资金可以覆盖所选期间。` : '按当前假设，资金可以覆盖所选期间。';
  if (h.status === 'shortfall') {
    const when = h.date ? `${h.date} 起` : '预测期内';
    return `按当前假设，${when}出现资金缺口 ${formatMoney(h.amount)}。`;
  }
  return '关键资料缺失，无法给出完整结论。';
}

/** 目标结果短语：状态 + 结构化金额/比例，不读自由备注。 */
export function goalResultText(g: GoalRow): string {
  const parts: string[] = [];
  if (g.result === 'ok') parts.push(g.date ? `预计 ${g.date} 可达成` : '预计可达成');
  else if (g.result === 'shortfall') parts.push(g.date ? `${g.date} 存在缺口` : '存在缺口');
  else parts.push('资料不足，暂无法判断');
  if (g.amount.cents !== null || g.amount.hidden) parts.push(formatMoney(g.amount));
  if (g.ratio && (g.ratio.hundredths !== null || g.ratio.hidden)) parts.push(`比例 ${formatRatio(g.ratio)}`);
  return parts.join('，');
}

// ---------------------------------------------------------------- 趋势

export type TrendModel = {
  /** 预计折线（只有预计点连线） */
  projected: SeriesPoint[];
  /** 实际点：稀疏、只来自完整盘点快照，逐点画点不连线、不插值 */
  actual: SeriesPoint[];
  /** 参考虚线 */
  reference: SeriesPoint[];
  all: SeriesPoint[];
};

const withValue = (s: SeriesPoint) => s.available != null && s.available.cents !== null;

export function trendModel(series: SeriesPoint[]): TrendModel {
  const all = [...series].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return {
    projected: all.filter(s => s.kind === 'projected' && withValue(s)),
    actual: all.filter(s => s.kind === 'actual' && withValue(s)),
    reference: all.filter(s => s.kind === 'reference' && withValue(s)),
    all,
  };
}

/** 趋势图的无障碍描述：逐点列出实际值，不插值。 */
export function trendAriaLabel(trend: TrendModel): string {
  if (!trend.projected.length && !trend.actual.length && !trend.reference.length) return '资金趋势：暂无可显示的数据';
  const parts = [`资金趋势：预计 ${trend.projected.length} 点，实际 ${trend.actual.length} 点，参考 ${trend.reference.length} 点`];
  for (const a of trend.actual) parts.push(`${a.date} 实际可用资金 ${formatMoney(a.available!)}`);
  return parts.join('。');
}

// ---------------------------------------------------------------- 导出边界

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 导出文件名：只含报告类型与生成日，不含金额、账号或敏感方案名。 */
export function exportFileName(report: ReportInputV1, privacy: boolean): string {
  const day = report.generated_on ?? '未知日期';
  return `${kindLabel(report.kind)}决策报告-${day}${privacy ? '-隐私版' : ''}.html`;
}

/** 复制摘要纯文本：只从视图（可能已脱敏）生成。 */
export function copyText(report: ReportInputV1, privacy: boolean): string {
  const view = privacy ? redactReport(report) : report;
  const lines: string[] = [];
  lines.push(`${kindLabel(view.kind)}决策报告${privacy ? '（隐私版）' : ''}`);
  lines.push(`名称：${view.subject_name}${view.other_name ? ` / ${view.other_name}` : ''}`);
  lines.push(`起点日：${dateLabel(view.source_date)} · 生成日：${dateLabel(view.generated_on)} · 金额基准：${dateLabel(view.monetary_basis_date)}`);
  lines.push(`模型版本：${view.model_version ?? '未知'} · 方案修订：${view.scenario_revision ?? '未知'}`);
  lines.push(`结论：${headlineSentence(view)}`);
  if (view.next_step.label) lines.push(`下一步：${view.next_step.label}${view.next_step.detail ? `（${view.next_step.detail}）` : ''}`);
  lines.push('资金范围：');
  for (const f of view.funds) lines.push(`- ${f.name}（${availabilityLabel(f.availability)}）：${formatMoney(f.amount)}${f.note ? ` · ${f.note}` : ''}`);
  lines.push('目标结果：');
  for (const g of view.goals) lines.push(`- ${g.name}（${templateLabel(g.template)}）：${goalResultText(g)}`);
  if (view.missing.length) {
    lines.push('缺项：');
    for (const m of view.missing) lines.push(`- ${m.label}（${impactLabel(m.impact)}）`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 可打印 HTML

const PRINT_CSS = `
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}
body{font:12px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d1d1f;margin:0}
header.report-head{border-bottom:2px solid #1d1d1f;padding-bottom:8px;margin-bottom:14px}
h1{font-size:20px;margin:0 0 4px}
.meta{color:#555;font-size:11px;display:flex;flex-wrap:wrap;gap:4px 16px}
h2{font-size:14px;margin:20px 0 6px;break-after:avoid}
section{break-inside:avoid-page}
table{border-collapse:collapse;width:100%;font-size:11.5px}
thead{display:table-header-group}
th,td{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
tr{break-inside:avoid}
.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:#555}
.banner{border:1px solid #a05400;background:#fff3e0;padding:6px 10px;border-radius:6px;margin:8px 0}
.conclusion{font-size:14px;font-weight:600;margin:6px 0}
.badge{display:inline-block;border:1px solid #999;border-radius:4px;padding:0 5px;font-size:10px;color:#555;margin-left:4px}
details{margin:6px 0}
footer{margin-top:24px;border-top:1px solid #ccc;padding-top:6px;color:#555;font-size:10.5px}
ul{margin:4px 0;padding-left:20px}
.print-bar{position:sticky;top:0;background:#f2f2f7;border-bottom:1px solid #ccc;padding:8px 12px;display:flex;gap:12px;align-items:center;font-size:12px}
.print-bar button{font-size:13px;padding:5px 16px}
@media print{.print-bar{display:none}}
`;

function tableRow(cells: string[]): string {
  return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
}

/** 趋势 SVG（打印版）：预计连线、参考虚线、实际仅圆点不连线。只在有值时绘制。 */
export function trendSvg(trend: TrendModel): string {
  const W = 680, H = 200, PAD = 12;
  const pts = [...trend.projected, ...trend.actual, ...trend.reference];
  if (!pts.length) return '';
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const x0 = day(trend.all[0].date), x1 = Math.max(day(trend.all.at(-1)!.date), x0 + 1);
  const values = pts.map(p => Number(p.available!.cents));
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const x = (d: string) => (PAD + (day(d) - x0) / (x1 - x0) * (W - 2 * PAD)).toFixed(1);
  const y = (p: SeriesPoint) => (H - 24 - (Number(p.available!.cents) - lo) / span * (H - 48)).toFixed(1);
  const line = (rows: SeriesPoint[]) => rows.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)} ${y(p)}`).join(' ');
  const parts: string[] = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(trendAriaLabel(trend))}" xmlns="http://www.w3.org/2000/svg">`];
  if (trend.reference.length >= 2) parts.push(`<path d="${line(trend.reference)}" fill="none" stroke="#888" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  if (trend.projected.length >= 2) parts.push(`<path d="${line(trend.projected)}" fill="none" stroke="#2a78d6" stroke-width="1.8"/>`);
  for (const p of trend.projected) parts.push(`<circle cx="${x(p.date)}" cy="${y(p)}" r="2.4" fill="#2a78d6"/>`);
  for (const p of trend.actual) parts.push(`<circle cx="${x(p.date)}" cy="${y(p)}" r="4" fill="#18794a" stroke="#fff"/>`);
  parts.push('</svg>');
  return parts.join('');
}

/**
 * 可打印 HTML 文档（自包含，A4 排版）。privacy 为真时先脱敏再渲染，
 * 文档标题、正文、图表 aria、备注全部来自脱敏视图；所有动态文本经 escapeHtml。
 * 页码依赖浏览器打印页眉页脚（CSS 无法自绘），在交付说明中登记。
 */
export function printableHtml(report: ReportInputV1, opts: { privacy: boolean }): string {
  const view = opts.privacy ? redactReport(report) : report;
  const h = escapeHtml;
  const title = `${kindLabel(view.kind)}决策报告${opts.privacy ? '（隐私版）' : ''}`;
  const trend = trendModel(view.series);
  const svg = trendSvg(trend);
  const out: string[] = [];
  out.push('<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/>');
  out.push(`<meta name="viewport" content="width=device-width,initial-scale=1.0"/>`);
  out.push(`<title>${h(title)} ${h(dateLabel(view.generated_on))}</title>`);
  out.push(`<style>${PRINT_CSS}</style></head><body>`);
  out.push(`<div class="print-bar"><strong>${h(title)}</strong><button onclick="window.print()">打印</button><span class="muted">可用浏览器“存储为 PDF”；分页、页码以浏览器打印预览为准</span></div>`);
  out.push(`<header class="report-head"><h1>${h(title)}</h1><div class="meta">`);
  out.push(`<span>名称：${h(view.subject_name)}${view.other_name ? ` / ${h(view.other_name)}` : ''}</span>`);
  out.push(`<span>起点日：${h(dateLabel(view.source_date))}</span><span>生成日：${h(dateLabel(view.generated_on))}</span>`);
  out.push(`<span>金额基准：${h(dateLabel(view.monetary_basis_date))}</span>`);
  out.push(`<span>方案修订：${view.scenario_revision ?? '未知'}</span><span>模型版本：${h(view.model_version ?? '未知')}</span>`);
  out.push('</div></header>');
  if (view.status === 'partial') out.push(`<p class="banner">本报告输入不完整（partial），部分结果保留缺项，未知不等于零。</p>`);
  out.push(`<section><p class="conclusion">${h(headlineSentence(view))}</p>`);
  out.push(`<p class="muted">下一步：${h(view.next_step.label)}${view.next_step.detail ? `（${h(view.next_step.detail)}）` : ''}</p></section>`);
  // 资金范围
  out.push('<section><h2>资金范围</h2><table><thead><tr><th>名称</th><th>可用性</th><th>金额</th><th>依据</th><th>备注</th></tr></thead><tbody>');
  for (const f of view.funds) out.push(tableRow([h(f.name), availabilityLabel(f.availability), `<span class="num">${h(formatMoney(f.amount))}</span>`, basisLabel(f.amount.basis), f.note ? h(f.note) : '<span class="muted">—</span>']));
  out.push('</tbody></table></section>');
  // 目标结果
  out.push('<section><h2>目标结果</h2><table><thead><tr><th>目标</th><th>类型</th><th>日期</th><th>结果</th><th>缺项</th></tr></thead><tbody>');
  for (const g of view.goals) out.push(tableRow([h(g.name), templateLabel(g.template), h(dateLabel(g.date)), h(goalResultText(g)), g.missing.length ? h(g.missing.join('；')) : '<span class="muted">—</span>']));
  out.push('</tbody></table></section>');
  // 趋势
  out.push('<section><h2>资金趋势</h2>');
  if (svg) {
    out.push(svg);
    out.push('<p class="muted">实线为预计，虚线为参考，绿色圆点为实际（仅完整盘点，不插值）。</p>');
    out.push('<table><thead><tr><th>日期</th><th>种类</th><th>可用资金</th><th>受限资金</th><th>债务</th></tr></thead><tbody>');
    for (const s of trend.all) out.push(tableRow([h(s.date), seriesKindLabel(s.kind), `<span class="num">${h(s.available ? formatMoney(s.available) : '—')}</span>`, `<span class="num">${h(s.restricted ? formatMoney(s.restricted) : '—')}</span>`, `<span class="num">${h(s.debt ? formatMoney(s.debt) : '—')}</span>`]));
    out.push('</tbody></table>');
  } else {
    out.push(`<p class="muted">${opts.privacy ? '金额已隐藏，趋势图与明细不显示。' : '暂无可显示的资金趋势。'}</p>`);
  }
  out.push('</section>');
  // 假设与依据
  out.push('<section><h2>计算依据</h2><table><thead><tr><th>项目</th><th>值</th><th>来源</th><th>确认日</th></tr></thead><tbody>');
  for (const a of view.assumptions) out.push(tableRow([h(a.label), h(formatValue(a.value)), sourceLabel(a.source), h(dateLabel(a.confirmed_on))]));
  out.push('</tbody></table></section>');
  // 方案差异
  if (view.kind === 'comparison' && view.differences.length) {
    out.push('<section><h2>方案差异</h2><table><thead><tr><th>项目</th><th>方案 A</th><th>方案 B</th><th>差额</th><th>依据</th></tr></thead><tbody>');
    for (const d of view.differences) out.push(tableRow([h(d.label), h(formatValue(d.current)), h(formatValue(d.other)), d.delta ? `<span class="num">${h(formatMoney(d.delta))}</span>` : '<span class="muted">不可比</span>', d.note ? h(d.note) : '<span class="muted">—</span>']));
    out.push('</tbody></table><p class="muted">差额仅展示生成方已确认的结果，不作因果归因。</p></section>');
  }
  // 缺项
  if (view.missing.length) {
    out.push('<section><h2>缺项与未覆盖</h2><ul>');
    for (const m of view.missing) out.push(`<li>${h(m.label)}<span class="badge">${impactLabel(m.impact)}</span>${m.hint ? ` <span class="muted">${h(m.hint)}</span>` : ''}</li>`);
    out.push('</ul></section>');
  }
  out.push(`<footer>${h(title)} · 生成日 ${h(dateLabel(view.generated_on))} · 报告为固定快照的只读视图，不是可恢复备份。</footer>`);
  out.push('</body></html>');
  return out.join('');
}
