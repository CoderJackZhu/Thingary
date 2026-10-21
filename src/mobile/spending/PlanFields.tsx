import { money } from '../../asset';
import { oneMonthBefore, rentIntervals, rentPreview } from '../../rent-plan';
import type { RentForm } from '../../rent-plan';
import { DateField, FormGroup, MoneyField, SelectField } from '../ui';

/**
 * Simple schedule form shared by plan and subscription editors: period, amount, start date, how many days
 * ahead the payment is made, optional end date, and a preview of the periods that will be generated.
 * Same fields and wording as the desktop RentPlanForm.
 */
export function PlanFields({ value: r, onChange, disabled, today, rent }: { value: RentForm; onChange: (v: RentForm) => void; disabled?: boolean; today: string; rent: boolean }) {
  const set = <K extends keyof RentForm>(k: K, v: RentForm[K]) => onChange({ ...r, [k]: v });
  const month = oneMonthBefore(r.start);
  const advance = [[0, '当天'], [7, '提前 7 天'], [15, '提前 15 天'], [month, '提前一个月']] as [number, string][];
  if (!advance.some(([d]) => d === r.advance_days)) advance.push([r.advance_days, `提前 ${r.advance_days} 天`]);
  const preview = rentPreview(r, today), yuan = (c: bigint | null) => (c === null ? '—' : money(c.toString()));
  return <>
    <FormGroup footer={rent ? '合同上的起租日可以是过去的日期。' : '第一期服务开始的日期，可以是过去的日期。'}>
      <SelectField label="付款周期" value={String(r.interval_months)} onChange={v => set('interval_months', Number(v) as RentForm['interval_months'])} options={rentIntervals.map(([m, l]) => ({ id: String(m), label: l }))} disabled={disabled}/>
      <MoneyField label="每期金额" value={r.amount_cents} onChange={v => set('amount_cents', v)} hint="每次付款的总额：按季付就填一整季的钱" disabled={disabled}/>
      <DateField label={rent ? '租住开始日期' : '开始日期'} value={r.start} onChange={v => { if (v) set('start', v); }} disabled={disabled}/>
      <SelectField label="提前几天付款" value={String(r.advance_days)} onChange={v => set('advance_days', Number(v))} options={advance.map(([d, l]) => ({ id: String(d), label: l }))} disabled={disabled}/>
      <DateField label={rent ? '租期到期日' : '结束日期'} value={r.end} onChange={v => set('end', v)} allowClear disabled={disabled} min={r.start}
        hint={rent ? '合同到期日，不含当天（到期日就是下一期的第一天，不再付款）；不确定租到何时就留空，会一直续费' : '不再付款的日期，不含当天（这一天就是下一期的第一天）；不确定何时结束就留空，会一直续费'}/>
    </FormGroup>
    <section className="m-card sp-preview" aria-live="polite" aria-label="将生成的期次">
      {preview ? <>
        <strong>{preview.open_ended ? `${rent ? '持续租住' : '持续进行'}，每期 ${yuan(BigInt(r.amount_cents || '0'))}，月均 ${yuan(preview.monthly_cents)}` : `共 ${preview.rows.length + (preview.truncated ? '+' : '')} 期，合计 ${yuan(preview.total_cents)}，月均 ${yuan(preview.monthly_cents)}`}</strong>
        <ol className="sp-rows">{preview.rows.slice(0, 6).map(row => <li key={row.due}><span>{row.due} 付款</span><span>覆盖 {row.from.slice(5)} 至 {row.to.slice(5)}{row.due <= today ? '（已过）' : ''}</span></li>)}</ol>
        {preview.rows.length > 6 && <p className="sp-note">只列出前 6 期{preview.truncated ? '' : `，共 ${preview.rows.length} 期`}。</p>}
        {preview.open_ended && <p className="sp-note">之后每期自动续费，不确定何时结束就不用填到期日。</p>}
      </> : <p className="sp-note">填好金额和开始日期后，这里会列出将生成的每一期；到期日须晚于开始日期。</p>}
    </section>
  </>;
}
