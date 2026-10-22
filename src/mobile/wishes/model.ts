// 手机心愿的纯函数：筛选与排序、卡片与详情的显示数据、编辑与购入草稿。
// 业务规则全部来自 src/wishlist.ts、src/wish-save.ts、src/asset.ts，这里只做手机界面的投影。
import { emptyFields, inputMoney, localDay, validate } from '../../asset.ts';
import { NOT_SET, UNKNOWN, dayLabel, moneyText } from '../format.ts';
import type { AssetRecord, Classification, Fields, Photo, SaveAsset } from '../../asset.ts';
import { defaultPreferences, defaultWishPreferences } from '../../preferences.ts';
import { actionableAnnotations, annotationSummary } from '../../plan-annotations.ts';
import type { PlanningAnnotation } from '../../plan-basic-contract.ts';
import { wishDecisionLabel } from '../../wishlist.ts';
import type { WishlistDraft, WishlistFilter, WishlistItem, WishlistPage, WishlistQuery } from '../../wishlist.ts';
import { t } from '../../i18n.ts';
export const pageSize = 100;
export const initialQuery: WishlistQuery = { search: '', filter: 'all', sort: 'created', descending: true, offset: 0 };
export const filterItems: { id: WishlistFilter; label: string }[] = [{ id: 'all', label: t('全部') }, { id: 'considering', label: t('考虑中') }, { id: 'purchased', label: t('已购入') }, { id: 'dropped', label: t('不再考虑') }];
export const sortItems: { id: WishlistQuery['sort']; label: string }[] = [{ id: 'created', label: t('加入日期') }, { id: 'price', label: t('预计价格') }, { id: 'target', label: t('计划日期') }, { id: 'name', label: t('名称') }];

/** 换排序字段时的默认方向，与电脑端一致：计划日期与优先级升序，其余降序。 */
export const defaultDescending = (sort: WishlistQuery['sort']): boolean => !(sort === 'priority' || sort === 'target');
export function sortLabel(sort: WishlistQuery['sort'], descending: boolean): string {
  const name = sortItems.find(item => item.id === sort)?.label ?? '加入日期';
  const direction = sort === 'created' ? (descending ? '新 → 旧' : '旧 → 新') : sort === 'target' ? (descending ? '晚 → 早' : '早 → 晚') : sort === 'price' ? (descending ? '高 → 低' : '低 → 高') : descending ? '倒序' : '正序';
  return `${name} ${direction}`;
}
export const isFiltered = (query: WishlistQuery): boolean => !!query.search.trim() || query.filter !== 'all';

/** 一页一页追加：重复的 ID 以后到的为准，顺序保持服务端排序。 */
export function mergePages(loaded: WishlistItem[], next: WishlistItem[]): WishlistItem[] {
  const fresh = new Map(next.map(item => [item.id, item]));
  return [...loaded.map(item => fresh.get(item.id) ?? item), ...next.filter(item => !loaded.some(old => old.id === item.id))];
}
export const hasMore = (loaded: number, total: number): boolean => loaded < total;

/** 「考虑中」条数不含历史待核实（它们在考虑中筛选里出现，但不计入合计）。 */
export const consideringCount = (totals: Pick<WishlistPage, 'total' | 'legacy_achieved_count'>): number => Math.max(0, totals.total - totals.legacy_achieved_count);

export type SummaryParts = { count: string; amount: string; unknown: string; legacy: string; allUnknown: boolean; main: string };
/**
 * 页头「考虑中 N 条 · 预计价格合计（M 条价格未知）· 历史待核实」。结构与电脑端 wishHeaderSummary 一致，
 * 但金额用手机统一的 moneyText（整数元不带 .00），不解析电脑端文字。
 */
export function summaryParts(page: Pick<WishlistPage, 'considering_known_cents' | 'considering_unknown_count' | 'legacy_achieved_count'>, considering: number | null): SummaryParts {
  const unknownCount = page.considering_unknown_count;
  const count = `考虑中 ${considering ?? '—'} 条`;
  const amount = considering === 0 ? moneyText('0') : considering !== null && unknownCount === considering ? UNKNOWN : moneyText(page.considering_known_cents);
  const unknown = unknownCount > 0 ? `（${unknownCount} 条价格未知）` : '';
  const legacy = page.legacy_achieved_count > 0 ? `${page.legacy_achieved_count} 条历史待核实` : '';
  return { count, amount, unknown, legacy, allUnknown: considering !== null && considering > 0 && unknownCount === considering, main: `${count} · 预计价格合计 ${amount}${unknown}` };
}

