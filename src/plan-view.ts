// 退休概览的展示模型（纯函数）：判词、总结句、进度、里程碑、轨迹点、覆盖拆分与逐年表。
// 引擎全程「今天的钱」；名义值只在这里乘以 (1+通胀)^年数。
import { coastAmount, coastAt, coverageAt, glide, nominalFactor, required, scaleSpend, table } from './plan-ledger.ts';
import type { Outcome, Plan, Projection } from './plan-ledger.ts';

export type ValueMode = 'today' | 'nominal';
export type Tone = 'good' | 'watch' | 'bad';
export type Seg = { t: string; strong?: boolean };

/** 展示用的缩放：今天的钱不变，名义值乘到该月龄的累计通胀。 */
export const scaleAt = (P: Plan, mode: ValueMode, month: number) => (mode === 'nominal' ? nominalFactor(P, month) : 1);

/** 紧凑金额（分 → 万／亿），图表坐标与卡片用。 */
export function compactYuan(cents: number): string {
  const v = cents / 100, a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e8) return `${sign}¥${trim(a / 1e8)}亿`;
  if (a >= 1e4) return `${sign}¥${trim(a / 1e4)}万`;
  return `${sign}¥${Math.round(a).toLocaleString('zh-CN')}`;
}
const trim = (x: number) => (x >= 100 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ''));

export const ageInt = (months: number) => Math.floor(months / 12);
const durationText = (months: number) => { const y = Math.floor(months / 12), m = months % 12; return y === 0 ? `${m} 个月` : m === 0 ? `${y} 年` : `${y} 年 ${m} 个月`; };

export type Verdict = {
  tone: Tone;
  badge: string;
  /** 判词（大字）。 */
  headline: Seg[];
  /** 「在 45 岁时。预计缺口为 …」一行；没有缺口或盈余时为空。 */
  sub: Seg[];
  /** 总结句：缴款与每年支出。 */
  summary: Seg[];
  /** 需要提醒的一句话（资金不足、缺口、晚了几年等），没有则为 null。 */
  guidance: string | null;
  /** 传统模式的状态；FIRE 模式为 null。 */
  status: 'depleted' | 'shortfall' | 'overfunded' | 'on_track' | null;
  /** FIRE：财务独立比期望晚多少个月；已提前或没达成时为 null。 */
  late_months: number | null;
  reached: boolean;
};

const seg = (t: string, strong = false): Seg => ({ t, ...(strong ? { strong } : {}) });

