// Pure form drafts, validation and save payloads for the iPhone spending screens.
// Validation text and payload shapes follow the desktop dialogs; nothing here talks to the backend.
import type { Expense, ExpenseFields, ExpenseSave } from '../../expenses.ts';
import type { Payment, PaymentRangeSave, PaymentSave, Plan, PlanFields, PlanSave, ResumeSave } from '../../recurring.ts';
import { intervals } from '../../recurring.ts';
import { blankPlan, firstSubscriptionPeriod, planScheduleDates, shiftDays } from '../../recurring-model.ts';
import { blankRent, fieldsToRent, rentPreview, rentToFields } from '../../rent-plan.ts';
import type { RentForm } from '../../rent-plan.ts';
import type { Income, IncomeFields, IncomeSave } from '../../plan.ts';
import { classifyIncome, incomeClassificationIssue, isInvestmentIncome } from '../../income-classification.ts';
import type { BalanceSave, TopupFields, TopupSave, VirtualAsset, VirtualFields, VirtualSave } from '../../virtual.ts';
import { billingOf } from '../../virtual.ts';
import type { LinkView } from '../../link.ts';

export type Check = { ok: true } | { ok: false; message: string };
const ok: Check = { ok: true };
const fail = (message: string): Check => ({ ok: false, message });
const empty = (v: string | null | undefined) => !v || v === '0';

// ---------------------------------------------------------------- 支出

export const blankExpense = (today: string): ExpenseFields => ({ title: '', date: today, amount_cents: '', category: 'travel', notes: '', refund_cents: null, refund_date: null, asset_id: null });
export function validateExpense(f: ExpenseFields): Check {
  if (!f.title.trim()) return fail('请填写名称。');
  if (empty(f.amount_cents)) return fail('请填写金额。');
  if (f.refund_date !== null && !f.refund_cents) return fail('请填写退款金额，或关闭退款。');
  return ok;
}
export function expenseSave(f: ExpenseFields, existing: Pick<Expense, 'id' | 'revision'> | null, generation: string, requestId: string): ExpenseSave {
  return { request_id: requestId, generation, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, fields: { ...f, title: f.title.trim() } };
}
/** 打开退款时默认今天，关闭时清空退款金额与日期。 */
export function toggleRefund(f: ExpenseFields, on: boolean, today: string): ExpenseFields {
  return { ...f, refund_cents: on ? f.refund_cents : null, refund_date: on ? (f.refund_date ?? today) : null };
}

// ---------------------------------------------------------------- 周期计划

