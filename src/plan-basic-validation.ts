import type { PlanningSources } from './plan-basic-contract.ts';
import { validateDebtRepayment } from './plan-debt.ts';

const cents = (s: string) => /^(0|[1-9]\d*)$/.test(s) && Number.isSafeInteger(Number(s));
const month = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && s.slice(0, 4) !== '0000';
const date = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
/** Persisted inputs are validated by Rust too. Protect read-only/temporary calculation callers. */
export function basicConstraintMessages(sources: PlanningSources): string[] {
  const p = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  if (!p?.retire.basic) return [];
  const r = p.retire, b = r.basic!, errors: string[] = [], add = (s: string) => errors.push(s);
  if (p.birth_month !== null && (!month(p.birth_month) || p.birth_month >= sources.today.slice(0, 7))) add('出生年月须合法并早于本月。');
  if (r.spend_cents !== null && !cents(r.spend_cents)) add('完整生活预算须为合法整数分。');
  if (!Number.isInteger(r.horizon_age) || r.horizon_age < 70 || r.horizon_age > 110 || (r.target_age !== null && (!Number.isInteger(r.target_age) || r.target_age < 20 || r.target_age >= r.horizon_age))) add('目标年龄与规划终点约束冲突。');
  for (const v of [r.real_return_before_hundredths, r.real_return_after_hundredths]) if (!Number.isInteger(v) || v < -1000 || v > 2000) add('实际收益输入超出合法范围。');
  if (!Number.isInteger(p.assumptions.inflation_hundredths) || p.assumptions.inflation_hundredths < 0 || p.assumptions.inflation_hundredths > 2000) add('通胀输入超出合法范围。');
  if (b.start.kind === 'simulation' && ((b.start.available_cents !== null && !cents(b.start.available_cents)) || (b.start.date !== null && !date(b.start.date)))) add('模拟起点金额或日期非法。');
  if (r.core && !date(r.core.monetary_basis_date)) add('金额基准日期非法。');
  const debtIds = new Set<string>();
  if ((r.core?.debt_repayments?.length ?? 0) > 500) add('还款安排过多。');
  for (const d of r.core?.debt_repayments ?? []) {
    try { validateDebtRepayment(d); } catch { add('贷款还款安排的金额、日期、期限或处理方式非法。'); }
    if (debtIds.has(d.account_id) || d.recorded_on > sources.today) add('贷款还款安排重复或填写日期晚于今天。');
    debtIds.add(d.account_id);
  }
  const fundIds = new Set<string>();
  for (const f of r.core?.fund_rules ?? []) {
    if (fundIds.has(f.account_id) || !Number.isInteger(f.share_hundredths) || f.share_hundredths < 0 || f.share_hundredths > 10000 || !['available', 'restricted', 'excluded'].includes(f.availability)) add('资金范围规则重复或非法。');
    fundIds.add(f.account_id);
  }
  if (b.start.kind === 'live' && sources.snapshot.status === 'ready' && sources.snapshot.value) {
    if (!date(sources.snapshot.value.date)) add('盘点日期非法。');
    for (const e of sources.snapshot.value.entries) if (e.counted && e.amount_cents !== null && !cents(e.amount_cents)) add('账户余额须为合法非负整数分。');
  }
  for (const c of [...b.contribution_costs, ...b.retirement_costs]) if (!['included', 'extra', 'excluded'].includes(c.treatment) || (c.reference_cents !== null && !cents(c.reference_cents))) add('费用包含关系或参考额非法。');
  for (const i of [...r.spend_items, ...r.income_items]) if (!cents(i.monthly_cents)) add('费用或收入金额非法。');
  for (const v of [r.rent_cents, r.keep_paying_monthly_cents, p.personal_pension_annual_cents]) if (v !== null && !cents(v)) add('房租、续缴费用或养老金年额非法。');
  const pc = b.pension_contributions;
  if ((pc.start_month !== null && !month(pc.start_month)) || (pc.stop_month !== null && !month(pc.stop_month)) || (pc.base_cents !== null && !cents(pc.base_cents)) || (pc.start_month !== null && pc.stop_month !== null && pc.start_month > pc.stop_month)) add('未来缴费排期或基数非法。');
  const eventIds = new Set<string>(), occurrenceIds = new Set<string>(), paymentIds = new Set<string>(), sourceIds = new Set<string>();
  for (const e of r.life_events) {
    if (eventIds.has(e.id) || !month(e.date)) add('大额计划身份重复或预计月份非法。');
    eventIds.add(e.id);
    for (const key of ['price_cents', 'down_cents', 'extra_cents', 'holding_cents', 'rent_saved_cents', 'resale_cents'] as const) if (!cents(e[key])) add('大额计划金额非法。');
    if (!Number.isInteger(e.loan_rate_hundredths) || e.loan_rate_hundredths < 0 || e.loan_rate_hundredths > 2000 || !Number.isInteger(e.loan_years) || e.loan_years < 1 || e.loan_years > 40) add('计划贷款利率或期限非法。');
    if (Number(e.down_cents) > Number(e.price_cents)) add('首付不能高于总价。');
  }
  for (const o of r.core?.occurrences ?? []) {
    if (occurrenceIds.has(o.event_id) || !eventIds.has(o.event_id) || !date(o.actual_date) || o.actual_date > sources.today) add('发生记录重复、日期非法或引用无效。');
    occurrenceIds.add(o.event_id);
    for (const p of o.payments) {
      if (paymentIds.has(p.id) || !date(p.date) || (p.amount_cents !== null && !cents(p.amount_cents))) add('实际付款重复、日期或金额非法。');
      paymentIds.add(p.id);
      if (p.source_id) {
        const key = `${p.source_kind}:${p.source_id}`;
        if (sourceIds.has(key)) add('同一实际付款被重复关联，请核对物品、已购愿望或关联支出');
        sourceIds.add(key);
      }
    }
    if (o.loan && (!date(o.loan.as_of) || !cents(o.loan.principal_cents) || !Number.isInteger(o.loan.remaining_months) || o.loan.remaining_months < 0 || o.loan.remaining_months > 480 || (o.loan.principal_cents !== '0' && o.loan.remaining_months === 0))) add('贷款余额、截至日或剩余期数非法。');
  }
  // Current native source protocol projects reference errors as text. Duplication is a conflict, not missing coverage.
  for (const s of sources.profile.status === 'ready' ? sources.profile.value.saved?.reference_issues ?? [] : []) if (s.includes('同一实际付款被重复关联')) add(s);
  return [...new Set(errors)];
}
