// D19 selection rules and batch-table facts, kept pure for tests.
export type BatchRow = { id: string; name: string; revision: number; state: 'active' | 'retired' | 'sold'; price_cents: string | null; purchase_date: string | null; last_event_date: string | null; category_id: string | null; channel_id: string | null; label_id: string | null; exclude: { total: boolean; daily: boolean; statistics: boolean; timeline: boolean }; maintenance_cents: string };
export type Modifiers = { meta: boolean; shift: boolean; toggle: boolean };

/**
 * Next selection after a click. ⌘ (or select mode) toggles one item, starting
 * from the item already shown in the summary; ⇧ adds the range from the anchor.
 */
export function nextSelection(prev: string[], anchor: string | null, id: string, order: string[], mod: Modifiers, current: string | null): { ids: string[]; anchor: string } {
  if (mod.shift && anchor && order.includes(anchor) && order.includes(id)) {
    const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
    const range = order.slice(a, b + 1);
    return { ids: [...prev, ...range.filter(x => !prev.includes(x))], anchor };
  }
  const start = !prev.length && current && current !== id && mod.meta ? [current] : prev;
  return { ids: start.includes(id) ? start.filter(x => x !== id) : [...start, id], anchor: id };
}

/** Selection panel facts; unknown prices stay out of the total, never counted as 0. */
export function batchSummary(rows: BatchRow[]) {
  let total = 0n, unknown = 0;
  const states = { active: 0, retired: 0, sold: 0 };
  for (const r of rows) {
    states[r.state]++;
    if (r.price_cents === null) unknown++; else total += BigInt(r.price_cents);
  }
  return { count: rows.length, total: total.toString(), unknown, states };
}

/** Earliest date a retire/reactivate may use for this row, as the single-item rule. */
export function earliestAction(row: BatchRow): string | undefined {
  return [row.purchase_date, row.last_event_date].filter((d): d is string => !!d).sort().at(-1);
}

/** Why a row cannot take a state action, or '' when it can. */
export function stateBlock(row: BatchRow, action: 'retire' | 'activate'): string {
  if (row.state === 'sold') return '已售出 · 不适用';
  if (action === 'retire' && row.state === 'retired') return '已退役 · 不适用';
  if (action === 'activate' && row.state === 'active') return '使用中 · 不适用';
  return '';
}

export function dateError(row: BatchRow, day: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '请填写日期';
  if (day > today) return '不能晚于今天';
  const earliest = earliestAction(row);
  if (earliest && day < earliest) return `不能早于 ${earliest}`;
  return '';
}

/** Same calendar day N years later; 29 Feb falls back to 28 Feb. */
export function addYears(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${String(y + years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** D19: a batch warranty starts at purchase (today when unknown) and runs one year. */
export function warrantyDefault(row: BatchRow, today: string, years = 1) {
  const start = row.purchase_date ?? today;
  return { start, end: addYears(start, years) };
}

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
/** Status line and elapsed share for the preview column; mirrors the inclusive end day. */
export function warrantyPreview(start: string, end: string, today: string): { text: string; percent: number | null } {
  if (end < start) return { text: '结束日期早于开始日期', percent: null };
  if (today < start) return { text: `尚未开始 · ${start} 起`, percent: 0 };
  if (today > end) return { text: '已过期', percent: 100 };
  const total = dayNumber(end) - dayNumber(start) + 1, left = dayNumber(end) - dayNumber(today);
  return { text: `保障中 · 还剩 ${left} 天`, percent: Math.round(((total - left - 1) / total) * 100) };
}

/** Net cost after a sale, or null when the purchase price is unknown. */
export function saleNet(row: BatchRow, priceCents: string | null): string | null {
  if (row.price_cents === null || priceCents === null) return null;
  return (BigInt(row.price_cents) + BigInt(row.maintenance_cents) - BigInt(priceCents)).toString();
}
