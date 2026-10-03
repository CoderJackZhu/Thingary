import { errorMessage, type AssetRecord, type Photo, type Selection } from "./asset.ts";

export const warrantyKinds = [
  ["manufacturer", "厂家保修"], ["extended", "延保"], ["applecare", "AppleCare"],
  ["store", "商店保修"], ["other", "其他保障"],
] as const;
export type WarrantyKind = typeof warrantyKinds[number][0];
export interface WarrantyFields { kind: WarrantyKind; provider: string; start_date: string | null; end_date: string | null; notes: string }
export type WarrantyStatus = "pending" | "upcoming" | "active" | "expiring" | "expired";
export type WarrantySummaryStatus = "none" | "covered" | "expiring_soon" | "not_covered";
export interface Warranty { reminder?:{date:string;notes:string}|null; id: string; fields: WarrantyFields; status: WarrantyStatus; remaining_days: number | null; photos: Photo[]; created_at: string; updated_at: string }
export interface WarrantySummary { status: WarrantySummaryStatus; total: number; active_count: number; expiring_count: number; upcoming_count: number; expired_count: number; pending_count: number }
export interface WarrantyDraft { reminder?:{date:string;notes:string}|null; kind: WarrantyKind; provider: string; start: string; end: string; notes: string; photo_ids: string[] }
export interface WarrantyChange {reminder?:{value:{date:string;notes:string}|null}; request_id: string; generation: string; asset_id: string; expected_revision: number; action: { type: "add"; fields: WarrantyFields; photos: Selection } | { type: "correct"; warranty_id: string; fields: WarrantyFields; photos: Selection } }
export interface WarrantyState { record: AssetRecord; generation: string; warranty_id?: string; fields: WarrantyDraft; original: WarrantyDraft; photos: Photo[]; pending: WarrantyChange | null }

export const blankWarranty = (): WarrantyDraft => ({ kind: "manufacturer", provider: "", start: "", end: "", notes: "", photo_ids: [] });
export const warrantyKey = "possio.warranty-draft.v1";
export function storedWarranty(): WarrantyState | null {
  try {
    const value = JSON.parse(localStorage.getItem(warrantyKey) || "null") as WarrantyState | null;
    if (value && typeof value.generation === "string" && typeof value.record?.asset?.id === "string" && Array.isArray(value.photos) && typeof value.fields?.provider === "string" && typeof value.original?.provider === "string") return value;
  } catch { /* Invalid local draft must not prevent startup. */ }
  return null;
}
export type WarrantyIssue = { kind: "blocked" | "pending" | "conflict"; message: string; latest?: AssetRecord };
export type WarrantySession = { kind: "edit"; state: WarrantyState; issue: WarrantyIssue | null };
export type WarrantyRecoveryResult = WarrantySession | { kind: "saved"; record: AssetRecord };

// Same rule set as the Rust derive_status: both dates known and start<=today<=end
// is the only way to confirm current coverage; 0–30 remaining days (inclusive)
// counts as near expiry; unknown dates never read as covered.
export function deriveStatus(start: string | null, end: string | null, today: string): { status: WarrantyStatus; remaining_days: number | null } {
  if (!start || !end) return { status: "pending", remaining_days: null };
  if (start > today) return { status: "upcoming", remaining_days: null };
  if (end < today) return { status: "expired", remaining_days: null };
  // Date-only strings compared at UTC midnight: exact calendar days, no local DST drift.
  const remaining = Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  return remaining <= 30 ? { status: "expiring", remaining_days: remaining } : { status: "active", remaining_days: remaining };
}

export function summarizeWarranties(items: { fields: { start_date: string | null; end_date: string | null } }[], today: string): WarrantySummary {
  const summary: WarrantySummary = { status: "none", total: items.length, active_count: 0, expiring_count: 0, upcoming_count: 0, expired_count: 0, pending_count: 0 };
  for (const item of items) {
    const status = deriveStatus(item.fields.start_date, item.fields.end_date, today).status;
    summary[`${status}_count`]++;
  }
  summary.status = summary.total === 0 ? "none" : summary.active_count > 0 ? "covered" : summary.expiring_count > 0 ? "expiring_soon" : "not_covered";
  return summary;
}

export const statusLabel: Record<WarrantyStatus, string> = { pending: "日期待补全", upcoming: "尚未生效", active: "保障中", expiring: "即将到期", expired: "已到期" };
export function warrantySummaryText(summary: WarrantySummary): string {
  if (summary.status === "none") return "还没有保障记录";
  if (summary.status === "covered") return summary.expiring_count > 0 ? `保障中，${summary.expiring_count} 份即将到期` : "保障中";
  if (summary.status === "expiring_soon") return `即将到期（${summary.expiring_count} 份）`;
  const facts = [
    summary.upcoming_count > 0 ? `${summary.upcoming_count} 份尚未生效` : "",
    summary.expired_count > 0 ? `${summary.expired_count} 份已到期` : "",
    summary.pending_count > 0 ? `${summary.pending_count} 份日期待补全` : "",
  ].filter(Boolean).join("，");
  return `当前无有效保障${facts ? `（${facts}）` : ""}`;
}

