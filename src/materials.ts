import catalog from '../src-tauri/materials/materials.json' with { type: 'json' };
import { objectArt } from './illustrations.ts';
export type Material = { id: string; name: string; style: string; category: string; keywords: string; shape?: string; art?: string; hidden?: boolean };
export type MaterialEntry = { id: string; name: string; builtin: boolean };
export const MATERIALS: Material[] = catalog;
export const materialCategories = ['全部', '通用', '数码', '家电', '家居', '办公', '交通', '运动', '厨具'] as const;
export type MaterialSource = 'icon' | 'dimensional' | 'recent' | 'custom';
export function materialOf(id: string | null): Material | null { return id ? MATERIALS.find(m => m.id === id) ?? null : null; }
export function materialArt(id: string): string {
  const m = materialOf(id);
  if (m?.art) return m.art;
  if (!m?.shape) return objectArt(m?.id ?? 'box');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" rx="18" fill="#eef3f7"/><g transform="translate(8 8)" fill="none" stroke="#48627d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${m.shape}</g></svg>`;
}
export function materialPhotoName(material: { name: string }): string { return `${material.name}示意图（非实物照片）`; }
export function materialActionLabel(entry: MaterialEntry): string {
  return entry.builtin ? `添加素材：${entry.name}（示意图，非实物照片）` : `添加素材：${entry.name}`;
}
export function filterMaterials(entries: MaterialEntry[], source: MaterialSource, category: string, search: string, recent: string[]) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => {
    const info = materialOf(entry.id);
    const matchesSource = source === 'recent' ? recent.includes(entry.id) : source === 'custom' ? !entry.builtin : entry.builtin && !info?.hidden && info?.style === source;
    return matchesSource && (category === '全部' || info?.category === category) && (!query || `${entry.name} ${info?.keywords ?? ''}`.toLocaleLowerCase().includes(query));
  });
  const frequent=['icon-phone','icon-laptop','icon-tablet','icon-desktop','icon-watch','icon-headphones','icon-camera','icon-keyboard','icon-mouse'];
  const rank=(id:string)=>{const i=frequent.indexOf(id);return i<0?(id==='coffee'?1000:100):i};
  return source === 'recent' ? filtered.sort((a,b)=>recent.indexOf(a.id)-recent.indexOf(b.id)) : filtered.sort((a,b)=>rank(a.id)-rank(b.id));
}
export function readRecentMaterials(storage: Pick<Storage, 'getItem'>, generation: string): string[] {
  try { const value: unknown = JSON.parse(storage.getItem('thingary.recent-materials.' + generation) || '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 24) : []; } catch { return []; }
}
export function rememberMaterial(storage: Pick<Storage, 'getItem' | 'setItem'>, generation: string, id: string) {
  storage.setItem('thingary.recent-materials.' + generation, JSON.stringify([id, ...readRecentMaterials(storage, generation).filter(x => x !== id)].slice(0, 24)));
}
