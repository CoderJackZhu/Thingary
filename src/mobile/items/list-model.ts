import type { Query, Page } from '../../asset.ts';
import { nextListSort } from '../../list-sort.ts';
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
