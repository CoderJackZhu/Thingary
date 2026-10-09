// 心愿接入（PLANNING_DESIGN §7）：「考虑中」且有预计价格的心愿作为带日期的一次性支出进入退休账本，
// 回答两个问题：到那天钱够不够；买下后 FIRE 日期推迟多久。纯函数，不改变心愿状态。
import { project, table } from './plan-ledger.ts';
import type { PlanningAnnotation } from './plan-basic-contract.ts';
import type { Plan } from './plan-ledger.ts';
import type { Spend } from './plan-fire.ts';
import type { RetireCalc } from './plan-retire-calc.ts';

/** 心愿里规划用到的字段（来自 WishlistItem）。 */
export type WishLike = { id: string; name: string; price_cents: string | null; target_date: string | null; decision_state: string };

/** dated 按计划日期（计入合计）；today 没有计划日期，只作「如果今天买下」的假设，不计入合计；expired 计划日期已过，不计入；no_price 没有预计价格。 */
export type WishStatus = 'dated' | 'today' | 'expired' | 'no_price';
export type WishSpend = { id: string; name: string; status: WishStatus; cents: number; date: string | null; offset_months: number | null };

const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

export function classifyWishes(items: WishLike[], today: string): WishSpend[] {
  const out: WishSpend[] = [];
  for (const w of items) {
    if (w.decision_state !== 'considering') continue;
    const base = { id: w.id, name: w.name };
    if (w.price_cents === null) { out.push({ ...base, status: 'no_price', cents: 0, date: null, offset_months: null }); continue; }
    const cents = Number(w.price_cents), date = w.target_date ? w.target_date : null;
    if (date === null) out.push({ ...base, status: 'today', cents, date: null, offset_months: 0 });
    else if (date < today) out.push({ ...base, status: 'expired', cents, date, offset_months: null });
    else out.push({ ...base, status: 'dated', cents, date, offset_months: monthIndex(date) - monthIndex(today) });
  }
  return out;
}

/** 计入合计的心愿：只有填了计划日期、表示「打算买」的。没填日期的只在单件假设里看影响。 */
export const counted = (spends: WishSpend[]) => spends.filter(s => s.status === 'dated');
const toSpend = (s: WishSpend): Spend => ({ offset_months: s.offset_months!, cents: s.cents });

export type Impact = {
  annotations?: PlanningAnnotation[];
  /** 没有这笔支出时的 FIRE（月数偏移）与有之后的；null 表示 70 岁前达不到。 */
  base_offset: number | null;
  with_offset: number | null;
  /** 推迟的月数；任一为 null 时没有意义。 */
  delay_months: number | null;
  /** 计划日期支出前的可支配资产（按当前储蓄），以及支出后。 */
  assets_before_cents: number;
  assets_after_cents: number;
  /** 支出后低于应急金线（应急金月数 × 退休后月支出）。 */
  breaches_emergency: boolean;
};

type Ready = RetireCalc & { plan: Plan; saving: number };
export const isReady = (calc: RetireCalc | null): calc is Ready => !!calc && calc.plan !== undefined && calc.saving !== null && calc.missing.length === 0 && (!calc.capabilities || calc.capabilities.prediction.status === 'ready' && calc.capabilities.prediction.value.source === 'saved');

/** 一组一次性支出（带月份的，含「按今天」的假设）对 FIRE 日期的影响：与「没有这些支出」的基线比较。合计请传 counted(...)。 */
export function impactOf(calc: Ready, spends: WishSpend[]): Impact {
  if (!isReady(calc)) throw new Error('心愿影响需要已保存的明确预计投入。');
  const P = calc.plan, now = P.now_months;
  const events = spends.filter(s => s.offset_months !== null).map(s => ({ ...toSpend(s), offset_months: P.anchor_date ? monthIndex(s.date ?? P.calculation_date ?? P.anchor_date) - monthIndex(P.anchor_date) : s.offset_months! }));
  // 基线是「已计入的大额计划都发生、这些心愿不发生」；心愿叠加在其上。
  const base = project(P, 0), withSpend = project({ ...P, spends: [...P.spends, ...events] }, 0);
  const first = events.length ? Math.min(...events.map(e => e.offset_months)) : 0, last = Math.min(Math.max(0, ...events.map(e => e.offset_months)), base.assets.length - 1);
  const line = calc.r.emergency_months * (table(P).essential[0] ?? 0);
  return {
    annotations: calc.capabilities?.annotations ?? P.annotations ?? [],
    base_offset: base.fi_month === null ? null : base.fi_month - now,
    with_offset: withSpend.fi_month === null ? null : withSpend.fi_month - now,
    delay_months: base.fi_month !== null && withSpend.fi_month !== null ? withSpend.fi_month - base.fi_month : null,
    assets_before_cents: base.assets[last],
    assets_after_cents: withSpend.assets[last],
    breaches_emergency: events.length > 0 && Array.from(withSpend.assets.subarray(first, last + 1)).some(v => v < line),
  };
}

/** 心愿详情里的一句话；没有预计价格时没有句子。money 把分格式化成文字（由调用方传入以保持纯函数）。 */
export function impactSentence(s: WishSpend, i: Impact, emergencyMonths: number, money: (cents: number) => string): string {
  if (s.status === 'no_price') return '';
  if (s.status === 'expired') return '计划日期已过，规划没有计入这笔支出；更新计划日期后会重新估算。';
  const when = s.status === 'today' ? '未设计划日期，只作假设：如果今天买下，可支配资产约' : `如果按计划在 ${s.date} 买下，按当前储蓄那时可支配资产约`;
  let tail: string;
  if (i.base_offset === null) tail = '按现在的储蓄，70 岁前本来就达不到 FIRE，买下后同样达不到';
  else if (i.with_offset === null) tail = '买下后 FIRE 在 70 岁前达不到（原本可以）';
  else if (i.delay_months === 0) tail = '买下后对 FIRE 日期几乎没有影响';
  else tail = `买下后 FIRE 推迟约 ${i.delay_months} 个月`;
  const line = i.breaches_emergency ? `；买下后可支配资产会低于 ${emergencyMonths} 个月支出的应急金线` : '';
  return `${when} ${money(i.assets_before_cents)}；${tail}${line}。`;
}
