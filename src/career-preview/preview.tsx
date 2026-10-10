import { CoverageNote } from '../CoverageNote';
// Development-only, fictional source adapter. No native calls and no persistence.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { careerSources, careerDraft } from './fixtures.ts';
import { previewAnswers } from './pension-check.ts';
import { incomeDraft, prepareIncomeScope } from './income-scope.ts';
import type { IncomeDraft } from './income-scope.ts';
import { IncomeSection } from './income-section.tsx';
import { PensionCheck } from './pension-check.tsx';
import type { CareerChange } from '../plan-career-compare.ts';
import type { CareerDraft, CareerEvaluation } from '../plan-career-contract.ts';
import { money, resultText, comparisonText } from './result-text.ts';
import { CashInsuranceSection, DelaySection, LowerQuestion, LowerResult, LumpsSection, QuestionPicker, RestQuestion, gapText, minText } from './map.tsx';
import { assumeInsurance, missingItems } from '../plan-career-map.ts';
import type { Question } from './map.tsx';
import { RestResult } from './results.tsx';
import { careerRetirementSources, careerPensionSources } from './pension-fixture.ts';
import { PensionMarginal } from './pension-marginal.tsx';
import { Guided } from './guided.tsx';
import '../style.css';
import '../ui.css';
import '../theme.css';
import './preview.css';