/** assetsNow 是当前可支配资产；fmt 把「今天的钱」的分按展示口径格式化（调用方已含缩放时传入的就是缩放后的）。 */
export function verdict(P: Plan, proj: Projection, out: Outcome, assetsNow: number, mode: ValueMode, fmt: (cents: number) => string): Verdict {
  const goal = P.target_months, goalAge = ageInt(goal), horizonAge = ageInt(P.horizon_months);
  const k = scaleAt(P, mode, goal);
  const T = table(P), idx = Math.min(Math.max(0, goal - P.now_months), Math.max(0, T.spend.length - 1));
  const annualSpend = (T.spend[idx] ?? 0) * 12 * k;
  const contribution = `${fmt(P.saving_cents)}/月`;
  const fire = P.mode === 'fire';
  const summary = fire
    ? [seg('根据当前假设及'), seg(contribution, true), seg(`的缴款，计划包括直至 ${horizonAge} 岁的每年`), seg(fmt(annualSpend), true), seg('支出。')]
    : [seg('根据当前假设及'), seg(contribution, true), seg(`的缴款，${goalAge} 岁时的预计余额为`), seg(fmt(out.assets_at_goal * k), true), seg('，所需资金为'), seg(fmt(out.required_at_goal * k), true), seg('。')];
  const gap = out.shortfall_at_goal * k;
  const subShort = gap > 0 ? [seg(`在 ${goalAge} 岁时。预计缺口为`), seg(fmt(gap), true)] : [];
  const fiNow = proj.fi_month !== null && proj.fi_month <= P.now_months;
  const failure = proj.failure_month !== null ? ageInt(proj.failure_month) : null, shortfallAge = proj.shortfall_month !== null ? ageInt(proj.shortfall_month) : null;

  // 引导语：按严重程度取第一条成立的（与对标产品同一顺序）。
  let guidance: string | null = null, tone: Tone = 'good';
  if (failure !== null) { tone = 'bad'; guidance = `预计投资组合在 ${failure} 岁时出现资金不足。请在假设分析中比较假设。`; }
  else if (shortfallAge !== null) { tone = 'watch'; guidance = `预计从 ${shortfallAge} 岁起出现支出缺口。请在假设分析中比较假设。`; }
  else if (!fire) { if (!out.funded_at_goal) { tone = 'watch'; guidance = '预计退休时出现缺口。请在假设分析中比较假设。'; } }
  else if (fiNow) guidance = '当前投资组合已达到你的假设下估算的财务独立目标。';
  else if (proj.fi_month === null) { tone = 'bad'; guidance = `预计 ${horizonAge} 岁前无法实现财务独立。请在假设分析中比较假设。`; }

  if (!fire) {
    const status: Verdict['status'] = failure !== null ? 'depleted' : !out.funded_at_goal ? 'shortfall' : out.assets_at_goal >= out.required_at_goal * 1.25 && out.required_at_goal > 0 ? 'overfunded' : 'on_track';
    const badge = { depleted: '资金不足', shortfall: '缺口', overfunded: '盈余', on_track: '进展顺利' }[status];
    const headline = status === 'depleted' ? [seg('预计投资组合资金不足的年龄为'), seg(`${failure} 岁`, true), seg(`，即在 ${goalAge} 岁退休之后。`)]
      : status === 'shortfall' ? [seg(`${goalAge} 岁时预计缺口为`), seg(fmt(gap), true), seg(`才能支撑退休生活至 ${horizonAge} 岁。`)]
      : status === 'overfunded' ? [seg(`预计您将在 ${goalAge} 岁退休，并有`), seg(fmt((out.assets_at_goal - out.required_at_goal) * k), true), seg('盈余。')]
      : [seg('预计您将退休于'), seg(`${goalAge} 岁`, true), seg('，进展顺利。')];
    return { tone: status === 'depleted' ? 'bad' : status === 'shortfall' ? 'watch' : tone, badge, headline, sub: [], summary, guidance, status, late_months: null, reached: out.funded_at_goal };
  }

  if (fiNow) return { tone: 'good', badge: '已实现财务独立', headline: [seg('您已实现'), seg('财务独立', true), seg('——按当前假设计算。')], sub: [], summary, guidance, status: null, late_months: null, reached: true };
  if (proj.fi_month === null) return { tone: 'bad', badge: `预计 ${horizonAge} 岁前无法达到`, headline: [seg(`按当前假设，${horizonAge} 岁前无法达到财务独立。`)], sub: subShort, summary, guidance, status: null, late_months: null, reached: false };
  const late = proj.fi_month - goal;
  if (late <= 0) return { tone: failure !== null || shortfallAge !== null ? tone : 'good', badge: '进展顺利', headline: [seg('预计您将在'), seg(`${ageInt(proj.fi_month)} 岁`, true), seg('达到财务独立。')], sub: subShort, summary, guidance, status: null, late_months: null, reached: true };
  const lateYears = Math.round(late / 12);
  return {
    tone: late <= 36 ? 'watch' : 'bad', badge: late < 12 ? `晚 ${late} 个月` : `晚 ${lateYears} 年`,
    headline: [seg('预计您将在'), seg(`${ageInt(proj.fi_month)} 岁`, true), seg('达到财务独立。')], sub: subShort, summary,
    guidance: failure !== null || shortfallAge !== null ? guidance : `预计在期望年龄的 ${late < 12 ? `${late} 个月` : `${lateYears} 年`}后实现财务独立。请在假设分析中比较假设。`,
    status: null, late_months: late, reached: false,
  };
}

/** 进度：当前资产 ÷ 目标年龄所需（按当前口径）；coast 是 Coast FIRE 在条上的位置。 */
export type Progress = { now: number; target: number; pct: number | null; coast_pct: number | null; goal_age: number };
export function progress(P: Plan, out: Outcome, assetsNow: number, mode: ValueMode): Progress {
  const k = scaleAt(P, mode, P.target_months), target = out.required_at_goal * k;
  const coast = coastAmount(P) * k;
  return { now: assetsNow, target, pct: target > 0 ? Math.min(100, (assetsNow / target) * 100) : null, coast_pct: target > 0 ? Math.min(100, (coast / target) * 100) : null, goal_age: ageInt(P.target_months) };
}

export type Milestone = { id: 'coast' | 'lean' | 'fi' | 'fat'; label: string; hint: string; amount: number; done: boolean };
/** Coast FIRE、Lean（支出 70%）、FI（全部支出）、Fat（支出 150%）：都是目标年龄那一刻所需，按当前口径显示。 */
export function milestones(P: Plan, assetsNow: number, mode: ValueMode): Milestone[] {
  const G = Math.max(P.target_months, P.now_months), k = scaleAt(P, mode, G);
  const at = (f: number) => required(f === 1 ? P : scaleSpend(P, f), G);
  const coast = coastAmount(P);
  const make = (id: Milestone['id'], label: string, hint: string, real: number, shown: number): Milestone => ({ id, label, hint, amount: shown, done: assetsNow >= real });
  return [
    make('coast', 'Coast FIRE', '目前所需资金估算', coast, coast * (mode === 'nominal' ? k : 1)),
    make('lean', 'Lean FIRE', '计划支出的 70%', at(0.7), at(0.7) * k),
    make('fi', 'FI', '完整的计划支出', at(1), at(1) * k),
    make('fat', 'Fat FIRE', '计划支出的 150%', at(1.5), at(1.5) * k),
  ];
}

