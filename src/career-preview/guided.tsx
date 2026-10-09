import { CoverageNote } from '../CoverageNote';
// Guided career page: answer first, plain words, sensible visible assumptions, technical switches folded away.
// Development preview: fictional sources, nothing is stored.
import { useDeferredValue, useMemo, useState } from 'react';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import type { PlanningSources } from '../plan-basic-contract.ts';
import type { CareerDraft } from '../plan-career-contract.ts';
import { careerSources } from './fixtures.ts';
import { careerPensionSources, careerRetirementSources } from './pension-fixture.ts';
import { prepareIncomeScope } from './income-scope.ts';
import type { IncomeDraft } from './income-scope.ts';
import { IncomeSection } from './income-section.tsx';
import { LumpsSection } from './map.tsx';
import { PensionMarginal } from './pension-marginal.tsx';
import { maxGap, minWindow, missingItems } from '../plan-career-map.ts';
import { evaluateCareerScenario } from '../plan-career.ts';
import { guidedDraft, guidedIncome, restLevers, sayLower, sayRest, saySwitch, yuan } from './guided-model.ts';
import type { GuidedDefaults } from './guided-model.ts';
import type { Say } from './guided-model.ts';
import './guided.css';
import './preview.css';

type Q = 'rest' | 'lower' | 'switch';
const questions: { id: Q; title: string; hint: string }[] = [
  { id: 'rest', title: '我想歇一阵，能撑多久？', hint: '钱够不够，退休目标还保不保得住' },
  { id: 'lower', title: '高收入还要做多久？', hint: '做到什么时候，之后少攒也没关系' },
  { id: 'switch', title: '换工作后，每月要攒多少？', hint: '才能保住原来的退休年龄' },
];

function load(state: string) {
  const sources: PlanningSources = state === 'pension' ? careerPensionSources() : state === 'retirement' ? careerRetirementSources() : careerSources();
  if (state === 'empty' && sources.profile.status === 'ready') sources.profile.value.saved = null;
  if (state === 'error') sources.profile = { status: 'error', value: { code: 'UNAVAILABLE', message: '虚构来源读取失败' } };
  return { sources, defaults: { draft: guidedDraft(), income: guidedIncome(sources), from: { spend: null, recovery: null } } as GuidedDefaults };
}

/** Standalone development page: fictional sources and example numbers. */
export function Guided() {
  const state = new URLSearchParams(location.search).get('state') ?? 'ready';
  const [round, setRound] = useState(0);
  const loaded = useMemo(() => load(state), [state, round]);
  return <GuidedPanel key={round} sources={loaded.sources} defaults={loaded.defaults} example={() => setRound(n => n + 1)}/>;
}

