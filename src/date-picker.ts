/** Local calendar arithmetic: no UTC conversion and no invented day for month values. */
export type Precision = 'day' | 'month';
export type YearIntent = 'past' | 'near' | 'long' | 'records';

/** Frequent choices are a display convenience, never the allowed date boundary. */
export function commonYears(today: number, selected: number | null, intent: YearIntent, min = 1, max = 9999, recorded: readonly number[] = []): number[] {
  const candidates = intent === 'records' ? [today, ...recorded]
    : Array.from({ length: intent === 'past' ? 10 : 11 }, (_, i) => today + (intent === 'past' ? -i : i - 5));
  return [...new Set([...candidates, ...(selected === null ? [] : [selected])])]
    .filter(y => Number.isInteger(y) && y >= min && y <= max).sort((a, b) => b - a);
}
export function yearPage(year: number): number {
  return Math.floor((Math.max(1, Math.min(9999, year)) - 1) / 12) * 12 + 1;
}
export function moveYear(year: number, key: string, min = 1, max = 9999): number | null {
  const start = yearPage(year);
  const next = key === 'Home' ? start : key === 'End' ? start + 11
    : year + (({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 } as Record<string, number>)[key] ?? NaN);
  return Number.isFinite(next) ? Math.max(min, Math.min(max, next)) : null;
}
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
  const boundedValue = (next: Date) => next.getFullYear() > 9999 ? (precision === 'day' ? '9999-12-31' : '9999-12') : next.getFullYear() < 1 ? (precision === 'day' ? '0001-01-01' : '0001-01') : calendarValue(next, precision);
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  if (key === 'PageUp' || key === 'PageDown') {
    const next = calendarDate(year, month + (key === 'PageUp' ? -1 : 1));
    if (precision === 'day') next.setDate(Math.min(day, calendarDate(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    return boundedValue(next);
  }
  if (precision === 'month') {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 } as Record<string, number>)[key];
    if (delta !== undefined) return boundedValue(calendarDate(year, month + delta));
    if (key === 'Home' || key === 'End') return boundedValue(calendarDate(year, key === 'Home' ? 0 : 11));
  } else {
    const weekday = (date.getDay() + 6) % 7;
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday } as Record<string, number>)[key];
    if (delta !== undefined) return boundedValue(calendarDate(year, month, day + delta));
  }
  return null;
}
/**
 * Outside test for an open calendar. Pressing an arrow glyph makes WebKit focus the hosting
 * element rather than the button, so that host still counts as inside while every other element
 * around the panel stays outside and dismisses it as usual.
 */
export function outsideCalendar(root: Node | null, panel: Node | null, target: Node | null): boolean {
  if (!target) return false;
  if (root?.contains(target) || panel?.contains(target)) return false;
  return !isCalendarHost(panel, target);
}
/** The portal host the panel was rendered into: the owning dialog, or the body outside one. */
function isCalendarHost(panel: Node | null, target: Node): boolean {
  for (let host = panel?.parentElement ?? null; host; host = host.parentElement) {
    if (host === target) return true;
    if (host.tagName === 'DIALOG') return false;
    if (host === host.ownerDocument.body) return false;
  }
  return false;
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
