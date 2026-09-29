import { errorMessage, inputMoney, yuan, type AssetRecord, type Photo, type Selection } from "./asset.ts";

export const maintenanceKinds = [
  ["repair", "维修"], ["service", "保养"], ["cleaning", "清洁"],
  ["replacement", "换件"], ["upgrade", "升级"], ["other", "其他"],
] as const;
export type MaintenanceKind = typeof maintenanceKinds[number][0];
export interface MaintenanceFields { date: string | null; kind: MaintenanceKind; title: string; description: string; cost_cents: string | null; provider: string }
export interface Maintenance { id: string; fields: MaintenanceFields; created_at: string; updated_at: string; photos: Photo[] }
export interface CostSummary { known_maintenance_cents: string; unknown_maintenance_count: number; total_investment_cents: string | null; sale_proceeds_cents: string | null; net_cost_cents: string | null; held_days: number | null; daily_cents: string | null }
export interface MaintenanceDraft extends Omit<MaintenanceFields,"cost_cents"> { cost: string; photo_ids: string[] }
export interface MaintenanceChange { request_id: string; generation: string; asset_id: string; expected_revision: number; action: { type:"add"; fields:MaintenanceFields; photos:Selection } | { type:"correct"; maintenance_id:string; fields:MaintenanceFields; photos:Selection } }
export interface MaintenanceState { record: AssetRecord; generation: string; maintenance_id?: string; fields: MaintenanceDraft; original: MaintenanceDraft; photos: Photo[]; pending: MaintenanceChange | null }

export const blankMaintenance = (): MaintenanceDraft => ({ date:null, kind:"repair", title:"", description:"", cost:"", provider:"", photo_ids:[] });
export const draftKey = (assetId:string, maintenanceId?:string) => `possio:maintenance:${assetId}:${maintenanceId ?? "new"}`;
export const maintenanceKey = "possio.maintenance-draft.v1";
export function storedMaintenance(): MaintenanceState | null {
  try {
    const value = JSON.parse(localStorage.getItem(maintenanceKey) || "null") as MaintenanceState | null;
    if (value && typeof value.generation === "string" && typeof value.record?.asset?.id === "string" && Array.isArray(value.photos) && typeof value.fields?.title === "string" && typeof value.original?.title === "string") return value;
  } catch { /* Invalid local draft must not prevent startup. */ }
  return null;
}
export type MaintenanceIssue = { kind: "blocked" | "pending" | "conflict"; message: string; latest?: AssetRecord };
export type MaintenanceSession = { kind: "edit"; state: MaintenanceState; issue: MaintenanceIssue | null };
export type MaintenanceRecoveryResult = MaintenanceSession | { kind: "saved"; record: AssetRecord };

// Read-only recovery: never retarget an old request or silently accept a newer revision.
export async function recoverMaintenance(
  saved: MaintenanceState, generation: string,
  read: (id: string) => Promise<AssetRecord | null>,
  receipt: (request: string, generation: string) => Promise<AssetRecord | null>,
): Promise<MaintenanceRecoveryResult> {
  let state = saved;
  const blocked = (message: string): MaintenanceSession => ({ kind: "edit", state, issue: { kind: "blocked", message } });
  if (state.generation !== generation) return blocked("资料库已切换。这份草稿及原请求仍保留，不能提交到当前资料库；可保留草稿并关闭，切回原资料库后再核对。");
  if (state.pending) {
    const expected = maintenanceChange(state.record, state.generation, state.fields, state.maintenance_id, state.pending.request_id);
    if (JSON.stringify(expected) !== JSON.stringify(state.pending)) return blocked("暂存请求与草稿不一致，已停止提交。原始输入保留，请核对资料后处理。");
    try {
      const result = await receipt(state.pending.request_id, state.generation);
      if (result) return result.asset.id === state.record.asset.id ? { kind: "saved", record: result } : blocked("回执中的资产与草稿不一致，已停止恢复。");
      state = { ...state, pending: null };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "STALE_DATASET") return blocked("资料库已切换，原请求仍保留；请切回原资料库后核对，或保留草稿并关闭。");
      return { kind: "edit", state, issue: { kind: "pending", message: errorMessage(error) + " 原请求与输入已保留，请稍后核对。" } };
    }
  }
  const latest = await read(state.record.asset.id);
  if (!latest || latest.deleted || latest.asset.id !== state.record.asset.id) return blocked("原资产已删除或不可用。输入仍保留，请恢复原资产后重试；不会把草稿转存到其他资产。");
  if (state.maintenance_id && !latest.maintenances.some(item => item.id === state.maintenance_id)) return blocked("原维护记录已不可用。输入仍保留，请恢复原记录后重试；不会自动改成新增。");
  if (latest.asset.revision !== state.record.asset.revision) return { kind: "edit", state, issue: { kind: "conflict", latest, message: "资产已更新。请核对当前记录，再明确确认是否保留你的输入；尚未替换草稿版本。" } };
  return { kind: "edit", state: { ...state, record: latest }, issue: null };
}

export async function refreshCostsForNewDay(previousDay: string, today: string, refreshList: () => Promise<unknown>, detailId: string | null, selectedId: string | null, refreshAsset: (id: string) => Promise<unknown>) {
  if (previousDay === today) return;
  const id = detailId ?? selectedId;
  await Promise.all([refreshList(), id ? refreshAsset(id) : Promise.resolve()]);
}
export function maintenanceDraft(record:AssetRecord, maintenanceId?:string):MaintenanceDraft {
  const m=record.maintenances.find(x=>x.id===maintenanceId);
  return m ? {date:m.fields.date,kind:m.fields.kind,title:m.fields.title,description:m.fields.description,provider:m.fields.provider,cost:m.fields.cost_cents===null?"":(Number(m.fields.cost_cents)/100).toFixed(2),photo_ids:m.photos.map(p=>p.id)} : blankMaintenance();
}
export function validateMaintenance(d:MaintenanceDraft, record:AssetRecord, today:string):string|null {
  if (!maintenanceKinds.some(([k])=>k===d.kind)) return "请选择维护类型";
  if (!d.title.trim() || [...d.title.trim()].length>200 || [...d.description].length>10000 || [...d.provider.trim()].length>200 || [d.title,d.description,d.provider].some(v=>v.includes("\0"))) return "标题须为 1–200 字，服务方最多 200 字，说明最多 10000 字，且不能含空字符";
  try { inputMoney(d.cost); } catch(e) { return (e as Error).message; }
  if (d.date) {
    const parsed=new Date(`${d.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==d.date) return "日期格式应为 YYYY-MM-DD";
    if (d.date>today) return "维护日期不能晚于今天";
    if (record.asset.purchase_date && d.date<record.asset.purchase_date) return "维护日期不能早于购买日期";
    if (record.sale && d.date>record.sale.fields.date) return "维护日期不能晚于售出日期";
  }
  return null;
}
export function maintenanceChange(record:AssetRecord,generation:string,d:MaintenanceDraft,maintenanceId?:string,requestId: string=crypto.randomUUID()):MaintenanceChange {
  const fields:MaintenanceFields={date:d.date||null,kind:d.kind,title:d.title.trim(),description:d.description,cost_cents:inputMoney(d.cost),provider:d.provider.trim()};
  const photos={ids:d.photo_ids,cover_id:null};
  return {request_id:requestId,generation,asset_id:record.asset.id,expected_revision:record.asset.revision,action:maintenanceId?{type:"correct",maintenance_id:maintenanceId,fields,photos}:{type:"add",fields,photos}};
}
export function money(cents:string|null){ return cents===null?"待补录":yuan(cents) }
