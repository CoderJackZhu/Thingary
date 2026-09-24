import { inputMoney, type AssetRecord, type Photo, type Selection } from "./asset.ts";

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

export const blankMaintenance = (): MaintenanceDraft => ({ date:null, kind:"repair", title:"", description:"", cost:"", provider:"", photo_ids:[] });
export const draftKey = (assetId:string, maintenanceId?:string) => `possio:maintenance:${assetId}:${maintenanceId ?? "new"}`;
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
export function maintenanceChange(record:AssetRecord,generation:string,d:MaintenanceDraft,maintenanceId?:string,requestId=crypto.randomUUID()):MaintenanceChange {
  const fields:MaintenanceFields={date:d.date||null,kind:d.kind,title:d.title.trim(),description:d.description,cost_cents:inputMoney(d.cost),provider:d.provider.trim()};
  const photos={ids:d.photo_ids,cover_id:null};
  return {request_id:requestId,generation,asset_id:record.asset.id,expected_revision:record.asset.revision,action:maintenanceId?{type:"correct",maintenance_id:maintenanceId,fields,photos}:{type:"add",fields,photos}};
}
export function money(cents:string|null){ if(cents===null)return "待补录"; return `¥${(Number(cents)/100).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}` }
