// Explicit-input Beijing benefit kernel. No storage, projection of past facts,
// career defaults, account growth, or restricted-asset unlocking here.
import { startAgeMonths, statutoryAgeMonths, requiredContributionMonths } from './plan-pension.ts';
import type { Worker } from './plan-pension.ts';
import { pensionMonths } from './plan-params.ts';

export type PolicySource = { basis: 'verified' | 'assumption'; source: string };
type Amount = PolicySource & { cents: string };
export type BeijingBenefitInput = {
  scope: 'beijing-enterprise-post-1998' | 'other' | null;
  birth_month: string | null;
  worker: Worker | null;
  flex_months: number | null;
  /** All actual paid months through retirement, including its month if paid. */
  paid_months_at_retirement: number | null;
  /** Final Z实指数, NOT a historical paid-month mean or current-base ratio. */
  average_index: (PolicySource & { ten_thousandths: number }) | null;
  benefit_base: (Amount & { year: number }) | null;
  /** Nominal account at retirement, NOT today's account balance. */
  account_at_retirement: Amount | null;
  disbursement: (PolicySource & { months: number }) | null;
};
export type PolicyIssue = { kind: 'missing' | 'invalid' | 'unsupported'; field: keyof BeijingBenefitInput; message: string };
export type BeijingBenefitResult = { status: 'blocked'; issues: PolicyIssue[] } | {
  status: 'ready';
  value: {
    retirement_month: string; scheduled_payment_month: string; payable_from_month: string | null;
    required_year: number; required_months: number; paid_months: number; short_months: number; eligible: boolean;
    contribution_years: number; average_index: number;
    base_monthly_cents: number; account_monthly_cents: number; total_monthly_cents: number; payable_monthly_cents: number;
    sources: Record<'average_index' | 'benefit_base' | 'account_at_retirement' | 'disbursement', PolicySource>;
  };
};
const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5)) - 1;
const monthText = (m: number) => `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}`;
const money = (v: string) => typeof v === 'string' && /^(0|[1-9]\d*)$/.test(v) && Number.isSafeInteger(Number(v));
const roundRatio = (n: bigint, d: bigint) => Number((n * 2n + d) / (d * 2n));
const sourceCopy = (v: PolicySource): PolicySource => ({ basis: v.basis, source: v.source });

/** Ready means calculable under supplied premises, not approved entitlement.
 * 年限/指数精度：北京官方测算表公式说明；资格年份/起领：人社部发〔2024〕94号§7/9。
 * Annual Z-index preparation remains outside this kernel until separately verified. */