export type PlanDraft = { name: string; category: string; notes: string; rent: RentForm; backfill: boolean | null };
export const blankPlanDraft = (today: string): PlanDraft => ({ name: '', category: 'rent', notes: '', rent: blankRent(today), backfill: null });
/** 已有计划能用简易表单读回时返回草稿；固定天数、试用、暂停、分段价格等返回 null，只允许改名称与备注。 */
export function planDraftFrom(plan: Plan): PlanDraft | null {
  const rent = fieldsToRent({ ...plan, rules: [], period_ends: {}, special_start: null, special_end: null, renewal_cents: null });
  return rent ? { name: plan.fields.name, category: plan.fields.category, notes: plan.fields.notes, rent, backfill: null } : null;
}
export function planFieldsFromDraft(base: PlanFields | null, draft: PlanDraft, today: string): PlanFields {
  return { ...(base ?? blankPlan(today)), name: draft.name.trim(), notes: draft.notes, ...rentToFields(draft.rent, draft.category) };
}
export function validatePlanDraft(draft: PlanDraft, today: string): Check {
  if (!draft.name.trim()) return fail('请填写名称。');
  if (empty(draft.rent.amount_cents)) return fail('请填写每期金额。');
  if (!rentPreview(draft.rent, today)) return fail(draft.category === 'rent' ? '请检查开始日期和租期到期日：到期日须晚于开始日期。' : '请检查开始日期和结束日期：结束日期须晚于开始日期。');
  return ok;
}
/** 新建且开始日期已过去时，已过去的期数；房租默认把这些期补记为已付，其他费用默认不补。 */
export function pastDues(draft: PlanDraft, today: string): number {
  return rentPreview(draft.rent, today)?.rows.filter(r => r.due <= today).length ?? 0;
}
export const backfillDefault = (draft: PlanDraft): boolean => draft.backfill ?? draft.category === 'rent';
export function planSave(fields: PlanFields, existing: Pick<Plan, 'id' | 'revision'> | null, generation: string, requestId: string): PlanSave {
  return { request_id: requestId, generation, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, fields };
}
/** 暂停／恢复只改 paused；结束计划确认最后使用日并关闭续费。 */
export const pausedFields = (f: PlanFields, paused: boolean): PlanFields => ({ ...f, paused });
export function endFields(f: PlanFields, lastUsed: string): PlanFields { return { ...f, end_date: lastUsed, auto_renew: false }; }
export function validateEnd(f: PlanFields, lastUsed: string): Check {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastUsed)) return fail('请填写最后使用日。');
  const start = f.service_start ?? f.first_due;
  if (lastUsed < start) return fail('最后使用日不能早于服务开始日。');
  return ok;
}
/** 建议的最后使用日：已设结束日、当前服务期末、已付覆盖期末、下一期末，依次取第一个有的。 */
export function endSuggestion(plan: Plan, link: Pick<LinkView, 'paid_until'> | null): string | null {
  const start = plan.resumptions?.at(-1)?.resumed_on ?? plan.fields.service_start ?? '';
  return plan.fields.end_date ?? plan.current_coverage?.[1] ?? (link?.paid_until && link.paid_until >= start ? link.paid_until : null) ?? plan.next_coverage?.[1] ?? null;
}
/** 已过去的期次一次补记为已付：范围是计划排期里从第一期到今天，金额同每期。 */
export function backfillRange(saved: Plan, amount: string, generation: string, today: string, requestId: string): PaymentRangeSave | null {
  const dates = planScheduleDates(saved, '1900-01-01', today);
  if (!dates.length) return null;
  return { request_id: requestId, generation, plan_id: saved.id, expected_revision: saved.revision, from_due: dates[0], to_due: dates[dates.length - 1], amount_cents: amount, confirmed: true };
}

// ---------------------------------------------------------------- 付款

export type PaymentDraft = { state: 'paid' | 'skipped'; paid: string; amount: string; notes: string };
export function paymentDraft(record: Payment | null, due: string, planAmount: string, today: string): PaymentDraft {
  return { state: record?.state ?? 'paid', paid: record?.paid_date ?? (due < today ? due : today), amount: record?.amount_cents ?? planAmount, notes: record?.notes ?? '' };
}
export function validatePayment(d: PaymentDraft): Check {
  if (d.state !== 'paid') return ok;
  return !d.paid ? fail('请填写实付日期。') : empty(d.amount) ? fail('请填写实付金额。') : ok;
}
export function paymentSave(d: PaymentDraft, target: { plan_id: string; due_date: string }, record: Payment | null, generation: string, requestId: string): PaymentSave {
  return { request_id: requestId, generation, id: record?.id ?? null, expected_revision: record?.revision ?? null, plan_id: target.plan_id, due_date: target.due_date, state: d.state, paid_date: d.state === 'paid' ? d.paid : null, amount_cents: d.state === 'paid' ? d.amount : null, notes: d.notes };
}
export const skipSave = (due: { plan_id: string; due_date: string }, generation: string, requestId: string): PaymentSave =>
  ({ request_id: requestId, generation, id: null, expected_revision: null, plan_id: due.plan_id, due_date: due.due_date, state: 'skipped', paid_date: null, amount_cents: null, notes: '' });

