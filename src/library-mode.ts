export type DemoStatus = { active: boolean; available: boolean; started: boolean };
export const resetKey = 'thingary.demo-reset-request.v1';
export const sectionKey = 'thingary.library-section.v1';
/** Set when “新增物品” is used in the sample: the sample takes no new assets, so the app returns to the personal library and opens the form there. */
export const newAssetKey = 'thingary.new-asset-after-switch.v1';
export const sections = ['overview', 'stats', 'wealth', 'expenses', 'recurring', 'virtual', 'planning', 'assets', 'wishlist', 'timeline', 'trash', 'settings'] as const;
export type Section = typeof sections[number];
export function initialSection(storage: Pick<Storage, 'getItem' | 'removeItem'>): Section {
  const saved = storage.getItem(sectionKey); storage.removeItem(sectionKey);
  return sections.find(s => s === saved) ?? 'overview';
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
    if (!key?.startsWith('thingary.') || !/draft|request|pending|upload|abandon/.test(key) || key === resetKey) continue;
    try { visit(JSON.parse(storage.getItem(key) || 'null')); } catch { /* Existing recovery handlers own malformed values. */ }
  }
  return [...result];
}
