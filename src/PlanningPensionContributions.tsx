import { CentInput, FormRow } from './FormControls';
import { MonthInput } from './DateInput';
import type { Draft } from './planning-basic-forms';

/** The existing contribution dates/base and core monthly deposit. Unknown never becomes a zero. */
export function PensionContributionsEditor({ d, patch, frozen, today }: { d: Draft; patch: (v: Partial<Draft>) => void; frozen: boolean; today: string }) {
  const choice = d.pcStart !== '' && d.pcStart === d.pcStop ? 'stop' : d.pcPlan === '' ? '' : 'continue';
  return <section className="form-block">
    <FormRow label="以后还继续交社保吗？"><select aria-label="以后还继续交社保吗" value={choice} disabled={frozen} onChange={e => {
      if (e.target.value === '') patch({ pcPlan: '', pcStart: '', pcStop: '' });
      else if (e.target.value === 'stop') patch({ pcPlan: 'custom', pcStart: today.slice(0, 7), pcStop: today.slice(0, 7) });
      else patch({ pcPlan: 'custom', pcStop: choice === 'stop' ? '' : d.pcStop });
    }}><option value="">还不清楚，先留空</option><option value="continue">继续交，填写下面的月份</option><option value="stop">这次不再交</option></select></FormRow>
    <FormRow label="从哪个月开始"><MonthInput label="未来缴费开始月份" value={d.pcStart} disabled={frozen} allowClear onChange={v => patch({ pcPlan: 'custom', pcStart: v })}/></FormRow>
    <FormRow label="到哪个月停止" hint="停止月份不再缴费；不再交时，开始和停止填同一个月"><MonthInput label="未来缴费停止月份" value={d.pcStop} min={d.pcStart || undefined} disabled={frozen} allowClear onChange={v => patch({ pcPlan: 'custom', pcStop: v })}/></FormRow>
    <FormRow label="以后每月按多少基数缴费" hint="不再交可以填 0；不清楚留空，未来基数与当前社保记录分开保存"><CentInput label="未来月缴费基数" value={d.pcBase} disabled={frozen} onChange={v => patch({ pcBase: v })}/></FormRow>
    <FormRow label="公积金每月缴存" hint="个人与单位合计；没有填 0，不清楚留空"><CentInput label="未来公积金每月缴存" value={d.hpf} disabled={frozen} onChange={v => patch({ hpf: v })}/></FormRow>
  </section>;
}
