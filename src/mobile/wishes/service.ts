// 手机心愿的读取与写入。命令、回执核对方式与电脑端 WishDetail / WishEditor / AssetEditor 相同：
// 先把请求存成回执，再调用命令；命令失败时按 request_id 只读核对，已保存就取回结果，没保存就清掉回执，
// 核对不了就保留回执（结果未知），由页面提示核对。取消或失败不留半条记录。
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset.ts';
import type { AssetRecord, Photo, SaveAsset } from '../../asset.ts';
import type { TaxonomyEntry } from '../../taxonomy.ts';
import { wishlistDecisionKey, wishlistDraftKey } from '../../wishlist.ts';
import type { WishLink, WishPlanSave, WishVerify, WishlistChange, WishlistItem, WishlistPage, WishlistQuery } from '../../wishlist.ts';
import { loadAssetCandidates } from '../../asset-picker.ts';
import { consideringCount, pageSize } from './model.ts';
import { t } from '../../i18n.ts';
export const linkKey = 'thingary.wish-link-pending.v1';
export const verifyKey = 'thingary.wish-verify-pending.v1';
export const assetDraftKey = 'thingary.asset-draft.v1';
export const savingsKey = 'thingary.savings-pending.v1';

export type Taxonomy = { generation: string; categories: readonly TaxonomyEntry[]; channels: readonly TaxonomyEntry[] };
export const loadTaxonomy = () => invoke<Taxonomy>('taxonomy_snapshot');
export const readWish = (id: string) => invoke<WishlistItem | null>('read_wishlist', { id });
export const readAsset = (id: string) => invoke<AssetRecord | null>('read_asset', { id });
export const listWishes = (query: WishlistQuery) => invoke<WishlistPage>('list_wishlist', { query });

/** 列表和分段计数：全部、考虑中、已购入、不再考虑各读一次总数；当前筛选的那份同时作为列表内容。 */
export async function loadList(query: WishlistQuery): Promise<{ page: WishlistPage; totals: Record<'all' | 'considering' | 'purchased' | 'dropped', number>; considering: number }> {
  const base: WishlistQuery = { ...query, search: '', offset: 0 };
  const [page, all, considering, purchased, dropped] = await Promise.all([
    listWishes(query), ...(['all', 'considering', 'purchased', 'dropped'] as const).map(filter => listWishes({ ...base, filter, sort: 'created', descending: true })),
  ]);
  return { page, totals: { all: all.total, considering: considering.total, purchased: purchased.total, dropped: dropped.total }, considering: consideringCount(considering) };
}
export const loadMore = (query: WishlistQuery, loaded: number) => listWishes({ ...query, offset: loaded });
export { pageSize };

export type Candidate = Awaited<ReturnType<typeof loadAssetCandidates>>['items'][number];
export const searchAssets = loadAssetCandidates;

// ---- 回执 ----
export type Op =
  | { kind: 'decision'; input: WishlistChange; label: string }
  | { kind: 'link'; input: WishLink; label: string }
  | { kind: 'verify'; input: WishVerify; label: string }
  | { kind: 'save'; input: WishPlanSave; label: string; draft: unknown }
  | { kind: 'purchase'; input: SaveAsset; label: string; wishlistId: string; expectedRevision: number; draft: unknown };
