import type { FieldIssueV1, TimeInputV1, FutureIncomeV1, SimplifiedPlanningFieldsV1 } from './plan-simplified-contract.ts';
export const simplifiedEmpty = (): SimplifiedPlanningFieldsV1 => ({ contract_version: 1, time: { reference: null, target_month: null, horizon_month: null }, income_mode: 'unconfirmed', future_incomes: [] });
export const monthIndexV1 = (m: string): number => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthTextV1 = (m: number): string => `${String(Math.floor(m / 12)).padStart(4, '0')}-${String(m % 12 + 1).padStart(2, '0')}`;
export const validMonthV1 = (m: unknown): m is string => typeof m === 'string' && /^(19\d\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/.test(m);
export function ageToMonthV1(reference: TimeInputV1['reference'], ageMonths: number): string {
  if (!reference || !validMonthV1(reference.month) || !Number.isInteger(reference.age_months) || reference.age_months < 0 || reference.age_months > 1440 || !Number.isInteger(ageMonths) || ageMonths < 0 || ageMonths > 1440) throw new Error('请新确认年龄参考或使用年月');
  const result = monthTextV1(monthIndexV1(reference.month) + ageMonths - reference.age_months);
  if (!validMonthV1(result)) throw new Error('换算月份超出范围');
  return result;
}
const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && validMonthV1(v.slice(0, 7)) && Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
export function validateSimplifiedPlanningV1(f: SimplifiedPlanningFieldsV1): FieldIssueV1[] {
  const out: FieldIssueV1[] = [];
  const issue = (path: string, code: string, message: string) => out.push({ path, code, message });
  const month = (v: unknown, path: string) => { if (v !== null && !validMonthV1(v)) issue(path, 'invalid_month', '月份须为 YYYY-MM'); };
  const text = (v: unknown, path: string, max: number, nullable = false) => { if (!(nullable && v === null) && (typeof v !== 'string' || [...v].length > max)) issue(path, 'invalid_text', '文字超出范围或格式无效'); };
  const shape = (v: unknown, path: string, keys: string[]): v is Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { issue(path, 'invalid_shape', '规划输入格式无效'); return false; }
    const o = v as Record<string, unknown>;
    if (keys.some(k => !(k in o)) || Object.keys(o).some(k => !keys.includes(k))) { issue(path, 'invalid_shape', '规划输入存在缺项或旧字段'); return false; }
    return true;
  };
  if (!shape(f, '', ['contract_version','time','income_mode','future_incomes']) || !shape(f.time, 'time', ['reference','target_month','horizon_month'])) return out;
  if (!Array.isArray(f.future_incomes)) {issue('future_incomes','invalid_shape','收入须为数组');return out;}
  if (f.time.reference !== null && !shape(f.time.reference, 'time.reference', ['month','age_months'])) return out;
  if (f.contract_version !== 1) issue('contract_version', 'unsupported_version', '不支持此规划契约');
  month(f.time.target_month, 'time.target_month'); month(f.time.horizon_month, 'time.horizon_month');
  if (f.time.reference !== null) {
    month(f.time.reference.month, 'time.reference.month');
    if (!validMonthV1(f.time.reference.month) || !Number.isInteger(f.time.reference.age_months) || f.time.reference.age_months < 0 || f.time.reference.age_months > 1440) issue('time.reference.age_months', 'invalid_age', '参考年龄须为 0—1440 个整月');
  }
  if (validMonthV1(f.time.target_month) && validMonthV1(f.time.horizon_month) && f.time.horizon_month <= f.time.target_month) issue('time.horizon_month', 'invalid_order', '终点须晚于目标月');
  if (!['unconfirmed', 'excluded', 'manual'].includes(f.income_mode)) issue('income_mode', 'invalid_mode', '未来收入选择无效');
  if (f.future_incomes.length > 20) issue('future_incomes', 'too_many', '最多 20 项收入');
  const ids = new Set<string>();
  for (const i of f.future_incomes) {
    if (!shape(i, 'future_incomes', ['id','name','role','included','monthly_cents','start_month','end_month','basis','basis_month','growth','source','source_checked_on','notes'])) continue;
    const p = `future_incomes.${i.id}`;
    if (typeof i.id !== 'string' || !i.id.trim() || i.id.length > 120 || ids.has(i.id)) issue(p, 'invalid_id', '收入标识无效或重复');
    ids.add(i.id); text(i.name, `${p}.name`, 120);
    if (typeof i.name === 'string' && !i.name.trim()) issue(`${p}.name`, 'required', '请填写收入名称');
    if (!['pension', 'other'].includes(i.role)) issue(`${p}.role`, 'invalid_role', '收入角色无效');
    if (typeof i.included !== 'boolean') issue(`${p}.included`, 'invalid_boolean', '计入选择无效');
    if (i.monthly_cents !== null && (typeof i.monthly_cents !== 'string' || i.monthly_cents.length > 11 || !/^(0|[1-9]\d*)$/.test(i.monthly_cents) || BigInt(i.monthly_cents) > 99999999999n)) issue(`${p}.monthly_cents`, 'invalid_amount', '月金额须为 0—99999999999 的规范整数分');
    month(i.start_month, `${p}.start_month`); month(i.end_month, `${p}.end_month`); month(i.basis_month, `${p}.basis_month`);
    if (validMonthV1(i.start_month) && validMonthV1(i.end_month) && i.end_month < i.start_month) issue(`${p}.end_month`, 'invalid_order', '结束月不能早于开始月');
    if (!['reference_month', 'start_month'].includes(i.basis)) issue(`${p}.basis`, 'invalid_basis', '请选择有效的金额口径');
    if (i.basis === 'reference_month' && !validMonthV1(i.basis_month)) issue(`${p}.basis_month`, 'required', '请确认购买力基准月');
    if (i.basis === 'start_month' && i.basis_month !== null) issue(`${p}.basis_month`, 'invalid_basis', '领取时金额不携带独立基准月');
    if (!['fixed_nominal', 'constant_purchasing_power'].includes(i.growth)) issue(`${p}.growth`, 'invalid_growth', '增长假设无效');
    text(i.source, `${p}.source`, 10000, true); text(i.notes, `${p}.notes`, 10000);
    if (i.source_checked_on !== null && !validDate(i.source_checked_on)) issue(`${p}.source_checked_on`, 'invalid_date', '来源日期无效');
  }
  return out;
}
/** A, S, T, L, M as specified in product design §12.2. Output is prediction only. */
export function incomeAtMonthV1(i: FutureIncomeV1, month: string, basisMonth: string, inflation: number | null): number | null {
  if (!i.included || i.monthly_cents === null || i.start_month === null || (i.basis === 'reference_month' && i.basis_month === null)) return null;
  if (month < i.start_month || (i.end_month !== null && month > i.end_month)) return 0;
  const S = monthIndexV1(i.basis === 'start_month' ? i.start_month : i.basis_month!);
  const T = monthIndexV1(basisMonth), L = monthIndexV1(i.start_month), M = monthIndexV1(month);
  const delta = i.growth === 'constant_purchasing_power' ? T - S : L - S - M + T;
  if (delta !== 0 && inflation === null) return null;
  if (inflation !== null && (!Number.isInteger(inflation) || inflation <= -10000)) return null;
  return Number(i.monthly_cents) * (1 + (inflation ?? 0) / 10000) ** (delta / 12);
}