// Read-only recovery: never retarget an old request or silently accept a newer revision.
export async function recoverWarranty(
  saved: WarrantyState, generation: string,
  read: (id: string) => Promise<AssetRecord | null>,
  receipt: (request: string, generation: string) => Promise<AssetRecord | null>,
): Promise<WarrantyRecoveryResult> {
  let state = saved;
  const blocked = (message: string): WarrantySession => ({ kind: "edit", state, issue: { kind: "blocked", message } });
  if (state.generation !== generation) return blocked("资料库已切换。这份草稿及原请求仍保留，不能提交到当前资料库；可保留草稿并关闭，切回原资料库后再核对。");
  if (state.pending) {
    const expected = warrantyChange(state.record, state.generation, state.fields, state.warranty_id, state.pending.request_id);
    if (JSON.stringify(expected) !== JSON.stringify(state.pending)) return blocked("暂存请求与草稿不一致，已停止提交。原始输入保留，请核对资料后处理。");
    try {
      const result = await receipt(state.pending.request_id, state.generation);
      if (result) return result.asset.id === state.record.asset.id ? { kind: "saved", record: result } : blocked("回执中的物品与草稿不一致，已停止恢复。");
      state = { ...state, pending: null };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "STALE_DATASET") return blocked("资料库已切换，原请求仍保留；请切回原资料库后核对，或保留草稿并关闭。");
      return { kind: "edit", state, issue: { kind: "pending", message: errorMessage(error) + " 原请求与输入已保留，请稍后核对。" } };
    }
  }
  const latest = await read(state.record.asset.id);
  if (!latest || latest.deleted || latest.asset.id !== state.record.asset.id) return blocked("原物品已删除或不可用。输入仍保留，请恢复原物品后重试；不会把草稿转存到其他物品。");
  if (state.warranty_id && !(latest.warranties ?? []).some(item => item.id === state.warranty_id)) return blocked("原保障记录已不可用。输入仍保留，请恢复原记录后重试；不会自动改成新增。");
  if (latest.asset.revision !== state.record.asset.revision) return { kind: "edit", state, issue: { kind: "conflict", latest, message: "物品已更新。请核对当前记录，再明确确认是否保留你的输入；尚未替换草稿版本。" } };
  return { kind: "edit", state: { ...state, record: latest }, issue: null };
}

export function warrantyDraft(record: AssetRecord, warrantyId?: string): WarrantyDraft {
  const w = (record.warranties ?? []).find(x => x.id === warrantyId);
  return w ? { reminder:w.reminder??null, kind: w.fields.kind, provider: w.fields.provider, start: w.fields.start_date ?? "", end: w.fields.end_date ?? "", notes: w.fields.notes, photo_ids: w.photos.map(p => p.id) } : blankWarranty();
}
const validDay = (value: string) => {
  const parsed = new Date(value + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export function validateWarranty(d: WarrantyDraft): string | null {
  if (!warrantyKinds.some(([k]) => k === d.kind)) return "请选择保障类型";
  if ([...d.provider.trim()].length > 200 || [...d.notes].length > 10000 || [d.provider, d.notes].some(v => v.includes("\0"))) return "提供方最多 200 字，备注最多 10000 字，且不能含空字符";
  if (d.start && !validDay(d.start)) return "开始日期格式应为 YYYY-MM-DD";
  if (d.end && !validDay(d.end)) return "结束日期格式应为 YYYY-MM-DD";
  // Warranties may start or end in the future; only a reversed pair is invalid.
  if (d.start && d.end && d.end < d.start) return "保障结束日期不能早于开始日期";
  return null;
}
export function warrantyChange(record: AssetRecord, generation: string, d: WarrantyDraft, warrantyId?: string, requestId: string = crypto.randomUUID()): WarrantyChange {
  const fields: WarrantyFields = { kind: d.kind, provider: d.provider.trim(), start_date: d.start || null, end_date: d.end || null, notes: d.notes };
  const photos = { ids: d.photo_ids, cover_id: null };
  return { reminder:{value:d.reminder??null}, request_id: requestId, generation, asset_id: record.asset.id, expected_revision: record.asset.revision, action: warrantyId ? { type: "correct", warranty_id: warrantyId, fields, photos } : { type: "add", fields, photos } };
}
