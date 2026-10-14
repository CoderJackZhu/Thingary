import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDate, calendarValue, parseCalendar, moveCalendar, clampCalendar, placeCalendar, commonYears, yearPage, moveYear, outsideCalendar } from '../src/date-picker.ts';

/** Minimal node graph standing in for a portaled panel inside a native dialog. */
function dom({ dialog = true } = {}) {
  const body = {tagName: 'BODY', ownerDocument: null, parentElement: null};
  body.ownerDocument = {body};
  const host = dialog ? {tagName: 'DIALOG', parentElement: body, ownerDocument: body.ownerDocument} : body;
  const panel = {tagName: 'DIV', parentElement: host, ownerDocument: body.ownerDocument};
  const arrow = {tagName: 'BUTTON', parentElement: panel, ownerDocument: body.ownerDocument};
  const sibling = {tagName: 'H3', parentElement: host, ownerDocument: body.ownerDocument};
  // contains() answers for the node itself and for anything below it.
  panel.contains = target => target === panel || target === arrow;
  const root = {tagName: 'DIV', parentElement: host, ownerDocument: body.ownerDocument, contains: () => false};
  return {root, panel, arrow, sibling, host, body};
}

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

test('frequent years stay short, include an old selection and respect original bounds', () => {
  assert.deepEqual(commonYears(2026, null, 'past'), [2026,2025,2024,2023,2022,2021,2020,2019,2018,2017]);
  assert.deepEqual(commonYears(2026, 1980, 'past', 1900, 2026).slice(-1), [1980]);
  assert.equal(commonYears(2026, 2080, 'near').length, 12);
  assert.deepEqual(commonYears(2026, 1, 'records', 1, 9999, [2020,2020,2024,NaN,0,10000]), [2026,2024,2020,1]);
  assert.deepEqual(commonYears(2026, null, 'records'), [2026]);
  assert.deepEqual(commonYears(2026, 1980, 'past', 2025, 2026), [2026,2025]);
});
test('year grid pages and keyboard navigation retain distant years within format bounds', () => {
  assert.equal(yearPage(1), 1); assert.equal(yearPage(2026), 2017); assert.equal(yearPage(9999), 9997);
  assert.equal(moveYear(2026,'PageDown'), 2038); assert.equal(moveYear(2026,'ArrowUp'), 2023);
  assert.equal(moveYear(2026,'Home'),2017); assert.equal(moveYear(2026,'End'),2028);
  assert.equal(moveYear(1,'ArrowLeft'),1); assert.equal(moveYear(9999,'End'),9999);
  assert.equal(moveYear(2026,'ArrowRight',1900,2026),2026); assert.equal(moveYear(2026,'Enter'),null);
});

test('the hosting element that WebKit focuses instead of a nav arrow stays inside the calendar', () => {
  const {root, panel, arrow, sibling, host} = dom();
  // Pressing an arrow focuses the dialog rather than the button; the panel must survive it.
  assert.equal(outsideCalendar(root, panel, host), false);
  assert.equal(outsideCalendar(root, panel, arrow), false);
  // Genuine surroundings still dismiss, so the panel can never become undismissable.
  assert.equal(outsideCalendar(root, panel, sibling), true);
  assert.equal(outsideCalendar(root, panel, {tagName: 'DIV'}), true);
  assert.equal(outsideCalendar(root, panel, null), false);
});
test('a panel portaled into the body keeps only the body as its focus host', () => {
  const {root, panel, host, body} = dom({dialog: false});
  assert.equal(outsideCalendar(root, panel, body), false);
  assert.equal(outsideCalendar(root, panel, host), false);
  assert.equal(outsideCalendar(root, panel, {tagName: 'H3'}), true);
});
