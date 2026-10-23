import { CoverageNote } from '../CoverageNote';
// Development-only question panels for the career preview: rest, lower contribution, insurance, retirement age. Fictional sources; nothing is stored.
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { ageMonthsAt, careerSpan, closeMonths, delayTarget, windowMap } from '../plan-career-map.ts';
import type { DelayTarget, MaxGap, MinWindow, Reason } from '../plan-career-map.ts';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { money } from './result-text.ts';
import './map.css';
import { t } from '../i18n.ts';
export type Question = 'rest' | 'lower' | 'switch';

/** Optional one-off inflows (share vesting, a large bonus, a side job), each in its own month. */
export function LumpsSection({ draft, patch }: { draft: CareerDraft; patch: (v: Partial<CareerDraft>) => void }) {
  const lumps = draft.lumps ?? [];
  const set = (next: NonNullable<CareerDraft['lumps']>) => patch({ lumps: next });
  return <section className="career-input"><h3>{t('另有的大额一次性收入（选填）')}</h3>
    <p className="career-footnote">{t('股票归属、大额奖金、兼职等，仅填资金截至日之后明确假设会到账、且不在月储蓄中的税后金额。已在起点资产里的钱不要再填；未确定的股权和奖金不计入。')}</p>
    {lumps.map((l, i) => <div key={i} className="career-lump"><MonthInput label={t('第 {v1} 笔到账月份', { v1: i + 1 })} value={l.month} onChange={v => set(lumps.map((o, j) => (j === i ? { ...o, month: v } : o)))}/><CentInput label={t('第 {v1} 笔金额', { v1: i + 1 })} placeholder={t('金额（元）')} value={l.cents} onChange={v => set(lumps.map((o, j) => (j === i ? { ...o, cents: v } : o)))}/><button type="button" aria-label={t('删除第 {v1} 笔', { v1: i + 1 })} onClick={() => set(lumps.filter((_, j) => j !== i))}>{t('删除')}</button></div>)}
    <button type="button" disabled={lumps.length >= 24} onClick={() => set([...lumps, { month: draft.transition_month ?? '', cents: '' }])}>{t('添加一笔')}</button>
  </section>;
}
type Patch = (v: Partial<CareerDraft>) => void;
type Props = { sources: PlanningSources; draft: CareerDraft; patch: Patch };

const wan = (cents: number) => `¥${(cents / 1_000_000).toFixed(1)}万`;
const span = (months: number) => `${Math.floor(months / 12)} 年 ${months % 12} 个月`;
const reasonText: Record<Reason, string> = { goal: '目标时资产不够', cash: '空窗中资金先不够', prefix: '已知付款先不够，后面的收入补不回来' };
const profileOf = (s: PlanningSources) => (s.profile.status === 'ready' ? s.profile.value.saved?.profile ?? null : null);
const ageText = (s: PlanningSources, ym: string) => { const m = ageMonthsAt(s, ym); return m === null ? ym : `${ym}（${Math.floor(m / 12)} 岁 ${m % 12} 个月）`; };

const questions: { id: Question; title: string; hint: string }[] = [
  { id: 'rest', title: t('保持退休目标，最长可空窗多久？'), hint: t('按你假设的复工后储蓄，检查现金与原退休目标；不是只看存款能花多久') },
  { id: 'lower', title: t('再做多久，才可以降低投入？'), hint: t('高收入还要做到哪个月，之后每月少攒也不影响退休目标') },
  { id: 'switch', title: t('换工作后，每月至少要攒多少？'), hint: t('换成别的工作或有一段空窗之后，每月最少要攒多少才能保住目标') },
];
export function QuestionPicker({ value, onChange }: { value: Question; onChange: (q: Question) => void }) {
  return <section className="career-questions" aria-label={t('想知道什么')}><h2>{t('你想知道什么？')}</h2>
    <div role="radiogroup" aria-label={t('想知道什么')} className="career-question-grid">{questions.map(q => <label key={q.id} className={`career-question${value === q.id ? ' on' : ''}`}><input type="radio" name="career-question" checked={value === q.id} onChange={() => onChange(q.id)}/><strong>{q.title}</strong><small>{q.hint}</small></label>)}</div>
  </section>;
}

