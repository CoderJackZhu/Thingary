import { useState } from 'react';
import { CurrencyPicker } from '../../../CurrencyPicker';
import { readDefaultCurrency, writeDefaultCurrency } from '../../../currency-picker.ts';
import { t, langPreferences, readLangPreference, setLangPreference, type LangPreference } from '../../../i18n.ts';
import { useNav } from '../../nav-context';
import { FormGroup, ListGroup, ListRow, SegmentedControl } from '../../ui';
import { SettingsShell } from './Shell';

/** 通用: 界面语言与默认币种. */
export default function GeneralPage() {
  const [currency, setCurrency] = useState(readDefaultCurrency), nav = useNav();
  return <SettingsShell title={t('通用')}>
    <FormGroup title={t('语言')} footer={t('切换语言会重新载入界面，并回到这一页。')}><div className="me-pad"><SegmentedControl label="Language" items={langPreferences.map(l => ({ id: l.value, label: l.label }))} value={readLangPreference()} onChange={value => setLangPreference(value as LangPreference, 'me.settings:general')}/></div></FormGroup>
    <FormGroup title={t('默认币种')} footer={t('新增金额时默认使用；已有记录不变。')}><div className="me-pad"><CurrencyPicker label={t('默认币种')} value={currency} onChange={code => { if (writeDefaultCurrency(code)) setCurrency(code); }}/></div></FormGroup>
    <ListGroup><ListRow title={t('汇率')} subtitle={t('各币种的默认汇率')} onClick={() => nav.push('me.settings', { page: 'rates' })}/></ListGroup>
  </SettingsShell>;
}
