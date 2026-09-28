export type DemoStatus = { active: boolean; available: boolean; started: boolean };
export const resetKey = 'possio.demo-reset-request.v1';
export const sectionKey = 'possio.library-section.v1';
export const sections = ['overview', 'stats', 'wealth', 'expenses', 'recurring', 'assets', 'wishlist', 'timeline', 'materials', 'trash', 'settings'] as const;
export type Section = typeof sections[number];
export function initialSection(storage: Pick<Storage, 'getItem' | 'removeItem'>): Section {
  const saved = storage.getItem(sectionKey); storage.removeItem(sectionKey);
  return sections.find(s => s === saved) ?? 'assets';
}
/** Only durable submitted receipts participate; theme/view settings are not requests. */
export function pendingGenerations(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): string[] {
  const result = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'generation' && typeof item === 'string') result.add(item);
      else if (item && typeof item === 'object') visit(item);
    }
  };
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith('possio.') || !/draft|request|pending|upload|abandon/.test(key) || key === resetKey) continue;
    try { visit(JSON.parse(storage.getItem(key) || 'null')); } catch { /* Existing recovery handlers own malformed values. */ }
  }
  return [...result];
}