export function minText(s: PlanningSources, x: MinWindow): string {
  if (x.status === 'found') return `高收入至少要持续到 ${ageText(s, x.close_month)} 之前（约 ${span(x.months)}）`;
  if (x.status === 'already_met') return '现在关闭也满足目标';
  return x.message;
}
export function gapText(x: MaxGap): string {
  if (x.status === 'found' && x.ranges) return `可行空窗：${x.ranges.map(r => r.from === r.to ? `${r.from} 个月` : `${r.from}—${r.to} 个月`).join('、')}；最大 ${x.months} 个月，不能认为更短都满足。`;
  if (x.status === 'found') return `最多能空窗 ${x.months} 个月（${x.limit === 'end' ? '已到本次搜索上限，不向目标以后外推' : `再长：${reasonText[x.limit]}`}）`;
  if (x.status === 'none') return `检查范围内未找到可行空窗：${x.reason ? reasonText[x.reason] : '条件未齐全'}`;
  return x.message;
}
function delayText(x: DelayTarget): string {
  if (x.status === 'found') return `按这个条件原目标满足不了；逐月检查中最早在 ${x.month} 满足（比原目标晚 ${x.delay_months} 个月）`;
  if (x.status === 'already_met') return '原目标就能满足，不用推迟';
  if (x.status === 'not_found') return `推迟到 ${x.up_to_month}也满足不了`;
  return x.message;
}

/** Retirement-age concession for the draft as filled in (needs the post-change savings estimate). */
export function DelaySection({ sources, draft }: Props) {
  const r = useMemo(() => delayTarget(sources, draft), [sources, draft]);
  return <><CoverageNote sources={sources} compact/><section className="career-input"><h3>{t('推迟目标后的逐月对照')}</h3><p className="career-line">{delayText(r)}</p>
    <p className="career-footnote">{t('只是和原目标并排看，不会改你的目标。按明确月份逐月比较，保持其余收入和支出假设不变。')}</p></section></>;
}

type Stage = 'gap' | 'recovery';

