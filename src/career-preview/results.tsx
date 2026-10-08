// Read-only presentation: one answer, with explicitly separate what-if comparisons.
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { validCareerAmount } from '../plan-career-contract.ts';
import { maxGap } from '../plan-career-map.ts';
import type { MaxGap } from '../plan-career-map.ts';
import { gapText } from './map.tsx';
import { money } from './result-text.ts';

function Sensitivity({ sources, draft, baseline }: { sources: PlanningSources; draft: CareerDraft; baseline: MaxGap }) {
  const [change, setChange] = useState('100000');
  const rows = useMemo(() => {
    if (!validCareerAmount(change) || Number(change) <= 0 || !validCareerAmount(draft.recovery.monthly_cents, true) || !validCareerAmount(draft.gap.spend_cents)) return [];
    const less = String(Number(draft.recovery.monthly_cents) - Number(change));
    const more = String(Number(draft.gap.spend_cents) + Number(change));
    return [
      { label: `复工后每月少攒 ${money(change)}，改为 ${money(less)}`, value: maxGap(sources, { ...draft, recovery: { ...draft.recovery, monthly_cents: less } }) },
      { label: `空窗每月多花 ${money(change)}，改为 ${money(more)}`, value: maxGap(sources, { ...draft, gap: { ...draft.gap, spend_cents: more } }) },
    ];
  }, [sources, draft, change]);
  return <div>
    <p className="career-footnote">每行只改变一项，其余沿用当前填写。默认的 1,000 元只是可修改的对照幅度，不代表收入预测或发生概率；不会改写上面的输入。</p>
    <FormRow label="每月变化幅度（元）"><CentInput label="每月变化幅度" value={change} onChange={setChange}/></FormRow>
    {!rows.length ? <p role="status">请填写大于 0 的变化幅度，并先补齐当前收支。</p> : <div className="career-table-wrap"><table className="career-table career-sensitivity"><caption>退休目标不变，分别改变储蓄或开销</caption><thead><tr><th>仅改变这一项</th><th>对照结果</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{gapText(row.value)}{baseline.status === 'found' && row.value.status === 'found' && <span className="career-footnote">（最长月数比当前{row.value.months === baseline.months ? '不变' : `${row.value.months < baseline.months ? '少' : '多'} ${Math.abs(row.value.months - baseline.months)} 个月`}）</span>}</td></tr>)}</tbody></table></div>}
  </div>;
}

export function RestResult({ sources, draft }: { sources: PlanningSources; draft: CareerDraft }) {
  const [expanded, setExpanded] = useState(false);
  const answer = useMemo(() => maxGap(sources, draft), [sources, draft]);
  const profile = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  return <>
    <h3>保持原退休目标，最长可空窗多久？</h3>
    <p className={answer.status === 'found' ? 'career-number' : 'career-message'}>{draft.recovery.monthly_cents === null ? '请先填写复工后每月能攒多少；若还不知道，可以切换到“每月至少要攒多少”。' : gapText(answer)}</p>
    <p className="career-footnote">从 {draft.transition_month ?? '待确认月份'} 开始不工作；复工后每月攒 {draft.recovery.monthly_cents === null ? '待确认' : money(draft.recovery.monthly_cents)}，保持 {profile?.retire.target_age ?? '待确认'} 岁退休、检查到 {profile?.retire.horizon_age ?? '待确认'} 岁。两段社保均按上方填写计入。</p>
    <p>这里同时检查空窗资金与退休目标。单看存款能花多久，可能得到另一个月数；本结果没有承诺你会在这段时间内找到工作。</p>
    {answer.status === 'found' && <details onToggle={e => setExpanded(e.currentTarget.open)}><summary>如果少攒一些或多花一些，会怎样？</summary>{expanded && <Sensitivity sources={sources} draft={draft} baseline={answer}/>}</details>}
  </>;
}
