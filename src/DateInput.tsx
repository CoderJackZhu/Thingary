import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { localDay } from './asset';
import { calendarDate, calendarValue, clampCalendar, moveCalendar, parseCalendar, placeCalendar, type Precision } from './date-picker';
import { useFormHint, useFormLabel } from './form-hint';
import './date-input.css';

type Props = {
  id?: string; label?: string; value: string; onChange: (value: string) => void;
  disabled?: boolean; min?: string; max?: string; allowClear?: boolean;
  invalid?: boolean; describedBy?: string;
};
export function DateInput(props: Props) { return <CalendarInput {...props} precision="day"/>; }
export function MonthInput(props: Props) { return <CalendarInput {...props} precision="month"/>; }

/** The portal stays in the owning native dialog so it remains in that dialog's top layer. */
function CalendarInput({ id, label: suppliedLabel, value, onChange, disabled = false, min: minimum, max: maximum, allowClear = false, invalid, describedBy, precision }: Props & { precision: Precision }) {
  const label = useFormLabel(suppliedLabel);
  const help = useFormHint(describedBy);
  // A related text field may contain a partial edit; it is not a usable calendar bound yet.
  const min = parseCalendar(minimum ?? '', precision) ? minimum! : precision === 'day' ? '1900-01-01' : '1900-01';
  const max = parseCalendar(maximum ?? '', precision) ? maximum : undefined;
  const today = localDay().slice(0, precision === 'day' ? 10 : 7);
  const initial = () => clampCalendar(parseCalendar(value, precision) ? value : today, min, max);
  const [open, setOpen] = useState(false), [cursor, setCursor] = useState(initial);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId(), focusGrid = useRef(false);
  const date = parseCalendar(cursor, precision) ?? calendarDate(new Date().getFullYear(), new Date().getMonth());
  const year = date.getFullYear(), month = date.getMonth();
  const inRange = (v: string) => v >= min && (!max || v <= max);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const choose = (v: string) => { onChange(v); close(true); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const positionPanel = () => {
      if (!root.current || !panel.current) return;
      const size = panel.current.getBoundingClientRect();
      setPosition(placeCalendar(root.current.getBoundingClientRect(), size, { width: window.innerWidth, height: window.innerHeight }));
    };
    positionPanel();
    // Capture nested editor scrolling, not only window scrolling.
    window.addEventListener('resize', positionPanel);
    document.addEventListener('scroll', positionPanel, true);
    const observer = new ResizeObserver(positionPanel);
    if (panel.current) observer.observe(panel.current);
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); window.removeEventListener('resize', positionPanel); document.removeEventListener('scroll', positionPanel, true); };
  }, [open, disabled, year, month]);
  useLayoutEffect(() => {
    if (open && !disabled && position.visibility !== 'hidden' && focusGrid.current) {
      panel.current?.querySelector<HTMLButtonElement>(`[data-value="${cursor}"]`)?.focus({ preventScroll: true }); focusGrid.current = false;
    }
  }, [open, disabled, cursor, position.visibility]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  function keys(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  function gridKeys(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    const next = moveCalendar(cursor, event.key, precision);
    if (next) { event.preventDefault(); event.stopPropagation(); const bounded = clampCalendar(next, min, max); if (bounded !== cursor) { focusGrid.current = true; setCursor(bounded); } }
  }
  function panelKeys(event: KeyboardEvent) {
    keys(event);
    if (event.key !== 'Tab') return;
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)') ?? [])].filter(el => el.tabIndex >= 0);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && at === 0) { event.preventDefault(); close(true); }
    else if (!event.shiftKey && at === controls.length - 1) {
      event.preventDefault();
      const scope = root.current?.closest('dialog') ?? document.body;
      const sequence = [...scope.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href]')].filter(el => !el.matches(':disabled') && el.tabIndex >= 0 && el.getClientRects().length && !panel.current?.contains(el));
      const next = sequence[sequence.indexOf(trigger.current!) + 1];
      close(); (next ?? trigger.current)?.focus();
    }
  }
  const changeMonth = (y: number, m: number) => setCursor(clampCalendar(calendarValue(calendarDate(y, m), precision), min, max));
  const firstYear = Number(min.slice(0, 4)), lastYear = max ? Number(max.slice(0, 4)) : Math.max(2110, year);
  const previous = precision === 'month' ? calendarValue(calendarDate(year - 1, 11), precision) : calendarValue(calendarDate(year, month, 0));
  const next = precision === 'month' ? calendarValue(calendarDate(year + 1, 0), precision) : calendarValue(calendarDate(year, month + 1));
  const blanks = (calendarDate(year, month).getDay() + 6) % 7;
  const count = precision === 'month' ? 12 : calendarDate(year, month + 1, 0).getDate();
  const picker = open && !disabled && <div ref={panel} id={panelId} className={'date-calendar' + (precision === 'month' ? ' month-calendar' : '')} style={position} role="dialog" aria-label={label ? `选择${label}` : '选择日期'} onKeyDown={panelKeys}>
    <div className="date-calendar-heading">
      <button type="button" aria-label={precision === 'day' ? '上个月' : '上一年'} disabled={previous < min} onClick={() => changeMonth(precision === 'day' ? year : year - 1, precision === 'day' ? month - 1 : month)}><Chevron direction="left"/></button>
      <select aria-label="年份" value={year} onChange={e => changeMonth(Number(e.target.value), month)}>{Array.from({length: Math.max(1, lastYear - firstYear + 1)}, (_, i) => firstYear + i).map(y => <option key={y} value={y}>{y} 年</option>)}</select>
      {precision === 'day' && <select aria-label="月份" value={month} onChange={e => changeMonth(year, Number(e.target.value))}>{Array.from({length: 12}, (_, m) => <option key={m} value={m} disabled={calendarValue(calendarDate(year, m + 1, 0)) < min || !!max && calendarValue(calendarDate(year, m)) > max}>{m + 1} 月</option>)}</select>}
      <button type="button" aria-label={precision === 'day' ? '下个月' : '下一年'} disabled={!!max && next > max} onClick={() => changeMonth(precision === 'day' ? year : year + 1, precision === 'day' ? month + 1 : month)}><Chevron direction="right"/></button>
    </div>
    <div className="date-calendar-grid" role="group" aria-label={precision === 'day' ? `${year} 年 ${month + 1} 月` : `${year} 年`} onKeyDown={gridKeys}>
      {precision === 'day' && <>{['一','二','三','四','五','六','日'].map(day => <span className="weekday" key={day}>{day}</span>)}{Array.from({length: blanks}, (_, i) => <span aria-hidden="true" key={'blank'+i}/>)}</>}
      {Array.from({length: count}, (_, i) => {
        const v = calendarValue(calendarDate(year, precision === 'day' ? month : i, precision === 'day' ? i + 1 : 1), precision);
        return <button type="button" key={v} data-value={v} aria-label={v} aria-pressed={value === v} aria-current={v === today ? 'date' : undefined} tabIndex={cursor === v ? 0 : -1} disabled={!inRange(v)} onFocus={() => setCursor(v)} onClick={() => choose(v)}>{precision === 'day' ? i + 1 : `${i + 1} 月`}</button>;
      })}
    </div>
    <div className="date-calendar-actions"><button type="button" disabled={!inRange(today)} onClick={() => choose(today)}>{precision === 'day' ? '今天' : '本月'}</button>{allowClear && <button type="button" onClick={() => choose('')}>{precision === 'day' ? '清空日期' : '清空月份'}</button>}</div>
  </div>;
  return <div className="date-input" ref={root} onKeyDown={keys}>
    <div className="date-input-row">
      <input id={id} aria-label={label} type="text" inputMode="numeric" placeholder={precision === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'} maxLength={precision === 'day' ? 10 : 7} autoComplete="off" value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={help} onChange={e => onChange(e.target.value)}/>
      <button ref={trigger} type="button" className="date-picker-toggle" aria-label={label ? `选择${label}` : precision === 'day' ? '打开日期选择器' : '打开月份选择器'} aria-haspopup="dialog" aria-controls={open ? panelId : undefined} aria-expanded={open} disabled={disabled} onClick={() => { focusGrid.current = true; setCursor(initial()); setPosition({visibility:'hidden'}); setOpen(!open); }}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="13" rx="2"/><path d="M6.5 2.5v4M13.5 2.5v4M3 8.5h14M7 12h2M11 12h2"/></svg></button>
    </div>
    {picker && createPortal(picker, root.current?.closest('dialog') ?? document.body)}
  </div>;
}
function Chevron({direction}: {direction:'left'|'right'}) { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={direction === 'left' ? 'm12 5-5 5 5 5' : 'm8 5 5 5-5 5'}/></svg>; }
