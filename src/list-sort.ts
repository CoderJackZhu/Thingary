export type ListSort = { key: string; descending: boolean };
export type SortValue = string | number | bigint | null | undefined;
export function nextListSort(sort: ListSort, key: string): ListSort {
  return { key, descending: sort.key === key ? !sort.descending : false };
}
export const moneySortValue = (cents: string | null | undefined): bigint | null => cents == null ? null : BigInt(cents);
/** Unknown values stay last in both directions. Never mutate ledger rows or the input array. */
export function sortRecords<T>(rows: readonly T[], sort: ListSort, value: (row: T, key: string) => SortValue, id: (row: T) => string, pinned?: (row: T) => boolean): T[] {
  return rows.slice().sort((a, b) => {
    const pin = Number(pinned?.(b) ?? false) - Number(pinned?.(a) ?? false);
    if (pin) return pin;
    let x = value(a, sort.key), y = value(b, sort.key);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    if (typeof x === 'string') x = x.toLowerCase();
    if (typeof y === 'string') y = y.toLowerCase();
    const order = x == null || y == null ? 0 : x < y ? -1 : x > y ? 1 : 0;
    return order * (sort.descending ? -1 : 1) || id(a).localeCompare(id(b));
  });
}
