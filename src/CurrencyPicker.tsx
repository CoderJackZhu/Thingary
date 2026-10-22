import { useEffect, useRef, useState } from 'react';
import { currencyName, currencySymbol, flagOf, flagsSupported, pickerSections, rememberCurrency } from './currency-picker.ts';
import { t } from './i18n.ts';
import './currency-picker.css';

/** 金额后面的“单位”按钮：点开后选币种（默认、最近、常用、全部，可搜索）。桌面是对话框，窄屏全屏。 */
export function CurrencyPicker({ value, onChange, disabled, label }: { value: string; onChange: (code: string) => void; disabled?: boolean; label?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  useEffect(() => { if (open) dialog.current?.showModal(); else if (dialog.current?.open) dialog.current.close(); }, [open]);
  const flags = flagsSupported();
  const pick = (code: string) => { rememberCurrency(code); onChange(code); setOpen(false); setQuery(''); };
  return <>
    <button type="button" className="cp-trigger" disabled={disabled} aria-haspopup="dialog" aria-label={label ?? t('选择币种')} onClick={() => setOpen(true)}>{flags && <span aria-hidden="true">{flagOf(value)}</span>}<strong>{value}</strong><span aria-hidden="true">▾</span></button>
    <dialog ref={dialog} className="cp-dialog" aria-label={t('选择币种')} onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      {open && <div className="cp-body">
        <header><input type="search" autoFocus value={query} placeholder={t('搜索代码、名称或国家')} aria-label={t('搜索币种')} onChange={event => setQuery(event.target.value)}/><button type="button" onClick={() => setOpen(false)}>{t('取消')}</button></header>
        <div className="cp-list">{(() => { const sections = pickerSections(query); return sections.every(s => !s.codes.length) ? <p className="muted">{t('没有匹配的币种。')}</p> : sections.map(section => <section key={section.id} aria-label={section.title}>
          <h3>{section.title}</h3>
          <ul>{section.codes.map(code => <li key={code}><button type="button" aria-pressed={code === value} className={code === value ? 'cp-on' : undefined} onClick={() => pick(code)}>
            {flags && <span className="cp-flag" aria-hidden="true">{flagOf(code)}</span>}<span className="cp-code">{code}</span><span className="cp-name">{currencyName(code)}</span><span className="cp-symbol">{currencySymbol(code)}</span>
          </button></li>)}</ul>
        </section>); })()}</div>
      </div>}
    </dialog>
  </>;
}
