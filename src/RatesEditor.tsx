import { useState } from 'react';
import { currencies } from './currency';
import { clearRate, currencyName, referenceRateOf, referenceRatesDate, rememberRate, savedRate } from './currency-picker.ts';
import { t } from './i18n.ts';
import './currency-picker.css';

/** 汇率（默认值）: one place to set the rate offered by default for each currency. Blank means the built-in reference. */
export function RatesEditor() {
  const [error, setError] = useState(''), [version, setVersion] = useState(0);
  const codes = currencies.map(c => c[0]).filter(c => c !== 'CNY');
  function commit(code: string, text: string) {
    const value = text.trim();
    if (!value) { clearRate(code); setError(''); }
    else if (/^\d{1,9}(\.\d{1,6})?$/.test(value) && Number(value) > 0) { rememberRate(code, value.replace(/^0+(?=\d)/, '')); setError(''); }
    else { setError(t('{code} 的汇率须是大于 0 的数字，最多 6 位小数。', { code })); }
    setVersion(v => v + 1);
  }
  return <div className="rates-editor">
    <p className="muted small">{t('新增金额时默认带出这里的汇率（1 单位外币折合多少人民币）。留空的用内置参考汇率：欧洲央行 {date} 的快照，只是估算，保存时以实际支付的人民币为准。', { date: referenceRatesDate })}</p>
    {error && <p role="alert" className="notice">{error}</p>}
    <ul>{codes.map(code => <li key={`${code}:${version}`}>
      <span className="rate-code"><strong>{code}</strong> <span className="muted">{currencyName(code)}</span></span>
      <input inputMode="decimal" aria-label={t('{code} 默认汇率', { code })} defaultValue={savedRate(code)} placeholder={referenceRateOf(code) || t('手动填写')} onBlur={e => commit(code, e.target.value)}/>
    </li>)}</ul>
  </div>;
}
