// 规划数据的读取（IPC）：目标页与心愿详情共用。纯计算在 plan-retire-calc.ts / plan-wishes.ts。
import { invoke } from '@tauri-apps/api/core';
import type { Income, PlanReview, ProfileState, PlanningSources } from './plan';
import type { Snapshot } from './wealth';
import type { WishlistItem, WishlistPage } from './wishlist';
import type { WishLike } from './plan-wishes';
import { readPlanningSources } from './planning-service.ts';
import type { Modules } from './modules.ts';

export type PlanContext = { review: PlanReview | null; incomes: Income[]; profile: ProfileState; snapshot: Snapshot | null; sources: PlanningSources };

/** Atomic sources; hidden wealth is never requested. History can fail independently. */
export async function loadPlanContext(): Promise<PlanContext> {
  const modules = await invoke<Modules>('modules_get');
  const sources = await readPlanningSources(modules);
  if (sources.profile.status === 'error') throw sources.profile.value;
  if (!sources.profile.value.saved?.profile.retire.basic && (sources.review.status === 'error' || sources.snapshot.status === 'error')) throw new Error('原规划来源尚未齐全');
  return { sources, profile: sources.profile.value, review: sources.review.status === 'ready' ? sources.review.value : null, incomes: sources.incomes.status === 'ready' ? sources.incomes.value : [], snapshot: sources.snapshot.status === 'ready' ? sources.snapshot.value : null };
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