const states = ['ready','retirement','pension','unknown','empty','error','shortfall'] as const;
type State = typeof states[number];
function fixture(state: State) {
  const sources=state==='pension'?careerPensionSources():state==='retirement'?careerRetirementSources():careerSources(),draft=careerDraft();
  for (const stage of [draft.gap, draft.recovery]) { stage.pension = null; stage.insurance = { monthly_cents: null, included: false }; }
  if(state==='unknown'){draft.gap_months=null;draft.check_until_month='2030-10';}
  if(state==='empty' && sources.profile.status==='ready') sources.profile.value.saved=null;
  if(state==='error') sources.profile={status:'error',value:{code:'UNAVAILABLE',message:'虚构来源读取失败'}};
  if(state==='shortfall' && sources.profile.status==='ready' && sources.profile.value.saved){
    const b=sources.profile.value.saved.profile.retire.basic!;if(b.start.kind==='simulation')b.start.available_cents='500000';
    draft.transition_month='2026-10';draft.gap_months=1;draft.gap.income_cents='1000000';
  }
  return {sources,draft,income:incomeDraft(sources)};
}
function Result({title,value}:{title:string;value:CareerEvaluation}) {
  const t=resultText(value);
  return <section className="career-result" aria-label={title}><h2>{title}</h2><CoverageNote annotations={value.annotations} compact/>
    <p className="career-label">找到新工作后，每月至少要攒多少，才能保住原来的退休目标</p><p className={value.requirement.status === 'ready' && ['found','no_positive_contribution'].includes(value.requirement.value.status) ? 'career-number' : 'career-message'}>{t.requirement}</p>
    <dl><dt>空窗资金检查</dt><dd>{t.cash}</dd><dt>检查范围</dt><dd>{t.cashRange}</dd><dt>期间最低金额</dt><dd>{t.minimum}</dd><dt>底线触及</dt><dd>{t.floor}</dd><dt>按你估计的每月能攒多少</dt><dd>{t.prediction}</dd></dl>
    <p className="career-footnote">仅对所列条件有效；工作阶段月内付款未完整检查。无需正投入不等于可以额外提款。</p>
  </section>;
}
function Preview() {
  const [state,setState]=useState<State>(()=>states.find(x=>x===new URLSearchParams(location.search).get('state'))??'ready');
  const [data,setData]=useState(()=>fixture(state));
  const [enabled,setEnabled]=useState(false);
  const [q,setQ]=useState<Question>('rest');
  const [change,setChange]=useState<CareerChange>({kind:'gap',months:18});
  const [dark,setDark]=useState(false);
  const [style,setStyle]=useState('bento');
  document.documentElement.dataset.style=style;document.documentElement.dataset.mode=dark?'dark':'light';
  const {sources,draft}=data;
  // Everything below (numbers, conditions, labels) comes from one settled copy of the draft, so they can never disagree.
  const deferred=useDeferredValue(data), settled=deferred.draft;
  const settledChange=useDeferredValue(change);
  const updating=deferred!==data || settledChange!==change;
  const [explore,setExplore]=useState(false);
  const scope=useMemo(()=>prepareIncomeScope(deferred.sources,settled,deferred.income),[deferred,settled]);
  const missing=useMemo(()=>missingItems(scope.draft,q!=='switch'),[scope.draft,q]);
  const listed=explore?missing.filter(m=>!m.assumable):missing;
  const blocked=listed.length>0;
  const assumed=useMemo(()=>explore?assumeInsurance(scope.draft):{draft:scope.draft,changed:false},[explore,scope.draft]);
  const shown=assumed.draft;
  const gate=scope.status==='ready'?null:scope.status;
  const policyBlocked=gate==='policy_blocked';
  const answers=useMemo(()=>enabled?previewAnswers(deferred.sources,shown,q,settledChange,deferred.income):null,[enabled,deferred,shown,q,settledChange]);
  const restAnswer=answers?.status==='ready'?answers.rest:null;
  const lowerAnswer=answers?.status==='ready'?answers.lower:null;
  const result=answers?.status==='ready'?answers.comparison:null;
  const financialSources=scope.sources;
  const setIncome=(income:IncomeDraft)=>setData(x=>({...x,income}));
  const [resultVisible,setResultVisible]=useState(true);
  // Watch the headline answer itself (not the tall result section): the bar only appears while the answer is out of view.
  useEffect(()=>{
    if(!enabled||typeof IntersectionObserver==='undefined')return;
    const el=document.querySelector('#career-results .career-number, #career-results .career-message');
    if(!el){setResultVisible(false);return;}
    const io=new IntersectionObserver(([e])=>setResultVisible(e.isIntersecting),{threshold:0});io.observe(el);return()=>io.disconnect();
  },[enabled,q,blocked,updating,gate,restAnswer,lowerAnswer,result]);
  const comparison=result?comparisonText(result):null;
  const patch=(value:Partial<CareerDraft>)=>setData(x=>({...x,draft:{...x.draft,...value}}));
  const reload=(next:State)=>{setState(next);setExplore(false);setChange({kind:'gap',months:18});setData(fixture(next));};
  const profile=sources.profile.status==='ready'?sources.profile.value.saved?.profile:null;
  return <><CoverageNote sources={financialSources ?? undefined} compact/><main className="career-preview">
    <header><p className="eyebrow">物谱 · 独立虚构预览</p><h1>职业变化，怎样影响原来的退休目标？</h1><p className="career-lead">只比较这次变化的条件。所有样例数字均为虚构，刷新或关闭后丢弃。</p></header>
    <div className="career-toolbar"><label>样例状态 <select aria-label="样例状态" value={state} onChange={e=>reload(e.target.value as State)}><option value="ready">完整条件</option><option value="retirement">退休收入选择（无受限池）</option><option value="pension">职工养老金与公积金（暂不支持）</option><option value="unknown">恢复时间未知</option><option value="empty">尚无资料</option><option value="error">来源读取失败</option><option value="shortfall">月内付款不足</option></select></label>
      <label>外观 <select aria-label="外观" value={style} onChange={e=>setStyle(e.target.value)}><option value="bento">柔和卡片</option><option value="native">清新原生</option><option value="olive">暖米橄榄</option></select></label>
      <label><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/> 深色</label></div>
    <section className="career-source"><h2>沿用的条件</h2>{profile?<p>资金截至 2026-09-30 · {state==='shortfall'?'可动用资金 5,000 元':'可动用资金 60 万元'} · 现在每月攒 15,000 元 · 50 岁退休，检查到 90 岁 · 退休预算 {money(profile.retire.spend_cents!)} / 月 · 收益、通胀为 0 · {state==='pension'||state==='retirement'?'原计划选择北京自动估算；本次口径在下方选择':'原计划不计任何退休收入'}</p>:<p role="status">{state==='error'?'虚构来源读取失败；可重新载入样例。':'尚无通用目标与资金资料。'}</p>}
      <button type="button" className={enabled?'':'primary'} onClick={()=>{if(enabled){setEnabled(false);setExplore(false);reload(state);setChange({kind:'gap',months:18});}else setEnabled(true);}}>{enabled?'关闭试算并丢弃修改':'打开职业变化试算'}</button>
      {enabled&&<a className="career-result-link" href="#career-results">查看试算结果 ↓</a>}
      {(state==='empty'||state==='error')&&<button type="button" onClick={()=>reload('ready')}>重新载入虚构资料</button>}</section>
    {enabled&&<>
      <p className="career-footnote">三个问题共用本次条件，切换保留填写；试算不修改基础计划。</p>
      <IncomeSection value={data.income} onChange={setIncome}/>
      <QuestionPicker value={q} onChange={setQ}/>
      {q==='rest'&&<RestQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='lower'&&<LowerQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='switch'&&<>
      <div className="career-single-input"><section className="career-input"><h2>这次变化</h2>
        <FormRow label="变化月份"><MonthInput label="变化月份" value={draft.transition_month??''} onChange={v=>patch({transition_month:v||null})}/></FormRow>
        <FormRow label="空窗月数" hint="留空表示尚不知道何时恢复；0 表示直接转变。"><input aria-label="空窗月数" type="number" min="0" max="1200" step="1" value={draft.gap_months??''} onChange={e=>patch({gap_months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>
        {draft.gap_months===null&&<FormRow label="局部检查到"><MonthInput label="局部检查到" value={draft.check_until_month??''} onChange={v=>patch({check_until_month:v||null})}/></FormRow>}
        <FormRow label="空窗月可靠到账（元）"><CentInput label="空窗月可靠到账" value={draft.gap.income_cents??''} onChange={v=>patch({gap:{...draft.gap,income_cents:v||null}})}/></FormRow>
        <FormRow label="空窗月完整开销（元）" hint="含生活、房租和已确认费用；自缴是否已含在下方单独确认。"><CentInput label="空窗月完整开销" value={draft.gap.spend_cents??''} onChange={v=>patch({gap:{...draft.gap,spend_cents:v||null}})}/></FormRow>
        <FormRow label="你估计找到新工作后每月能攒多少（元）" hint="收入拿到手、扣完全部花销后每月剩下的钱；留空也可以先看至少要攒多少。"><CentInput label="你估计找到新工作后每月能攒多少" signed value={draft.recovery.monthly_cents??''} onChange={v=>patch({recovery:{...draft.recovery,monthly_cents:v||null}})}/></FormRow>
        <details><summary>资金检查条件</summary><FormRow label="空窗资金底线（元）" hint="选填，仅约束这段空窗。"><CentInput label="空窗资金底线" value={draft.floor_cents??''} onChange={v=>patch({floor_cents:v||null})}/></FormRow>
          <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e=>patch({liquid_funds_confirmed:e.target.checked})}/>本例资金可及时动用</label></details>
      </section></div>
      <LumpsSection draft={draft} patch={patch}/>
      </>}
      {q==='lower'&&<LumpsSection draft={draft} patch={patch}/>}
      <CashInsuranceSection key={state} draft={draft} patch={patch}/>
      <section id="career-results" className="career-input career-main-result" tabIndex={-1} aria-label="试算结果" aria-live="polite">
        <h2>试算结果{updating&&<span className="career-updating"> · 更新中…</span>}</h2>
        {updating?<p className="career-message">正在更新条件，旧答案已撤下。</p>:<>
        {!gate&&<p className="career-banner">{financialSources?.profile.status==='ready'&&financialSources.profile.value.saved?.profile.retire.basic?.retirement_income.mode==='manual'?'本次按手填退休收入试算；停缴或改变基数不重算这笔收入。':'本次不计任何退休收入；不表示你实际没有养老金。'}</p>}
        {!gate&&data.income.excludePools&&<p className="career-banner" role="status">本次不计公积金和个人养老金（偏保守）：只用可动用的钱；如开销里有靠公积金付的部分，请按实际现金支出填写。</p>}
        {gate&&gate!=='source_blocked'&&!policyBlocked&&<div className="career-message" role="status">{scope.issues.map(x=><p key={x}>{x}</p>)}</div>}
        {answers?.cash&&((gate&&gate!=='pool_blocked')||blocked||restAnswer?.status==='blocked'||lowerAnswer?.status==='blocked')&&<section aria-label="仅检查已填写的空窗"><h3>仅检查已填写的空窗区间</h3><p>{answers.cash.status==='ready'?`${answers.cash.value.from_month} 至 ${answers.cash.value.until_month} 之前：${answers.cash.value.first_shortfall_month?answers.cash.value.first_shortfall_month+' 首次资金不足':'未发现资金不足'}，期间最低 ${money(answers.cash.value.minimum_cents)}。`:answers.cash.issues.map(x=>x.message).join(' ')}</p><p className="career-footnote">只检查所列开销与付款，不证明退休目标满足，不是最长空窗答案。</p></section>}
        {blocked&&!gate&&<div className="career-message" role="status"><p>还差 {listed.length} 项，暂时算不出长期答案：</p><ul>{listed.map(m=><li key={m.label}>{m.label}</li>)}</ul><p className="career-footnote">缺项不按 0 补齐；已填但不合法的金额也会阻断。</p></div>}
        {!gate&&(explore||(missing.length>0&&missing.every(m=>m.assumable)))&&<label className="career-check"><input type="checkbox" checked={explore} onChange={e=>setExplore(e.target.checked)}/>先看一眼粗略估计：假设未填的社保不用自己掏钱（偏乐观，只是探索，不是答案）</label>}
        {!gate&&explore&&assumed.changed&&!blocked&&<p className="career-banner" role="status">这是假设试算，不是答案：未填社保现金暂按自己不掏钱，偏乐观；填完整并取消勾选后才是答案。</p>}
        {sources.profile.status!=='ready' || !profile?.retire.basic
          ? <p role="status">{sources.profile.status==='error'?'通用资料读取失败，请重新载入资料。':'尚无通用目标与资金资料，请先补齐资料。'}</p>
          : policyBlocked||gate==='pool_blocked' ? <>
            <div className="career-message" role="status"><h3>暂不能把职工养老金计入职业试算</h3><p>本预览尚未完成职工养老金与职业变化的联动，因此暂不提供自动联动的长期答案。可在上方主动选择本次手填收入或不计任何退休收入；已有受限池的资料仍不支持。</p><ul><li>历史实缴月数和平均指数不足以还原应缴起点、各年缴费与可扣除期。</li><li>退休当年的计发基数、退休时账户余额和最终指数还需明确。</li><li>职业路径尚未接入独立起领月份与受限池解锁的完整链路。</li></ul><p>填齐上面的社保现金或选择粗略估计也不能跳过这些条件。可在下方核对一组明确的金额假设，但它不会解锁职业主答案。</p></div>
            <PensionCheck key={state} sources={sources}/>
          </> : !blocked&&financialSources&&<>
            {q==='rest'&&restAnswer&&<RestResult sources={financialSources} draft={shown} answer={restAnswer}/>}
            {q==='lower'&&lowerAnswer&&<LowerResult sources={financialSources} draft={shown} patch={patch} answer={lowerAnswer}/>}
            {q==='switch'&&result&&<>
              <Result title="按当前填写" value={result.baseline}/>
              <details><summary>推迟退休目标的对照</summary><DelaySection sources={financialSources} draft={shown} patch={patch}/></details>
            </>}
            <p className="career-footnote">工作阶段月内付款未完整检查。结果是按所填条件计算的估算，不是职业预测或保证；当前仍为待验证的独立原型。</p>
          </>}
        </>}
        {/* Keep editable comparison controls mounted while deferred answers are withdrawn. */}
        {q==='switch'&&!gate&&!blocked&&result&&<details><summary>只改变一项，看看影响</summary>
          <FormRow label="对照条件"><select aria-label="对照条件" value={change.kind} onChange={e=>setChange(e.target.value==='gap'?{kind:'gap',months:18}:e.target.value==='recovery'?{kind:'recovery',monthly_cents:'300000'}:{kind:'budget',monthly_cents:'1000000'})}><option value="gap">空窗延长</option><option value="recovery">恢复后投入改变</option><option value="budget">退休预算改变</option></select></FormRow>
          {change.kind==='gap'?<FormRow label="对照空窗月数"><input aria-label="对照空窗月数" type="number" min="0" max="1200" value={change.months??''} onChange={e=>setChange({kind:'gap',months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>:<FormRow label={change.kind==='budget'?'对照：退休后每月预算（元）':'对照：找到新工作后每月能攒多少（元）'}><CentInput label="对照金额" signed={change.kind==='recovery'} value={change.monthly_cents??''} onChange={v=>setChange({...change,monthly_cents:v||null})}/></FormRow>}
          <p className="career-footnote">每次只改变所选条件，其余保持一致。输入值是本次假设；算出的“至少要攒多少”不会自动当成你的收入。</p>
          {!updating&&<>
            {comparison&&<div className="career-delta"><p>{comparison.headline}</p>{comparison.detail&&<p className="career-footnote">{comparison.detail}</p>}</div>}
            <Result title="对照条件" value={result.alternative}/>
          </>}
        </details>}
      </section>
      {profile?.retire.basic&&<section className="career-input"><PensionMarginal sources={sources}/></section>}
      {(gate||blocked||updating||!resultVisible)&&<div className="career-sticky" role="status" aria-live="polite"><span>{
        updating?'更新中…'
        :policyBlocked?'本预览暂不支持含北京自动估算的职业答案'
        :gate==='pool_blocked'?'本例需要受限池估算，首版暂不支持'
        :gate==='income_blocked'?'请确认本次退休收入条件'
        :gate==='source_blocked'?'资料尚未就绪，答案暂不可用'
        :blocked?`还差 ${listed.length} 项，答案暂时算不出`
        :(()=>{
          const text=q==='rest'?(restAnswer?gapText(restAnswer):''):q==='lower'?(lowerAnswer?minText(sources,lowerAnswer):''):(result?resultText(result.baseline).requirement:'');
          const stuck=q==='rest'?restAnswer?.status==='blocked':q==='lower'?lowerAnswer?.status==='blocked':result?.baseline.requirement.status==='blocked';
          return `${stuck?'暂时算不出':explore&&assumed.changed?'假设试算（偏乐观，不是答案）':'当前答案'}：${text}`;
        })()}</span><a href={blocked&&!gate?'#career-insurance':'#career-results'}>{blocked&&!gate?'去补填 ↑':'看详细结果 ↓'}</a></div>}
    </>}
  </main></>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('lab')==='1'?<Preview/>:<Guided/>);