/** 轨迹图：每个行首一个点，加上规划终点；required 是所需资金下滑曲线。 */
export type TrajectoryPoint = { age: number; projected: number; required: number; phase: 'accumulation' | 'retired' };
export function trajectory(P: Plan, proj: Projection, mode: ValueMode): TrajectoryPoint[] {
  const g = glide(P, proj);
  const pts: TrajectoryPoint[] = proj.rows.map((r, i) => ({ age: r.start_month / 12, projected: r.start * scaleAt(P, mode, r.start_month), required: g[i] * scaleAt(P, mode, r.start_month), phase: r.phase }));
  const last = proj.rows[proj.rows.length - 1];
  if (last) pts.push({ age: P.horizon_months / 12, projected: Math.max(0, proj.assets[proj.assets.length - 1]) * scaleAt(P, mode, P.horizon_months), required: 0, phase: 'retired' });
  return pts;
}

/** 覆盖拆分：某月龄每月计划支出由收入流、国家养老金、投资组合提取与无资金部分支撑。 */
export type CoverageSegment = { key: string; label: string; monthly: number; kind: 'income' | 'pension' | 'portfolio' | 'unfunded' };
export type CoverageView = {
  month: number; age: number; spend: number; essential: number;
  segments: CoverageSegment[]; pct: { income: number; portfolio: number; unfunded: number };
  /** 年提取占当时组合价值的比例（万分比整数以外的小数，仅参考）；没有组合价值时为 null。 */
  draw_rate: number | null;
  spend_items: { id: string; label: string; monthly: number; start: string; end: string; essential: boolean; active: boolean }[];
  income_items: { id: string; label: string; monthly: number; start: string; end: string; active: boolean }[];
  next_income_age: number | null;
};

export function coverage(P: Plan, proj: Projection, month: number, mode: ValueMode): CoverageView {
  const c = coverageAt(P, proj, month), k = scaleAt(P, mode, month);
  const segments: CoverageSegment[] = [
    ...c.items.filter(x => x.monthly > 0).map(x => ({ key: x.id, label: x.label, monthly: x.monthly * k, kind: 'income' as const })),
    ...(c.pension > 0 ? [{ key: 'pension', label: '国家养老金', monthly: c.pension * k, kind: 'pension' as const }] : []),
    ...(c.withdrawal > 0 ? [{ key: 'portfolio', label: '投资组合提取', monthly: c.withdrawal * k, kind: 'portfolio' as const }] : []),
    ...(c.unfunded > 0 ? [{ key: 'unfunded', label: '无资金支持', monthly: c.unfunded * k, kind: 'unfunded' as const }] : []),
  ];
  const spend = c.spend * k, pct = (v: number) => (spend > 0 ? Math.min(100, (v / spend) * 100) : 0);
  const income = segments.filter(s => s.kind === 'income' || s.kind === 'pension').reduce((s, x) => s + x.monthly, 0);
  const row = proj.rows.find(r => month >= r.start_month && month < r.start_month + 12);
  const value = row ? row.start : 0;
  const ageOf = (a: number | null) => (a === null ? '终身' : `${a} 岁`);
  const retireAge = proj.retire_month !== null ? ageInt(proj.retire_month) : ageInt(P.target_months);
  const nextIncome = P.incomes.filter(s => s.start_age * 12 > month).map(s => s.start_age).sort((a, b) => a - b)[0] ?? (proj.pension && proj.pension.unlock_age_months > month && proj.pension.monthly_cents > 0 ? ageInt(proj.pension.unlock_age_months) : null);
  const infl = 1 + P.inflation_hundredths / 10000;
  return {
    month, age: ageInt(month), spend, essential: c.essential * k,
    segments, pct: { income: pct(income), portfolio: pct(c.withdrawal * k), unfunded: pct(c.unfunded * k) },
    draw_rate: value > 0 && c.withdrawal > 0 ? (c.withdrawal * 12) / value : null,
    spend_items: P.items.map(it => {
      const start = it.start_age ?? retireAge, active = month >= start * 12 && (it.end_age === null || month < it.end_age * 12);
      const real = (1 + (it.inflation_hundredths ?? P.inflation_hundredths) / 10000) / infl;
      return { id: it.id, label: it.label, monthly: active ? it.monthly_cents * real ** ((month - P.now_months) / 12) * k : 0, start: it.start_age === null ? '退休' : `${it.start_age} 岁`, end: ageOf(it.end_age), essential: it.essential, active };
    }),
    income_items: [
      ...P.incomes.map(s => ({ id: s.id, label: s.label, monthly: c.items.find(x => x.id === s.id)!.monthly * k, start: `${s.start_age} 岁`, end: ageOf(s.end_age), active: c.items.find(x => x.id === s.id)!.active })),
      ...(proj.pension && proj.pension.monthly_cents > 0 ? [{ id: 'pension', label: '国家养老金', monthly: c.pension * k, start: `${ageInt(proj.pension.unlock_age_months)} 岁`, end: '终身', active: c.pension > 0 }] : []),
    ],
    next_income_age: nextIncome,
  };
}

