import type { Query } from './asset';
import { useRef } from 'react';
import { SortButton } from './SortHeader';
import { t } from './i18n.ts';
const columns = [
  ['name', t('物品'), 'asset-name'],
  ['date', t('购入日期'), 'purchase-date'],
  ['price', t('购入金额'), 'amount'],
  ['daily', t('日均'), 'daily-cost'],
  ['status', t('状态'), 'asset-state'],
] as const;
export function AssetListHeader({ query, onSort }: { query: Query; onSort: (change: Partial<Query>) => void }) {
  return <div className="list-head" role="group" aria-label={t('物品列表排序')}>
    {columns.map(([field, label, className]) => <SortButton key={field} field={field} label={label} className={className} sort={{ key: query.sort, descending: query.descending }} onSort={s => onSort({ sort: s.key, descending: s.descending })}/>)}
  </div>;
}

export function AssetMoreSort({ query, onSort }: { query: Query; onSort: (change: Partial<Query>) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const options = [['created', t('添加时间')], ['held', t('持有时长')]] as const;
  const active = options.find(([key]) => key === query.sort);
  return <details ref={menu} className="collection-options more-list-sort" data-popover>
    <summary>{active ? `${active[1]} ${query.descending ? '↓' : '↑'}` : t('更多排序')}</summary>
    <div className="filter-controls" role="group" aria-label={t('其他物品排序方式')}>
      {options.map(([field, label]) => <SortButton key={field} field={field} label={label} sort={{ key: query.sort, descending: query.descending }} onSort={s => {
        onSort({ sort: s.key, descending: s.descending });
        if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); }
      }}/>)}
      <p className="muted small">{t('持有时长从购入日算至今天；已售出算至售出日。购入日期未知的放最后。')}</p>
    </div>
  </details>;
}
