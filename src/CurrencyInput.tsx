import { useEffect, useState } from 'react';
import { decimalUnits, flipSign, parseDecimal } from './currency';
import { t } from './i18n.ts';
/** Accept display separators only when they form complete groups of three. */
function inputValue(text: string, places: number, signed: boolean): string {
  const trimmed = text.trim();
  if (trimmed === '' || (signed && trimmed === '-') || (places > 0 && (trimmed === '.' || (signed && trimmed === '-.')))) return '';
  const pattern = new RegExp(`^${signed ? '-?' : ''}(?:\\d+|\\d{1,3}(?:,\\d{3})+|\\d{1,3}(?:[ \\u00a0\\u202f\\u2009]\\d{3})+)(?:\\.\\d*)?$`);
  const decimal = trimmed.replace(/^(-?)\./, (_match, sign: string) => `${sign}0.`);
  if (!pattern.test(decimal)) throw new Error(t('请填写数字；千分位可用逗号或空格，例如 1,234 或 1 234。'));
  if (places === 0 && decimal.includes('.')) throw new Error(t('这个币种不支持小数，请填写整数。'));
  const normalized = decimal.replace(/[, \u00a0\u202f\u2009]/g, '').replace(/\.$/, '');
  if (normalized.replace(/^-/, '').split('.')[0].length > 19) throw new Error(t('数值超出范围。'));
  return parseDecimal(normalized, places, signed);
}

/**
 * Invalid original text stays visible; an empty parent value prevents saving an old amount.
 * `signToggle` adds a ± button for signed fields (iOS number pads have no minus key); `enterKeyHint` / `onEnter` let the
 * host move to the next field when Return is pressed.
 */
export function CurrencyInput({ label, value, onChange, places, disabled, signed = false, signToggle = false, enterKeyHint, onEnter }: { label: string; value: string; onChange: (v: string) => void; places: number; disabled?: boolean; signed?: boolean; signToggle?: boolean; enterKeyHint?: 'next' | 'done' | 'go'; onEnter?: () => void }) {
  const [raw, setRaw] = useState(value === '' ? '' : decimalUnits(value, places)), [error, setError] = useState('');
  useEffect(() => {
    let normalized = '';
    try { normalized = inputValue(raw, places, signed); } catch { /* Keep invalid original text while the parent is empty. */ }
    if (normalized !== value) { setRaw(value === '' ? '' : decimalUnits(value, places)); setError(''); }
  }, [value, places, signed]);
  function edit(text: string) {
    setRaw(text);
    try { const normalized = inputValue(text, places, signed); setError(''); onChange(normalized); }
    catch (e) { setError(e instanceof Error ? e.message : t('请检查数字。')); onChange(''); }
  }
  return <span className={`holding-input currency-input${signed && signToggle ? ' currency-signed' : ''}`}><input aria-label={label} aria-invalid={!!error} inputMode={places ? 'decimal' : 'numeric'} enterKeyHint={enterKeyHint} disabled={disabled} value={raw} placeholder={places ? '0.' + '0'.repeat(places) : '0'} onChange={event => edit(event.target.value)} onKeyDown={onEnter ? event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter(); } } : undefined}/>
    {signed && signToggle && <button type="button" className="currency-sign" aria-label={t('{label}：切换正负', { label })} aria-pressed={raw.trim().startsWith('-')} disabled={disabled} onClick={() => edit(flipSign(raw))}>±</button>}
    {error && <small role="alert">{error}</small>}</span>;
}
