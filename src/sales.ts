import type { AssetRecord } from './asset.ts';
import { inputMoney, validate, emptyFields } from './asset.ts';
export type SaleFields = { date: string; price_cents: string; platform: string; buyer: string; notes: string };
export type Sale = { id: string; previous_state: 'active' | 'retired'; fields: SaleFields };
export type SaleAction = { type: 'sell'; fields: SaleFields } | { type: 'correct'; sale_id: string; fields: SaleFields } | { type: 'revoke'; sale_id: string };
export type SaleChange = { request_id: string; generation: string; asset_id: string; expected_revision: number; action: SaleAction };
export type SaleForm = { date: string; price: string; platform: string; buyer: string; notes: string };
export type SaleDraft = { record: AssetRecord; generation: string; mode: 'sell' | 'correct' | 'revoke'; fields: SaleForm; original: SaleForm; pending: SaleChange | null };
export const saleKey = 'possio.sale-draft.v1';
export function saleFields(record: AssetRecord, today: string): SaleForm {
  const f=record.sale?.fields;
  return f ? {date:f.date,price:(Number(f.price_cents)/100).toFixed(2),platform:f.platform,buyer:f.buyer,notes:f.notes} : {date:today,price:'',platform:'',buyer:'',notes:''};
}
export function saleError(d: SaleDraft, today: string): string {
  if(d.record.deleted) return '物品已移入最近删除，请先恢复物品。';
  if(d.mode==='sell' ? d.record.lifecycle?.state==='sold' : !d.record.sale || d.record.lifecycle?.state!=='sold') return '当前状态已变化，请重新读取后选择适用动作。';
  if(d.mode==='revoke') return '';
  const f=d.fields;
  const errors=validate({...emptyFields,name:'售出',date:f.date,price:f.price,notes:f.notes},today);
  if(!f.date) return '请填写售出日期。';
  if(errors.date) return f.date>today ? '售出日期不能晚于今天。' : '请输入有效售出日期，格式为 YYYY-MM-DD。';
  if(!f.price.trim()) return '请填写实际售价；售价为零时填写 0。';
  if(errors.price) return errors.price;
  if(errors.notes) return errors.notes;
  for(const s of [f.platform,f.buyer]) if([...s].length>200||s.includes('\0'))return '平台和买家最多 200 字，且不能含空字符。';
  if(d.record.asset.purchase_date && f.date<d.record.asset.purchase_date) return '售出日期不能早于购入日期。';
  const last=d.record.lifecycle?.events.at(-1);
  if(last && f.date<last.date) return `售出日期不能早于前置状态记录（${last.date}）。`;
  const latestMaintenance=(d.record.maintenances??[]).filter(m=>m.fields.date).map(m=>m.fields.date!).sort().at(-1);
  if(latestMaintenance && f.date<latestMaintenance) return `售出日期不能早于维护记录（${latestMaintenance}）。`;
  return '';
}
export function saleAction(d: SaleDraft): SaleAction {
  if(d.mode==='revoke') return {type:'revoke',sale_id:d.record.sale!.id};
  const {price,...rest}=d.fields, fields={...rest,price_cents:inputMoney(price)!};
  return d.mode==='sell' ? {type:'sell',fields} : {type:'correct',sale_id:d.record.sale!.id,fields};
}
export function settlement(record: AssetRecord, sale: SaleFields) {
  const days=record.asset.purchase_date ? Math.floor((Date.parse(sale.date+'T00:00:00Z')-Date.parse(record.asset.purchase_date+'T00:00:00Z'))/86400000)+1 : null;
  const unknown=record.costs?.unknown_maintenance_count ?? 0;
  const maintenance=BigInt(record.costs?.known_maintenance_cents ?? '0');
  const net=record.asset.price_cents===null || unknown>0 ? null : BigInt(record.asset.price_cents)+maintenance-BigInt(sale.price_cents);
  const n=net===null ? null : net<0n ? -net : net;
  const daily=n!==null && days!==null && days>0 ? (((n+BigInt(Math.floor(days/2)))/BigInt(days))*(net!<0n?-1n:1n)).toString() : null;
  return {days,net:net?.toString()??null,daily};
}
export function incompleteCostReason(record: AssetRecord): string {
  const missing = [];
  if (record.asset.price_cents === null) missing.push('购入金额未知');
  const count = record.costs?.unknown_maintenance_count ?? 0;
  if (count > 0) missing.push(`${count} 条维护费用未知`);
  return missing.length ? missing.join('，') + '，成本不完整。' : '';
}
export function storedSale(): SaleDraft | null {
  try {const d=JSON.parse(localStorage.getItem(saleKey)||'null'); if(typeof d?.record?.asset?.id==='string'&&typeof d.generation==='string'&&['sell','correct','revoke'].includes(d.mode)&&['date','price','platform','buyer','notes'].every(k=>typeof d.fields?.[k]==='string'&&typeof d.original?.[k]==='string')&&(!d.pending||typeof d.pending.request_id==='string'))return d;} catch { /* Invalid drafts do not block library reads. */ }
  return null;
}
