import { defaultRetire, hundredthsToPct, pctToHundredths } from './plan.ts';
import type { StoredProfile } from './plan.ts';
import type { Worker } from './plan-pension.ts';
import { defaultAssumptions, noOverrides } from './plan-params.ts';
export type Form = { birth: string; worker: Worker; paid: string; balance: string; base: string; past: string; flex: string; pp: string; tax: string; infl: string; wage: string; ppReturn: string;
  oWage: string; oLower: string; oUpper: string; oNotional: string; oHpf: string };
export const toForm = (p: StoredProfile | null): Form => ({
  birth: p?.birth_month ? p.birth_month + '-01' : '', worker: p?.worker ?? 'male', paid: p?.paid_months == null ? '' : String(p.paid_months), balance: p?.account_balance_cents ?? '', base: p?.base_cents ?? '',
  past: p?.past_index_hundredths == null ? '' : String(p.past_index_hundredths / 100), flex: String(p?.flex_months ?? 0), pp: p?.personal_pension_annual_cents ?? '0', tax: String(p?.marginal_tax_hundredths ?? 1000),
  infl: hundredthsToPct((p?.assumptions ?? defaultAssumptions).inflation_hundredths), wage: hundredthsToPct((p?.assumptions ?? defaultAssumptions).wage_growth_hundredths), ppReturn: hundredthsToPct((p?.assumptions ?? defaultAssumptions).pp_return_hundredths),
  oWage: p?.overrides.avg_wage_cents ?? '', oLower: p?.overrides.base_lower_cents ?? '', oUpper: p?.overrides.base_upper_cents ?? '',
  oNotional: p?.overrides.notional_rate_hundredths == null ? '' : hundredthsToPct(p.overrides.notional_rate_hundredths), oHpf: p?.overrides.hpf_rate_hundredths == null ? '' : hundredthsToPct(p.overrides.hpf_rate_hundredths),
});

export function profileFromForm(f: Form, previous: StoredProfile | null, today: string): StoredProfile {
  const invalid = (label: string, message: string) => new Error(`${label}：${message}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birth) || !Number.isFinite(Date.parse(f.birth)) || new Date(f.birth + 'T00:00:00Z').toISOString().slice(0, 10) !== f.birth) throw invalid('出生日期', '请选择出生日期。');
    if (f.birth.slice(0, 7) >= today.slice(0, 7)) throw invalid('出生日期', '出生日期须早于本月。');
    if (!/^\d{1,4}$/.test(f.paid) || Number(f.paid) > 1200) throw invalid('累计缴费月数', '请填写累计缴费月数（社保 App 可查），明确没有才填 0；未知可先关闭，继续查看真实记录。');
    if (f.balance === '') throw invalid('个人账户余额', '请填写个人账户余额，明确没有才填 0；未知可先关闭，继续查看真实记录。');
    if (f.base === '') throw invalid('当前月缴费基数', '请填写当前月缴费基数。');
    const infl = pctToHundredths(f.infl), wage = pctToHundredths(f.wage), ppr = pctToHundredths(f.ppReturn);
    if (infl === null) throw invalid('通胀率', '通胀率请填百分数，例如 2 或 2.5。');
    if (wage === null) throw invalid('工资增长率', '工资增长率请填百分数，例如 3。');
    if (ppr === null) throw invalid('个人养老金收益率', '个人养老金收益率请填百分数，例如 2。');
    const flex = Number(f.flex);
    if (!Number.isInteger(flex) || flex < -36 || flex > 36) throw invalid('弹性领取月数', '弹性提前或延后须是 −36 到 36 之间的整数月。');
    const past = f.past.trim() === '' ? null : Math.round(Number(f.past) * 100);
    if (past !== null && !(past >= 1 && past <= 1000)) throw invalid('历史平均缴费指数', '历史平均缴费指数请填 0.01 到 10 之间的数，或留空。');
    const rateOrNull = (text: string, label: string): number | null | undefined => { if (text.trim() === '') return null; const v = pctToHundredths(text); if (v === null) { throw invalid(label, `${label}请填百分数，或留空使用内置值。`); } return v; };
    const notional = rateOrNull(f.oNotional, '记账利率'); if (notional === undefined) throw invalid('记账利率', '请核对记账利率');
    const hpf = rateOrNull(f.oHpf, '公积金利率'); if (hpf === undefined) throw invalid('公积金利率', '请核对公积金利率');
    const profile: StoredProfile = {
      birth_month: f.birth.slice(0, 7), worker: f.worker, region: 'beijing', paid_months: Number(f.paid), account_balance_cents: f.balance, base_cents: f.base, past_index_hundredths: past, flex_months: flex,
      personal_pension_annual_cents: f.pp, marginal_tax_hundredths: Number(f.tax), assumptions: { inflation_hundredths: infl, wage_growth_hundredths: wage, pp_return_hundredths: ppr },
      overrides: { ...noOverrides, avg_wage_cents: f.oWage || null, base_lower_cents: f.oLower || null, base_upper_cents: f.oUpper || null, notional_rate_hundredths: notional, hpf_rate_hundredths: hpf },
      retire: previous?.retire ?? defaultRetire,
    };

    return profile;
}
