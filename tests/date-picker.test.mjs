import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calendarValue, parseCalendar, moveCalendar, clampCalendar, placeCalendar } from '../src/date-picker.ts';

test('calendar validates leap days and preserves month precision and local years', () => {
  assert.equal(parseCalendar('2025-02-29', 'day'), null);
  assert.equal(parseCalendar('2026-13', 'month'), null);
  assert.equal(parseCalendar('2026-04-31', 'day'), null);
  assert.equal(calendarValue(parseCalendar('2024-02-29', 'day')), '2024-02-29');
  assert.equal(calendarValue(calendarDate(99, 0, 1)), '0099-01-01');
  assert.equal(calendarValue(parseCalendar('2026-10', 'month'), 'month'), '2026-10');
});
test('keyboard moves across years, weeks and shorter months without date overflow', () => {
  assert.equal(moveCalendar('2024-01-31', 'PageDown', 'day'), '2024-02-29');
  assert.equal(moveCalendar('2025-01-31', 'PageDown', 'day'), '2025-02-28');
  assert.equal(moveCalendar('2026-01-01', 'ArrowLeft', 'day'), '2025-12-31');
  assert.equal(moveCalendar('2026-10-07', 'Home', 'day'), '2026-10-05');
  assert.equal(moveCalendar('2026-10-07', 'End', 'day'), '2026-10-11');
  assert.equal(moveCalendar('2026-12', 'ArrowRight', 'month'), '2027-01');
  assert.equal(moveCalendar('2026-02', 'ArrowUp', 'month'), '2025-11');
  assert.equal(clampCalendar('2026-10-09', '2026-01-01', '2026-10-07'), '2026-10-07');
});
test('popover flips at the bottom and clamps to viewport on both axes', () => {
  assert.deepEqual(placeCalendar({left: 720, right: 890, top: 650, bottom: 688}, {width: 304, height: 340}, {width: 900, height: 720}), {left: 584, top: 302, maxHeight: 696});
  assert.equal(placeCalendar({left: 0, right: 24, top: 10, bottom: 48}, {width: 304, height: 340}, {width: 320, height: 200}).left, 12);
  assert.equal(placeCalendar({left: 0, right: 320, top: 0, bottom: 38}, {width: 304, height: 340}, {width: 320, height: 200}).top, 12);
});
