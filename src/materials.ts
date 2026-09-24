// Built-in material library (D13) plus user-uploaded materials (schema 9).
// The built-in catalog is kept in sync with src-tauri/materials/materials.json
// and the embedded PNGs by tests on both sides; extending the library only
// adds entries and artwork, never form logic.
import { objectArt } from './illustrations.ts';
export type Material = { id: string; name: string };
export type MaterialEntry = { id: string; name: string; builtin: boolean };
export const MATERIALS: Material[] = [
  { id: 'laptop', name: '电脑' },
  { id: 'camera', name: '相机' },
  { id: 'headphones', name: '耳机' },
  { id: 'phone', name: '手机' },
  { id: 'tablet', name: '平板' },
  { id: 'keyboard', name: '键盘' },
  { id: 'coffee', name: '咖啡机' },
  { id: 'box', name: '通用物品' }
];
export function materialOf(id: string | null): Material | null { return id ? MATERIALS.find(m => m.id === id) ?? null : null; }
export function materialArt(id: string): string { return objectArt(materialOf(id) ? id : 'box'); }
export function materialPhotoName(material: Material): string { return `${material.name}示意图（非实物照片）`; }
// The action label for picking a library tile; built-ins stay marked as
// illustrations so the choice never claims to be a real photo.
export function materialActionLabel(entry: MaterialEntry): string {
  return entry.builtin ? `添加素材：${entry.name}（示意图，非实物照片）` : `添加素材：${entry.name}`;
}