/** The guided panel itself. `example` is only given by the fictional preview; in the app the figures come from the user's own facts. */
export function GuidedPanel({ sources, defaults, example, embedded = false }: { sources: PlanningSources; defaults: GuidedDefaults; example?: () => void; embedded?: boolean }) {
  const [data, setData] = useState(() => ({ draft: defaults.draft, income: defaults.income }));
  const [q, setQ] = useState<Q>('rest');
  const [lowerGap, setLowerGap] = useState(0);
  const [leversOpen, setLeversOpen] = useState(false);
  const patch = (v: Partial<CareerDraft>) => setData(x => ({ ...x, draft: { ...x.draft, ...v } }));
  const setGap = (v: Partial<CareerDraft['gap']>) => patch({ gap: { ...data.draft.gap, ...v } });
  const setIncome = (income: IncomeDraft) => setData(x => ({ ...x, income }));
  const { draft, income } = data;

  const deferred = useDeferredValue(data), updating = deferred !== data;
  const scope = useMemo(() => prepareIncomeScope(sources, deferred.draft, deferred.income), [sources, deferred]);
  const profile = sources.profile.status === 'ready' ? sources.profile.value.saved?.profile ?? null : null;
  const targetAge = profile?.retire.target_age ?? null, current = profile?.retire.basic?.contribution.monthly_cents ?? null;
  const missing = useMemo(() => {
    if (scope.status !== 'ready') return [];
    const out = missingItems(scope.draft, q === 'rest');
    if (q === 'rest' || (q === 'switch' && scope.draft.gap_months !== 0)) {
      if (scope.draft.gap.spend_cents === null || scope.draft.gap.spend_cents === '') out.unshift({ label: '不工作期间每月总共花多少', assumable: false });
      if (scope.draft.gap.income_cents === null || scope.draft.gap.income_cents === '') out.unshift({ label: '不工作期间每月还有多少收入', assumable: false });
    }
    return out;
  }, [scope, q]);
  const levels = useMemo(() => (current !== null && /^-?\d+$/.test(current) ? [0, .25, .5, .75].map(f => String(Math.round(Number(current) * f))) : ['0']), [current]);

  const say: Say | null = useMemo(() => {
    if (!scope.sources) return null;
    if (missing.length) return null;
    if (q === 'rest') return sayRest(maxGap(scope.sources, scope.draft), targetAge);
    if (q === 'switch') return saySwitch(evaluateCareerScenario(scope.sources, scope.draft), scope.draft.recovery.monthly_cents);
    return null;
  }, [scope, missing, q, targetAge]);
  const lowerRows = useMemo(() => (q === 'lower' && scope.sources && !missing.length ? levels.map(l => {
    const d = structuredClone(scope.draft); d.gap_months = lowerGap; d.recovery.monthly_cents = l;
    return { level: l, say: sayLower(minWindow(scope.sources!, d), scope.sources!) };
  }) : null), [q, scope, missing, levels, lowerGap]);
  const levers = useMemo(() => (leversOpen && q === 'rest' && scope.sources && !missing.length ? restLevers(scope.sources, scope.draft) : []), [leversOpen, q, scope, missing]);

  const blockedMessage = !profile ? (sources.profile.status === 'error' ? '读取个人资料失败，请重新载入。' : '还没有个人资料：先在规划里填好目标和资金，才能算。')
    : scope.status !== 'ready' ? scope.issues.join(' ') : missing.length ? `还差：${missing.map(m => m.label).join('、')}。` : null;
  const extra = draft.gap.extra_income ?? { lump_cents: null, benefit_monthly_cents: null, benefit_months: null };
  const setExtra = (v: Partial<typeof extra>) => setGap({ extra_income: { ...extra, ...v } });
  const tone = say?.tone ?? 'wait';

  const note = example
    ? <>现在填的是<strong>示例数字</strong>，请改成你自己的。<button type="button" onClick={example}>恢复示例数字</button></>
    : <>起点按你的资料填好了{defaults.from.spend ? '（每月花销取自过去的盘点）' : ''}{defaults.from.recovery ? '（找到新工作后每月能攒，先按和现在一样）' : ''}，<strong>请改成你自己的估计</strong>。这里的数字只在这次试算里，关闭就丢弃，不会改你的计划。</>;
  const Root = embedded ? 'div' : 'main';
  return <Root className={`guided${embedded ? ' guided-embedded' : ''}`}><CoverageNote sources={sources} compact/>
    {embedded ? <p className="guided-note">{note}</p> : <header><p className="eyebrow">物谱 · 职业变化试算（虚构预览）</p><h1>歇一阵或换工作，退休目标还保得住吗？</h1>
      <p className="guided-lead">选一个问题，填几个数，答案马上出来。数字只在这个页面里，关掉就没了，不会改你的计划。</p>
      <p className="guided-note">{note}</p></header>}
    <section aria-label="想知道什么"><div role="radiogroup" aria-label="想知道什么" className="guided-questions">
      {questions.map(x => <label key={x.id} className={`guided-question${q === x.id ? ' on' : ''}`}><input type="radio" name="guided-question" checked={q === x.id} onChange={() => setQ(x.id)}/><strong>{x.title}</strong><small>{x.hint}</small></label>)}
    </div></section>

    <div className="guided-body">
      <div className="guided-form">
        <section className="guided-card"><h2>你的情况</h2>
          {q !== 'lower' && <FormRow label={q === 'switch' ? '从哪个月开始换工作' : '从哪个月开始不工作'} hint="比如被裁、辞职、跳槽的那个月。"><MonthInput label="开始的月份" value={draft.transition_month ?? ''} onChange={v => patch({ transition_month: v || null })}/></FormRow>}
          {q === 'lower'
            ? <FormRow label="高收入停下来后，先空窗几个月？" hint="直接转成每月攒得少的工作，就填 0。"><input aria-label="先空窗几个月" type="number" min="0" step="1" value={lowerGap} onChange={e => setLowerGap(Math.max(0, Math.floor(Number(e.target.value) || 0)))}/></FormRow>
            : q === 'switch' && <FormRow label="中间空窗几个月？" hint="直接换工作、没有空窗，就填 0。"><input aria-label="空窗月数" type="number" min="0" max="1200" step="1" value={draft.gap_months ?? ''} onChange={e => patch({ gap_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow>}
          {q !== 'lower' && (q === 'rest' || draft.gap_months !== 0) && <>
            <FormRow label="不工作期间，每月总共花多少？（元）" hint="房租、吃饭、通勤、家人开销，再加上你自己交的社保和医保。拿不准就看最近几个月的平均支出。"><CentInput label="不工作期间每月花销" value={draft.gap.spend_cents ?? ''} onChange={v => setGap({ spend_cents: v || null })}/></FormRow>
            <FormRow label="不工作期间，每月还有多少收入？（元）" hint="零活、兼职、家人补贴等；一分都没有就填 0。失业金在“更多假设”里填。"><CentInput label="不工作期间每月到账" value={draft.gap.income_cents ?? ''} onChange={v => setGap({ income_cents: v || null })}/></FormRow>
          </>}
          {q !== 'lower' && <FormRow label={q === 'switch' ? '你估计找到新工作后，每月能攒多少？（元，选填）' : '你估计找到新工作后，每月能攒多少？（元）'} hint="到手工资扣掉所有花销、社保之后，每月剩下能存下来的钱，可以是 0 或负数。填了才能对比。"><CentInput label="找到新工作后每月能攒多少" signed value={draft.recovery.monthly_cents ?? ''} onChange={v => patch({ recovery: { ...draft.recovery, monthly_cents: v || null } })}/></FormRow>}
          {q === 'lower' && <p className="guided-hint">下面的答案会按“你现在每月攒的钱”的 0%、25%、50%、75% 各算一遍，所以这里不用再填每月能攒多少。</p>}
        </section>

        <details className="guided-card"><summary>更多假设（一般不用动）</summary>
          <p className="guided-hint">现在的默认是偏保守的：不计退休后的养老金，也不计公积金和个人养老金。想算得更贴近，就在这里改。</p>
          <IncomeSection value={income} onChange={setIncome}/>
          {q !== 'lower' && <section className="career-input"><h3>补偿金、失业金</h3>
            <FormRow label="一次性补偿金（元）" hint="比如 N+1，税后；没有就留空。记在开始那个月的月底。"><CentInput label="一次性补偿金" value={extra.lump_cents ?? ''} onChange={v => setExtra({ lump_cents: v || null })}/></FormRow>
            <FormRow label="失业金每月（元）" hint="税后；要和下面的领取月数一起填。"><CentInput label="失业金每月" value={extra.benefit_monthly_cents ?? ''} onChange={v => setExtra({ benefit_monthly_cents: v || null })}/></FormRow>
            <FormRow label="失业金最多领几个月"><input aria-label="失业金最多领几个月" type="number" min="0" step="1" value={extra.benefit_months ?? ''} onChange={e => setExtra({ benefit_months: e.target.value === '' ? null : Number(e.target.value) })}/></FormRow></section>}
          <LumpsSection draft={draft} patch={patch}/>
          {q === 'rest' && <section className="career-input"><h3>资金底线</h3><FormRow label="不工作期间，手里的钱最少要留多少？（元，选填）" hint="比如想一直留着 10 万应急。"><CentInput label="资金底线" value={draft.floor_cents ?? ''} onChange={v => patch({ floor_cents: v || null })}/></FormRow>
            <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e => patch({ liquid_funds_confirmed: e.target.checked })}/>这些钱随时能取出来用</label></section>}
        </details>
      </div>

      <aside className="guided-answer" aria-label="答案">
        <section className={`guided-card guided-result tone-${tone}`} aria-live="polite" id="guided-answer">
          <p className="guided-kicker">{questions.find(x => x.id === q)!.title}{updating && <span> · 更新中…</span>}</p>
          {blockedMessage ? <><p className="guided-headline">还算不出来</p><p className="guided-sub">{blockedMessage}</p></>
            : q === 'lower' && lowerRows ? <ul className="guided-rows">{lowerRows.map(r => <li key={r.level}><strong>之后每月只攒 {yuan(r.level)}</strong><span>{r.say.headline}</span><small>{r.say.sub}</small></li>)}</ul>
            : say && <><p className="guided-headline">{say.headline}</p><p className="guided-sub">{say.sub}</p></>}
          <ul className="guided-chips" aria-label="这次的假设">
            <li>{income.mode === 'excluded' ? '不计退休后的养老金（偏保守）' : income.mode === 'manual' ? '按你手填的退休收入' : '沿用原计划的退休收入'}</li>
            <li>{income.excludePools ? '不计公积金、个人养老金' : '计入公积金、个人养老金'}</li>
            <li>社保算在花销里</li>
            {targetAge !== null && <li>{targetAge} 岁退休</li>}
          </ul>
          {q === 'rest' && say && !blockedMessage && <details onToggle={e => setLeversOpen(e.currentTarget.open)}><summary>怎样才能撑得更久？</summary>
            <ul className="guided-rows">{levers.map(l => <li key={l.label}><strong>{l.label}</strong><span>{l.text}</span></li>)}{!levers.length && <li>计算中…</li>}</ul></details>}
          <details><summary>这个结果有哪些局限？</summary><p className="guided-hint">它是按你填的数字做的估算，不是预测：不会替你猜会不会被裁、多久找到工作、工资涨不涨。每月付款的先后只在不工作那一段检查过。养老金、公积金默认不计入，结果偏保守。</p></details>
        </section>
      </aside>
    </div>

    <section className="guided-card guided-after"><h2>社保要不要自己交？</h2>
      <p className="guided-hint">上面把社保算在花销里。想看多交一段时间的社保，退休后每月能多拿多少，在这里粗估。</p>
      <PensionMarginal sources={sources}/></section>
  </Root>;
}