export function calculateBeijingBenefit(input: BeijingBenefitInput): BeijingBenefitResult {
  const issues: PolicyIssue[] = [];
  const issue = (kind: PolicyIssue['kind'], field: PolicyIssue['field'], message: string) => issues.push({ kind, field, message });
  const keys: (keyof BeijingBenefitInput)[] = ['scope', 'birth_month', 'worker', 'flex_months', 'paid_months_at_retirement', 'average_index', 'benefit_base', 'account_at_retirement', 'disbursement'];
  for (const field of keys) if (input[field] == null) issue('missing', field, `请确认 ${field}；未知不能按零或默认值试算。`);
  if (issues.length) return { status: 'blocked', issues };

  if (input.scope !== 'beijing-enterprise-post-1998') issue('unsupported', 'scope', '仅支持已确认的北京企业职工1998年7月以后参保、无过渡性养老金等特殊情形。');
  if (typeof input.birth_month !== 'string' || !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(input.birth_month)) issue('invalid', 'birth_month', '出生月须为1900至2199年的合法年月。');
  if (!['male', 'female_cadre', 'female_worker'].includes(input.worker!)) issue('invalid', 'worker', '职工类别须独立核对，不能按职业名称推定。');
  if (!Number.isInteger(input.flex_months) || Math.abs(input.flex_months!) > 36) issue('invalid', 'flex_months', '弹性月数须为−36至36的整数。');
  if (!Number.isInteger(input.paid_months_at_retirement) || input.paid_months_at_retirement! < 0 || input.paid_months_at_retirement! > 1200) issue('invalid', 'paid_months_at_retirement', '实缴月数须为0至1200的整数，不按天数折算。');
  for (const field of ['average_index', 'benefit_base', 'account_at_retirement', 'disbursement'] as const) {
    const v = input[field]!;
    if (!['verified', 'assumption'].includes(v.basis) || typeof v.source !== 'string' || !v.source.trim()) issue('invalid', field, '须给出来源并区分已核对数值与明确假设。');
  }
  const index = input.average_index!, base = input.benefit_base!, account = input.account_at_retirement!, disbursement = input.disbursement!;
  if (!Number.isSafeInteger(index.ten_thousandths) || index.ten_thousandths < 0) issue('invalid', 'average_index', '指数须为非负万分位整数，不自动截断或夹到0.6。');
  if (!money(base.cents) || Number(base.cents) <= 0 || !Number.isInteger(base.year)) issue('invalid', 'benefit_base', '待遇计发基数须为正整数分，且须明确退休适用年份。');
  if (!money(account.cents)) issue('invalid', 'account_at_retirement', '退休时账户余额须为非负整数分。');
  if (!Number.isFinite(disbursement.months) || disbursement.months <= 0) issue('invalid', 'disbursement', '计发月数须为有限正数。');
  if (issues.length) return { status: 'blocked', issues };

  const birth = input.birth_month!, worker = input.worker!, flex = input.flex_months!;
  const statutory = statutoryAgeMonths(worker, birth), original = { male: 720, female_cadre: 660, female_worker: 600 }[worker];
  if (monthIndex(birth) + original < 2025 * 12) issue('unsupported', 'birth_month', '2025年前已达原法定退休年龄，不适用本接口的弹性退休规则。');
  const age = startAgeMonths({ birth_month: birth, worker, flex_months: flex });
  const retirement = monthIndex(birth) + age, year = Math.floor(retirement / 12);
  if (input.paid_months_at_retirement! > Math.min(age, retirement - monthIndex('1998-07') + 1)) issue('invalid', 'paid_months_at_retirement', '实缴月数超过本接口参保范围内可存在的月份，请重新核对。');
  if (base.year !== year) issue('invalid', 'benefit_base', '待遇计发基数的适用年份必须与本次实际退休年份一致。');
  if (disbursement.basis === 'verified') {
    if (age % 12 !== 0) issue('unsupported', 'disbursement', '非整岁计发月数尚未核实；仅能以明确假设试算。');
    else if (pensionMonths[age / 12] !== disbursement.months) issue('invalid', 'disbursement', '计发月数与该整岁退休年龄的官方表值不符。');
  }
  if (issues.length) return { status: 'blocked', issues };

  const paid = input.paid_months_at_retirement!;
  const requiredYear = Math.floor((monthIndex(birth) + Math.min(age, statutory)) / 12);
  const required = requiredContributionMonths(requiredYear), short = Math.max(0, required - paid);
  // Exactly round years to 2 decimals before amount calculation; qualification
  // above retains integer months. Integer ratios avoid cent-level tie drift.
  const yearsHundredths = roundRatio(BigInt(paid) * 100n, 12n);
  const basic = roundRatio(BigInt(base.cents) * (10000n + BigInt(index.ten_thousandths)) * BigInt(yearsHundredths), 200000000n);
  const individual = Number.isInteger(disbursement.months)
    ? roundRatio(BigInt(account.cents), BigInt(disbursement.months))
    : Math.round(Number(account.cents) / disbursement.months);
  const total = basic + individual;
  if (![basic, individual, total].every(Number.isSafeInteger)) return { status: 'blocked', issues: [{ kind: 'invalid', field: 'benefit_base', message: '计算结果超出可安全表示的整数分范围。' }] };
  const paymentMonth = monthText(retirement + 1);
  return { status: 'ready', value: {
    retirement_month: monthText(retirement), scheduled_payment_month: paymentMonth, payable_from_month: short ? null : paymentMonth,
    required_year: requiredYear, required_months: required, paid_months: paid, short_months: short, eligible: short === 0,
    contribution_years: yearsHundredths / 100, average_index: index.ten_thousandths / 10000,
    base_monthly_cents: basic, account_monthly_cents: individual, total_monthly_cents: total, payable_monthly_cents: short ? 0 : total,
    sources: { average_index: sourceCopy(index), benefit_base: sourceCopy(base), account_at_retirement: sourceCopy(account), disbursement: sourceCopy(disbursement) },
  } };
}
