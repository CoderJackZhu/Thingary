// 分类分布的呈现顺序：圆环和下方表格共用同一份，都按当前口径从高到低。
// 后端按分类位置返回（见 Rust `overview`），那是设置里的分类顺序，与多少件、多少钱无关；
// 口径切换只改大小和占比、不改顺序，就会让"按数量／按购入金额"看起来没有生效。
// 颜色仍取自分类自身的 slot，不随排序改变，所以同一分类在两种口径下都是同一个颜色。

export type ShareMetric = 'count' | 'amount';
export type ShareRow = { id: string | null; name: string; count: number; known_cents: string };

/** 当前口径下的排序值。金额未知不计入金额合计，按 0 参与排序，落在末位而不是当作有无。 */
export function shareValue(row: ShareRow, metric: ShareMetric): number {
  return metric === 'count' ? row.count : Number(row.known_cents);
}

/** 从高到低；同值先比另一口径，再按稳定 ID 排列（与列表排序一致，且不随系统语言变化）。不改写传入数组。 */
export function sortByShare<T extends ShareRow>(rows: readonly T[], metric: ShareMetric): T[] {
  const other: ShareMetric = metric === 'count' ? 'amount' : 'count';
  return rows.slice().sort((a, b) =>
    shareValue(b, metric) - shareValue(a, metric)
    || shareValue(b, other) - shareValue(a, other)
    || (a.id ?? a.name).localeCompare(b.id ?? b.name));
}