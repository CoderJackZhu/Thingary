import type { Due, Plan, PlanFields } from './recurring';
import { planIntervalText } from './recurring.ts';
import { t } from './i18n.ts';
export const virtualKinds = [['license', t('买断软件')], ['domain', t('域名')], ['subscription', t('订阅服务')], ['general', t('虚拟资产')]] as const;
export type VirtualKind = typeof virtualKinds[number][0];
/** 计费方式与旧类型字段独立：单次购买、订阅、储值（设计 §2）。 */
export const billingModes = [['single', t('单次购买')], ['subscription', t('订阅')], ['topup', t('储值')]] as const;
export type BillingMode = typeof billingModes[number][0];
export const billingText = (b: string) => billingModes.find(([k]) => k === b)?.[1] ?? t('单次购买');
export type VirtualStatus = 'stopped' | 'perpetual' | 'unknown' | 'expired' | 'expiring' | 'active' | 'ongoing' | 'paused' | 'future';
export type VirtualFields = { name: string; kind: VirtualKind; billing: BillingMode; label_id: string | null; pay_method?: string | null; perpetual?: boolean | null; provider: string; purchase_date: string | null; price_cents: string | null; expires: string | null; plan_id: string | null; url: string; notes: string; stopped_on: string | null };
export type TopupFields = { topup_date: string | null; paid_cents: string | null; gift_cents: string | null; credit_cents: string | null; pay_method: string; notes: string };
export type TopupRecord = { id: string; asset_id: string; fields: TopupFields; revision: number };
export type BalanceRecord = { id: string; asset_id: string; balance_cents: string; recorded_on: string; notes: string; revision: number };
export type ReminderState = { date: string; notes: string; repeat_every_period?: boolean; lead_days?: number };
export type VirtualAsset = { paid_count?: number; paid_until?: string | null; plan?: Plan | null; id: string; fields: VirtualFields; revision: number; plan_name: string | null; plan_deleted: boolean; valid_until: string | null; status: VirtualStatus; needs_review?: boolean; spent_cents: string | null; label_name?: string | null; reminder?: ReminderState | null; payment_due?: Due | null; topup_count?: number; topups?: TopupRecord[]; topup_unknown_paid?: number; topup_known_cents?: string | null; topup_credit_cents?: string | null; balance?: BalanceRecord | null };
export type VirtualSave = { plan?: { id: string | null; expected_revision: number | null; fields: PlanFields }; renewal_price_cents?: string | null; renewal_from?: string | null; special_end?: { period_start: string; coverage_end: string | null } | null; first_topup?: TopupFields | null; request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: VirtualFields };
export type TopupSave = { request_id: string; generation: string; asset_id: string; id: string | null; expected_revision: number | null; fields: TopupFields };
export type BalanceSave = { request_id: string; generation: string; asset_id: string; id: string | null; expected_revision: number | null; balance_cents: string; recorded_on: string; notes: string };
export type ReminderSave = { request_id: string; generation: string; asset_id: string; expected_revision: number; repeat_every_period?: boolean; lead_days?: number; reminder: { date: string; notes: string } | null };
export type PlanChoice = { id: string; name: string; interval_months: number; linked_to: string | null };
export type VirtualOverview = { generation: string; today: string; items: VirtualAsset[]; in_use: number; expiring: number; expired: number; spent_cents: string; unknown_price: number; plans: PlanChoice[] };

export const virtualKindText = (k: string) => virtualKinds.find(([c]) => c === k)?.[1] ?? t('虚拟资产');
export const statusText: Record<VirtualStatus, string> = { stopped: t('已停用'), perpetual: t('永久有效'), unknown: t('有效期待补充'), expired: t('已到期'), expiring: t('即将到期'), active: t('有效'), ongoing: t('持续订阅'), paused: t('已暂停续费'), future: t('待生效') };
export const virtualStatusText = (v: VirtualAsset) => {
  if (billingOf(v) === 'single' && v.status === 'stopped') return t('已结束使用');
  if (billingOf(v) === 'single' && v.fields.kind === 'general' && v.status === 'unknown') return t('未设置有效期');
  if (v.fields.kind === 'subscription' && v.status === 'expired') return t('已结束');
  // 储值没有“有效期待补充”语义：空到期日就是未设置（设计 §3）。
  if (billingOf(v) === 'topup' && v.status === 'unknown') return t('未设置到期日');
  return statusText[v.status];
};
/** 计费方式列的稳定文案；旧类型映射到对应计费方式展示。 */
export function billingOf(v: VirtualAsset): BillingMode {
  if (v.fields.billing) return v.fields.billing;
  return v.fields.plan_id ? 'subscription' : 'single';
}
/** 解释权益与计费计划的关系；旧独立订阅不能把历史单次价格推成月费。 */
export function planAssociationText(v: VirtualAsset): string {
  if (v.fields.plan_id) return v.plan_deleted ? t('关联计划在最近删除中') : t('关联「{v1}」；付款记录由该计划管理', { v1: v.plan_name ?? '周期计划' });
  if (v.fields.kind === 'subscription') return t('旧版独立订阅，未关联周期计划；原金额保留为单次投入，不作为每期价格');
  return billingOf(v) === 'topup' ? t('按充值记录计费，无需周期计划') : t('单次购买，无需周期计划');
}

