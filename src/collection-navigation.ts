import type { Query } from './asset';

export const collectionStatusOptions = [
  ['all', '全部'], ['active', '使用中'], ['retired', '已退役'], ['sold', '已售出'],
] as const;

/** The existing single filter also carries missing-information scopes. */
export function collectionNavigation(query: Pick<Query, 'filter' | 'warranty'>) {
  const selected = collectionStatusOptions.find(([filter]) => filter === query.filter)?.[0] ?? null;
  const title = selected === 'active' ? '使用中'
    : selected === 'retired' ? '已退役'
      : selected === 'sold' ? '已售出'
        : selected === 'all' && query.warranty === 'covered' ? '保障中' : '全部物品';
  return { selected, title };
}