export const addedDate = (item: WishlistItem): string => item.preferences?.added_date ?? localDay(new Date(item.created_at));
/** 计划日期已过只提示「考虑中」的心愿；已购入或不再考虑的不需要处理。 */
export const planOverdue = (item: WishlistItem, today: string): boolean => item.decision_state === 'considering' && !!item.fields.target_date && item.fields.target_date < today;
export function reasonSummary(note: string): string {
  const first = note.split('\n', 1)[0].trim();
  return first.length > 40 ? first.slice(0, 40) + '…' : first;
}
/** 分类名：未分类显示「未分类」；分类资料读不到时不显示，避免把未知当成未分类。 */
export function categoryName(item: WishlistItem, categories: readonly { id: string; name: string }[] | null): string | null {
  if (!item.fields.category_id) return '未分类';
  if (!categories) return null;
  return categories.find(c => c.id === item.fields.category_id)?.name ?? '未分类';
}
export type Tone = 'accent' | 'positive' | 'neutral' | 'warn';
export const stateTone = (decision: string): Tone => decision === 'purchased' ? 'positive' : decision === 'dropped' ? 'neutral' : decision === 'legacy_achieved' ? 'warn' : 'accent';

export type CardView = { id: string; name: string; state: string; tone: Tone; category: string | null; pinned: boolean; price: string | null; added: string; plan: string; overdue: boolean; reason: string; cover: Photo | null };
export function cardView(item: WishlistItem, today: string, categories: readonly { id: string; name: string }[] | null): CardView {
  const cents = item.fields.estimated_price_cents;
  return {
    id: item.id, name: item.fields.name, state: wishDecisionLabel(item.decision_state), tone: stateTone(item.decision_state), category: categoryName(item, categories),
    pinned: !!item.preferences?.pinned, price: cents === null ? null : moneyText(cents), added: dayLabel(addedDate(item), today),
    plan: item.fields.target_date ? `计划 ${dayLabel(item.fields.target_date, today)}` : `计划日期${NOT_SET}`, overdue: planOverdue(item, today), reason: reasonSummary(item.fields.notes), cover: item.cover,
  };
}
/** 列表顶部的提醒：已加载的考虑中心愿里计划日期已过的。 */
export function overdueBanner(items: WishlistItem[], today: string): { id: string; count: number; title: string; text: string } | null {
  const late = items.filter(item => planOverdue(item, today)).sort((a, b) => a.fields.target_date.localeCompare(b.fields.target_date));
  if (!late.length) return null;
  const first = late[0];
  return { id: first.id, count: late.length, title: late.length > 1 ? t('{length} 条心愿的计划日期已过', { length: late.length }) : first.fields.name, text: late.length > 1 ? t('最早的是「{name}」（{v2}），不会自动购买', { name: first.fields.name, v2: dayLabel(first.fields.target_date, today) }) : t('计划日期 {v1} 已过，不会自动购买', { v1: dayLabel(first.fields.target_date, today) }) };
}

export type DetailActions = { record: boolean; link: boolean; drop: boolean; reconsider: boolean; viewAsset: boolean; trashHint: boolean; verify: boolean };
/** 详情页各状态能做的操作，与电脑端 WishDetail 底部一致。 */
export function detailActions(item: WishlistItem): DetailActions {
  const considering = item.decision_state === 'considering', legacy = item.decision_state === 'legacy_achieved';
  const open = considering || (legacy && !item.legacy_generated_asset);
  return {
    record: open, link: open, drop: considering, reconsider: item.decision_state === 'dropped', verify: legacy,
    viewAsset: item.decision_state === 'purchased' && !!item.converted_asset && !item.converted_asset.deleted,
    trashHint: item.decision_state === 'purchased' && !!item.converted_asset?.deleted,
  };
}
export const assetStateText = (state: string): string => state === 'sold' ? '已售出' : state === 'retired' ? '已退役' : '使用中';
/** 考虑替换的物品：购入日期、状态、已有总投入（含维护金额未知的提示）。 */
export function replacementLine(record: AssetRecord, today: string = localDay()): { text: string; investment: string } {
  const costs = record.costs, unknown = costs.unknown_maintenance_count;
  const investment = moneyText(costs.total_investment_cents);
  return { text: `${record.asset.purchase_date ? dayLabel(record.asset.purchase_date, today) : '购入日期未知'} · ${assetStateText(record.lifecycle?.state ?? 'active')}`, investment: `已有总投入 ${investment}${unknown > 0 ? `（${unknown} 笔维护金额未知）` : ''}` };
}
export const linkHost = (link: string): string => { try { return new URL(link).host; } catch { return link; } };
export const decisionNoteTitle = '为什么不买';