/** Costs are visible even before historical payments have been explicitly recorded. */
export function cumulativeCost(v: VirtualAsset) {
  if (billingOf(v) === 'topup') {
    const known = v.topup_known_cents ?? null;
    return { estimated: false, cents: known, unknown: !v.topup_count ? 'no-records' : known == null ? 'unknown' : v.topup_unknown_paid ? 'partial' : null } as const;
  }
  const estimated = v.plan?.estimated_cents != null;
  return { estimated, cents: estimated ? v.plan!.estimated_cents! : v.spent_cents } as const;
}
export function paymentScheduleText(v: VirtualAsset) {
  if (v.status === 'expired' && v.fields.kind === 'subscription') return t('订阅已结束，不再续费');
  if (v.status === 'stopped') return t('已停用');
  if (v.plan?.fields.paused) return t('续费已暂停');
  if (billingOf(v) === 'topup') return v.fields.expires ? t('额度到期 {expires}', { expires: v.fields.expires }) : t('未设置到期日');
  return v.plan?.next_due ? t('下次付款 {next_due}', { next_due: v.plan.next_due }) : t('无后续期');
}
export const virtualFilters = [['all', t('全部')], ['valid', t('有效')], ['expiring', t('即将到期')], ['expired', t('已结束／到期')], ['stopped', t('已结束使用／停用')]] as const;
export type VirtualFilter = typeof virtualFilters[number][0];
/** “有效” groups everything still usable, including perpetual and not-yet-known validity. */
export function matchesFilter(v: VirtualAsset, filter: VirtualFilter) {
  if (filter === 'all') return true;
  if (filter === 'valid') return v.status === 'active' || v.status === 'perpetual' || v.status === 'unknown' || v.status === 'ongoing' || v.status === 'paused' || v.status === 'future';
  return v.status === filter;
}
/** Where validity comes from, shown next to the date. */
export function validityText(v: VirtualAsset) {
  if (v.fields.stopped_on) return `${billingOf(v) === 'single' ? t('使用结束于') : t('停用于')} ${v.fields.stopped_on}`;
  if (v.status === 'future') return t('待生效（{v1}）', { v1: v.plan?.resumptions?.at(-1)?.resumed_on ?? v.plan?.fields.service_start ?? '' });
  if (v.status === 'perpetual') return t('永久有效');
  if (billingOf(v) === 'single' && !v.fields.plan_id && v.fields.perpetual) return t('永久有效');
  if (v.status === 'ongoing') return t('持续进行，无结束日期');
  if (v.status === 'paused' && !v.plan?.fields.end_date) return t('暂停续费，结束日期未指定');
  if (v.plan && (v.plan.fields.service_start || v.fields.kind === 'subscription')) return v.plan.fields.end_date ? t('至 {end_date}', { end_date: v.plan.fields.end_date }) : v.plan.fields.paused ? t('暂停续费，结束日期未指定') : t('持续进行，无结束日期');
  if (billingOf(v) === 'topup') return v.fields.expires ? t('至 {expires}', { expires: v.fields.expires }) : t('未设置到期日');
  if (v.fields.kind === 'license' && !v.fields.plan_id && !v.valid_until) return t('永久有效');
  if (v.fields.plan_id) return v.plan_deleted ? t('关联计划在最近删除中') : v.valid_until ? t('{valid_until}（按已付期推算）', { valid_until: v.valid_until }) : t('待首次付款');
  // 新建 general 单次购买：空期限是“未设置有效期”，与明确永久区分（R5）；
  // 旧 domain 空值保持“待补充”原义。
  if (billingOf(v) === 'single' && v.fields.kind === 'general' && !v.valid_until && !v.fields.perpetual) return t('未设置有效期');
  return v.valid_until ?? t('待补充');
}
/**
 * 后续续费价格的保存载荷（review R6）：明确区分未修改／取消／设置。
 * - 初始无值且当前为空 → null（不触碰）；
 * - 初始有值且当前清空 → ''（撤销尚未生效的价格段，已生效段保留）；
 * - 当前有值 → 该值。
 */
export function renewalPayload(initial: string | null | undefined, current: string): string | null {
  const had = !!initial;
  if (current) return current;
  return had ? '' : null;
}

/** 新单次购买的永久有效与“未设置有效期”是两个明确状态（设计 §3）。 */
export function singleValidityText(v: { fields: { perpetual?: boolean | null; kind: string; expires: string | null; plan_id: string | null } }): string | null {
  const f = v.fields;
  if (f.plan_id) return null;
  if (f.perpetual) return t('永久有效');
  if (f.expires) return t('至 {expires}', { expires: f.expires });
  if (f.kind === 'license') return t('永久有效');
  // 只有新建的 general 类型区分“未设置有效期”；旧 domain 空值保持待补充。
  if (f.kind === 'general') return t('未设置有效期');
  return null;
}

/** 储值投入摘要：区分尚未记录、完全未知与仅已知部分（设计 §6）。 */
export function topupSpendText(v: VirtualAsset) {
  if (!v.topup_count) return { main: null, note: '尚未记录充值' as const };
  if (v.topup_known_cents == null) return { main: null, note: '投入未知' as const };
  if (v.topup_unknown_paid) return { main: v.topup_known_cents, note: '仅已知部分' as const };
  return { main: v.topup_known_cents, note: null };
}
export const planInterval = planIntervalText;

/** Permission denial preserves the opt-in setting; a failed/unknown save never
 * reports success. Permission controls delivery, not whether the intent exists. */
export async function saveReminderWithPermission(enabled: boolean, requestPermission: () => Promise<unknown>, persist: () => Promise<unknown>): Promise<string | null> {
  let warning: string | null = null;
  if (enabled) {
    try { await requestPermission(); }
    catch (e) {
      const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : t('请检查系统通知权限');
      warning = t('提醒设置已保存，但尚不能发送系统通知：{message}', { message });
    }
  }
  await persist();
  return warning;
}
