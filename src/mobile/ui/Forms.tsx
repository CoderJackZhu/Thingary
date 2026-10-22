import { useId } from 'react';
import type { ReactNode } from 'react';
import { CurrencyInput } from '../../CurrencyInput';
import { DateInput } from '../../DateInput';
import { advanceFocus } from './field-advance';

type ButtonProps = { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'plain' | 'danger'; block?: boolean; disabled?: boolean; type?: 'button' | 'submit'; ariaLabel?: string };
/** Text button, at least 44px tall. `primary` is the single main action of a screen. */
export function Button({ children, onClick, variant = 'secondary', block, disabled, type = 'button', ariaLabel }: ButtonProps) {
  return <button type={type} className={`m-button m-button-${variant}${block ? ' m-block' : ''}`} disabled={disabled} aria-label={ariaLabel} onClick={onClick}>{children}</button>;
}

/** iOS-style on/off switch (role=switch). `label` is read by VoiceOver; show visible text next to it in a FormRow. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="m-switch" onClick={() => onChange(!checked)}><span/></button>;
}

/** Horizontally scrolling filter chips. Single choice by default; with `multiple`, `value` is an array (tags). */
export function ChipRow(props: { items: { id: string; label: string }[]; label: string } & ({ multiple?: false; value: string; onChange: (value: string) => void } | { multiple: true; value: string[]; onChange: (value: string[]) => void })) {
  const { items, label } = props;
  const selected = (id: string) => props.multiple ? props.value.includes(id) : props.value === id;
  const toggle = (id: string) => props.multiple ? props.onChange(props.value.includes(id) ? props.value.filter(v => v !== id) : [...props.value, id]) : props.onChange(id);
  return <div className="m-chips" role="group" aria-label={label}>{items.map(item => <button key={item.id} type="button" className="m-chip" aria-pressed={selected(item.id)} onClick={() => toggle(item.id)}>{item.label}</button>)}</div>;
}

/** White grouped card holding FormRows or fields, with an optional heading and footnote. */
export function FormGroup({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return <section className="m-form-group" aria-label={title}>{title && <h2 className="m-group-title">{title}</h2>}<div className="m-card m-form-card">{children}</div>{footer && <p className="m-group-footer">{footer}</p>}</section>;
}

/** One form line: label on the left, control on the right (or full width with `stacked`). `hint` explains unknown / optional values. */
export function FormRow({ label, hint, children, stacked, htmlFor }: { label: string; hint?: string; children: ReactNode; stacked?: boolean; htmlFor?: string }) {
  return <div className={`m-form-row${stacked ? ' m-stacked' : ''}`}><label className="m-form-label" htmlFor={htmlFor}>{label}</label><div className="m-form-control">{children}</div>{hint && <p className="m-form-hint">{hint}</p>}</div>;
}

/** Single-line text input in a FormRow. */
export function TextField({ label, value, onChange, placeholder, hint, disabled, maxLength, inputMode }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; disabled?: boolean; maxLength?: number; inputMode?: 'text' | 'numeric' | 'decimal' | 'search' }) {
  const id = useId();
  return <FormRow label={label} hint={hint} htmlFor={id}><input id={id} className="m-input" value={value} placeholder={placeholder} disabled={disabled} maxLength={maxLength} inputMode={inputMode} onChange={event => onChange(event.target.value)}/></FormRow>;
}

/** Multi-line note field, label above. */
export function TextAreaField({ label, value, onChange, placeholder, hint, disabled, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: string; disabled?: boolean; rows?: number }) {
  const id = useId();
  return <FormRow label={label} hint={hint} htmlFor={id} stacked><textarea id={id} className="m-input m-textarea" rows={rows} value={value} placeholder={placeholder} disabled={disabled} onChange={event => onChange(event.target.value)}/></FormRow>;
}

/** Native select in a FormRow (opens the iOS picker). */
export function SelectField({ label, value, onChange, options, disabled, hint }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; disabled?: boolean; hint?: string }) {
  const id = useId();
  return <FormRow label={label} hint={hint} htmlFor={id}><select id={id} className="m-input m-select" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></FormRow>;
}

/**
 * Amount input in a FormRow. `signed` fields get a ± button (the iOS number pad has no minus key). Wraps the desktop CurrencyInput: `value` is an integer string of minor units
 * ('' = unknown, never zero), `places` the currency decimals. Leave empty when the amount is not known.
 */
export function MoneyField({ label, value, onChange, places = 2, hint, disabled, signed, symbol = '¥', onEnter }: { label: string; value: string; onChange: (value: string) => void; places?: number; hint?: string; disabled?: boolean; signed?: boolean; symbol?: string; /** Return (or 下一项 on the keyboard bar) was pressed; default moves to the next field of the form and closes the keyboard after the last. */ onEnter?: () => void }) {
  return <FormRow label={label} hint={hint}><span className="m-money">{symbol && <span aria-hidden="true">{symbol}</span>}<CurrencyInput label={label} value={value} onChange={onChange} places={places} disabled={disabled} signed={signed} signToggle={signed} enterKeyHint="next" onEnter={onEnter ?? (() => { const el = document.activeElement; if (el instanceof HTMLElement) advanceFocus(el); })}/></span></FormRow>;
}

/** Date input in a FormRow (desktop DateInput). `value` is YYYY-MM-DD or '' for unknown; `allowClear` adds 清除. */
export function DateField({ label, value, onChange, hint, disabled, min, max, allowClear }: { label: string; value: string; onChange: (value: string) => void; hint?: string; disabled?: boolean; min?: string; max?: string; allowClear?: boolean }) {
  return <FormRow label={label} hint={hint}><span className="m-date"><DateInput label={label} value={value} onChange={onChange} disabled={disabled} min={min} max={max} allowClear={allowClear}/></span></FormRow>;
}
