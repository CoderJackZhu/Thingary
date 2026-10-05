import { invoke } from '@tauri-apps/api/core';
import type { AssetRecord } from './asset';

/** 物品候选：按稳定 ID、名称与购入日期区分同名记录（§6.2、§7.1）。 */
export type AssetCandidate = { id: string; name: string; purchase_date: string | null; state: string; revision: number; own?: boolean };
export type AssetCandidatePage = { items: AssetCandidate[]; nextOffset: number | null };

/**
 * 服务端搜索一页在册物品（100/页，nextOffset 续读）；own 物品可按稳定 ID
 * 独立补读且不截断其余结果，已删除物品需先恢复才可选择。
 */
export async function loadAssetCandidates(legacyId: string | null, search: string, offset = 0): Promise<AssetCandidatePage> {
  const page = await invoke<{ items: AssetRecord[]; total: number }>('list_assets', { query: { search: search.trim(), filter: 'all', category: { mode: 'all' }, sort: 'created', descending: true, offset, warranty: 'all', label: null } });
  const candidate = (r: AssetRecord): AssetCandidate => ({ id: r.asset.id, name: r.asset.name, purchase_date: r.asset.purchase_date, state: r.lifecycle?.state ?? 'active', revision: r.asset.revision, own: r.asset.id === legacyId });
  const items = page.items.filter(r => !r.deleted).map(candidate);
  if (offset === 0 && legacyId && !items.some(c => c.id === legacyId)) {
    const record = await invoke<AssetRecord | null>('read_asset', { id: legacyId });
    if (record && !record.deleted && (!search.trim() || record.asset.name.toLowerCase().includes(search.trim().toLowerCase()))) items.unshift(candidate(record));
  }
  const next = offset + page.items.length;
  return { items: items.sort((a, b) => Number(b.own ?? false) - Number(a.own ?? false)), nextOffset: page.items.length && next < page.total ? next : null };
}

export const assetStateLabel = (state: string): string => state === 'sold' ? '已售出' : state === 'retired' ? '已退役' : '使用中';
