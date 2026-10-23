import { useState } from 'react';
import { CurrencyPicker } from './CurrencyPicker';
import { RatesEditor } from './RatesEditor';
import { readDefaultCurrency, writeDefaultCurrency } from './currency-picker.ts';
import { t, langPreferences, readLangPreference, setLangPreference, type LangPreference } from './i18n.ts';

/** 通用：界面语言与默认币种。 */
export function GeneralSettings() {
  const [currency, setCurrency] = useState(readDefaultCurrency);
  return <section className="ui-card ui-content module-settings appearance-settings" aria-labelledby="general-heading">
    <div className="data-heading"><div><p className="eyebrow">{t('设置')}</p><h2 id="general-heading">{t('通用')}</h2></div></div>
    <label className="privacy-idle">语言 / Language<select defaultValue={readLangPreference()} onChange={event => setLangPreference(event.target.value as LangPreference, 'settings:general')}>{langPreferences.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}</select></label>
    <p className="data-intro">{t('切换语言会重新载入界面，并回到这一页。')}</p>
    <div className="privacy-idle">{t('默认币种')}<CurrencyPicker label={t('默认币种')} value={currency} onChange={code => { if (writeDefaultCurrency(code)) setCurrency(code); }}/><span className="muted small">{t('新增金额时默认使用；已有记录不变。')}</span></div>
    <details className="rates-details"><summary>{t('汇率（默认值）')}</summary><RatesEditor/></details>
  </section>;
}
