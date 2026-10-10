import { ConfirmationField } from './PlanningConfirmation';
import type { ConfirmationIssue } from './PlanningConfirmation';
import type { Dispatch, SetStateAction } from 'react';
import { money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { DateInput } from './DateInput';
import { estimateAccountCents, hundredthsToPct, rateText } from './plan';
import type { PensionForm } from './planning-basic-forms';
import type { Worker } from './plan-pension';
import { PERSONAL_PENSION_CAP_CENTS, beijing, defaultAssumptions, paramsFor, noOverrides } from './plan-params';
const workerText: Record<Worker, string> = { male: '男职工', female_cadre: '女干部（原 55 岁退休）', female_worker: '女工人（原 50 岁退休）' };
const taxRates = [0, 300, 1000, 2000, 2500, 3000, 3500, 4500];

/** Pension facts only. Blank means unknown (saved as unknown, never as 0); the estimate names what is still missing. */
export function PlanningProfileFields({ f, setF, today, frozen, hideBirth = false, missingKeys, completion = false, issue }: { f: PensionForm; setF: Dispatch<SetStateAction<PensionForm>>; today: string; frozen: boolean; hideBirth?: boolean; missingKeys?: (keyof PensionForm)[]; completion?: boolean; issue?: ConfirmationIssue | null }) {
  const set = <K extends keyof PensionForm>(k: K, v: PensionForm[K]) => setF(x => ({ ...x, [k]: v }));
  const defaults = paramsFor({ region: f.region || null, overrides: { ...noOverrides, avg_wage_cents: f.oWage || null } }, today);
  const show = (k: keyof PensionForm) => !missingKeys || missingKeys.includes(k);
  return <>
    <section className="form-block">
      {show('region') && <ConfirmationField label="参保地" attention={completion} issue={issue}><div role="radiogroup" aria-label="参保地">
        {[{ value: 'beijing' as const, label: '北京（内置参数）', hint: '参数带官方来源与核对日期。' }, { value: 'custom' as const, label: '其他城市（自己填当地参数）', hint: '按全国统一公式，用你填的当地参数估算。' }].map(r => <label className="plan-choice" key={r.value}><input type="radio" name="pension-region" aria-label={r.label} checked={f.region === r.value} disabled={frozen} onChange={() => set('region', r.value)}/><span><strong>{r.label}</strong><small>{r.hint}</small></span></label>)}
      </div></ConfirmationField>}
      {f.region === 'custom' && (show('oWage') || show('region')) && <ConfirmationField label="当地养老金计发基数" attention={completion} issue={issue}><FormRow label="当地养老金计发基数（月，必填）" hint={`一般是当地上年度职工月平均工资，可在当地人社局公告中查到；本次按 ${Number(today.slice(0, 4)) - 1} 年度作为假设`}><CentInput label="当地养老金计发基数" value={f.oWage} disabled={frozen} onChange={v => set('oWage', v)}/></FormRow></ConfirmationField>}
      {f.region === 'custom' && (show('oWage') || show('region')) && <details className="form-block"><summary>缴费基数上下限与利率（留空用默认）</summary>
        <p className="muted small">上下限默认按计发基数的 60% / 300% 假设，四舍五入到分。全国统一利率沿用内置测算值，未来利率仍是假设。</p>
        <FormRow label="缴费基数下限"><CentInput label="缴费基数下限" value={f.oLower} disabled={frozen} placeholder={defaults ? (Number(defaults.base_lower_cents) / 100).toFixed(2) : '计发基数的 60%'} onChange={v => set('oLower', v)}/></FormRow>
        <FormRow label="缴费基数上限"><CentInput label="缴费基数上限" value={f.oUpper} disabled={frozen} placeholder={defaults ? (Number(defaults.base_upper_cents) / 100).toFixed(2) : '计发基数的 300%'} onChange={v => set('oUpper', v)}/></FormRow>
        <FormRow label="记账利率（%）"><input aria-label="记账利率" inputMode="decimal" value={f.oNotional} disabled={frozen} placeholder={hundredthsToPct(beijing.notional_rate_hundredths)} onChange={e => set('oNotional', e.target.value)}/></FormRow>
        <FormRow label="公积金利率（%）"><input aria-label="公积金利率" inputMode="decimal" value={f.oHpf} disabled={frozen} placeholder={hundredthsToPct(beijing.hpf_rate_hundredths)} onChange={e => set('oHpf', e.target.value)}/></FormRow>
      </details>}
      {!hideBirth && show('birth') && <ConfirmationField label="出生日期" attention={completion} issue={issue}><FormRow label="出生日期" hint="点日历选择；只用到年和月"><DateInput id="profile-birth" label="出生日期" value={f.birth} max={today} disabled={frozen} onChange={v => set('birth', v)}/></FormRow></ConfirmationField>}
      {show('worker') && <ConfirmationField label="性别与职工类型" attention={completion} issue={issue}><FormRow label="性别与职工类型" hint="决定法定退休年龄的延迟节奏：男职工原 60 岁；女干部原 55 岁；女工人原 50 岁。拿不准就看劳动合同或问单位人事"><select aria-label="性别与职工类型" value={f.worker} disabled={frozen} onChange={e => set('worker', e.target.value as Worker | '')}><option value="">未填写</option>{(Object.keys(workerText) as Worker[]).map(k => <option key={k} value={k}>{workerText[k]}</option>)}</select></FormRow></ConfirmationField>}
      {show('paid') && <ConfirmationField label="累计缴费月数" attention={completion} issue={issue}><FormRow label="累计缴费月数" hint="当地社保查询记录里，数缴了养老保险的月数；明确没有才填 0"><input aria-label="累计缴费月数" inputMode="numeric" value={f.paid} disabled={frozen} onChange={e => set('paid', e.target.value)} placeholder="例如 48"/></FormRow></ConfirmationField>}
      {show('balance') && <ConfirmationField label="个人账户余额" attention={completion} issue={issue}><FormRow label="个人账户余额" hint="以社保查询的当前余额为准；未知先留空，明确没有才填 0"><span className="account-estimate"><CentInput label="个人账户余额" value={f.balance} disabled={frozen} placeholder="0.00" onChange={v => set('balance', v)}/><button type="button" className="ui-btn" disabled={frozen || !/^\d+$/.test(f.paid) || f.base === ''} onClick={() => set('balance', estimateAccountCents(Number(f.paid), f.base))}>帮我估算</button></span></FormRow></ConfirmationField>}
      {show('base') && <ConfirmationField label="当前月缴费基数" attention={completion} issue={issue}><FormRow label="当前月缴费基数" hint="按当前社保查询记录填写；未来续缴的起止与基数在「未来缴费」里单独设置"><CentInput label="当前月缴费基数" value={f.base} disabled={frozen} placeholder="0.00" onChange={v => set('base', v)}/></FormRow></ConfirmationField>}
    </section>
    {(!missingKeys || show('flex')) && <details className="form-block" open={!!missingKeys || f.past !== '' || f.flex !== '0'}><summary>更多（一般不用填）</summary>
      {show('past') && <ConfirmationField label="历史平均缴费指数" attention={completion} issue={issue}><FormRow label="历史平均缴费指数" hint="过去各月缴费基数 ÷ 当年社平的平均；留空表示与当前基数相同"><input aria-label="历史平均缴费指数" inputMode="decimal" value={f.past} disabled={frozen} onChange={e => set('past', e.target.value)} placeholder="例如 2.5"/></FormRow></ConfirmationField>}
      {show('flex') && <ConfirmationField label="弹性领取月数" attention={completion} issue={issue}><FormRow label="弹性领取月数" hint="不调整领取月份请填 0，不清楚留空；提前为负、延后为正，最多 36 个月"><input aria-label="弹性领取月数" inputMode="numeric" value={f.flex} disabled={frozen} onChange={e => set('flex', e.target.value)}/></FormRow></ConfirmationField>}
    </details>}
    {(show('pp') || show('tax')) && <section className="form-block">
      {show('pp') && <ConfirmationField label="个人养老金每年缴存" attention={completion} issue={issue}><FormRow label="个人养老金每年缴存" hint={`没有开户填 0；每年最多 ${money(String(PERSONAL_PENSION_CAP_CENTS))}。留空表示未知`}><CentInput label="个人养老金每年缴存" value={f.pp} disabled={frozen} placeholder="0.00" onChange={v => set('pp', v)}/></FormRow></ConfirmationField>}
      {show('tax') && <ConfirmationField label="个税边际税率" attention={completion} issue={issue}><FormRow label="个税边际税率" hint="用于估算个人养老金每年省多少税；这是假设"><select aria-label="个税边际税率" value={f.tax} disabled={frozen} onChange={e => set('tax', e.target.value)}><option value="">未填写</option>{taxRates.map(r => <option key={r} value={r}>{rateText(r)}</option>)}</select></FormRow></ConfirmationField>}
    </section>}
    {!missingKeys && <details className="form-block" open={f.wage !== hundredthsToPct(defaultAssumptions.wage_growth_hundredths) || f.ppReturn !== hundredthsToPct(defaultAssumptions.pp_return_hundredths)}><summary>假设（有默认值，一般不用改）</summary>
      <p className="muted small">下面是假设，不是事实；预填值是可修改的测算起点。通胀在「更多假设」里统一设置。</p>
      <ConfirmationField label="工资增长率" attention={completion} issue={issue}><FormRow label="工资与社平增长率（年，名义）" hint="这是假设"><input aria-label="工资增长率" inputMode="decimal" value={f.wage} disabled={frozen} onChange={e => set('wage', e.target.value)}/></FormRow></ConfirmationField>
      <ConfirmationField label="个人养老金收益率" attention={completion} issue={issue}><FormRow label="个人养老金收益率（年，名义）" hint="这是假设"><input aria-label="个人养老金收益率" inputMode="decimal" value={f.ppReturn} disabled={frozen} onChange={e => set('ppReturn', e.target.value)}/></FormRow></ConfirmationField>
    </details>}
    {!missingKeys && f.region === 'beijing' && <details className="form-block"><summary>参数覆盖（留空使用内置值）</summary>
      <ConfirmationField label="上年度月平均工资" attention={completion} issue={issue}><FormRow label="上年度月平均工资"><CentInput label="上年度月平均工资" value={f.oWage} disabled={frozen} placeholder={(Number(beijing.avg_wage_cents) / 100).toFixed(2)} onChange={v => set('oWage', v)}/></FormRow></ConfirmationField>
      <ConfirmationField label="缴费基数下限" attention={completion} issue={issue}><FormRow label="缴费基数下限"><CentInput label="缴费基数下限" value={f.oLower} disabled={frozen} placeholder={(Number(beijing.base_lower_cents) / 100).toFixed(2)} onChange={v => set('oLower', v)}/></FormRow></ConfirmationField>
      <ConfirmationField label="缴费基数上限" attention={completion} issue={issue}><FormRow label="缴费基数上限"><CentInput label="缴费基数上限" value={f.oUpper} disabled={frozen} placeholder={(Number(beijing.base_upper_cents) / 100).toFixed(2)} onChange={v => set('oUpper', v)}/></FormRow></ConfirmationField>
      <ConfirmationField label="记账利率" attention={completion} issue={issue}><FormRow label="记账利率（%）"><input aria-label="记账利率" inputMode="decimal" value={f.oNotional} disabled={frozen} placeholder={hundredthsToPct(beijing.notional_rate_hundredths)} onChange={e => set('oNotional', e.target.value)}/></FormRow></ConfirmationField>
      <ConfirmationField label="公积金利率" attention={completion} issue={issue}><FormRow label="公积金利率（%）"><input aria-label="公积金利率" inputMode="decimal" value={f.oHpf} disabled={frozen} placeholder={hundredthsToPct(beijing.hpf_rate_hundredths)} onChange={e => set('oHpf', e.target.value)}/></FormRow></ConfirmationField>
    </details>}
  </>;
}