export type RangeDraft = { from: string; to: string; amount: string; confirmed: boolean };
/** 可补记的往期付款日（到今天为止的排期）。 */
export function rangeDates(plan: Plan, today: string): string[] {
  return planScheduleDates(plan, plan.fields.service_start ? '1900-01-01' : plan.fields.first_due, today).slice(-600);
}
export function rangeCount(dates: string[], d: RangeDraft): number { return dates.filter(x => x >= d.from && x <= d.to).length; }
export function validateRange(dates: string[], d: RangeDraft): Check {
  if (!d.confirmed || !rangeCount(dates, d) || empty(d.amount)) return fail('请选择有效范围、填写每期实付，并明确确认已付。');
  return ok;
}
export function rangeSave(plan: Plan, d: RangeDraft, generation: string, requestId: string): PaymentRangeSave {
  return { request_id: requestId, generation, plan_id: plan.id, expected_revision: plan.revision, from_due: d.from, to_due: d.to, amount_cents: d.amount, confirmed: d.confirmed };
}

// ---------------------------------------------------------------- 重新订阅

export type ResumeDraft = { start: string; cycle: string; amount: string; separateDue: boolean; due: string };
export function resumeContext(plan: Plan, pending: string | null) {
  const replacing = !!pending && !!plan.resumptions?.length;
  const previousEnd = replacing ? plan.resumptions!.at(-1)!.previous_end : plan.fields.end_date!;
  return { replacing, previousEnd, minimum: shiftDays(previousEnd, 1) };
}
export function resumeDraft(plan: Plan, pending: string | null, today: string): ResumeDraft {
  const { replacing, minimum } = resumeContext(plan, pending);
  return { start: pending ?? (today > minimum ? today : minimum), cycle: plan.fields.interval_days ? 'days' : String(plan.fields.interval_months), amount: plan.fields.amount_cents, separateDue: replacing && plan.fields.first_due !== pending, due: replacing ? plan.fields.first_due : today };
}
export const resumeCycles = (plan: Plan): { id: string; label: string }[] => [...intervals.map(([v, l]) => ({ id: String(v), label: l })), ...(plan.fields.interval_days ? [{ id: 'days', label: `每 ${plan.fields.interval_days} 天` }] : [])];
/** 重新订阅后的计划字段（用来预览首期区间和校验）。 */
export function resumedFields(plan: Plan, d: ResumeDraft): PlanFields {
  const firstDue = d.separateDue ? d.due : d.start;
  return { ...plan.fields, service_start: d.start, coverage_start: d.start, first_due: firstDue, end_date: null, trial_days: null, interval_months: d.cycle === 'days' ? 1 : Number(d.cycle), interval_days: d.cycle === 'days' ? plan.fields.interval_days ?? null : null };
}
export function validateResume(plan: Plan, pending: string | null, d: ResumeDraft): Check {
  const { minimum } = resumeContext(plan, pending), f = resumedFields(plan, d), period = firstSubscriptionPeriod(f), firstDue = f.first_due;
  if (!period?.[1] || period[1] < d.start || d.start < minimum) return fail('请填写有效的服务生效日期，须晚于上段最后使用日。');
  if (shiftDays(firstDue, 0) !== firstDue || firstDue < minimum) return fail('请填写有效的首期计划付款日，须晚于上段最后使用日。');
  if (!d.amount || BigInt(d.amount) <= 0n) return fail('请填写本次每期价格。');
  return ok;
}
export function resumeSave(plan: Plan, link: Pick<LinkView, 'generation' | 'asset'>, pending: string | null, d: ResumeDraft, requestId: string): ResumeSave {
  const { replacing } = resumeContext(plan, pending), f = resumedFields(plan, d);
  return { request_id: requestId, generation: link.generation, plan_id: plan.id, expected_revision: plan.revision, asset_id: link.asset?.id ?? null, asset_expected_revision: link.asset?.revision ?? null, start_date: d.start,
    ...(f.first_due !== d.start ? { first_due: f.first_due } : {}), ...(replacing ? { replace_pending: true } : {}), amount_cents: d.amount, interval_months: f.interval_months, interval_days: f.interval_days ?? null };
}

// ---------------------------------------------------------------- 收入

