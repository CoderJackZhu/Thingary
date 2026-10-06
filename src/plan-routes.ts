// 35 岁以后的路线：几套预设的职业去向，每条路线自带储蓄、社保缴费基数、公积金与空窗比例，用户只选一条。
// 参数是写死的假设（verified 标明来源），远期的东西不让用户逐项调；想改就在储蓄阶段里手填。
import type { Employment } from './plan-pension.ts';
import { expectedSaving } from './plan-ledger.ts';
import type { SavingPhase } from './plan-ledger.ts';

export type Route = {
  id: string; label: string; summary: string;
  /** 以下均为今天的钱、每月（分）：有收入时的储蓄、社保缴费基数、公积金月缴存（单位＋个人）。 */
  saving_cents: number; base_cents: number; hpf_cents: number;
  /** 平均空窗比例（万分比），只作用于这条路线的储蓄。 */
  gap_share_hundredths: number;
  /** user：来自用户自己的估计；assumption：我的假设，未核对。 */
  verified: 'user' | 'assumption';
  basis: string;
};

export const routes: Route[] = [
  { id: 'soe', label: '国企／事业单位', summary: '稳定，收入中等', saving_cents: 800_000, base_cents: 1_500_000, hpf_cents: 360_000, gap_share_hundredths: 500, verified: 'assumption',
    basis: '示例假设：月薪约 1.5 万、扣掉房租每月存 8000；缴费基数取 1.5 万；公积金按北京上限比例 12%＋12%；空窗比例 5%。' },
  { id: 'civil', label: '机关事业单位／公务员', summary: '最稳，收入偏低', saving_cents: 500_000, base_cents: 1_200_000, hpf_cents: 288_000, gap_share_hundredths: 0, verified: 'assumption',
    basis: '假设月薪约 1.2 万、每月存 5000，未核对；公积金 12%＋12%；机关事业养老金另有职业年金，这里按同一公式近似，会偏保守。' },
  { id: 'tech', label: '继续互联网', summary: '高薪但不稳', saving_cents: 1_500_000, base_cents: 3_000_000, hpf_cents: 720_000, gap_share_hundredths: 1500, verified: 'assumption',
    basis: '示例假设：每月存 1.5 万、缴费基数 3 万、公积金 12%＋12%；行业裁员频繁，按 15% 的空窗折算。' },
  { id: 'flex', label: '灵活就业／自由职业', summary: '自己交社保，没有公积金', saving_cents: 300_000, base_cents: 727_000, hpf_cents: 0, gap_share_hundredths: 0, verified: 'assumption',
    basis: '示例假设：每月净存 3000；社保按北京下限 7270 自缴（医保、失业、养老三项合计约 2000 元/月，已含在这笔储蓄里）；没有公积金。' },
];

export const routeById = (id: string | null) => (id === null ? null : routes.find(r => r.id === id) ?? null);

/** 在 fromMonth（月龄）起换成路线：之前用户自己的储蓄阶段（或盘点中位数）原样保留，之后的阶段被路线取代；路线的空窗比例只折算路线这一段。 */
export function routeSavingPhases(user: SavingPhase[], measured: number, now: number, route: Route, fromMonth: number, livingCents: number): SavingPhase[] {
  const base = user.length ? user : [{ from_month: now, cents: measured }];
  const before = base.filter((p, i) => i === 0 || p.from_month < fromMonth);
  if (fromMonth <= now) return [{ from_month: now, cents: expectedSaving(route.saving_cents, route.gap_share_hundredths, livingCents) }];
  return [...before, { from_month: fromMonth, cents: expectedSaving(route.saving_cents, route.gap_share_hundredths, livingCents) }];
}

/** 路线的缴费分段：公积金月缴存要扣掉近期每月平均提取（自动提取等），不低于 0。 */
export const routeEmployment = (route: Route, fromMonth: number, hpfOutMonthly: number): Employment[] => [{ from_age_months: fromMonth, base_cents: route.base_cents, hpf_monthly_cents: Math.max(0, route.hpf_cents - hpfOutMonthly) }];
