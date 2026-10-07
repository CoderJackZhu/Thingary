import type { Dispatch, SetStateAction } from 'react';
import { money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { DateInput } from './DateInput';
import { estimateAccountCents, hundredthsToPct, rateText } from './plan';
import type { Form } from './planning-profile';
import type { Worker } from './plan-pension';
import { PERSONAL_PENSION_CAP_CENTS, beijing, defaultAssumptions } from './plan-params';
const workerText: Record<Worker, string> = { male: '男职工', female_cadre: '女干部（原 55 岁退休）', female_worker: '女工人（原 50 岁退休）' };
const taxRates = [0, 300, 1000, 2000, 2500, 3000, 3500, 4500];
export function PlanningProfileFields({ f, setF, today, frozen, guided = false }: { f: Form; setF: Dispatch<SetStateAction<Form>>; today: string; frozen: boolean; guided?: boolean }) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(x => ({ ...x, [k]: v }));
  return <>
    <section className="form-block">
      <FormRow label="出生日期" hint="点日历选择；只用到年和月"><DateInput id="profile-birth" label="出生日期" value={f.birth} max={today} disabled={frozen} onChange={v => set('birth', v)}/></FormRow>
      <FormRow label="性别与职工类型" hint={guided ? "以当前职工类型填写，用于法定退休年龄估算" : "决定法定退休年龄的延迟节奏：男职工原 60 岁；女干部（干部、管理、专业技术岗位）原 55 岁；女工人（一线工人）原 50 岁。拿不准就看劳动合同或问单位人事"}><select aria-label="性别与职工类型" value={f.worker} disabled={frozen} onChange={e => set('worker', e.target.value as Worker)}>{(Object.keys(workerText) as Worker[]).map(k => <option key={k} value={k}>{workerText[k]}</option>)}</select></FormRow>
      <FormRow label="累计缴费月数" hint="京通「社保缴费信息」里，数缴了养老保险的月数"><input aria-label="累计缴费月数" inputMode="numeric" value={f.paid} disabled={frozen} onChange={e => set('paid', e.target.value)} placeholder="例如 48"/></FormRow>
      <FormRow label="个人账户余额" hint={guided ? "社保查询的当前个人账户余额；未知可先跳过" : "把每月个人缴的养老里记入账户的部分加起来（单位上班是 8% 的基数，灵活就业也只有 8% 进账户）；以社保查询余额为准；未知可先跳过设置，明确没有才填 0。粗估只能作测算假设"}><span className="account-estimate"><CentInput label="个人账户余额" value={f.balance} disabled={frozen} placeholder="0.00" onChange={v => set('balance', v)}/>{!guided && <button type="button" className="ui-btn" disabled={frozen || !/^\d+$/.test(f.paid) || f.base === ''} onClick={() => set('balance', estimateAccountCents(Number(f.paid), f.base))}>帮我估算</button>}</span></FormRow>
      <FormRow label="当前月缴费基数" hint="按当前社保查询记录填写；未来续缴基数在计划中单独调整"><CentInput label="当前月缴费基数" value={f.base} disabled={frozen} placeholder="0.00" onChange={v => set('base', v)}/></FormRow>
    </section>
    <details className="form-block" open={f.past !== '' || f.flex !== '0'}><summary>更多（一般不用填）</summary>
      <FormRow label="历史平均缴费指数" hint="过去各月缴费基数 ÷ 当年社平的平均；留空表示与当前基数相同。只有过去的基数和现在差得很多时才需要填"><input aria-label="历史平均缴费指数" inputMode="decimal" value={f.past} disabled={frozen} onChange={e => set('past', e.target.value)} placeholder="例如 2.5"/></FormRow>
      <FormRow label="弹性领取月数" hint="保持 0 即可；想比较提前或延后领取时才改：提前为负、延后为正，最多 36 个月"><input aria-label="弹性领取月数" inputMode="numeric" value={f.flex} disabled={frozen} onChange={e => set('flex', e.target.value)}/></FormRow>
    </details>
    <section className="form-block">
      <FormRow label="个人养老金每年缴存" hint={`没有开户填 0；每年最多 ${money(String(PERSONAL_PENSION_CAP_CENTS))}`}><CentInput label="个人养老金每年缴存" value={f.pp} disabled={frozen} placeholder="0.00" onChange={v => set('pp', v)}/></FormRow>
      <FormRow label="个税边际税率" hint="用于估算个人养老金每年省多少税"><select aria-label="个税边际税率" value={f.tax} disabled={frozen} onChange={e => set('tax', e.target.value)}>{taxRates.map(r => <option key={r} value={r}>{rateText(r)}</option>)}</select></FormRow>
    </section>
    <details className="form-block" open={f.infl !== hundredthsToPct(defaultAssumptions.inflation_hundredths) || f.wage !== hundredthsToPct(defaultAssumptions.wage_growth_hundredths) || f.ppReturn !== hundredthsToPct(defaultAssumptions.pp_return_hundredths)}><summary>假设（有默认值，一般不用改）</summary>
      <p className="muted small">下面是假设，不是事实；预填值是可修改的测算起点，请按自己的判断修改。</p>
      <FormRow label="通胀率（年）" hint="这是假设"><input aria-label="通胀率" inputMode="decimal" value={f.infl} disabled={frozen} onChange={e => set('infl', e.target.value)}/></FormRow>
      <FormRow label="工资与社平增长率（年，名义）" hint="这是假设"><input aria-label="工资增长率" inputMode="decimal" value={f.wage} disabled={frozen} onChange={e => set('wage', e.target.value)}/></FormRow>
      <FormRow label="个人养老金收益率（年，名义）" hint="这是假设"><input aria-label="个人养老金收益率" inputMode="decimal" value={f.ppReturn} disabled={frozen} onChange={e => set('ppReturn', e.target.value)}/></FormRow>
    </details>
    <details className="form-block"><summary>参数覆盖（留空使用内置值）</summary>
      <FormRow label="上年度月平均工资"><CentInput label="上年度月平均工资" value={f.oWage} disabled={frozen} placeholder={(Number(beijing.avg_wage_cents) / 100).toFixed(2)} onChange={v => set('oWage', v)}/></FormRow>
      <FormRow label="缴费基数下限"><CentInput label="缴费基数下限" value={f.oLower} disabled={frozen} placeholder={(Number(beijing.base_lower_cents) / 100).toFixed(2)} onChange={v => set('oLower', v)}/></FormRow>
      <FormRow label="缴费基数上限"><CentInput label="缴费基数上限" value={f.oUpper} disabled={frozen} placeholder={(Number(beijing.base_upper_cents) / 100).toFixed(2)} onChange={v => set('oUpper', v)}/></FormRow>
      <FormRow label="记账利率（%）"><input aria-label="记账利率" inputMode="decimal" value={f.oNotional} disabled={frozen} placeholder={hundredthsToPct(beijing.notional_rate_hundredths)} onChange={e => set('oNotional', e.target.value)}/></FormRow>
      <FormRow label="公积金利率（%）"><input aria-label="公积金利率" inputMode="decimal" value={f.oHpf} disabled={frozen} placeholder={hundredthsToPct(beijing.hpf_rate_hundredths)} onChange={e => set('oHpf', e.target.value)}/></FormRow>
    </details>
  </>;
}
