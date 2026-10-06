// 心愿接入（PLANNING_DESIGN §7）：「考虑中」且有预计价格的心愿作为带日期的一次性支出进入退休账本，
// 回答两个问题：到那天钱够不够；买下后 FIRE 日期推迟多久。纯函数，不改变心愿状态。
import { assetSeries, findFire } from './plan-fire.ts';
import type { Spend } from './plan-fire.ts';
import type { RetireCalc } from './plan-retire-calc.ts';

/** 心愿里规划用到的字段（来自 WishlistItem）。 */
export type WishLike = { id: string; name: string; price_cents: string | null; target_date: string | null; decision_state: string };

/** dated 按计划日期；today 没有计划日期，按今天计入；expired 计划日期已过，不计入；no_price 没有预计价格。 */
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

/** 计入账本的心愿。 */
export const counted = (spends: WishSpend[]) => spends.filter(s => s.status === 'dated' || s.status === 'today');
const toSpend = (s: WishSpend): Spend => ({ offset_months: s.offset_months!, cents: s.cents });

export type Impact = {
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

type Ready = RetireCalc & { L: NonNullable<RetireCalc['L']>; saving: number };
export const isReady = (calc: RetireCalc | null): calc is Ready => !!calc && calc.L !== undefined && calc.saving !== null && calc.missing.length === 0;

/** 一组一次性支出对 FIRE 日期的影响：与「没有这些支出」的基线比较。 */
export function impactOf(calc: Ready, spends: WishSpend[]): Impact {
  const { L, saving, r } = calc;
  const events = counted(spends).map(toSpend);
  const base = findFire(L, saving, r.real_return_before_hundredths, r.real_return_after_hundredths);
  const withSpend = findFire(L, saving, r.real_return_before_hundredths, r.real_return_after_hundredths, events);
  const last = Math.max(0, ...events.map(e => e.offset_months));
  const baseSeries = assetSeries(L, saving, r.real_return_before_hundredths, last);
  const afterSeries = assetSeries(L, saving, r.real_return_before_hundredths, last, events);
  const line = r.emergency_months * L.spend_cents;
  return {
    base_offset: base?.offset_months ?? null,
    with_offset: withSpend?.offset_months ?? null,
    delay_months: base && withSpend ? withSpend.offset_months - base.offset_months : null,
    assets_before_cents: baseSeries.before[last],
    assets_after_cents: afterSeries.after[last],
    breaches_emergency: events.length > 0 && afterSeries.after.slice(Math.min(...events.map(e => e.offset_months))).some(v => v < line),
  };
}

/** 心愿详情里的一句话；没有预计价格时没有句子。money 把分格式化成文字（由调用方传入以保持纯函数）。 */
export function impactSentence(s: WishSpend, i: Impact, emergencyMonths: number, money: (cents: number) => string): string {
  if (s.status === 'no_price') return '';
  if (s.status === 'expired') return '计划日期已过，规划没有计入这笔支出；更新计划日期后会重新估算。';
  const when = s.status === 'today' ? '未设计划日期，按今天买下估算：可支配资产约' : `按当前储蓄，${s.date} 时可支配资产约`;
  let tail: string;
  if (i.base_offset === null) tail = '按现在的储蓄，70 岁前本来就达不到 FIRE，买下后同样达不到';
  else if (i.with_offset === null) tail = '买下后 FIRE 在 70 岁前达不到（原本可以）';
  else if (i.delay_months === 0) tail = '买下后对 FIRE 日期几乎没有影响';
  else tail = `买下后 FIRE 推迟约 ${i.delay_months} 个月`;
  const line = i.breaches_emergency ? `；买下后可支配资产会低于 ${emergencyMonths} 个月支出的应急金线` : '';
  return `${when} ${money(i.assets_before_cents)}；${tail}${line}。`;
}