export const blankIncome = (today: string, hpfDefault: string): IncomeFields => ({ date: today, net_cents: '', hpf_cents: hpfDefault || null, notes: '', category: 'unclassified', source_account_id: null, destination: null, receiving_account_id: null });
export type IncomeCheckContext = { original: IncomeFields | null; depositConfirmed: boolean };
export function validateIncome(f: IncomeFields, ctx: IncomeCheckContext): Check {
  if (!f.date) return fail('请填写到账日期。');
  const issue = incomeClassificationIssue(f);
  if (issue) return fail(issue);
  if (isInvestmentIncome(f) && !isInvestmentIncome(ctx.original ?? {}) && f.hpf_cents !== null && !ctx.depositConfirmed) return fail('请确认保留这笔收入已有的公积金缴存事实，或更正该金额。');
  if (f.net_cents === '') return fail('请填写税后到账金额；没有到账就填 0。');
  return ok;
}
export const incomeSave = (f: IncomeFields, existing: Pick<Income, 'id' | 'revision'> | null, generation: string, requestId: string): IncomeSave =>
  ({ request_id: requestId, generation, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, fields: f });
/** 切换分类：投资类收入不继承建议的公积金默认值（同桌面）。 */
export function changeIncomeCategory(f: IncomeFields, category: NonNullable<IncomeFields['category']>, isNew: boolean, depositEdited: boolean): IncomeFields {
  const next = classifyIncome(f, category);
  if (isNew && !depositEdited && isInvestmentIncome(next)) next.hpf_cents = null;
  return next;
}

// ---------------------------------------------------------------- 虚拟资产

export const blankTopup = (today: string): TopupFields => ({ topup_date: today, paid_cents: '', gift_cents: null, credit_cents: null, pay_method: '', notes: '' });
/** 默认到账额度＝实付＋赠送；两项都没有时不推断。 */
export function autoCredit(f: Pick<TopupFields, 'paid_cents' | 'gift_cents'>): string | null {
  return !f.paid_cents && !f.gift_cents ? null : String(BigInt(f.paid_cents || '0') + BigInt(f.gift_cents || '0'));
}
export function validateTopup(f: TopupFields, credit: string | null): Check {
  return !f.paid_cents && !f.gift_cents && !f.credit_cents && credit == null ? fail('请至少填写实付、赠送或到账额度中的一项。') : ok;
}
/** 空串统一为 null：未知的实付不落成 0。 */
export function cleanTopup(f: TopupFields, credit: string | null): TopupFields {
  const clean = (v: string | null | undefined) => (v === '' || v === undefined ? null : v);
  return { ...f, paid_cents: clean(f.paid_cents), gift_cents: clean(f.gift_cents), credit_cents: clean(f.credit_cents ?? credit) };
}
export const topupSave = (f: TopupFields, credit: string | null, asset: Pick<VirtualAsset, 'id'>, existing: { id: string; revision: number } | null, generation: string, requestId: string): TopupSave =>
  ({ request_id: requestId, generation, asset_id: asset.id, id: existing?.id ?? null, expected_revision: existing?.revision ?? null, fields: cleanTopup(f, credit) });
export const balanceSave = (d: { cents: string; date: string; notes: string }, asset: Pick<VirtualAsset, 'id' | 'balance'>, generation: string, requestId: string): BalanceSave =>
  ({ request_id: requestId, generation, asset_id: asset.id, id: asset.balance?.id ?? null, expected_revision: asset.balance?.revision ?? null, balance_cents: d.cents, recorded_on: d.date, notes: d.notes });

