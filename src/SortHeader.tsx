import { nextListSort, type ListSort } from './list-sort';

type Props = { field: string; label: string; sort: ListSort; onSort: (sort: ListSort) => void; className?: string; sortLabel?: string };
export function SortButton({ field, label, sort, onSort, className = '', sortLabel = label }: Props) {
  const active = sort.key === field, next = nextListSort(sort, field);
  const current = active ? sort.descending ? '降序' : '升序' : '未排序';
  const action = `点击按${next.descending ? '降序' : '升序'}排列`;
  return <button type="button" className={`column-sort ${className}`} aria-pressed={active} aria-label={`按${sortLabel}排序，${current}；${action}`} title={`${sortLabel}：${current}，${action}`} onClick={() => onSort(next)}>
    {label}<span className="column-sort-arrow" aria-hidden="true">{active ? sort.descending ? '↓' : '↑' : '↕'}</span>
  </button>;
}
export function SortHeader(props: Props) {
  return <th scope="col" aria-sort={props.sort.key === props.field ? props.sort.descending ? 'descending' : 'ascending' : 'none'}><SortButton {...props}/></th>;
}