// ---- 编辑草稿 ----
/** 分转成输入框里的元文本，不经过浮点数。 */
export function yuanText(cents: string | null): string {
  if (cents === null) return '';
  const value = BigInt(cents), whole = value / 100n, fraction = (value % 100n).toString().padStart(2, '0');
  return fraction === '00' ? whole.toString() : `${whole}.${fraction}`;
}
export function newWishDraft(generation: string, today: string): WishlistDraft {
  return { generation, fields: { name: '', category_id: null, estimated_price: '', priority: null, target_date: '', external_link: '', notes: '' }, cover: null, photoError: '', pending: null, preferences: { ...defaultWishPreferences(), added_date: today }, photos: [] };
}
/** 编辑已有心愿：与电脑端从详情进入编辑时构造的草稿相同。 */
export function editWishDraft(item: WishlistItem, generation: string): WishlistDraft {
  return { generation, item, fields: { ...item.fields, estimated_price: yuanText(item.fields.estimated_price_cents), target_date: item.fields.target_date || '' }, preferences: item.preferences ?? defaultWishPreferences(), photos: item.photos ?? (item.cover ? [item.cover] : []), cover: item.cover, photoError: '', pending: null };
}
export const legacySavings = (item: WishlistItem | undefined): boolean => item?.preferences?.mode === 'savings' && item.preferences.saved_cents !== '0';

// ---- 记录购入 ----
export type PurchaseDraft = { generation: string; wishId: string; wishRevision: number; wishName: string; estimate: string | null; fields: Fields; classification: Classification; photos: Photo[]; cover: string | null; coverNotice: string };
export function newPurchaseDraft(item: WishlistItem, generation: string, today: string, staged: Photo | null, coverNotice = ''): PurchaseDraft {
  return { generation, wishId: item.id, wishRevision: item.revision, wishName: item.fields.name, estimate: item.fields.estimated_price_cents, fields: { ...emptyFields, name: item.fields.name, date: today }, classification: { category_id: item.fields.category_id, channel_id: null }, photos: staged ? [staged] : [], cover: staged?.id ?? null, coverNotice };
}
/** 校验并构造 convert_wishlist 里的物品请求；预计价格不会被当作实付金额。 */
export function purchaseSave(draft: PurchaseDraft, today: string, requestId: string): { errors: Partial<Record<keyof Fields, string>>; input: null } | { errors: Partial<Record<keyof Fields, string>>; input: SaveAsset } {
  const errors = validate(draft.fields, today);
  if (Object.keys(errors).length) return { errors, input: null };
  const { name, price, date, ...details } = draft.fields;
  return { errors, input: { options: { preferences: defaultPreferences() }, classification: draft.classification, base: { request_id: requestId, generation: draft.generation, asset_id: null, expected_revision: null, name, price_cents: inputMoney(price), purchase_date: date || null }, details, photos: { ids: draft.photos.map(p => p.id), cover_id: draft.cover } } };
}
export const purchaseHint = (estimate: string | null): string => estimate === null ? '心愿未填预计价格。' : `预计 ${moneyText(estimate)} 仅作参考，不会当作实付金额。`;

/** 规划影响下方的覆盖说明，与电脑端 CoverageNote 的紧凑版同一口径。 */
export function planNotes(annotations: readonly PlanningAnnotation[]): string[] {
  if (!annotations.length) return [];
  const count = actionableAnnotations(annotations).length;
  return [count ? `有 ${count} 项条件待确认，详见目标页` : '有安排未计入，详见目标页', ...annotationSummary(annotations)];
}
