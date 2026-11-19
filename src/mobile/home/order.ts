/** Presentation preference only: never stored in the library or its backups. */
export const homeOrderKey = 'thingary.mobile.home-order.v1';
export const defaultHomeOrder = ['net', 'plan', 'pending', 'daily', 'recent'] as const;
const previousDefaultHomeOrders = [
  ['net', 'plan', 'daily', 'pending', 'recent'],
  ['pending', 'net', 'plan', 'daily', 'recent'],
] as const;
export type HomeBlockId = typeof defaultHomeOrder[number];
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeHomeOrder(value: unknown): HomeBlockId[] {
  const known = (id: unknown): id is HomeBlockId => defaultHomeOrder.includes(id as HomeBlockId);
  return [...new Set([...(Array.isArray(value) ? value.filter(known) : []), ...defaultHomeOrder])];
}
export function readHomeOrder(storage: Store | null): HomeBlockId[] {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(homeOrderKey) ?? 'null');
    // Move untouched defaults (including the old 待处理-first order) to the
    // current action-before-metric order; a deliberate custom order stays as-is.
    if (Array.isArray(stored) && previousDefaultHomeOrders.some(order => stored.length === order.length && stored.every((id, index) => id === order[index]))) return [...defaultHomeOrder];
    return normalizeHomeOrder(stored);
  }
  catch { return [...defaultHomeOrder]; }
}
export function writeHomeOrder(storage: Store | null, order: readonly HomeBlockId[]): boolean {
  try { if (!storage) return false; storage.setItem(homeOrderKey, JSON.stringify(normalizeHomeOrder(order))); return true; }
  catch { return false; }
}
export function moveHomeBlock(order: readonly HomeBlockId[], from: HomeBlockId, to: HomeBlockId): HomeBlockId[] {
  const next = [...order], start = next.indexOf(from), end = next.indexOf(to);
  if (start < 0 || end < 0 || start === end) return next;
  next.splice(start, 1); next.splice(end, 0, from);
  return next;
}
/** Only the blocks the current modules provide, in the saved order; unknown or closed IDs stay in the stored preference. */
export function orderHomeBlocks<T extends { id: HomeBlockId }>(blocks: readonly T[], order: readonly HomeBlockId[]): T[] {
  return order.flatMap(id => { const block = blocks.find(item => item.id === id); return block ? [block] : []; });
}
