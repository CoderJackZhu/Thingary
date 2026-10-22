import { recurringCategories } from './recurring.ts';
import type { FinancePeriod } from './finance-contract';
import type { SourceTarget } from './source';
import { t } from './i18n.ts';
export type ExpenseFields = { title: string; date: string; amount_cents: string; category: string; notes: string; refund_cents: string | null; refund_date: string | null; asset_id: string | null };
export type Expense = { id: string; fields: ExpenseFields; revision: number; asset_name: string | null; asset_deleted: boolean };
export type ExpenseSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: ExpenseFields };
export type Line = { source: 'purchase' | 'maintenance' | 'expense' | 'linked' | 'refund' | 'sale' | 'payment' | 'virtual' | 'topup'; id: string; asset_id: string | null; plan_id?: string | null; title: string; category: string | null; date: string | null; amount_cents: string | null; notes?: string | null };
/** One year bucket of the all-years view; counts cover spend-participating dated lines only (design §3.1). */
export type AnnualTotal = { year: number; spent_cents: string; refund_cents: string; net_cents: string; sale_cents: string; count: number; known_count: number; unknown_count: number };
export type Month = { month: string; spent_cents: string; refund_cents: string; count: number; known_count: number; unknown_count: number };
export type ExpenseView = { generation: string; period?: FinancePeriod; year: number | null; years: number[]; lines: Line[]; undated: Line[]; months: Month[]; annual_totals: AnnualTotal[]; spent_cents: string; refund_cents: string; net_cents: string; sale_cents: string; undated_cents: string; unknown_amount_count: number };

export const expenseCategories = [['travel', t('旅行')], ['education', t('教育培训')], ['health', t('医疗健康')], ['home', t('家居服务')], ['digital', t('数字服务')], ['gift', t('礼物人情')], ['other', t('其他')]] as const;
export const sourceLabel: Record<Line['source'], string> = { purchase: t('物品购入'), maintenance: t('维护'), expense: t('支出'), linked: t('已并入物品'), refund: t('退款'), sale: t('售出回收'), payment: t('周期付款'), virtual: t('虚拟资产'), topup: t('储值充值') };
/** Item rows carry the item's category name; standalone rows carry a fixed key. */
export function categoryText(line: Line) {
  if (line.source === 'payment') return recurringCategories.find(([k]) => k === line.category)?.[1] ?? t('其他');
  if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund' || line.source === 'virtual') return expenseCategories.find(([k]) => k === line.category)?.[1] ?? t('其他');
  return line.category ?? t('未分类');
}
/** Lines that add to spending in the period; linked, refund and sale rows do not. */
export const countsAsSpending = (line: Line) => line.source === 'purchase' || line.source === 'maintenance' || line.source === 'expense' || line.source === 'payment' || line.source === 'virtual' || line.source === 'topup';

/** Exact owner IDs travel with a projected expense; names and dates are not resolvers. */
export function expenseSourceTarget(line: Line): SourceTarget | null {
  if (line.source === 'payment') return line.plan_id ? { kind: 'payment', id: line.id, plan_id: line.plan_id } : null;
  if (line.source === 'virtual') return { kind: 'virtual', id: line.id };
  if (line.source === 'topup') return line.asset_id ? { kind: 'topup', id: line.id, asset_id: line.asset_id } : null;
  if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund') return { kind: 'expense', id: line.id };
  return line.asset_id ? { kind: 'asset', id: line.asset_id } : null;
}

/** Chart/summary wording for a spend bucket with known and unknown parts (design §3.2). */
export function spendDisplay(b: { count: number; known_count: number; unknown_count: number; spent_cents?: string }): { value: string | null; note: string | null } {
  if (b.count === 0) return { value: null, note: t('未记录支出') };
  if (b.known_count === 0) return { value: null, note: t('金额待补') };
  const note = b.unknown_count > 0 ? t('仅已知部分 · {unknown_count} 笔金额待补', { unknown_count: b.unknown_count }) : null;
  return { value: b.spent_cents ?? null, note };
}

/** Label the host's actual period without filtering or re-aggregating its projection. */
export function expensePeriodLabel(period: FinancePeriod): string {
  switch (period.kind) {
    case 'all': return t('全部');
    case 'year': return t('{year} 年', { year: period.year });
    case 'month': return t('{v1} 年 {v2} 月', { v1: period.month.slice(0, 4), v2: Number(period.month.slice(5)) });
    case 'range': return t('{from} 至 {to}{v3}', { from: period.from, to: period.to, v3: period.includeFrom ? '（包含两端）' : '（不含起点当日）' });
  }
}
