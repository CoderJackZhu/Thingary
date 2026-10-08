// Development-only question panels for the career preview: rest, lower contribution, insurance, retirement age. Fictional sources; nothing is stored.
import { useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { beijing } from '../plan-params.ts';
import { ageMonthsAt, careerSpan, closeMonths, delayTarget, maxGap, minWindow, pensionOptions, windowMap } from '../plan-career-map.ts';
import type { DelayTarget, MaxGap, MinWindow, PensionChoice, Reason } from '../plan-career-map.ts';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { money } from './result-text.ts';
import './map.css';

export type Question = 'rest' | 'lower' | 'switch';
type Patch = (v: Partial<CareerDraft>) => void;
type Props = { sources: PlanningSources; draft: CareerDraft; patch: Patch };

const wan = (cents: number) => `¥${(cents / 1_000_000).toFixed(1)}万`;
const span = (months: number) => `${Math.floor(months / 12)} 年 ${months % 12} 个月`;
const reasonText: Record<Reason, string> = { goal: '目标时资产不够', cash: '空窗中资金先不够', prefix: '已知付款先不够，后面的收入补不回来' };
const profileOf = (s: PlanningSources) => (s.profile.status === 'ready' ? s.profile.value.saved?.profile ?? null : null);
const ageText = (s: PlanningSources, ym: string) => { const m = ageMonthsAt(s, ym); return m === null ? ym : `${ym}（${Math.floor(m / 12)} 岁 ${m % 12} 个月）`; };

const questions: { id: Question; title: string; hint: string }[] = [
  { id: 'rest', title: '现在离开，能休息多久？', hint: '不工作的这段时间，钱撑得住几个月，原来的退休目标还保不保得住' },
  { id: 'lower', title: '再做多久，才可以降低投入？', hint: '高收入还要做到哪个月，之后每月少攒也不影响退休目标' },
  { id: 'switch', title: '换工作后，每月至少要攒多少？', hint: '换成别的工作或有一段空窗之后，每月最少要攒多少才能保住目标' },
];
export function QuestionPicker({ value, onChange }: { value: Question; onChange: (q: Question) => void }) {
  return <section className="career-questions" aria-label="想知道什么"><h2>你想知道什么？</h2>
    <div role="radiogroup" aria-label="想知道什么" className="career-question-grid">{questions.map(q => <label key={q.id} className={`career-question${value === q.id ? ' on' : ''}`}><input type="radio" name="career-question" checked={value === q.id} onChange={() => onChange(q.id)}/><strong>{q.title}</strong><small>{q.hint}</small></label>)}</div>
  </section>;
}

function minText(s: PlanningSources, x: MinWindow): string {
  if (x.status === 'found') return `高收入至少要持续到 ${ageText(s, x.close_month)} 之前（约 ${span(x.months)}）`;
  if (x.status === 'already_met') return '现在关闭也满足目标';
  return x.message;
}
function gapText(x: MaxGap): string {
  if (x.status === 'found') return `最多能空窗 ${x.months} 个月（${x.limit === 'end' ? '一直到目标前都撑得住' : `再长：${reasonText[x.limit]}`}）`;
  if (x.status === 'none') return `按这个条件，不空窗也保不住：${x.reason ? reasonText[x.reason] : '条件未齐全'}`;
  return x.message;
}
function delayText(x: DelayTarget): string {
  if (x.status === 'found') return `按这个条件原目标满足不了；最早要到 ${x.age} 岁才能退休（比原目标晚 ${x.delay_years} 年）`;
  if (x.status === 'already_met') return '原目标就能满足，不用推迟';
  if (x.status === 'not_found') return `推迟到 ${x.up_to_age} 岁也满足不了`;
  return x.message;
}

/** Retirement-age concession for the draft as filled in (needs the post-change savings estimate). */
export function DelaySection({ sources, draft }: Props) {
  const r = useMemo(() => delayTarget(sources, draft), [sources, draft]);
  return <section className="career-input"><h3>满足不了，最早几岁能退休？</h3><p className="career-line">{delayText(r)}</p>
    <p className="career-footnote">只是和原目标并排看，不会改你的目标。养老金缴费仍按原安排；推迟退休后要不要继续交社保，在“社保怎么交”里比。</p></section>;
}

/** Contribution choices for the gap or the stage after it. `draft` must already hold the post-change savings estimate. */
export function InsuranceSection({ sources, draft, defaultStage }: Props & { defaultStage: 'gap' | 'recovery' }) {
  const p = profileOf(sources), origBase = p?.base_cents ?? null;
  const [stage, setStage] = useState(defaultStage), [cash, setCash] = useState<(string | null)[]>([null, null, null, null]);
  const choices: PensionChoice[] = [
    { label: '停缴', pension: 'pause', cash_cents: cash[0] },
    { label: '灵活就业自缴（下限）', pension: { base_cents: beijing.base_lower_cents, hpf_monthly_cents: '0' }, cash_cents: cash[1] },
    ...(origBase ? [{ label: '灵活就业自缴（原基数）', pension: { base_cents: origBase, hpf_monthly_cents: '0' }, cash_cents: cash[2] }] : []),
    { label: '沿用原安排（如新单位代缴）', pension: 'unchanged' as const, cash_cents: cash[3] },
  ];
  const slot = (i: number) => (origBase || i < 2 ? i : 3);
  const res = useMemo(() => pensionOptions(sources, draft, stage, choices), [sources, draft, stage, cash]);
  const first = res.rows[0], floor = res.rows[1];
  const short = first.pension && !first.pension.eligible ? first.pension.short_months : 0;
  const floorCash = floor.cash_cents !== null && /^\d+$/.test(floor.cash_cents) ? Number(floor.cash_cents) : null;
  return <section className="career-input"><h3>社保怎么交</h3>
    {draft.recovery.monthly_cents === null && <p className="career-message" role="status">先填“你估计找到新工作后每月能攒多少”，才能算养老金。</p>}
    <FormRow label="比较哪一段"><select aria-label="比较哪一段" value={stage} onChange={e => setStage(e.target.value as 'gap' | 'recovery')}><option value="gap">空窗期</option><option value="recovery">找到新工作之后到目标前</option></select></FormRow>
    <div className="career-table-wrap"><table className="career-table"><caption>每月现金社保按缴费单填，含医疗等不进养老金的部分；养老金按所选方式重新算。{res.stage_months === null ? '' : `这一段共 ${res.stage_months} 个月。`}</caption>
      <thead><tr><th scope="col">方式</th><th scope="col">每月现金（元）</th><th scope="col">这段合计</th><th scope="col">退休时月养老金</th><th scope="col">比第一行</th><th scope="col">目标时资产</th></tr></thead>
      <tbody>{res.rows.map((r, i) => {
        const dc = r.stage_cash_cents !== null && first.stage_cash_cents !== null ? r.stage_cash_cents - first.stage_cash_cents : null, dp = r.pension && first.pension ? r.pension.monthly_cents - first.pension.monthly_cents : null;
        return <tr key={r.label}><th scope="row">{r.label}</th>
          <td><CentInput label={`${r.label} 每月现金`} placeholder="0" value={cash[slot(i)] ?? ''} onChange={v => setCash(cash.map((o, j) => (j === slot(i) ? (v === '' ? null : v) : o)))}/></td>
          <td>{r.stage_cash_cents === null ? '—' : money(r.stage_cash_cents)}</td>
          <td>{r.pension === null ? (r.judgement.verdict === 'blocked' ? '—' : '未引用北京养老金') : r.pension.eligible ? money(r.pension.monthly_cents) : `领不到（还差 ${r.pension.short_months} 个月）`}</td>
          <td>{i === 0 ? '基准' : dc === 0 && !dp ? '与第一行相同' : dc === null ? '—' : `多花 ${money(dc)}${dp === null ? '' : `，月养老金${dp >= 0 ? '多' : '少'} ${money(Math.abs(dp))}${dc > 0 && dp > 0 ? `，约 ${(dc / (dp * 12)).toFixed(1)} 年回本` : ''}`}`}</td>
          <td>{r.assets_at_goal_cents === null ? (r.judgement.issues[0] ?? '—') : money(r.assets_at_goal_cents)}</td></tr>;
      })}</tbody></table></div>
    {short > 0 && <p className="career-line">停缴的话，离领养老金的资格还差 <strong>{short} 个月</strong>{floorCash !== null ? <>；之后若按“灵活就业自缴（下限）”每月 {money(floorCash)} 补齐，约要 <strong>{money(short * floorCash)}</strong></> : '（填上“灵活就业自缴（下限）”的每月现金，就能算补齐要花多少）'}。</p>}
    <p className="career-footnote">“回本”不计养老金每年上调和账户利息，只是量级参考。停缴不抹去已缴月数。</p>
    <details className="career-rules"><summary>已核实的社保规则（2026-10-08 查官方原文）</summary><ul>
      <li>按月领取基本养老金的最低缴费年限：<strong>从 2030 年 1 月 1 日起由 15 年逐步提高到 20 年，每年提高 6 个月</strong>。<a href="https://www.mot.gov.cn/hudong/xiangguanziliao/202601/t20260114_4197321.html" target="_blank" rel="noreferrer">国务院办法（交通运输部转载）</a></li>
      <li>北京灵活就业人员的职工医保：<strong>首次参保，缴费之月起 6 个月后才享受待遇；断缴 3 个月内足额补缴视为连续（欠缴期间的医疗费补支），超过 3 个月再交，视为初次参保、重新等 6 个月</strong>。<a href="https://www.beijing.gov.cn/fuwu/bmfw/bmzt/lhjyry/202507/t20250709_4145235.html" target="_blank" rel="noreferrer">首都之窗·北京市医疗保障局，2025-07-09</a></li>
      <li>领失业保险金的条件包括“失业前用人单位和本人已缴纳失业保险费满一年”和“非因本人意愿中断就业”；<strong>领取期间的职工医保费由失业保险基金缴纳</strong>。<a href="https://rsj.beijing.gov.cn/xxgk/2024zcwj/202412/t20241227_3974931.html" target="_blank" rel="noreferrer">北京市失业保险金申领发放实施办法（试行）</a></li>
      <li><strong>没有核实到：</strong>灵活就业自己缴的失业保险，能不能按同样条件领失业金——该办法没有专门说明，请向北京市人社部门确认；退休后医保的累计缴费年限要求也没有核实。</li>
    </ul></details>
  </section>;
}

/** Question 1: how long can the user rest. */
export function RestQuestion({ sources, draft, patch }: Props) {
  const longest = useMemo(() => maxGap(sources, draft), [sources, draft]);
  const extra = draft.gap.extra_income ?? { lump_cents: null, benefit_monthly_cents: null, benefit_months: null };
  const setExtra = (v: Partial<typeof extra>) => patch({ gap: { ...draft.gap, extra_income: { ...extra, ...v } } });
  return <>
    <div className="career-layout"><section className="career-input"><h2>你的情况</h2>
      <FormRow label="从哪个月开始不工作"><MonthInput label="从哪个月开始不工作" value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>
      <FormRow label="不工作期间，每月到账多少（元）" hint="如失业金以外的零活收入，税后；完全没有就填 0。"><CentInput label="不工作期间每月到账" value={draft.gap.income_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, income_cents: v || null } })}/></FormRow>
      <FormRow label="不工作期间，每月总共花多少（元）" hint="生活、房租、月供、自缴社保等全部花销。"><CentInput label="不工作期间每月花销" value={draft.gap.spend_cents ?? ''} onChange={v => patch({ gap: { ...draft.gap, spend_cents: v || null } })}/></FormRow>
      <FormRow label="你估计找到新工作后每月能攒多少（元）" hint="收入拿到手、扣完全部花销后每月剩下的钱；可以是 0 或负数。"><CentInput label="你估计找到新工作后每月能攒多少" signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>
      <details><summary>资金检查条件</summary><FormRow label="空窗资金底线（元）" hint="选填：期间不想让可动用资金低于多少。"><CentInput label="空窗资金底线" value={draft.floor_cents ?? ''} onChange={v => patch({ floor_cents: v || null })}/></FormRow>
        <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e => patch({ liquid_funds_confirmed: e.target.checked })}/>这笔资金可以及时取用（不勾选就无法检查空窗中的付款）</label></details>
    </section><section className="career-input"><h2>答案</h2>
      <p className="career-number">{draft.recovery.monthly_cents === null ? '先在左边填“你估计找到新工作后每月能攒多少”（想不出来就先填 0），才能算最多能空窗多久。' : gapText(longest)}</p>
      <p className="career-footnote">不工作从 {draft.transition_month ? ageText(sources, draft.transition_month) : '—'} 开始。结果只在上面这些条件下成立，不是预测。</p>
      <h3>补偿金与限期补助（选填）</h3>
      <FormRow label="一次性到账（元）" hint="如离职补偿、未休假折现，税后；留空表示没有。到账记在开始不工作那个月月底。"><CentInput label="一次性到账" value={extra.lump_cents ?? ''} onChange={v => setExtra({ lump_cents: v || null })}/></FormRow>
      <FormRow label="限期补助每月（元）" hint="如失业金，税后；只在下面的月数内每月月底到账，要同时填月数。"><CentInput label="限期补助每月" value={extra.benefit_monthly_cents ?? ''} onChange={v => setExtra({ benefit_monthly_cents: v || null })}/></FormRow>
      <FormRow label="补助领取月数"><input aria-label="补助领取月数" type="number" min="0" step="1" value={extra.benefit_months ?? ''} onChange={e => setExtra({ benefit_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>
    </section></div>
    <InsuranceSection sources={sources} draft={draft} patch={patch} defaultStage="gap"/>
  </>;
}

/** Question 2: how long must the high-income window last. */
export function LowerQuestion({ sources, draft, patch }: Props) {
  const p = profileOf(sources), current = p?.retire.basic?.contribution.monthly_cents ?? null, bounds = careerSpan(sources);
  const defaults = useMemo(() => (current !== null && /^-?\d+$/.test(current) ? [0, 0.25, 0.5, 0.75].map(f => String(Math.round(Number(current) * f))) : ['0']), [current]);
  const [custom, setCustom] = useState<string[] | null>(null), [mapGap, setMapGap] = useState(0), [pick, setPick] = useState(1);
  const recoveries = custom ?? defaults, chosen = recoveries[Math.min(pick, recoveries.length - 1)] ?? '0';
  const step = bounds ? Math.max(12, Math.ceil((bounds.target - bounds.now) / 8 / 12) * 12) : 12;
  const closes = useMemo(() => closeMonths(sources, step).slice(0, 9), [sources, step]);
  const base = useMemo(() => ({ ...structuredClone(draft), gap_months: mapGap }), [draft, mapGap]);
  const withL = useMemo(() => { const d = structuredClone(draft); d.recovery.monthly_cents = chosen; return d; }, [draft, chosen]);
  const ok = recoveries.every(v => /^-?(0|[1-9]\d*)$/.test(v));
  const map = useMemo(() => (ok ? windowMap(sources, base, closes, recoveries) : null), [ok, sources, base, closes, recoveries]);
  const mins = useMemo(() => (ok ? recoveries.map(l => minWindow(sources, { ...structuredClone(base), recovery: { ...structuredClone(base.recovery), monthly_cents: l } })) : []), [ok, sources, base, recoveries]);
  if (!bounds) return <section className="career-input"><p className="career-message" role="status">先有通用的目标和资金资料，才能算这个问题。</p></section>;
  return <>
    <div className="career-layout"><section className="career-input"><h2>你的情况</h2>
      <FormRow label="高收入停下来之后，先空窗几个月（可为 0）" hint="0 表示直接转成每月攒得少的工作。"><input aria-label="地图空窗月数" type="number" min="0" step="1" value={mapGap} onChange={e => setMapGap(Math.max(0, Math.floor(Number(e.target.value) || 0)))}/></FormRow>
      {recoveries.map((v, i) => <FormRow key={i} label={`之后每月能攒多少 ${i + 1}（元）`} hint={i === 0 ? '默认取你现在每月攒的钱的 0%、25%、50%、75%，可改；负数表示每月要动用存款。' : undefined}><CentInput label={`之后每月能攒多少 ${i + 1}`} signed value={v} onChange={x => setCustom(recoveries.map((o, j) => (j === i ? x || '0' : o)))}/></FormRow>)}
    </section><section className="career-input"><h2>答案：高收入要做到什么时候</h2>
      {ok && recoveries.map((l, i) => <p key={i} className="career-line"><strong>之后每月只攒 {money(l)}</strong><br/>{minText(sources, mins[i])}</p>)}
      {!ok && <p className="career-message">金额须是整数分。</p>}
      <p className="career-footnote">按“之后每月能攒的钱”保持不变来算；高收入能不能持续，要靠你自己判断，这里不替你预测。</p>
    </section></div>
    {map && <section className="career-input"><h3>窗口地图</h3>
      <div className="career-table-wrap"><table className="career-table"><caption>横轴是高收入停下来的月份，纵轴是之后每月能攒多少。✓ 表示原目标满足，其余是目标时点缺的资金或先不够的原因。</caption>
        <thead><tr><th scope="col">之后每月攒</th>{map.closes.map(c => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{map.rows.map((row, i) => <tr key={i}><th scope="row">{money(map.recoveries[i])}</th>{row.map(c => <td key={c.close_month} className={`career-cell career-${c.verdict}`}>{c.verdict === 'meets' ? '✓ 满足' : c.verdict === 'blocked' ? '—' : c.reason === 'goal' ? `差 ${wan(c.shortfall_cents ?? 0)}` : c.reason === 'cash' ? '资金先不够' : '付款先不够'}</td>)}</tr>)}</tbody>
      </table></div></section>}
    <section className="career-input"><h3>下面两项按哪一档“之后每月能攒多少”算</h3>
      <FormRow label="之后每月能攒多少"><select aria-label="之后每月能攒多少档位" value={Math.min(pick, recoveries.length - 1)} onChange={e => setPick(Number(e.target.value))}>{recoveries.map((v, i) => <option key={i} value={i}>{money(v)} / 月</option>)}</select></FormRow></section>
    <DelaySection sources={sources} draft={withL} patch={patch}/>
    <InsuranceSection sources={sources} draft={withL} patch={patch} defaultStage="recovery"/>
  </>;
}