/** Question 1: how long can the user rest. */
export function RestQuestion({ draft, patch }: Props) {
  const extra = draft.gap.extra_income ?? { lump_cents: null, benefit_monthly_cents: null, benefit_months: null };
  const setExtra = (v: Partial<typeof extra>) => patch({ gap: { ...draft.gap, extra_income: { ...extra, ...v } } });
  return <>
    <div className="career-layout"><section className="career-input"><h2>{t('你的情况')}</h2>
      <FormRow label={t('从哪个月开始不工作')}><MonthInput label={t('从哪个月开始不工作')} value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>
      <FormRow label={t('不工作期间，每月到账多少（元）')} hint={t('如失业金以外的零活收入，税后；完全没有就填 0。')}><CentInput label={t('不工作期间每月到账')} value={draft.gap.income_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, income_cents: v || null } })}/></FormRow>
      <FormRow label={t('不工作期间，每月总共花多少（元）')} hint={t('生活、房租、月供、自缴社保等全部花销。')}><CentInput label={t('不工作期间每月花销')} value={draft.gap.spend_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, spend_cents: v || null } })}/></FormRow>
      <FormRow label={t('你估计找到新工作后每月能攒多少（元）')} hint={t('收入拿到手、扣完全部花销后每月剩下的钱；可以是 0 或负数。')}><CentInput label={t('你估计找到新工作后每月能攒多少')} signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>
      <details><summary>{t('资金检查条件')}</summary><FormRow label={t('空窗资金底线（元）')} hint={t('选填：期间不想让可动用资金低于多少。')}><CentInput label={t('空窗资金底线')} value={draft.floor_cents ?? ''} onChange={v => patch({ floor_cents: v || null })}/></FormRow>
        <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e => patch({ liquid_funds_confirmed: e.target.checked })}/>{t('这笔资金可以及时取用（不勾选就无法检查空窗中的付款）')}</label></details>
    </section><section className="career-input">
      <h3>{t('补偿金与限期补助（选填）')}</h3>
      <FormRow label={t('一次性到账（元）')} hint={t('如离职补偿、未休假折现，税后；留空表示没有。到账记在开始不工作那个月月底。')}><CentInput label={t('一次性到账')} value={extra.lump_cents ?? ''} onChange={v => setExtra({ lump_cents: v || null })}/></FormRow>
      <FormRow label={t('限期补助每月（元）')} hint={t('如失业金，税后；只在下面的月数内每月月底到账，要同时填月数上限；提前恢复后不再计入。')}><CentInput label={t('限期补助每月')} value={extra.benefit_monthly_cents ?? ''} onChange={v => setExtra({ benefit_monthly_cents: v || null })}/></FormRow>
      <FormRow label={t('补助领取月数上限')}><input aria-label={t('补助领取月数上限')} type="number" min="0" step="1" value={extra.benefit_months ?? ''} onChange={e => setExtra({ benefit_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    </section></div>
    <LumpsSection draft={draft} patch={patch}/>
  </>;
}

/** Question 2: how long must the high-income window last. */
export function LowerQuestion({ draft, patch }: Props) {
  return <section className="career-input"><h2>{t('降低投入后的条件')}</h2>
    <FormRow label={t('先空窗几个月')} hint={t('留空表示未知；0 表示直接换工作。')}><input aria-label={t('地图空窗月数')} type="number" min="0" step="1" value={draft.gap_months ?? ''} onChange={e => patch({ gap_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    <FormRow label={t('不工作期间，每月到账多少（元）')}><CentInput label={t('不工作期间每月到账')} value={draft.gap.income_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, income_cents: v || null } })}/></FormRow>
    <FormRow label={t('不工作期间，每月总共花多少（元）')}><CentInput label={t('不工作期间每月花销')} value={draft.gap.spend_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, spend_cents: v || null } })}/></FormRow>
    <FormRow label={t('之后每月能攒多少（元）')}><CentInput label={t('之后每月能攒多少')} signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>
    <FormRow label={t('详细对照采用哪个变化月')} hint={t('最早月份由试算搜索；此处仅用于推迟目标的对照。')}><MonthInput label={t('对照变化月')} value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>
  </section>;
}

