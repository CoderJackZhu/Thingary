/** Select labels by their actual horizontal bounds; data points remain untouched. */
export function spacedLabels<T>(items: T[], x: (item: T) => number, width: (item: T) => number, gap = 8): T[] {
  if (!items.length) return [];
  const selected: T[] = [items.at(-1)!];
  let left = x(selected[0]) - width(selected[0]) / 2;
  for (let i = items.length - 2; i >= 0; i--) {
    const item = items[i], half = width(item) / 2;
    if (x(item) + half + gap <= left) { selected.push(item); left = x(item) - half; }
  }
  return selected.reverse();
}