export type Result = WishlistItem | AssetRecord;
export const opKey = (op: Op): string => op.kind === 'decision' ? wishlistDecisionKey : op.kind === 'link' ? linkKey : op.kind === 'verify' ? verifyKey : op.kind === 'save' ? wishlistDraftKey : assetDraftKey;
export const opRequest = (op: Op): string => op.kind === 'purchase' ? op.input.base.request_id : op.input.request_id;
export const opGeneration = (op: Op): string => op.kind === 'purchase' ? op.input.base.generation : op.input.generation;
/** 这笔回执作用在哪条心愿上，页面据此只在对应心愿上提示。 */
export function opWish(op: Op): string | null {
  if (op.kind === 'decision') return op.input.action.type === 'add' ? null : op.input.action.wishlist_id;
  if (op.kind === 'link' || op.kind === 'verify') return op.input.wishlist_id;
  if (op.kind === 'save') return op.input.id;
  return op.wishlistId;
}
function stored(key: string): unknown { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
function put(op: Op) {
  const value = op.kind === 'save' || op.kind === 'purchase' ? op.draft : op.input;
  try { localStorage.setItem(opKey(op), JSON.stringify(value)); } catch { throw new Error(t('无法记录本次请求，尚未提交，请检查可用空间后重试。')); }
}
export function clearOp(op: Op) { try { localStorage.removeItem(opKey(op)); } catch { /* nothing to clear */ } }
const isRequest = (value: unknown): value is { request_id: string; generation: string } => !!value && typeof value === 'object' && typeof (value as { request_id?: unknown }).request_id === 'string' && typeof (value as { generation?: unknown }).generation === 'string';

/** 重启后仍保留的回执：决定、关联、核实、保存心愿、记录购入（旧攒钱回执只读核对）。 */
export function storedOps(): Op[] {
  const out: Op[] = [];
  const decision = stored(wishlistDecisionKey) as WishlistChange | null;
  if (isRequest(decision) && decision.action && decision.action.type !== 'add' && typeof decision.action.wishlist_id === 'string') out.push({ kind: 'decision', input: decision, label: decision.action.type === 'drop' ? t('不再考虑') : decision.action.type === 'reconsider' ? t('重新考虑') : t('放弃心愿') });
  const link = stored(linkKey) as WishLink | null;
  if (isRequest(link) && typeof (link as WishLink).wishlist_id === 'string') out.push({ kind: 'link', input: link as WishLink, label: t('关联已有物品') });
  const verify = stored(verifyKey) as WishVerify | null;
  if (isRequest(verify) && typeof (verify as WishVerify).wishlist_id === 'string') out.push({ kind: 'verify', input: verify as WishVerify, label: t('核实旧记录') });
  const draft = stored(wishlistDraftKey) as { planPending?: WishPlanSave | null } | null;
  if (draft && isRequest(draft.planPending)) out.push({ kind: 'save', input: draft.planPending as WishPlanSave, label: draft.planPending.id ? t('保存心愿修改') : t('新增心愿'), draft });
  const asset = stored(assetDraftKey) as { pending?: SaveAsset | null; conversion?: { wishlist_id: string; expected_revision: number } } | null;
  if (asset?.conversion && asset.pending && isRequest(asset.pending.base)) out.push({ kind: 'purchase', input: asset.pending, label: t('记录购入'), wishlistId: asset.conversion.wishlist_id, expectedRevision: asset.conversion.expected_revision, draft: asset });
  return out;
}
export function storedSavingReceipt(wishId: string, generation: string): { request_id: string } | null {
  const value = stored(savingsKey) as { request_id?: string; generation?: string; id?: string } | null;
  return value && value.generation === generation && value.id === wishId && typeof value.request_id === 'string' ? { request_id: value.request_id } : null;
}

async function send(op: Op): Promise<Result> {
  if (op.kind === 'decision') return invoke<WishlistItem>('change_wishlist', { input: op.input });
  if (op.kind === 'link') return invoke<WishlistItem>('link_wish_asset', { input: op.input });
  if (op.kind === 'verify') return invoke<WishlistItem>('verify_legacy_wish', { input: op.input });
  if (op.kind === 'save') return invoke<WishlistItem>('save_wish_plan', { input: op.input });
  return invoke<AssetRecord>('convert_wishlist', { input: { wishlist_id: op.wishlistId, expected_revision: op.expectedRevision, asset: op.input } });
}
/** 只读核对：已保存返回结果，没保存返回 null；核对本身失败会抛出。 */
async function check(op: Op): Promise<Result | null> {
  if (op.kind === 'decision') return invoke<WishlistItem | null>('saved_wishlist_request', { input: op.input });
  if (op.kind === 'purchase') return invoke<AssetRecord | null>('saved_request', { request: op.input.base.request_id, generation: op.input.base.generation });
  return invoke<WishlistItem | null>('saved_wish_feature', { request: op.input.request_id, generation: op.input.generation });
}

export type Outcome =
  | { status: 'saved'; value: Result }
  /** 确认没有保存：回执已清除，输入仍在页面里。 */
  | { status: 'failed'; message: string }
  /** 不能确定是否保存：回执保留，页面必须暂停并提示核对。 */
  | { status: 'unknown'; message: string };

/** 提交一笔写入：先存回执，再发命令，失败时按 request_id 核对。 */
export async function submitOp(op: Op): Promise<Outcome> {
  const existing = storedOps().find(other => opKey(other) === opKey(op));
  if (existing && opRequest(existing) !== opRequest(op)) return { status: 'failed', message: t('还有一笔「{label}」的结果待核对，请先核对后再保存。', { label: existing.label }) };
  try { put(op); } catch (cause) { return { status: 'failed', message: errorMessage(cause) }; }
  try { const value = await send(op); clearOp(op); return { status: 'saved', value }; }
  catch (cause) {
    try {
      const value = await check(op);
      clearOp(op);
      return value ? { status: 'saved', value } : { status: 'failed', message: errorMessage(cause) };
    } catch { return { status: 'unknown', message: errorMessage(cause) + t(' 暂时无法确认是否已保存，原请求已保留，请核对后再继续。') }; }
  }
}

export type Settled = { status: 'saved'; value: Result } | { status: 'unsaved' } | { status: 'stale' } | { status: 'unknown'; message: string };
/** 核对一笔保留的回执（只读，不重发）。资料库已切换的回执不属于当前资料，直接放弃。 */
export async function resolveOp(op: Op, generation: string | null): Promise<Settled> {
  if (generation !== null && opGeneration(op) !== generation) { clearOp(op); return { status: 'stale' }; }
  try {
    const value = await check(op);
    clearOp(op);
    return value ? { status: 'saved', value } : { status: 'unsaved' };
  } catch (cause) { return { status: 'unknown', message: errorMessage(cause) + t(' 原请求仍保留，请稍后再核对。') }; }
}
/** 升级前的旧攒钱回执：只核对、不重放，结果按历史数据显示。 */
export async function resolveSaving(wishId: string, generation: string): Promise<'saved' | 'unsaved'> {
  const receipt = storedSavingReceipt(wishId, generation);
  if (!receipt) return 'unsaved';
  const saved = await invoke<WishlistItem | null>('saved_wish_feature', { request: receipt.request_id, generation });
  try { localStorage.removeItem(savingsKey); } catch { /* nothing to clear */ }
  return saved ? 'saved' : 'unsaved';
}

// ---- 决定、关联、核实的请求体（revision 取自当前显示的版本）----
export const dropChange = (item: WishlistItem, generation: string, note: string, requestId: string): WishlistChange => ({ request_id: requestId, generation, expected_revision: item.revision, action: { type: 'drop', wishlist_id: item.id, decision_note: note.trim() } });
export const reconsiderChange = (item: WishlistItem, generation: string, note: string, requestId: string): WishlistChange => ({ request_id: requestId, generation, expected_revision: item.revision, action: { type: 'reconsider', wishlist_id: item.id, decision_note: note.trim() } });
export const linkRequest = (item: WishlistItem, generation: string, candidate: { id: string; revision: number }, requestId: string): WishLink => ({ request_id: requestId, generation, wishlist_id: item.id, expected_revision: item.revision, asset_id: candidate.id, expected_asset_revision: candidate.revision });
export const verifyRequest = (item: WishlistItem, generation: string, outcome: WishVerify['outcome'], note: string, patch: WishVerify['asset_patch'], requestId: string): WishVerify => ({ request_id: requestId, generation, wishlist_id: item.id, expected_revision: item.revision, outcome, decision_note: note.trim(), asset_patch: patch });
/** 保存心愿时同时写入电脑端格式的草稿回执（含 planPending），重启后可核对。 */
export const saveDraft = (draft: object, input: WishPlanSave) => ({ ...draft, planPending: input });
/** 记录购入的回执沿用电脑端物品草稿格式。 */
export const purchaseDraft = (parts: { generation: string; fields: unknown; classification: unknown; photos: Photo[]; cover: string | null; wishId: string; wishRevision: number; wishName: string; estimate: string | null }, input: SaveAsset) => ({
  fields: parts.fields, original: parts.fields, classification: parts.classification, originalClassification: parts.classification, photos: parts.photos, cover: parts.cover, originalMedia: { photos: parts.photos, cover: parts.cover }, photoError: '', generation: parts.generation, id: null, revision: null, pending: input,
  conversion: { wishlist_id: parts.wishId, expected_revision: parts.wishRevision, wish_name: parts.wishName, estimated_price_cents: parts.estimate },
});
