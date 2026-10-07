import { useState } from 'react';
import { money } from './asset';
import { CentInput, FormRow } from './FormControls';
import { HISTORY_CAVEAT, savingFromFlow } from './planning-basic-defaults';
import type { History } from './planning-basic-defaults';

/** Where "每月能存多少" can come from without guessing: past 盘点, or two numbers the person knows. Nothing here is saved until 采用. */
export function ContributionHelper({ history, disabled, onPick }: { history: History; disabled?: boolean; onPick: (cents: string) => void }) {
  const [income, setIncome] = useState(''), [spend, setSpend] = useState('');
  const diff = savingFromFlow(income, spend);
  if (history.saving !== null) return <p className="muted small plan-suggest" role="status">按过去 {history.count} 个盘点区间，你每月存下的中位数约 {money(history.saving)}（{HISTORY_CAVEAT}）。<button type="button" className="ui-btn" disabled={disabled} onClick={() => onPick(history.saving!)}>采用</button></p>;
  return <details className="plan-suggest"><summary>不确定？用每月到账和开销估一个</summary>
    <p className="muted small">{history.reason}没有足够的盘点历史，可以填两个大概数：每月到账多少，全部开销（含房租、保险、旅行等）多少。</p>
    <FormRow label="每月到账（税后）"><CentInput label="每月到账" value={income} disabled={disabled} placeholder="0.00" onChange={setIncome}/></FormRow>
    <FormRow label="每月全部开销" hint="大概就行，偏高估一点更稳妥"><CentInput label="每月全部开销" value={spend} disabled={disabled} placeholder="0.00" onChange={setSpend}/></FormRow>
    {diff !== null && <p role="status">每月大约能存 {money(diff)}。<button type="button" className="ui-btn" disabled={disabled} onClick={() => onPick(diff)}>采用</button></p>}
  </details>;
}