export function LowerResult({ sources, draft, patch, answer }: Props & { answer: MinWindow }) {
  const bounds = careerSpan(sources);
  const current = profileOf(sources)?.retire.basic?.contribution.monthly_cents;
  const [expanded, setExpanded] = useState(false);
  const candidates = current ? [0, .25, .5, .75].map(f => String(Math.round(Number(current) * f))) : [];
  const step = bounds ? Math.max(12, Math.ceil((bounds.target - bounds.now) / 8 / 12) * 12) : 12;
  const map = useMemo(() => expanded && bounds ? windowMap(sources, draft, closeMonths(sources, step), candidates) : null, [expanded, sources, draft, step, current]);
  return <><CoverageNote sources={sources} compact/><>
    <h3>{t('保持退休目标，最早何时可以降低投入？')}</h3><p className="career-number">{minText(sources, answer)}</p>
    <p className="career-footnote">{t('逐月检查所填条件，只报告最早满足的一个月，不承诺更晚都满足。月数为起点至变化月的日历跨度，起点当月可能没有完整投入。')}</p>
    <details onToggle={e => setExpanded(e.currentTarget.open)}><summary>{t('展开月份与投入的条件地图')}</summary>
      {map && <div className="career-table-wrap"><table className="career-table"><caption>{t('候选投入取当前投入的 0%、25%、50%、75%，仅供条件对照；空窗及缴费沿用本次条件。每格仅代表该月份。')}</caption>
        <thead><tr><th>{t('之后每月攒')}</th>{map.closes.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{map.rows.map((row, i) => <tr key={i}><th>{money(map.recoveries[i])}</th>{row.map(c => <td key={c.close_month} className={`career-cell career-${c.verdict}`} title={c.issues.join(' ')}>{c.verdict === 'meets' ? t('满足所列条件') : c.verdict === 'blocked' ? t('待补条件') : c.reason === 'goal' ? t('差 {v1}', { v1: wan(c.shortfall_cents ?? 0) }) : t('已知资金限制')}</td>)}</tr>)}</tbody>
      </table></div>}
    </details>
    <details><summary>{t('推迟退休目标的对照')}</summary><DelaySection sources={sources} draft={draft} patch={patch}/></details>
  </></>;
}

/** External retirement income path: only actual cash bills matter, no contribution-base questions. */
export function CashInsuranceSection({ draft, patch }: Pick<Props, 'draft' | 'patch'>) {
  const [stage, setStage] = useState<Stage>('gap');
  const [entry, setEntry] = useState<Record<Stage, { cash: string; inc: '' | 'included' | 'extra' }>>({ gap: { cash: '', inc: '' }, recovery: { cash: '', inc: '' } });
  const set = (next: { cash: string; inc: '' | 'included' | 'extra' }) => {
    setEntry(x => ({ ...x, [stage]: next }));
    patch({ [stage]: { ...draft[stage], insurance: { monthly_cents: next.cash !== '' && next.inc !== '' ? next.cash : null, included: next.inc === 'included' } } } as Partial<CareerDraft>);
  };
  const active = draft[stage];
  return <section className="career-input career-insurance" id="career-insurance"><h2>{t('另外需要支付的费用')}</h2>
    <p className="career-footnote">{t('只记录用户确认的现金费用。没有额外费用时主动填 0；已含在总开销或净储蓄中时不要重复扣除。')}</p>
    <FormRow label={t('设置哪段时间')}><select aria-label={t('设置哪段时间')} value={stage} onChange={e => setStage(e.target.value as Stage)}><option value="gap">{t('不工作的这段时间')}</option><option value="recovery">{t('恢复工作以后')}</option></select></FormRow>
    <FormRow label={t('每月另外支付的费用（元）')} hint={t('按你确认的费用填写；工资已经扣除的金额不用再填一遍。')}><CentInput label={t('每月实际缴费')} value={entry[stage].cash} onChange={v => set({ ...entry[stage], cash: v })}/></FormRow>
    <FormRow label={stage === 'gap' ? t('前面的总开销已经包含这笔费用吗？') : t('每月能攒多少已经扣掉这笔费用了吗？')}><select aria-label={t('缴费是否已包含')} value={entry[stage].inc} onChange={e => set({ ...entry[stage], inc: e.target.value as '' | 'included' | 'extra' })}><option value="">{t('请选择')}</option><option value="extra">{t('还没包含，另外扣除')}</option><option value="included">{t('已经包含，只计算一次')}</option></select></FormRow>
    <p className="career-footnote">{active.insurance.monthly_cents === null ? t('还需确认金额与包含关系；未知不会按 0 计算。') : active.insurance.included ? t('沿用前面的开销或储蓄，不再扣一次。') : stage === 'gap' ? t('在前面的开销之外，每月另付 {v1}。', { v1: money(active.insurance.monthly_cents) }) : t('从填写的每月储蓄中另扣 {v1}。', { v1: money(active.insurance.monthly_cents) })}</p>
    <ul className="career-footnote" aria-label={t('两段缴费摘要')}>{(['gap', 'recovery'] as const).map(s => <li key={s}>{s === 'gap' ? t('不工作期间') : t('恢复工作以后')}：{draft[s].insurance.monthly_cents === null ? t('待填完整') : t('{v1} / 月，{v2}', { v1: money(draft[s].insurance.monthly_cents), v2: draft[s].insurance.included ? '已含' : '另付' })}</li>)}</ul>
    <button type="button" onClick={() => setStage(stage === 'gap' ? 'recovery' : 'gap')}>{stage === 'gap' ? t('填写恢复工作后的费用') : t('填写不工作期间的费用')}</button>
    <a className="career-result-link" href="#career-results">{t('查看试算结果 ↓')}</a>
  </section>;
}
