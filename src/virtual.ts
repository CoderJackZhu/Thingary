import type { Plan, PlanFields } from './recurring';
export const virtualKinds = [['license', '买断软件'], ['domain', '域名'], ['subscription', '订阅服务']] as const;
export type VirtualKind = typeof virtualKinds[number][0];
export type VirtualStatus = 'stopped' | 'perpetual' | 'unknown' | 'expired' | 'expiring' | 'active' | 'ongoing' | 'paused';
export type VirtualFields = { name: string; kind: VirtualKind; provider: string; purchase_date: string | null; price_cents: string | null; expires: string | null; plan_id: string | null; url: string; notes: string; stopped_on: string | null };
export type VirtualAsset = { paid_count?: number; paid_until?: string | null; plan?: Plan | null; id: string; fields: VirtualFields; revision: number; plan_name: string | null; plan_deleted: boolean; valid_until: string | null; status: VirtualStatus; spent_cents: string | null };
export type VirtualSave = { plan?: { id: string | null; expected_revision: number | null; fields: PlanFields }; request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: VirtualFields };
export type PlanChoice = { id: string; name: string; interval_months: number; linked_to: string | null };
export type VirtualOverview = { generation: string; today: string; items: VirtualAsset[]; in_use: number; expiring: number; expired: number; spent_cents: string; unknown_price: number; plans: PlanChoice[] };

export const virtualKindText = (k: string) => virtualKinds.find(([c]) => c === k)?.[1] ?? '虚拟资产';
export const statusText: Record<VirtualStatus, string> = { stopped: '已停用', perpetual: '永久有效', unknown: '有效期待补充', expired: '已到期', expiring: '即将到期', active: '有效', ongoing: '持续订阅', paused: '已暂停续费' };
export const virtualStatusText = (v: VirtualAsset) => v.fields.kind === 'subscription' && v.status === 'expired' ? '已结束' : statusText[v.status];
/** Costs are visible even before historical payments have been explicitly recorded. */
export function cumulativeCost(v: VirtualAsset) {
  const estimated = v.plan?.estimated_cents != null;
  return { estimated, cents: estimated ? v.plan!.estimated_cents! : v.spent_cents };
}
export function paymentScheduleText(v: VirtualAsset) {
  if (v.status === 'expired' && v.fields.kind === 'subscription') return '订阅已结束，不再续费';
  if (v.status === 'stopped') return '已停用';
  if (v.plan?.fields.paused) return '续费已暂停';
  return v.plan?.next_due ? `下次付款 ${v.plan.next_due}` : '无后续期';
}
export const virtualFilters = [['all', '全部'], ['valid', '有效'], ['expiring', '即将到期'], ['expired', '已结束／到期'], ['stopped', '已停用']] as const;
export type VirtualFilter = typeof virtualFilters[number][0];
/** “有效” groups everything still usable, including perpetual and not-yet-known validity. */
export function matchesFilter(v: VirtualAsset, filter: VirtualFilter) {
  if (filter === 'all') return true;
  if (filter === 'valid') return v.status === 'active' || v.status === 'perpetual' || v.status === 'unknown' || v.status === 'ongoing' || v.status === 'paused';
  return v.status === filter;
}
/** Where validity comes from, shown next to the date. */
export function validityText(v: VirtualAsset) {
  if (v.status === 'ongoing') return '持续进行，无结束日期';
  if (v.status === 'paused' && !v.plan?.fields.end_date) return '暂停续费，结束日期未指定';
  if (v.plan && (v.plan.fields.service_start || v.fields.kind === 'subscription')) return v.plan.fields.end_date ? `至 ${v.plan.fields.end_date}` : v.plan.fields.paused ? '暂停续费，结束日期未指定' : '持续进行，无结束日期';
  if (v.fields.kind === 'license' && !v.fields.plan_id && !v.valid_until) return '永久有效';
  if (v.fields.plan_id) return v.plan_deleted ? '关联计划在最近删除中' : v.valid_until ? `${v.valid_until}（按已付期推算）` : '待首次付款';
  return v.valid_until ?? '待补充';
}
