import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { savingFromFlow } from './planning-basic-defaults';
import { t } from './i18n.ts';
/** 历史推算的估计存下已移出规划表单，只在收入与复盘的折叠历史参考中保留；这里只留本次手填辅助。 */
export function ContributionHelper({ disabled, onPick }: { disabled?: boolean; onPick: (cents: string) => void }) {
  const [income, setIncome] = useState(''), [spend, setSpend] = useState('');
  const diff = savingFromFlow(income, spend);
  return <details className="plan-suggest"><summary>{t('不确定？用每月到账和开销估一个')}</summary>
    <p className="muted small">{t('填写你预计的税后到账和全部生活开销（含房租、保险、旅行等）。转入基金、股票等投资账户的钱不是开销，投资涨跌也不算到账。')}</p>
    <FormRow label={t('每月到账（税后）')}><CentInput label={t('每月到账')} value={income} disabled={disabled} placeholder="0.00" onChange={setIncome}/></FormRow>
    <FormRow label={t('每月全部开销')} hint={t('大概就行，偏高估一点更稳妥')}><CentInput label={t('每月全部开销')} value={spend} disabled={disabled} placeholder="0.00" onChange={setSpend}/></FormRow>
    {diff !== null && <p role="status">{t('每月大约能存 {v1}。', { v1: money(diff) })}<button type="button" className="ui-btn" disabled={disabled} onClick={() => onPick(diff)}>{t('采用')}</button></p>}
  </details>;
}