export const blankVirtual = (): VirtualFields => ({ name: '', kind: 'general', billing: 'subscription', label_id: null, provider: '', purchase_date: null, price_cents: null, expires: null, plan_id: null, url: '', notes: '', stopped_on: null });
export type VirtualDraft = { fields: VirtualFields; perpetual: boolean; plan: PlanDraft; withTopup: boolean; firstTopup: TopupFields };
export function virtualDraft(item: VirtualAsset | null, today: string): VirtualDraft {
  const plan = item?.plan ? planDraftFrom(item.plan) : null;
  return {
    fields: item ? { ...item.fields, billing: billingOf(item) } : blankVirtual(),
    perpetual: !!item && (!!item.fields.perpetual || (item.fields.kind === 'license' && !item.fields.expires)),
    plan: plan ?? { ...blankPlanDraft(today), category: 'subscription' }, withTopup: false, firstTopup: blankTopup(today),
  };
}
/** 旧版关联计划（没有服务开始日期）只读，只能改档案本身的字段。 */
export const isLegacyLink = (item: VirtualAsset | null): boolean => !!item && !!item.fields.plan_id && (!item.plan || !item.plan.fields.service_start);
/** 固定天数、试用、暂停等简易表单读不回的计划：手机版只读，沿用原计划字段。 */
export const isComplexPlan = (item: VirtualAsset | null): boolean => !!item?.plan && !isLegacyLink(item) && !planDraftFrom(item.plan);
export function validateVirtual(item: VirtualAsset | null, d: VirtualDraft, today: string): Check {
  const mode = d.fields.billing, sub = mode === 'subscription', locked = isLegacyLink(item) || isComplexPlan(item);
  if (!d.fields.name.trim()) return fail('请填写名称。');
  if (sub && !locked) { const c = validatePlanDraft({ ...d.plan, name: d.fields.name }, today); if (!c.ok) return c; }
  if (mode === 'single' && item?.fields.kind === 'license' && !d.fields.stopped_on && !d.perpetual && !d.fields.expires) return fail('旧买断软件未设期限时按永久有效解释；有限期授权请填有效至，不再使用请选已结束使用。');
  if (mode === 'single' && d.perpetual && d.fields.expires) return fail('选择永久有效时不要填写有效至。');
  return ok;
}
/** 虚拟资产保存载荷：订阅同时携带关联的周期计划；储值可带首次充值。续费价格分段、特殊到期不在手机版编辑，保持原样。 */
export function virtualSave(item: VirtualAsset | null, d: VirtualDraft, generation: string, today: string, requestId: string): VirtualSave {
  const mode = d.fields.billing, sub = mode === 'subscription', legacy = isLegacyLink(item);
  const namesUnified = !item?.plan || item.plan.fields.name === item.fields.name;
  const complex = isComplexPlan(item);
  const planFields = complex ? item!.plan!.fields : planFieldsFromDraft(item?.plan?.fields ?? null, { ...d.plan, name: d.fields.name, category: d.plan.category || 'subscription' }, today);
  const fields: VirtualFields = { ...d.fields, name: d.fields.name.trim(), perpetual: d.perpetual,
    ...(sub && !legacy ? { purchase_date: planFields.service_start && planFields.service_start <= today ? planFields.service_start : null, price_cents: null, expires: null } : {}),
    ...(mode === 'topup' ? { price_cents: null, plan_id: null, perpetual: false } : {}) };
  const credit = autoCredit(d.firstTopup);
  return {
    ...(sub && ((item?.plan && !item.plan_deleted) || !item) ? { plan: { id: item?.plan?.id ?? null, expected_revision: item?.plan?.revision ?? null, fields: legacy ? item!.plan!.fields : { ...planFields, name: namesUnified || !item ? fields.name : item.plan!.fields.name, category: d.plan.category || 'subscription' } } } : {}),
    ...(mode === 'topup' && !item && d.withTopup && (d.firstTopup.paid_cents || d.firstTopup.gift_cents || d.firstTopup.credit_cents || credit) ? { first_topup: cleanTopup(d.firstTopup, credit) } : {}),
    request_id: requestId, generation, id: item?.id ?? null, expected_revision: item?.revision ?? null, fields,
  };
}
/** 已有付款或充值事实的档案不能更换计费方式。 */
export function canSwitchBilling(item: VirtualAsset | null, next: string): Check {
  if (!item || billingOf(item) === next) return ok;
  const hadFacts = billingOf(item) === 'topup' ? (item.topup_count ?? 0) > 0 : billingOf(item) === 'subscription' ? !!item.fields.plan_id : !!item.fields.price_cents;
  return hadFacts ? fail('已有付款或充值事实的档案不能更换计费方式；请保留原方式或新建档案。') : ok;
}
export const stopFields = (f: VirtualFields, today: string): VirtualFields => ({ ...f, stopped_on: today });
