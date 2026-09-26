import { useEffect, useRef, useState } from 'react';
import { localDay } from './asset';
import './date-input.css';

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  allowClear?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

function selectedMonth(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return new Date(Number(match[1]), month - 1, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthDate(year: number, month: number, day: number): string {
  const date = new Date(year, month, day);
  return iso(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Text entry and an explicit calendar share one YYYY-MM-DD value. */
export function DateInput({ id, value, onChange, disabled = false, min = '1900-01-01', max, allowClear = false, invalid, describedBy }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => selectedMonth(value));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) return;
    setMonth(selectedMonth(value));
  }, [value, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const year = month.getFullYear(), monthIndex = month.getMonth();
  const count = new Date(year, monthIndex + 1, 0).getDate();
  const blanks = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const today = localDay();
  const inRange = (date: string) => date >= min && (!max || date <= max);
  const previousEnd = monthDate(year, monthIndex, 0);
  const nextStart = monthDate(year, monthIndex + 1, 1);
  const years = Array.from({ length: 211 }, (_, index) => 1900 + index);
  return <div className="date-input" ref={root} onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}>
    <div className="date-input-row">
      <input id={id} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} autoComplete="off" value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy} onChange={event => onChange(event.target.value)}/>
      <button type="button" className="date-picker-toggle" aria-label="打开日期选择器" aria-expanded={open} disabled={disabled} onClick={() => { setMonth(selectedMonth(value)); setOpen(current => !current); }}>选日期</button>
    </div>
    {open && !disabled && <div className="date-calendar" role="dialog" aria-label="选择日期">
      <div className="date-calendar-heading"><button type="button" aria-label="上个月" disabled={previousEnd < min} onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}>‹</button><select aria-label="年份" value={year} onChange={event => setMonth(new Date(Number(event.target.value), monthIndex, 1))}>{years.map(item => <option key={item} value={item}>{item} 年</option>)}</select><select aria-label="月份" value={monthIndex} onChange={event => setMonth(new Date(year, Number(event.target.value), 1))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{index + 1} 月</option>)}</select><button type="button" aria-label="下个月" disabled={!!max && nextStart > max} onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}>›</button></div>
      <div className="date-calendar-grid" role="group" aria-label={`${year} 年 ${monthIndex + 1} 月`}>{['一', '二', '三', '四', '五', '六', '日'].map(day => <span className="weekday" key={day}>{day}</span>)}{Array.from({ length: blanks }, (_, index) => <span key={`blank-${index}`}/>)}{Array.from({ length: count }, (_, index) => { const day = index + 1, date = iso(year, monthIndex, day); return <button type="button" key={date} aria-label={date} aria-pressed={value === date} disabled={!inRange(date)} onClick={() => { onChange(date); setOpen(false); }}>{day}</button>; })}</div>
      <div className="date-calendar-actions"><button type="button" disabled={!inRange(today)} onClick={() => { onChange(today); setOpen(false); }}>今天</button>{allowClear && <button type="button" onClick={() => { onChange(''); setOpen(false); }}>清空日期</button>}</div>
    </div>}
  </div>;
}