/** 逐年快照表的一行：金额按当前口径（行首月龄的通胀系数）。 */
export type SnapshotRow = { age: number; year: number; phase: 'accumulation' | 'retired'; end: number; contribution: number; income: number; unlock: number; spend: number; withdrawal: number; unfunded: number; start_month: number };
export function snapshotRows(P: Plan, proj: Projection, mode: ValueMode): SnapshotRow[] {
  return proj.rows.map(r => { const k = scaleAt(P, mode, r.start_month); return { age: r.age, year: r.year, phase: r.phase, end: r.end * k, contribution: r.contribution * k, income: r.income * k, unlock: r.unlock * k, spend: r.spend * k, withdrawal: r.withdrawal * k, unfunded: r.unfunded * k, start_month: r.start_month }; });
}

export { durationText };

/** 覆盖随时间：从退休（未退休则从目标年龄）到规划终点，每行首一个点；keys 是出现过的资金来源，按固定顺序叠放。 */
export type CoverageSeries = { keys: CoverageSegment[]; points: { age: number; spend: number; values: Record<string, number> }[]; start_month: number };
export function coverageSeries(P: Plan, proj: Projection, mode: ValueMode): CoverageSeries {
  const start = proj.retire_month ?? Math.max(P.target_months, P.now_months);
  const keys: CoverageSegment[] = [];
  const points = proj.rows.filter(r => r.start_month + 12 > start).map(r => {
    const m = Math.max(r.start_month, start), c = coverage(P, proj, m, mode), values: Record<string, number> = {};
    for (const s of c.segments) { values[s.key] = s.monthly * 12; if (!keys.some(k => k.key === s.key)) keys.push({ ...s, monthly: 0 }); }
    return { age: m / 12, spend: c.spend * 12, values };
  });
  const order = { income: 0, pension: 1, portfolio: 2, unfunded: 3 };
  keys.sort((a, b) => order[a.kind] - order[b.kind]);
  return { keys, points, start_month: start };
}

/** 结果区间：基准与几种收入变化情形的 FI 年龄（FIRE）或目标年龄时的盈亏（传统）并排。 */
export type RangeRow = { id: string; label: string; fi_month: number | null; late_months: number | null; surplus: number; failed: boolean };
export function rangeRows(P: Plan, stress: { id: string; label: string; stressed: Outcome }[], base: Outcome): RangeRow[] {
  const row = (id: string, label: string, o: Outcome): RangeRow => ({ id, label, fi_month: o.fi_month, late_months: o.fi_month !== null && base.fi_month !== null ? o.fi_month - base.fi_month : null, surplus: o.assets_at_goal - o.required_at_goal, failed: o.failure_month !== null || o.shortfall_month !== null });
  const pick = ['income-drop', 'job-gap', 'save-less'];
  return [row('base', '基准', base), ...pick.flatMap(id => { const r = stress.find(s => s.id === id); return r ? [row(id, r.label, r.stressed)] : []; })];
}

/** Coast 检查点：到某个月龄至少要有多少，之后哪怕不再存钱也能在目标年龄达标；对照按计划那时预计有多少。
 *  取储蓄阶段里每一次下降的起点；没有下降时给 35 岁作参考。 */
export type Checkpoint = { month: number; label: string; need: number; expected: number; ok: boolean };
export function checkpoints(P: Plan, proj: Projection): Checkpoint[] {
  const ph = P.saving_phases ?? [];
  const months: { m: number; label: string }[] = [];
  ph.forEach((x, i) => { if (i > 0 && x.cents < ph[i - 1].cents) months.push({ m: x.from_month, label: '储蓄下降前' }); });
  if (!months.length) months.push({ m: 35 * 12, label: '35 岁参考' });
  const last = Math.min(P.target_months, proj.retire_month ?? Infinity);
  return months.filter(x => x.m > P.now_months && x.m < last).slice(0, 3).map(x => {
    const need = coastAt(P, x.m), expected = Math.max(0, proj.assets[Math.min(proj.assets.length - 1, x.m - P.now_months)]);
    return { month: x.m, label: x.label, need, expected, ok: expected >= need };
  });
}
