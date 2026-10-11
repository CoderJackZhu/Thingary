import { CentInput } from '../FormControls';
export function GoalMoneyInput({ value, onChange, label, disabled, signed = false, step = 10000 }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean; signed?: boolean; step?: number }) {
  const change = (direction: number) => { const n = Number(value || '0'); if (Number.isSafeInteger(n)) onChange(String(Math.min(99999999999, Math.max(signed ? -99999999999 : 0, n + direction * step)))); };
  return <div className="goal-money"><button type="button" aria-label={`${label}减少${step / 100}元`} disabled={disabled} onClick={() => change(-1)}>−</button><CentInput label={label} value={value} onChange={onChange} disabled={disabled} signed={signed}/><button type="button" aria-label={`${label}增加${step / 100}元`} disabled={disabled} onClick={() => change(1)}>＋</button><small className="muted">每次 {step / 100} 元，可手填到分；留空表示未知。</small></div>;
}
