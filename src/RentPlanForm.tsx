import { money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments } from './FormControls';
import { oneMonthBefore, rentIntervals, rentPreview } from './rent-plan';
import type { RentForm } from './rent-plan';

const yuan = (cents: bigint | null) => (cents === null ? '—' : money(cents.toString()));

/** 房租的简易填写：只问开始日期、付款周期、金额、提前几天付、到期日，下面直接预览会生成哪几期。 */
export function RentPlanForm({ value: r, onChange, disabled, today }: { value: RentForm; onChange: (v: RentForm) => void; disabled: boolean; today: string }) {
  const set = <K extends keyof RentForm>(k: K, v: RentForm[K]) => onChange({ ...r, [k]: v });
  const advance = [[0, '当天'], [7, '提前 7 天'], [15, '提前 15 天'], [oneMonthBefore(r.start), '提前一个月']] as const;
  const preview = rentPreview(r, today);
  return <>
    <FormRow label="付款周期" hint="多久付一次房租"><Segments label="付款周期" value={String(r.interval_months)} disabled={disabled} options={rentIntervals.map(([m, l]) => ({ value: String(m), label: l }))} onChange={v => set('interval_months', Number(v) as RentForm['interval_months'])}/></FormRow>
    <FormRow label="每期金额" hint="每次付款的总额：按季付就填一整季的钱"><CentInput label="每期金额" value={r.amount_cents} disabled={disabled} placeholder="0.00" onChange={v => set('amount_cents', v)}/></FormRow>
    <FormRow label="租住开始日期" hint="合同上的起租日，可以是过去的日期"><DateInput id="rent-start" label="租住开始日期" value={r.start} disabled={disabled} onChange={v => v && set('start', v)}/></FormRow>
    <FormRow label="提前几天付款" hint="每期租期开始前多少天付钱；当天付就选「当天」">
      <span className="rent-advance">{advance.map(([d, l]) => <button key={l} type="button" className="ui-btn" aria-pressed={r.advance_days === d} disabled={disabled} onClick={() => set('advance_days', d)}>{l}</button>)}
        <input aria-label="提前天数" inputMode="numeric" value={String(r.advance_days)} disabled={disabled} onChange={e => { const n = Number(e.target.value.replace(/\D/g, '') || 0); set('advance_days', Math.min(366, n)); }}/> 天</span>
    </FormRow>
    <FormRow label="租期到期日" hint="合同到期日，不含当天（到期日就是下一期的第一天，不再付款）；不确定租到何时就留空，会一直续费"><DateInput id="rent-end" label="租期到期日" value={r.end} allowClear disabled={disabled} onChange={v => set('end', v)}/></FormRow>
    <div className="rent-preview" aria-live="polite">
      {preview ? <>
        <p><strong>{preview.open_ended ? `持续租住，每期 ${yuan(BigInt(r.amount_cents || '0'))}，月均 ${yuan(preview.monthly_cents)}` : `共 ${preview.rows.length + (preview.truncated ? '+' : '')} 期，合计 ${yuan(preview.total_cents)}，月均 ${yuan(preview.monthly_cents)}`}</strong></p>
        <ol>{preview.rows.map(row => <li key={row.due}>{row.due} 付款，覆盖 {row.from} 至 {row.to}{row.due <= today ? <span className="muted">（已过）</span> : null}</li>)}</ol>
        {preview.open_ended && <p className="muted small">之后每期自动续费，不确定何时结束就不用填到期日。</p>}
        {preview.truncated && <p className="muted small">只列出前 {preview.rows.length} 期。</p>}
      </> : <p className="muted small">填好金额和开始日期后，这里会列出将生成的每一期；到期日须晚于开始日期。</p>}
    </div>
  </>;
}
