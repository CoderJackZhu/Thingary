import { inputMoney } from './asset.ts';
import type { Photo } from './asset.ts';

export type WishlistPriority = 'high' | 'medium' | 'low' | null;
export type WishlistStatus = 'ongoing' | 'achieved' | 'abandoned';
export type WishlistFilter = 'all' | WishlistStatus;
export type WishlistFields = { name: string; category_id: string | null; estimated_price: string; priority: WishlistPriority; target_date: string; external_link: string; notes: string };
export type WishlistItem = { preferences?: import("./preferences").WishPreferences; photos?:Photo[]; id: string; fields: Omit<WishlistFields, 'estimated_price'> & { estimated_price_cents: string | null }; status: WishlistStatus; revision: number; created_at: string; updated_at: string; abandoned_at: string | null; achieved_at: string | null; converted_asset: { id: string; name: string; deleted: boolean } | null; cover: Photo | null };
export type WishlistQuery = { search: string; filter: WishlistFilter; sort: 'created' | 'priority' | 'price' | 'target'; descending: boolean; offset: number };
export type WishlistPage = { generation: string; items: WishlistItem[]; total: number; ongoing_known_cents: string; ongoing_unknown_count: number };
export type WishlistChange = { request_id: string; generation: string; expected_revision: number | null; action: { type: 'add'; fields: { name: string; category_id: string | null; estimated_price_cents: string | null; priority: WishlistPriority; target_date: string | null; external_link: string; notes: string }; cover: { ids: string[]; cover_id: string | null } } | { type: 'abandon'; wishlist_id: string } };
export type WishlistDraft = { transientCover?:string; item?:WishlistItem; preferences?:import("./preferences").WishPreferences; photos?:Photo[]; statusIntent?:'preserve'|'manual'|'ongoing'; achievedDate?:string; planPending?:WishPlanSave|null; generation: string; fields: WishlistFields; cover: Photo | null; photoError: string; pending: WishlistChange | null };

export const wishlistDraftKey = 'thingary.wishlist-draft.v1';
export const wishlistAbandonKey = 'thingary.wishlist-abandon.v1';
export const emptyWishlistFields: WishlistFields = { name: '', category_id: null, estimated_price: '', priority: null, target_date: '', external_link: '', notes: '' };

export function wishlistBlocksApp(state: { editor: WishlistDraft | null; recovered: WishlistDraft | null; abandon: WishlistItem | null; abandonRecovery: WishlistChange | null }): boolean {
  return !!(state.editor || state.recovered || state.abandon || state.abandonRecovery);
}

function isWishlistChange(value: unknown): value is WishlistChange {
  if (!value || typeof value !== 'object') return false;
  const input = value as Partial<WishlistChange>;
  if (typeof input.request_id !== 'string' || typeof input.generation !== 'string' || !input.action || typeof input.action !== 'object') return false;
  if (input.action.type === 'abandon') return typeof input.action.wishlist_id === 'string' && typeof input.expected_revision === 'number';
  if (input.action.type !== 'add' || input.expected_revision !== null) return false;
  const fields = input.action.fields;
  const cover = input.action.cover;
  return !!fields && typeof fields.name === 'string' && typeof fields.external_link === 'string' && typeof fields.notes === 'string'
    && !!cover && Array.isArray(cover.ids) && cover.ids.every(id => typeof id === 'string') && (cover.cover_id === null || typeof cover.cover_id === 'string');
}

export function storedWishlistChange(storage: Pick<Storage, 'getItem'>, key: string): WishlistChange | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || 'null');
    return isWishlistChange(value) ? value : null;
  } catch { return null; }
}

export function validateWishlist(fields: WishlistFields): Partial<Record<keyof WishlistFields, string>> {
  const errors: Partial<Record<keyof WishlistFields, string>> = {};
  if (!fields.name.trim() || [...fields.name.trim()].length > 200) errors.name = '请填写名称，最多 200 字。';
  try { inputMoney(fields.estimated_price); } catch (e) { errors.estimated_price = (e as Error).message; }
  if (fields.target_date) {
    const parsed = new Date(fields.target_date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.target_date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fields.target_date || fields.target_date < '1900-01-01') errors.target_date = '请输入有效日期，格式为 YYYY-MM-DD。';
  }
  if (![null, 'high', 'medium', 'low'].includes(fields.priority)) errors.priority = '请选择有效优先级。';
  if ([...fields.external_link].length > 2048 || fields.external_link.includes('\0')) errors.external_link = '链接最多 2048 字，且不能含空字符。';
  else if (fields.external_link.trim() && !/^https?:\/\//.test(fields.external_link.trim())) errors.external_link = '链接须以 http:// 或 https:// 开头。';
  if ([...fields.notes].length > 10000 || fields.notes.includes('\0')) errors.notes = '备注最多 10000 字，且不能含空字符。';
  return errors;
}

export function wishlistChange(draft: WishlistDraft): WishlistChange {
  return { request_id: crypto.randomUUID(), generation: draft.generation, expected_revision: null, action: { type: 'add', fields: { name: draft.fields.name, category_id: draft.fields.category_id, estimated_price_cents: inputMoney(draft.fields.estimated_price), priority: draft.fields.priority, target_date: draft.fields.target_date || null, external_link: draft.fields.external_link, notes: draft.fields.notes }, cover: { ids: draft.cover ? [draft.cover.id] : [], cover_id: draft.cover?.id ?? null } } };
}

export function storedWishlistDraft(storage: Pick<Storage, 'getItem'>): WishlistDraft | null {
  try {
    const value = JSON.parse(storage.getItem(wishlistDraftKey) || 'null');
    if (!value || typeof value.generation !== 'string' || typeof value.fields?.name !== 'string' || typeof value.fields?.estimated_price !== 'string' || typeof value.fields?.target_date !== 'string' || typeof value.fields?.external_link !== 'string' || typeof value.fields?.notes !== 'string') return null;
    if (value.pending !== null && (!isWishlistChange(value.pending) || value.pending.generation !== value.generation)) return null;
    return value;
  } catch { return null; }
}

export type WishPlanSave={request_id:string;generation:string;id:string|null;expected_revision:number|null;fields:WishlistChange['action'] extends never ? never : {name:string;category_id:string|null;estimated_price_cents:string|null;priority:WishlistPriority;target_date:string|null;external_link:string;notes:string};preferences:import('./preferences').WishPreferences;photos:{ids:string[];cover_id:string|null};status_intent:'preserve'|'manual'|'ongoing';achieved_date:string|null};
