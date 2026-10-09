// Explicit bridge to the existing ledger; no automatic career-path inference.
import { calculateBeijingBenefit } from './plan-pension-policy.ts';
import type { BeijingBenefitInput } from './plan-pension-policy.ts';
import type { Pension } from './plan-fire.ts';

export type PolicyLedgerInput = {
  benefit: BeijingBenefitInput;
  /** Supplied conversion from plan purchasing-power basis to first-payment money.
   * Retiring and starting payment in different months must not add hidden inflation. */
  nominal_factor_at_income_start: number | null;
  /** Existing Pension cashflow is constant real money. Must be explicitly assumed. */
  inflation_indexed_after_start: boolean | null;
  /** Independent confirmed restricted pool, never the social-security account. */
  pool: { lump_cents: number; unlock_age_months: number } | null;
};

export function beijingBenefitForLedger(input: PolicyLedgerInput) {
  const result=calculateBeijingBenefit(input.benefit);
  if(result.status==='blocked')return result;
  if(input.nominal_factor_at_income_start==null||input.inflation_indexed_after_start==null||input.pool==null)
    return {status:'blocked',issues:[{kind:'missing',field:'ledger',message:'须明确购买力转换、领取后金额假设与独立受限资金；没有资金须显式填0。'}]} as const;
  const factor=input.nominal_factor_at_income_start,pool=input.pool;
  if(!Number.isFinite(factor)||factor<=0||!Number.isSafeInteger(pool.lump_cents)||pool.lump_cents<0||!Number.isSafeInteger(pool.unlock_age_months)||pool.unlock_age_months<0)
    return {status:'blocked',issues:[{kind:'invalid',field:'ledger',message:'购买力系数和资金解锁条件不合法。'}]} as const;
  if(input.inflation_indexed_after_start!==true)
    return {status:'blocked',issues:[{kind:'unsupported',field:'ledger',message:'本适配器仅支持显式假设领取后随通胀增长；固定名义金额须另用收入流。'}]} as const;
  const monthly=result.value.payable_monthly_cents/factor;
  if(!Number.isFinite(monthly)||monthly>Number.MAX_SAFE_INTEGER)
    return {status:'blocked',issues:[{kind:'invalid',field:'ledger',message:'购买力转换后金额超出安全范围。'}]} as const;
  const birth=input.benefit.birth_month!;
  const age=(s:string)=>(Number(s.slice(0,4))-Number(birth.slice(0,4)))*12+Number(s.slice(5))-Number(birth.slice(5));
  const pension: Pension={monthly_cents:monthly,lump_cents:pool.lump_cents,unlock_age_months:pool.unlock_age_months,
    income_start_age_months:result.value.payable_from_month?age(result.value.payable_from_month):null,
    eligible:result.value.eligible,short_months:result.value.short_months};
  return {status:'ready',value:{pension,benefit:result.value}} as const;
}
