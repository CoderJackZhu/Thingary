/** Presentation preference only: never stored in the library or its backups. */
export const homeOrderKey = 'thingary.mobile.home-order.v1';
export const defaultHomeOrder = ['net', 'plan', 'daily', 'pending', 'recent'] as const;
export type HomeBlockId = typeof defaultHomeOrder[number];
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeHomeOrder(value: unknown): HomeBlockId[] {
  const known = (id: unknown): id is HomeBlockId => defaultHomeOrder.includes(id as HomeBlockId);
  return [...new Set([...(Array.isArray(value) ? value.filter(known) : []), ...defaultHomeOrder])];
}
export function readHomeOrder(storage: Store | null): HomeBlockId[] {
  try { return normalizeHomeOrder(JSON.parse(storage?.getItem(homeOrderKey) ?? 'null')); }
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
