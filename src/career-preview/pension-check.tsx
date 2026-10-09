import { useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { calculateBeijingBenefit } from '../plan-pension-policy.ts';
import type { BeijingBenefitInput } from '../plan-pension-policy.ts';
import type { PlanningSources } from '../plan-basic-contract.ts';
import { checkAssumption, decimalIndex, fictionalPensionCheck, pensionCheckInput } from './pension-check.ts';
import { money } from './result-text.ts';

const labels: Record<keyof BeijingBenefitInput, string> = {
  scope: '适用范围', birth_month: '出生月份', worker: '职工类别', flex_months: '弹性退休月数',
  paid_months_at_retirement: '退休时累计实缴月数', average_index: '退休时最终缴费指数', benefit_base: '待遇计发基数及年份',
  account_at_retirement: '退休时个人账户余额', disbursement: '计发月数',
};
const number = (s: string) => s === '' ? null : Number(s);

export function PensionCheck({ sources }: { sources: PlanningSources }) {
  const [input, setInput] = useState(() => pensionCheckInput(sources));
  const [indexText, setIndexText] = useState('');
  const patch = (value: Partial<BeijingBenefitInput>) => setInput(p => ({ ...p, ...value }));
  const reset = (p: BeijingBenefitInput) => { setInput(p); setIndexText(p.average_index ? String(p.average_index.ten_thousandths / 10000) : ''); };
  const result = calculateBeijingBenefit(input);
  return <details className="career-pension-check"><summary>核对一组养老金金额条件</summary>
    <p>这里核对的是你明确给定的退休时条件，不会随上面的空窗、储蓄或缴费基数变化，也未计入职业主答案。全部金额是退休年份的名义金额。</p>
    <p className="career-footnote">最终缴费指数不是自选缴费基数；退休时账户余额也不是今天的余额。缺少这些信息时可先留空。</p>
    <div className="career-toolbar"><button type="button" onClick={() => reset(fictionalPensionCheck())}>载入完整虚构假设</button><button type="button" onClick={() => reset(pensionCheckInput(sources))}>清空核对条件</button></div>
    <p className="career-footnote">虚构假设：1994-10 出生、男性、弹性月数为 0，退休时实缴 276 个月、最终指数 0.9200、账户 117,000 元、计发月数 117；2057 年基数假设为 12,049 元，不代表已公布的未来政策。</p>
    <FormRow label={labels.scope}><select aria-label={labels.scope} value={input.scope ?? ''} onChange={e => patch({ scope: (e.target.value || null) as BeijingBenefitInput['scope'] })}><option value="">尚未确认</option><option value="beijing-enterprise-post-1998">北京企业职工，1998年7月及以后参保，无视同缴费等特殊情形</option><option value="other">其他情形</option></select></FormRow>
    <FormRow label={labels.birth_month}><MonthInput label={labels.birth_month} value={input.birth_month ?? ''} onChange={v => patch({ birth_month: v || null })}/></FormRow>
    <FormRow label={labels.worker}><select aria-label={labels.worker} value={input.worker ?? ''} onChange={e => patch({ worker: (e.target.value || null) as BeijingBenefitInput['worker'] })}><option value="">尚未确认</option><option value="male">男职工</option><option value="female_cadre">原55岁女职工类别</option><option value="female_worker">原50岁女职工类别</option></select></FormRow>
    <FormRow label={labels.flex_months} hint="负数提前，正数延迟；办理条件仍须核对。"><input aria-label={labels.flex_months} type="number" min="-36" max="36" step="1" value={input.flex_months ?? ''} onChange={e => patch({ flex_months: number(e.target.value) })}/></FormRow>
    <FormRow label={labels.paid_months_at_retirement}><input aria-label={labels.paid_months_at_retirement} type="number" min="0" step="1" value={input.paid_months_at_retirement ?? ''} onChange={e => patch({ paid_months_at_retirement: number(e.target.value) })}/></FormRow>
    <FormRow label={labels.average_index} hint="例如 0.9200，最多四位小数；不自动推算。"><input aria-label={labels.average_index} inputMode="decimal" value={indexText} onChange={e => { setIndexText(e.target.value); patch({ average_index: e.target.value === '' ? null : { ten_thousandths: decimalIndex(e.target.value), ...checkAssumption } }); }}/></FormRow>
    <FormRow label="待遇计发基数（元/月）" hint="须与实际退休年份对应，不能用社保缴费基数代替。"><CentInput label="待遇计发基数" value={input.benefit_base?.cents ?? ''} onChange={v => patch({ benefit_base: { cents: v, year: input.benefit_base?.year ?? NaN, ...checkAssumption } })}/></FormRow>
    <FormRow label="待遇计发基数适用年份"><input aria-label="待遇计发基数适用年份" type="number" step="1" value={Number.isFinite(input.benefit_base?.year) ? input.benefit_base!.year : ''} onChange={e => patch({ benefit_base: { cents: input.benefit_base?.cents ?? '', year: number(e.target.value) ?? NaN, ...checkAssumption } })}/></FormRow>
    <FormRow label="退休时个人账户余额（元）"><CentInput label={labels.account_at_retirement} value={input.account_at_retirement?.cents ?? ''} onChange={v => patch({ account_at_retirement: v === '' ? null : { cents: v, ...checkAssumption } })}/></FormRow>
    <FormRow label={labels.disbursement} hint="非整岁口径未核实，手填数值仅作假设。"><input aria-label={labels.disbursement} type="number" min="0" step="any" value={input.disbursement?.months ?? ''} onChange={e => patch({ disbursement: e.target.value === '' ? null : { months: Number(e.target.value), ...checkAssumption } })}/></FormRow>
    <div className="career-delta" aria-label="养老金金额核对结果" aria-live="polite">
      {result.status === 'blocked' ? <><h3>暂不能核对金额</h3><ul>{result.issues.map(i => <li key={`${i.field}-${i.kind}`}>{labels[i.field]}：{i.kind === 'missing' ? '尚未填写或确认' : i.field === 'average_index' && i.kind === 'invalid' ? '请输入非负指数，最多四位小数；不会自动舍入。' : i.message}</li>)}</ul></> : <>
        <h3>给定条件下的金额核对</h3><p>假设试算，未计入职业主答案</p>
        <dl><dt>基础养老金 / 月</dt><dd>{money(result.value.base_monthly_cents)}</dd><dt>个人账户养老金 / 月</dt><dd>{money(result.value.account_monthly_cents)}</dd><dt>公式合计 / 月</dt><dd>{money(result.value.total_monthly_cents)}</dd>
          <dt>按月领取资格</dt><dd>{result.value.eligible ? `实缴 ${result.value.paid_months} 个月，达到 ${result.value.required_year} 年所需 ${result.value.required_months} 个月；仍须审批` : `还缺 ${result.value.short_months} 个月；不自动补缴或退款`}</dd>
          <dt>所给条件下的退休月</dt><dd>{result.value.retirement_month}</dd><dt>可计入的月收入与计划起领月</dt><dd>{result.value.payable_from_month ? `${money(result.value.payable_monthly_cents)} / 月，${result.value.payable_from_month} 起（假设获批）` : '资格不足，暂不能计入月收入，无可领取起月'}</dd></dl>
        <p className="career-footnote">指数、计发基数、退休时账户余额及计发月数来源：本次手动假设。更改这些条件会重新核算；结果不是经办机构核定待遇。</p>
      </>}
    </div>
  </details>;
}
