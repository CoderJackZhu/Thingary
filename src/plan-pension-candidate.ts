// One explicit candidate path; not wired to career search or ordinary planning.
import { prepareBeijingIndex } from './plan-pension-index.ts';
import type { BeijingIndexInput } from './plan-pension-index.ts';
import { projectPensionAccount } from './plan-pension-account.ts';
import type { PensionAccountInput } from './plan-pension-account.ts';
import { beijingBenefitForLedger } from './plan-pension-policy-ledger.ts';
import type { PolicyLedgerInput } from './plan-pension-policy-ledger.ts';
import type { BeijingBenefitInput } from './plan-pension-policy.ts';

export type BeijingPensionPathInput = {
  index: BeijingIndexInput | null;
  account: Omit<PensionAccountInput,'months'|'end_month'> | null;
  benefit: Omit<BeijingBenefitInput,'average_index'|'paid_months_at_retirement'|'account_at_retirement'> | null;
  ledger: Omit<PolicyLedgerInput,'benefit'> | null;
};
const blocked = (kind:'missing'|'invalid',field:string,message:string) => ({status:'blocked',issues:[{kind,field,message}]} as const);

/** Derived amounts cannot be supplied separately. All future contribution and
 * interest premises stay explicit, and partial index years remain unsupported. */
export function prepareBeijingPensionPath(input: BeijingPensionPathInput) {
  for(const field of ['index','account','benefit','ledger'] as const){
    if(input[field]==null)return blocked('missing',field,'请明确该组条件，未知不能自动填补。');
    if(typeof input[field]!=='object'||Array.isArray(input[field]))return blocked('invalid',field,'该组条件须为明确的字段对象。');
  }
  for(const field of ['average_index','paid_months_at_retirement','account_at_retirement'])
    if(field in input.benefit!)return blocked('invalid','benefit','最终指数、实缴月数和账户余额须由同一候选路径生成，不能另传固定值。');
  if('months' in input.account!||'end_month' in input.account!)return blocked('invalid','account','账户外推的月记录与截至月须来自同一候选路径。');
  const index=prepareBeijingIndex(input.index!);
  if(index.status==='blocked')return index;
  const opening=input.account!.opening;
  const account=projectPensionAccount({...input.account!,end_month:input.index!.retirement_month,
    months:input.index!.months!.filter(m=>opening&&typeof opening.month==='string'&&m.month>opening.month)});
  if(account.status==='blocked')return account;
  const bridge=beijingBenefitForLedger({...input.ledger!,benefit:{...input.benefit!,average_index:index.value.average_index,
    paid_months_at_retirement:index.value.paid_months,account_at_retirement:account.value.account_at_end}});
  if(bridge.status==='blocked')return bridge;
  if(bridge.value.benefit.retirement_month!==input.index!.retirement_month)
    return blocked('invalid','index.retirement_month','路径退休月与出生月、职工类别及弹性退休条件不一致。');
  return {status:'ready',value:{index:index.value,account:account.value,benefit:bridge.value.benefit,pension:bridge.value.pension}} as const;
}
