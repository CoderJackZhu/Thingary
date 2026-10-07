/** Local calendar arithmetic: no UTC conversion and no invented day for month values. */
export type Precision = 'day' | 'month';
export function calendarDate(year: number, month: number, day = 1): Date {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date;
}
export function calendarValue(date: Date, precision: Precision = 'day'): string {
  const month = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return precision === 'month' ? month : `${month}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseCalendar(value: string, precision: Precision): Date | null {
  const match = (precision === 'day' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})$/).exec(value);
  if (!match) return null;
  const date = calendarDate(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1));
  return calendarValue(date, precision) === value ? date : null;
}
export function clampCalendar(value: string, min: string, max?: string): string {
  return value < min ? min : max && value > max ? max : value;
}
export function moveCalendar(value: string, key: string, precision: Precision): string | null {
  const date = parseCalendar(value, precision);
  if (!date) return null;
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  if (key === 'PageUp' || key === 'PageDown') {
    const next = calendarDate(year, month + (key === 'PageUp' ? -1 : 1));
    if (precision === 'day') next.setDate(Math.min(day, calendarDate(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    return calendarValue(next, precision);
  }
  if (precision === 'month') {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[key];
    if (delta !== undefined) return calendarValue(calendarDate(year, month + delta), precision);
    if (key === 'Home' || key === 'End') return calendarValue(calendarDate(year, key === 'Home' ? 0 : 11), precision);
  } else {
    const weekday = (date.getDay() + 6) % 7;
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday } as Record<string, number>)[key];
    if (delta !== undefined) return calendarValue(calendarDate(year, month, day + delta));
  }
  return null;
}
type Anchor = { left: number; right: number; top: number; bottom: number };
export function placeCalendar(anchor: Anchor, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const pad = 12, gap = 8;
  const width = Math.min(size.width, Math.max(0, viewport.width - pad * 2));
  const height = Math.min(size.height, Math.max(0, viewport.height - pad * 2));
  const below = viewport.height - anchor.bottom - gap - pad;
  const above = anchor.top - gap - pad;
  const top = below >= height || below >= above ? anchor.bottom + gap : anchor.top - height - gap;
  return {
    left: Math.max(pad, Math.min(anchor.right - width, viewport.width - pad - width)),
    top: Math.max(pad, Math.min(top, viewport.height - pad - height)),
    maxHeight: Math.max(0, viewport.height - pad * 2),
  };
}
