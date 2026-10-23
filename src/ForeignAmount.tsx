import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CurrencyPicker } from './CurrencyPicker';
import { convertCurrency, currencyCode, currencyDecimals, decimalUnits, parseDecimal } from './currency';
import { readDefaultCurrency, rememberCurrency } from './currency-picker.ts';
import { money, type PriceOrigin } from './asset';
import { t } from './i18n.ts';

export type AmountKind = 'expense' | 'income' | 'wish';
/** Typing a foreign amount: the form keeps its CNY cents field; this hook owns the unit, the original amount and the rate, and pushes the converted cents up. */
export function useForeignAmount(kind: AmountKind, id: string | null, onCents: (cents: string) => void) {
  const [code, setCodeState] = useState('CNY'), [text, setTextState] = useState(''), [fx, setFxState] = useState('');
  const loaded = useRef(false), live = useRef({ code: 'CNY', text: '', fx: '' });
  useEffect(() => {
    if (loaded.current) return; loaded.current = true;
    if (!id) { const d = readDefaultCurrency(); setCodeState(d); live.current.code = d; return; }
    invoke<PriceOrigin | null>('get_amount_origin', { kind, id }).then(o => {
      if (!o) return;
      const next = { code: o.currency, text: decimalUnits(o.original_minor, currencyDecimals(o.currency)), fx: decimalUnits(o.fx_rate_micro, 6).replace(/\.?0+$/, '') };
      live.current = next; setCodeState(next.code); setTextState(next.text); setFxState(next.fx);
    }).catch(() => { /* no original amount: plain CNY */ });
  }, [kind, id]);
  /** The converted cents, '' while the typed amount or rate is unusable, or null for CNY (the form's own input rules). */
  function converted(c = live.current): string | null {
    if (c.code === 'CNY') return null;
    try {
      const places = currencyDecimals(c.code);
      if (!c.text.trim() || !new RegExp(`^\\d{1,12}${places ? `(\\.\\d{1,${places}})?` : ''}$`).test(c.text.trim())) return '';
      const rate = parseDecimal(c.fx.trim(), 6);
      return rate === '0' ? '' : convertCurrency(c.code, parseDecimal(c.text.trim(), places), rate);
    } catch { return ''; }
  }
  function update(patch: Partial<typeof live.current>) {
    live.current = { ...live.current, ...patch };
    setCodeState(live.current.code); setTextState(live.current.text); setFxState(live.current.fx);
    const cents = converted(); if (cents !== null) onCents(cents);
  }
  const origin = (): PriceOrigin | null => {
    const c = live.current, cents = converted();
    return c.code !== 'CNY' && cents ? { currency: c.code, original_minor: parseDecimal(c.text.trim(), currencyDecimals(c.code)), fx_rate_micro: parseDecimal(c.fx.trim(), 6) } : null;
  };
  return {
    code, text, fx, foreign: currencyCode(code) !== 'CNY',
    cents: converted(code === 'CNY' ? undefined : { code, text, fx }),
    setCode(next: string) { rememberCurrency(next); update({ code: next, text: next === 'CNY' ? '' : live.current.text, fx: next === 'CNY' ? '' : live.current.fx }); },
    setText: (v: string) => update({ text: v }), setFx: (v: string) => update({ fx: v }),
    /** After the record is saved: keep (or clear) its original-currency amount. The CNY amount is already saved, so a failure here is silent. */
    async persist(generation: string, recordId: string) {
      const o = origin();
      if (!o && !id) return;
      try { await invoke('set_amount_origin', { input: { generation, kind, record_id: recordId, origin: o } }); } catch { /* annotation only */ }
    },
    /** True while a foreign amount is typed but cannot be converted yet. */
    incomplete: live.current.code !== 'CNY' && converted() === '',
  };
}
export type ForeignAmount = ReturnType<typeof useForeignAmount>;

/** The unit button; with a foreign unit also the original amount and the hand-typed rate. */
export function CurrencyUnit({ fa, label, disabled }: { fa: ForeignAmount; label: string; disabled?: boolean }) {
  return <div className="price-field"><div className="price-line"><CurrencyPicker label={label} value={currencyCode(fa.code)} disabled={disabled} onChange={fa.setCode}/></div>
    {fa.foreign && <><div className="price-line"><input inputMode="decimal" aria-label={t('原币金额')} placeholder="0.00" value={fa.text} onChange={e => fa.setText(e.target.value)} disabled={disabled}/><strong>{fa.code}</strong></div>
      <label className="price-rate"><span>{t('汇率：1 {code} =', { code: fa.code })}</span><input inputMode="decimal" aria-label={t('汇率')} placeholder="7.12" value={fa.fx} onChange={e => fa.setFx(e.target.value)} disabled={disabled}/><span>{t('人民币')}</span></label>
      <small>{fa.cents ? t('折合 {v1}（汇率手填，不联网）', { v1: money(fa.cents) }) : t('请填写原币金额和汇率。')}</small></>}
  </div>;
}
