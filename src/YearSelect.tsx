import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { commonYears, moveYear, outsideCalendar, placeCalendar, yearPage, type YearIntent } from './date-picker';
import { useFormHint } from './form-hint';
import './date-input.css';

type Props = {
  label?: string; value: number | null; todayYear: number; onChange: (year: number) => void;
  intent?: YearIntent; min?: number; max?: number; recorded?: readonly number[]; disabled?: boolean;
};
/** Short native menu, with a bounded-size grid for every other valid year. */
export function YearSelect({ label = '年份', value, todayYear, onChange, intent = 'near', min = 1, max = 9999, recorded, disabled = false }: Props) {
  const help = useFormHint();
  const initial = () => Math.max(min, Math.min(max, value ?? todayYear));
  const [open, setOpen] = useState(false), [cursor, setCursor] = useState(initial);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<HTMLSelectElement | HTMLButtonElement>(null);
  const focusGrid = useRef(false), panelId = useId();
  const start = yearPage(cursor), end = Math.min(9999, start + 11);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => { if (disabled) return; setCursor(initial()); focusGrid.current = true; setPosition({ visibility: 'hidden' }); setOpen(true); };
  const pick = (year: number) => { if (disabled || year < min || year > max) return; onChange(year); close(true); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (outsideCalendar(root.current, panel.current, e.target as Node)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const place = () => {
      if (root.current && panel.current) setPosition(placeCalendar(root.current.getBoundingClientRect(), panel.current.getBoundingClientRect(), { width: innerWidth, height: innerHeight }));
    };
    place(); window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place); if (root.current) observer.observe(root.current); if (panel.current) observer.observe(panel.current);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open, disabled, start]);
  useLayoutEffect(() => {
    if (open && position.visibility !== 'hidden' && focusGrid.current) { panel.current?.querySelector<HTMLButtonElement>(`[data-year="${cursor}"]`)?.focus({ preventScroll: true }); focusGrid.current = false; }
  }, [open, cursor, position.visibility]);
  const navigate = (year: number) => { focusGrid.current = true; setCursor(Math.max(min, Math.min(max, year))); };
  function keys(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close(true); }
  }
  function gridKeys(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    const next = moveYear(cursor, e.key, min, max);
    if (next !== null) { e.preventDefault(); e.stopPropagation(); navigate(next); }
  }
  const years = commonYears(todayYear, value, intent, min, max, recorded);
  const popup = open && !disabled && <div ref={panel} id={panelId} className="date-calendar year-calendar" style={position} role="dialog" aria-label={`选择${label}`} onKeyDown={e => {
    keys(e);
    if (e.key !== 'Tab') return;
    const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])].filter(el => el.tabIndex >= 0);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && at === 0 || !e.shiftKey && at === controls.length - 1) { e.preventDefault(); close(true); }
  }}>
    <div className="date-calendar-heading">
      <button type="button" aria-label="上一组年份" disabled={start <= min} onClick={() => navigate(start - 1)}>‹</button>
      <strong>{start}–{end} 年</strong>
      <button type="button" aria-label="下一组年份" disabled={end >= max} onClick={() => navigate(end + 1)}>›</button>
    </div>
    <div className="date-calendar-grid" role="group" aria-label={`${start} 至 ${end} 年`} onKeyDown={gridKeys}>
      {Array.from({ length: end - start + 1 }, (_, i) => start + i).map(year => <button type="button" key={year} data-year={year} aria-label={`${year} 年`} aria-pressed={value === year} aria-current={year === todayYear ? 'date' : undefined} disabled={year < min || year > max} tabIndex={cursor === year ? 0 : -1} onFocus={() => setCursor(year)} onClick={() => pick(year)}>{year}</button>)}
    </div>
    <div className="date-calendar-actions"><button type="button" disabled={todayYear < min || todayYear > max} onClick={() => navigate(todayYear)}>回到今年</button><button type="button" onClick={() => close(true)}>取消</button></div>
  </div>;
  return <div className="year-select" ref={root} onKeyDown={keys}>
    {intent === 'long' ? <button type="button" className="year-select-trigger" ref={el => { trigger.current = el; }} aria-label={`选择${label}`} aria-describedby={help} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={show}>{value === null ? '选择年份' : `${value} 年`} <span aria-hidden="true">▾</span></button>
      : <select aria-label={label} aria-describedby={help} ref={el => { trigger.current = el; }} value={value ?? ''} disabled={disabled} onChange={e => e.target.value === 'other' ? show() : pick(Number(e.target.value))}>
        <option value="" disabled>选择年份</option>{years.map(year => <option key={year} value={year}>{year} 年</option>)}<option value="other">其他年份…</option>
      </select>}
    {popup && createPortal(popup, root.current?.closest('.date-calendar') ?? root.current?.closest('dialog') ?? document.body)}
  </div>;
}
