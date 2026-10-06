// 规划数据的读取（IPC）：目标页与心愿详情共用。纯计算在 plan-retire-calc.ts / plan-wishes.ts。
import { invoke } from '@tauri-apps/api/core';
import type { Income, IncomeList, PlanReview, ProfileState } from './plan';
import type { Snapshot, Summary } from './wealth';
import type { WishlistItem, WishlistPage } from './wishlist';
import type { WishLike } from './plan-wishes';

export type PlanContext = { review: PlanReview; incomes: Income[]; profile: ProfileState; snapshot: Snapshot | null };

/** 一次读齐：储蓄统计、收入、个人资料与最近完整盘点。 */
export async function loadPlanContext(): Promise<PlanContext> {
  const [review, list, profile, summary] = await Promise.all([invoke<PlanReview>('plan_review'), invoke<IncomeList>('plan_income_list'), invoke<ProfileState>('plan_profile'), invoke<Summary>('wealth_summary')]);
  const latest = [...summary.points].reverse().find(p => p.complete);
  const snapshot = latest ? await invoke<Snapshot | null>('wealth_snapshot', { id: latest.snapshot_id }) : null;
  return { review, incomes: list.rows, profile, snapshot };
}

export const wishLike = (w: WishlistItem): WishLike => ({ id: w.id, name: w.fields.name, price_cents: w.fields.estimated_price_cents, target_date: w.fields.target_date || null, decision_state: w.decision_state });

/** 全部「考虑中」的心愿（分页读完）。 */
export async function loadConsideringWishes(): Promise<WishLike[]> {
  const items: WishlistItem[] = [];
  for (let offset = 0; ; ) {
    const page = await invoke<WishlistPage>('list_wishlist', { query: { search: '', filter: 'considering', sort: 'created', descending: true, offset } });
    items.push(...page.items);
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  return items.map(wishLike);
}
