// Moving between form fields without the keyboard's Return key. iOS number pads have no Return key at all,
// so amount fields get a small 下一项 / 完成 bar above the keyboard (see KeyboardBar) and the same logic runs on Return.

const FIELDS = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled])';

/** The fields of one form in reading order: the sheet, modal or page that holds `from`. */
export function fieldsAround(from: HTMLElement): HTMLElement[] {
  const scope = from.closest<HTMLElement>('.m-sheet-body, .m-modal, .m-main') ?? document.body;
  return [...scope.querySelectorAll<HTMLElement>(FIELDS)].filter(el => !el.closest('[inert], [hidden]') && el.getClientRects().length > 0);
}
/** Pure choice of the field after `current`; null when `current` is the last one (or unknown). */
export function nextField<T>(list: T[], current: T): T | null {
  const i = list.indexOf(current);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}
/** Focus the next field of the form and scroll it to the middle; on the last field close the keyboard. */
export function advanceFocus(from: HTMLElement): 'moved' | 'blurred' {
  const next = nextField(fieldsAround(from), from);
  if (!next) { from.blur(); return 'blurred'; }
  next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return 'moved';
}
/** Fields whose keyboard has no Return key: the decimal and numeric pads. */
export const needsAccessory = (el: Element | null): el is HTMLInputElement =>
  !!el && el.matches('input[inputmode=decimal], input[inputmode=numeric]');
