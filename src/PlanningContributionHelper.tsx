import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { SAVING_BASIS_CAVEAT, savingFromFlow } from './planning-basic-defaults';
import type { History } from './planning-basic-defaults';

/** The investment accounts' change is told apart from saving, never added to it. */
export const MarketNote = ({ history }: { history: History }) => history.market === null ? null : <span className="muted small"> 另外，投资账户变化的每月中位数约 {money(history.market)}（含转入和涨跌），单独列出。</span>;

/** Historical changes are read-only. Only explicitly entered income minus expenses may be picked. */
export function ContributionHelper({ history, disabled, onPick }: { history: History; disabled?: boolean; onPick: (cents: string) => void }) {
  const [income, setIncome] = useState(''), [spend, setSpend] = useState('');
  const diff = savingFromFlow(income, spend);
  return <>{history.saving !== null && <p className="muted small plan-suggest" role="status">按过去 {history.count} 个盘点区间，你每月估计存下的中位数约 {money(history.saving)}（估计）。{SAVING_BASIS_CAVEAT}<MarketNote history={history}/>历史账户变化不直接作为未来每月投入。</p>}
  <details className="plan-suggest"><summary>不确定？用每月到账和开销估一个</summary>
    <p className="muted small">填写你预计的税后到账和全部生活开销（含房租、保险、旅行等）。转入基金、股票等投资账户的钱不是开销，投资涨跌也不算到账。</p>
    <FormRow label="每月到账（税后）"><CentInput label="每月到账" value={income} disabled={disabled} placeholder="0.00" onChange={setIncome}/></FormRow>
    <FormRow label="每月全部开销" hint="大概就行，偏高估一点更稳妥"><CentInput label="每月全部开销" value={spend} disabled={disabled} placeholder="0.00" onChange={setSpend}/></FormRow>
    {diff !== null && <p role="status">每月大约能存 {money(diff)}。<button type="button" className="ui-btn" disabled={disabled} onClick={() => onPick(diff)}>采用</button></p>}
  </details></>;
}
