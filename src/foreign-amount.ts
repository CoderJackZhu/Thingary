// A foreign amount typed as: original amount + rate + what was actually paid in CNY.
// The paid CNY amount is the fact that is saved; the rate is derived from it (six decimals), so any two of the three determine the third.
import { convertCurrency, currencyCode, currencyDecimals, decimalUnits, parseDecimal } from './currency.ts';

export type FaState = { code: string; text: string; fx: string; paid: string };
export type FaOrigin = { currency: string; original_minor: string; fx_rate_micro: string };
export const blankFa = (code = 'CNY'): FaState => ({ code, text: '', fx: '', paid: '' });
export const isForeign = (s: Pick<FaState, 'code'>): boolean => currencyCode(s.code) !== 'CNY';

const originalMinor = (s: FaState): bigint | null => {
  const text = s.text.trim(), places = currencyDecimals(s.code);
  if (!new RegExp(`^\\d{1,12}${places ? `(\\.\\d{1,${places}})?` : ''}$`).test(text)) return null;
  const v = BigInt(parseDecimal(text, places));
  return v > 0n ? v : null;
};
const rateMicro = (s: FaState): bigint | null => {
  try { const v = BigInt(parseDecimal(s.fx.trim(), 6)); return v > 0n ? v : null; } catch { return null; }
};
const paidCents = (s: FaState): bigint | null => {
  const text = s.paid.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  return BigInt(parseDecimal(text, 2));
};
const trimRate = (micro: bigint): string => decimalUnits(micro.toString(), 6).replace(/\.?0+$/, '');
/** Rate that makes `original` come to `paid` cents (half up), as micro-units. */
const deriveRate = (original: bigint, paid: bigint, code: string): bigint => {
  const scaled = original * 10n ** BigInt(2 - currencyDecimals(code));
  return (paid * 1_000_000n * 2n + scaled) / (scaled * 2n);
};

export type FaField = 'code' | 'text' | 'fx' | 'paid';
/** The converted amount at the current rate, as cents; '' until both the original amount and a rate are usable. This is the grey default of the paid field. */
export function faEstimate(s: FaState): string {
  const original = originalMinor(s), rate = rateMicro(s);
  if (!isForeign(s) || original === null || rate === null) return '';
  try { return convertCurrency(s.code, original.toString(), rate.toString()); } catch { return ''; }
}
/** One edit. `paid` holds only what the user typed; the grey default comes from the rate. `remembered` is the rate last used for a newly chosen currency. */
export function editFa(s: FaState, field: FaField, value: string, remembered = ''): FaState {
  if (field === 'code') {
    if (currencyCode(value) === 'CNY') return blankFa('CNY');
    return currencyCode(value) === currencyCode(s.code) ? s : { code: value, text: '', fx: remembered, paid: '' };
  }
  const next = { ...s, [field]: value } as FaState;
  if (field === 'fx') { next.paid = ''; return next; }
  const original = originalMinor(next), paid = paidCents(next);
  if (original !== null && paid !== null && paid > 0n) next.fx = trimRate(deriveRate(original, paid, next.code));
  return next;
}

/** The CNY cents saved for a foreign amount (what was paid, else the estimate), '' while incomplete, null for CNY (the form's own input rules). */
export function faCents(s: FaState): string | null {
  if (!isForeign(s)) return null;
  if (originalMinor(s) === null) return '';
  const paid = paidCents(s);
  if (s.paid.trim() !== '') return paid === null ? '' : paid.toString();
  return faEstimate(s);
}
/** The original-currency record kept beside the saved amount; null for CNY or while incomplete. */
export function faOrigin(s: FaState): FaOrigin | null {
  const original = originalMinor(s), cents = faCents(s);
  if (!isForeign(s) || original === null || !cents) return null;
  const paid = paidCents(s);
  if (s.paid.trim() !== '' && paid !== null && paid > 0n) return { currency: s.code, original_minor: original.toString(), fx_rate_micro: deriveRate(original, paid, s.code).toString() };
  const rate = rateMicro(s);
  return rate === null ? null : { currency: s.code, original_minor: original.toString(), fx_rate_micro: rate.toString() };
}
/** The editor state for a saved record. */
export function faFrom(origin: FaOrigin | null, paidCentsText: string | null): FaState {
  if (!origin) return blankFa();
  return { code: origin.currency, text: decimalUnits(origin.original_minor, currencyDecimals(origin.currency)), fx: trimRate(BigInt(origin.fx_rate_micro)), paid: paidCentsText === null ? '' : decimalUnits(paidCentsText, 2) };
}
