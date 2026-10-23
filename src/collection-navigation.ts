import type { Query } from './asset';
import { t } from './i18n.ts';
export const collectionStatusOptions = [
  ['all', t('全部')], ['active', t('使用中')], ['retired', t('已退役')], ['sold', t('已售出')],
] as const;

/** The existing single filter also carries missing-information scopes. */
export function collectionNavigation(query: Pick<Query, 'filter' | 'warranty'>) {
  const selected = collectionStatusOptions.find(([filter]) => filter === query.filter)?.[0] ?? null;
  const title = selected === 'active' ? t('使用中')
    : selected === 'retired' ? t('已退役')
      : selected === 'sold' ? t('已售出')
        : selected === 'all' && query.warranty === 'covered' ? t('保障中') : t('全部物品');
  return { selected, title };
}
