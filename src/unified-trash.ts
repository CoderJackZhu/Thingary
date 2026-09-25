import { maintenanceKinds } from './maintenance.ts';
import { warrantyKinds } from './warranty.ts';

export type RecordKind = 'maintenance' | 'warranty';
export type RecordTrashChange = { request_id: string; generation: string; asset_id: string; record_id: string; kind: RecordKind; expected_revision: number; deleted: boolean };
export type RecordTrashAction = { input: RecordTrashChange; meta: { title: string; assetName: string }; pending: boolean };
export const recordPendingKey = 'possio.record-trash-request.v1';
export function storedRecordTrash(): RecordTrashAction | null {
  try {
    const value = JSON.parse(localStorage.getItem(recordPendingKey) || 'null');
    if (value?.pending === true && (value.input?.kind === 'maintenance' || value.input?.kind === 'warranty') && typeof value.input?.request_id === 'string' && typeof value.input?.generation === 'string' && typeof value.input?.record_id === 'string' && typeof value.input?.asset_id === 'string' && Number.isSafeInteger(value.input?.expected_revision) && typeof value.input?.deleted === 'boolean' && typeof value.meta?.title === 'string' && typeof value.meta?.assetName === 'string') return value;
  } catch { /* A corrupt reminder must not block the trash page. */ }
  return null;
}
export const recordKindLabel: Record<RecordKind, string> = { maintenance: '维护记录', warranty: '保障记录' };

export type TrashEntry = { kind: 'asset' | RecordKind; id: string; title: string; subtype: string | null; date: string | null; end_date: string | null; cost_cents: string | null; provider: string | null; deleted_at: string; asset_id: string | null; asset_name: string | null; asset_deleted: boolean; asset_revision: number; asset_state: string | null };
export type TrashPage = { generation: string; items: TrashEntry[]; total: number };
export const stateText: Record<string, string> = { active: '使用中', retired: '已退役', sold: '已售出' };
export const trashFilters = [['all', '全部'], ['asset', '资产'], ['maintenance', '维护'], ['warranty', '保障']] as const;
const costText = (cents: string | null) => cents === null ? '待补录' : `¥${(Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Pure display facts for one unified-trash row, shared by the panel and tests.
export function entryDisplay(entry: TrashEntry): { typeLabel: string; title: string; facts: string[]; parentBlocked: boolean } {
  if (entry.kind === 'asset') return { typeLabel: '资产', title: entry.title, facts: [`原状态：${stateText[entry.asset_state ?? 'active'] ?? '使用中'}`], parentBlocked: false };
  if (entry.kind === 'maintenance') {
    const kind = maintenanceKinds.find(([k]) => k === entry.subtype)?.[1] ?? '维护';
    return { typeLabel: '维护', title: entry.title || kind, facts: [`${entry.date || '日期未知'} · 费用 ${costText(entry.cost_cents)}`], parentBlocked: entry.asset_deleted };
  }
  const kind = warrantyKinds.find(([k]) => k === entry.subtype)?.[1] ?? '保障';
  return { typeLabel: '保障', title: entry.provider ? `${kind} · ${entry.provider}` : kind, facts: [`${entry.date || '起日期未知'} – ${entry.end_date || '止日期未知'}`], parentBlocked: entry.asset_deleted };
}
