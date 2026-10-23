import { CoverageNote } from '../CoverageNote';
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
import { t } from '../i18n.ts';
function Sensitivity({ sources, draft, baseline }: { sources: PlanningSources; draft: CareerDraft; baseline: MaxGap }) {
  const [change, setChange] = useState('100000');
  const rows = useMemo(() => {
    if (!validCareerAmount(change) || Number(change) <= 0 || !validCareerAmount(draft.recovery.monthly_cents, true) || !validCareerAmount(draft.gap.spend_cents)) return [];
    const less = String(Number(draft.recovery.monthly_cents) - Number(change));
    const more = String(Number(draft.gap.spend_cents) + Number(change));
    return [
      { label: t('复工后每月少攒 {v1}，改为 {v2}', { v1: money(change), v2: money(less) }), value: maxGap(sources, { ...draft, recovery: { ...draft.recovery, monthly_cents: less } }) },
      { label: t('空窗每月多花 {v1}，改为 {v2}', { v1: money(change), v2: money(more) }), value: maxGap(sources, { ...draft, gap: { ...draft.gap, spend_cents: more } }) },
    ];
  }, [sources, draft, change]);
  return <div><CoverageNote sources={sources} compact/>
    <p className="career-footnote">{t('每行只改变一项，其余沿用当前填写。默认的 1,000 元只是可修改的对照幅度，不代表收入预测或发生概率；不会改写上面的输入。')}</p>
    <FormRow label={t('每月变化幅度（元）')}><CentInput label={t('每月变化幅度')} value={change} onChange={setChange}/></FormRow>
    {!rows.length ? <p role="status">{t('请填写大于 0 的变化幅度，并先补齐当前收支。')}</p> : <div className="career-table-wrap"><table className="career-table career-sensitivity"><caption>{t('退休目标不变，分别改变储蓄或开销')}</caption><thead><tr><th>{t('仅改变这一项')}</th><th>{t('对照结果')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th>{row.label}</th><td>{gapText(row.value)}{baseline.status === 'found' && row.value.status === 'found' && <span className="career-footnote">{t('（最长月数比当前')}{row.value.months === baseline.months ? t('不变') : t('{v1} {v2} 个月', { v1: row.value.months < baseline.months ? '少' : '多', v2: Math.abs(row.value.months - baseline.months) })}）</span>}</td></tr>)}</tbody></table></div>}
  </div>;
}

export function RestResult({ sources, draft, answer }: { sources: PlanningSources; draft: CareerDraft; answer: MaxGap }) {
  const [expanded, setExpanded] = useState(false);
  const profile = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile : null;
  return <><CoverageNote sources={sources} compact/>
    <h3>{t('保持原退休目标，最长可空窗多久？')}</h3>
    <p className={answer.status === 'found' ? 'career-number' : 'career-message'}>{draft.recovery.monthly_cents === null ? t('请先填写复工后每月能攒多少；若还不知道，可以切换到“每月至少要攒多少”。') : gapText(answer)}</p>
    <p className="career-footnote">{t('从')} {draft.transition_month ?? t('待确认月份')} {t('开始不工作；复工后每月攒')} {draft.recovery.monthly_cents === null ? t('待确认') : money(draft.recovery.monthly_cents)}{t('，保持')} {profile?.retire.simplified.time.target_month ?? t('待确认')} {t('退休、检查到')} {profile?.retire.simplified.time.horizon_month ?? t('待确认')}{t('。两段现金费用均按上方填写计入。')}</p>
    <p>{t('这里同时检查空窗资金与退休目标。单看存款能花多久，可能得到另一个月数；本结果没有承诺你会在这段时间内找到工作。')}</p>
    {answer.status === 'found' && <details onToggle={e => setExpanded(e.currentTarget.open)}><summary>{t('如果少攒一些或多花一些，会怎样？')}</summary>{expanded && <Sensitivity sources={sources} draft={draft} baseline={answer}/>}</details>}
  </>;
}
