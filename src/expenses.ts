import { recurringCategories } from './recurring.ts';
export type ExpenseFields = { title: string; date: string; amount_cents: string; category: string; notes: string; refund_cents: string | null; refund_date: string | null; asset_id: string | null };
export type Expense = { id: string; fields: ExpenseFields; revision: number; asset_name: string | null; asset_deleted: boolean };
export type ExpenseSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: ExpenseFields };
export type Line = { source: 'purchase' | 'maintenance' | 'expense' | 'linked' | 'refund' | 'sale' | 'payment' | 'virtual'; id: string; asset_id: string | null; title: string; category: string | null; date: string | null; amount_cents: string | null; notes?: string | null };
export type ExpenseView = { generation: string; year: number | null; years: number[]; lines: Line[]; undated: Line[]; months: { month: string; spent_cents: string; refund_cents: string }[]; spent_cents: string; refund_cents: string; net_cents: string; sale_cents: string; undated_cents: string; unknown_amount_count: number };

export const expenseCategories = [['travel', '旅行'], ['education', '教育培训'], ['health', '医疗健康'], ['home', '家居服务'], ['digital', '数字服务'], ['gift', '礼物人情'], ['other', '其他']] as const;
export const sourceLabel: Record<Line['source'], string> = { purchase: '物品购入', maintenance: '维护', expense: '支出', linked: '已并入物品', refund: '退款', sale: '售出回收', payment: '周期付款', virtual: '虚拟资产' };
/** Item rows carry the item's category name; standalone rows carry a fixed key. */
export function categoryText(line: Line) {
  if (line.source === 'payment') return recurringCategories.find(([k]) => k === line.category)?.[1] ?? '其他';
  if (line.source === 'expense' || line.source === 'linked' || line.source === 'refund' || line.source === 'virtual') return expenseCategories.find(([k]) => k === line.category)?.[1] ?? '其他';
  return line.category ?? '未分类';
}
/** Lines that add to spending in the period; linked, refund and sale rows do not. */
export const countsAsSpending = (line: Line) => line.source === 'purchase' || line.source === 'maintenance' || line.source === 'expense' || line.source === 'payment' || line.source === 'virtual';
