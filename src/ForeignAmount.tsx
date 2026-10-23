import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CurrencyPicker } from './CurrencyPicker';
import { currencyCode, currencyDecimals } from './currency';
import { currencySymbol, readDefaultCurrency, readRate, rememberCurrency, rememberRate } from './currency-picker.ts';
import { blankFa, editFa, faCents, faFrom, faOrigin, isForeign, type FaField, type FaOrigin, type FaState } from './foreign-amount.ts';
import { t } from './i18n.ts';

export type AmountKind = 'expense' | 'income' | 'wish';

/** Applies one edit to a state, using the remembered rate when the currency changes. */
export const applyFa = (s: FaState, field: FaField, value: string): FaState => editFa(s, field, value, field === 'code' ? readRate(value) : '');

/** Switching the unit of an item price keeps the typed number: CNY→foreign reuses it as the original amount, foreign→CNY keeps what was paid. */
export function changeFaCode(cur: FaState, code: string): FaState {
  if (currencyCode(code) === 'CNY') return { ...blankFa('CNY'), text: cur.paid };
  const next = applyFa(cur, 'code', code);
  return currencyCode(cur.code) === 'CNY' && cur.text ? applyFa(next, 'text', cur.text) : next;
}

/**
 * Typing a foreign amount: the form keeps its CNY cents field; this hook owns the unit, the original amount, the rate and the
 * paid CNY amount and pushes the paid cents up. A new record starts in the default currency.
 */
export function useForeignAmount(kind: AmountKind, id: string | null, onCents: (cents: string) => void) {
  const [s, setS] = useState<FaState>(() => (id ? blankFa() : editFa(blankFa(), 'code', readDefaultCurrency(), readRate(readDefaultCurrency()))));
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !id) return; loaded.current = true;
    invoke<FaOrigin | null>('get_amount_origin', { kind, id }).then(o => { if (o) setS(faFrom(o, null)); }).catch(() => { /* no original amount: plain CNY */ });
  }, [kind, id]);
  function edit(field: FaField, value: string) {
    if (field === 'code') rememberCurrency(value);
    const next = applyFa(s, field, value);
    setS(next);
    const cents = faCents(next);
    if (cents !== null) onCents(cents);
  }
  return {
    ...s, foreign: isForeign(s), cents: faCents(s), edit,
    /** After the record is saved: keep (or clear) its original-currency amount. The CNY amount is already saved, so a failure here is silent. */
    async persist(generation: string, recordId: string) {
      const o = faOrigin(s);
      if (!o && !id) return;
      try { await invoke('set_amount_origin', { input: { generation, kind, record_id: recordId, origin: o } }); if (o) rememberRate(o.currency, s.fx); } catch { /* annotation only */ }
    },
  };
}
export type ForeignAmount = ReturnType<typeof useForeignAmount>;

/** The unit button that sits right of an amount: the currency symbol, opens the picker. */
export function CurrencyButton({ code, onChange, label, disabled }: { code: string; onChange: (code: string) => void; label: string; disabled?: boolean }) {
  return <CurrencyPicker label={label} value={currencyCode(code)} disabled={disabled} onChange={onChange} compact/>;
}
/** The original-currency amount input (shown instead of the form's CNY input while a foreign currency is chosen). */
export function OriginalInput({ s, onText, label, disabled }: { s: Pick<FaState, 'code' | 'text'>; onText: (v: string) => void; label: string; disabled?: boolean }) {
  return <input className="amt-input" inputMode="decimal" aria-label={label} placeholder={currencyDecimals(s.code) ? '0.00' : '0'} value={s.text} onChange={e => onText(e.target.value)} disabled={disabled}/>;
}
/** "折合 1 USD = [rate] ¥" and "实际支付 ¥ [paid]": either one fills in the other. */
export function RateRow({ s, onFx, onPaid, disabled }: { s: FaState; onFx: (v: string) => void; onPaid: (v: string) => void; disabled?: boolean }) {
  return <div className="rate-row">
    <label><span>{t('折合 1 {code} =', { code: s.code })}</span><input inputMode="decimal" aria-label={t('汇率')} placeholder={readRate(s.code) || '7.12'} value={s.fx} onChange={e => onFx(e.target.value)} disabled={disabled}/><span>{currencySymbol('CNY')}</span></label>
    <label><span>{t('实际支付')} {currencySymbol('CNY')}</span><input inputMode="decimal" aria-label={t('实际支付的人民币金额')} placeholder="0.00" value={s.paid} onChange={e => onPaid(e.target.value)} disabled={disabled}/></label>
  </div>;
}

/** Amount row: the form's own CNY input (children) or the original amount, with the unit button on its right and, for a foreign unit, the rate/paid row below. */
export function AmountEntry({ fa, label, disabled, children }: { fa: ForeignAmount; label: string; disabled?: boolean; children: React.ReactNode }) {
  return <div className="amt"><div className="amt-line">{fa.foreign ? <OriginalInput s={fa} onText={v => fa.edit('text', v)} label={label} disabled={disabled}/> : children}<CurrencyButton code={fa.code} onChange={c => fa.edit('code', c)} label={t('币种')} disabled={disabled}/></div>
    {fa.foreign && <RateRow s={fa} onFx={v => fa.edit('fx', v)} onPaid={v => fa.edit('paid', v)} disabled={disabled}/>}</div>;
}
