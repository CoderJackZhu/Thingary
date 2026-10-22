import type { Query, Page } from '../../asset.ts';
import { nextListSort } from '../../list-sort.ts';
import type { OverviewData } from '../../Overview.tsx';
export const initialQuery = (): Query => ({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all', label: null, sort: 'date', descending: true, offset: 0 });
export const sortOptions = [['date','购入日期'],['price','购入金额'],['daily','日均成本'],['status','状态'],['created','添加时间'],['held','持有时长'],['name','名称']] as const;
export function changeQuery(query: Query, change: Partial<Query>): Query { return { ...query, ...change, offset: 0 }; }
export function chooseSort(query: Query, key: string): Query { const sort=nextListSort({ key:query.sort, descending:query.descending },key); return changeQuery(query,{ sort:sort.key,descending:sort.descending }); }
/** Appending cannot combine pages from different libraries or days. Backend owns order and filtering. */
export function appendPage(previous: Page | null, next: Page, offset: number): Page {
  if (!offset) return next;
  if (!previous || previous.generation !== next.generation || previous.today !== next.today || previous.items.length !== offset) throw new Error('资料已变化，请重新加载列表。');
  const ids=new Set(previous.items.map(r=>r.asset.id));
  if(next.items.some(r=>ids.has(r.asset.id))) throw new Error('列表顺序已变化，请重新加载列表。');
  return {...next,items:[...previous.items,...next.items]};
}

export type ItemsSummary = {
  /** Sum of known purchase prices of held items (使用中 + 已退役, not sold); null when every held item has no price. */
  totalCents: string | null; unknownPriceCount: number;
  /** Held daily cost total from the shared summary; null when nothing can be computed. */
  dailyCents: string | null; dailyNotes: string[];
  heldCount: number; soldCount: number;
};
/** Header numbers of the item list, all taken from the held-scope overview so mobile and desktop agree. Unknown is never counted as 0. */
export function itemsSummary(o: OverviewData): ItemsSummary {
  const d = o.held_daily, unknownPriceCount = o.held_unknown_price_count;
  const dailyNotes = [
    d.unknown_count > 0 ? `${d.unknown_count} 件资料不全，日均仅含已知部分` : '',
    d.per_use_count > 0 ? `${d.per_use_count} 件按次` : '',
    d.excluded_count > 0 ? `${d.excluded_count} 件不计入日均` : '',
  ].filter(Boolean);
  return { totalCents: o.held_count > 0 && unknownPriceCount >= o.held_count ? null : o.held_known_cents, unknownPriceCount, dailyCents: d.known_cents, dailyNotes, heldCount: o.held_count, soldCount: o.sold_count };
}
/** "分类：全部 · 购入日期 ↓" – the current filter and sort in one line; `已筛选` when other filters apply. */
export function stateCaption(query: Query, categoryName: string): string {
  const sort = sortOptions.find(([id]) => id === query.sort)?.[1] ?? '';
  const filtered = query.warranty !== 'all' || !!query.label || query.filter.startsWith('missing');
  return `分类：${categoryName} · ${sort} ${query.descending ? '↓' : '↑'}${filtered ? ' · 已筛选' : ''}`;
}
