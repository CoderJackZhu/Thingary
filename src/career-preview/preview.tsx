import { CoverageNote } from '../CoverageNote';
// Development-only, fictional source adapter. No native calls and no persistence.
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { careerSources, careerDraft } from './fixtures.ts';
import { previewAnswers } from './answers.ts';
import { incomeDraft, prepareIncomeScope } from './income-scope.ts';
import type { IncomeDraft } from './income-scope.ts';
import { IncomeSection } from './income-section.tsx';
import type { CareerChange } from '../plan-career-compare.ts';
import type { CareerDraft, CareerEvaluation } from '../plan-career-contract.ts';
import { money, resultText, comparisonText } from './result-text.ts';
import { CashInsuranceSection, DelaySection, LowerQuestion, LowerResult, LumpsSection, QuestionPicker, RestQuestion, gapText, minText } from './map.tsx';
import { missingItems } from '../plan-career-map.ts';
import type { Question } from './map.tsx';
import { RestResult } from './results.tsx';
import { Guided } from './guided.tsx';
import '../style.css';
import '../ui.css';
import '../theme.css';
import './preview.css';
import { t as tr } from '../i18n.ts';
const states = ['ready','unknown','empty','error','shortfall'] as const;
type State = typeof states[number];
function fixture(state: State) {
  const sources=careerSources(),draft=careerDraft();
  for (const stage of [draft.gap, draft.recovery]) { stage.insurance = { monthly_cents: null, included: false }; }
  if(state==='unknown'){draft.gap_months=null;draft.check_until_month='2030-10';}
  if(state==='empty' && sources.profile.status==='ready') sources.profile.value.saved=null;
  if(state==='error') sources.profile={status:'error',value:{code:'UNAVAILABLE',message:tr('虚构来源读取失败')}};
  if(state==='shortfall' && sources.profile.status==='ready' && sources.profile.value.saved){
    const b=sources.profile.value.saved.profile.retire.basic!;if(b.start.kind==='simulation')b.start.available_cents='500000';
    draft.transition_month='2026-10';draft.gap_months=1;draft.gap.income_cents='1000000';
  }
  return {sources,draft,income:incomeDraft(sources)};
}
function Result({title,value}:{title:string;value:CareerEvaluation}) {
  const t=resultText(value);
  return <section className="career-result" aria-label={title}><h2>{title}</h2><CoverageNote annotations={value.annotations} compact/>
    <p className="career-label">{tr('找到新工作后，每月至少要攒多少，才能保住原来的退休目标')}</p><p className={value.requirement.status === 'ready' && ['found','no_positive_contribution'].includes(value.requirement.value.status) ? 'career-number' : 'career-message'}>{t.requirement}</p>
    <dl><dt>{tr('空窗资金检查')}</dt><dd>{t.cash}</dd><dt>{tr('检查范围')}</dt><dd>{t.cashRange}</dd><dt>{tr('期间最低金额')}</dt><dd>{t.minimum}</dd><dt>{tr('底线触及')}</dt><dd>{t.floor}</dd><dt>{tr('按你估计的每月能攒多少')}</dt><dd>{t.prediction}</dd></dl>
    <p className="career-footnote">{tr('仅对所列条件有效；工作阶段月内付款未完整检查。无需正投入不等于可以额外提款。')}</p>
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
  const scope=useMemo(()=>prepareIncomeScope(deferred.sources,settled,deferred.income),[deferred,settled]);
  const missing=useMemo(()=>missingItems(scope.draft,q!=='switch'),[scope.draft,q]);
  const listed=missing;
  const blocked=listed.length>0;
  const shown=scope.draft;
  const gate=scope.status==='ready'?null:scope.status;
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
  const reload=(next:State)=>{setState(next);setChange({kind:'gap',months:18});setData(fixture(next));};
  const profile=sources.profile.status==='ready'?sources.profile.value.saved?.profile:null;
  return <><CoverageNote sources={financialSources ?? undefined} compact/><main className="career-preview">
    <header><p className="eyebrow">{tr('物谱 · 独立虚构预览')}</p><h1>{tr('职业变化，怎样影响原来的退休目标？')}</h1><p className="career-lead">{tr('只比较这次变化的条件。所有样例数字均为虚构，刷新或关闭后丢弃。')}</p></header>
    <div className="career-toolbar"><label>{tr('样例状态')} <select aria-label={tr('样例状态')} value={state} onChange={e=>reload(e.target.value as State)}><option value="ready">{tr('完整条件')}</option><option value="unknown">{tr('恢复时间未知')}</option><option value="empty">{tr('尚无资料')}</option><option value="error">{tr('来源读取失败')}</option><option value="shortfall">{tr('月内付款不足')}</option></select></label>
      <label>{tr('外观')} <select aria-label={tr('外观')} value={style} onChange={e=>setStyle(e.target.value)}><option value="bento">{tr('柔和卡片')}</option><option value="native">{tr('清新原生')}</option><option value="olive">{tr('暖米橄榄')}</option></select></label>
      <label><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/> {tr('深色')}</label></div>
    <section className="career-source"><h2>{tr('沿用的条件')}</h2>{profile?<p>{tr('资金截至 2026-09-30 ·')} {state==='shortfall'?tr('可动用资金 5,000 元'):tr('可动用资金 60 万元')} {tr('· 现在每月攒 15,000 元 · {target_month} 退休，检查到 {horizon_month} · 退休预算 {v3} / 月 · 收益、通胀为 0 · 原计划不计未来收入', { target_month: profile.retire.simplified.time.target_month, horizon_month: profile.retire.simplified.time.horizon_month, v3: money(profile.retire.spend_cents!) })}</p>:<p role="status">{state==='error'?tr('虚构来源读取失败；可重新载入样例。'):tr('尚无通用目标与资金资料。')}</p>}
      <button type="button" className={enabled?'':'primary'} onClick={()=>{if(enabled){setEnabled(false);reload(state);setChange({kind:'gap',months:18});}else setEnabled(true);}}>{enabled?tr('关闭试算并丢弃修改'):tr('打开职业变化试算')}</button>
      {enabled&&<a className="career-result-link" href="#career-results">{tr('查看试算结果 ↓')}</a>}
      {(state==='empty'||state==='error')&&<button type="button" onClick={()=>reload('ready')}>{tr('重新载入虚构资料')}</button>}</section>
    {enabled&&<>
      <p className="career-footnote">{tr('三个问题共用本次条件，切换保留填写；试算不修改基础计划。')}</p>
      <IncomeSection value={data.income} onChange={setIncome}/>
      <QuestionPicker value={q} onChange={setQ}/>
      {q==='rest'&&<RestQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='lower'&&<LowerQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='switch'&&<>
      <div className="career-single-input"><section className="career-input"><h2>{tr('这次变化')}</h2>
        <FormRow label={tr('变化月份')}><MonthInput label={tr('变化月份')} value={draft.transition_month??''} onChange={v=>patch({transition_month:v||null})}/></FormRow>
        <FormRow label={tr('空窗月数')} hint={tr('留空表示尚不知道何时恢复；0 表示直接转变。')}><input aria-label={tr('空窗月数')} type="number" min="0" max="1200" step="1" value={draft.gap_months??''} onChange={e=>patch({gap_months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>
        {draft.gap_months===null&&<FormRow label={tr('局部检查到')}><MonthInput label={tr('局部检查到')} value={draft.check_until_month??''} onChange={v=>patch({check_until_month:v||null})}/></FormRow>}
        <FormRow label={tr('空窗月可靠到账（元）')}><CentInput label={tr('空窗月可靠到账')} value={draft.gap.income_cents??''} onChange={v=>patch({gap:{...draft.gap,income_cents:v||null}})}/></FormRow>
        <FormRow label={tr('空窗月完整开销（元）')} hint={tr('含生活、房租和已确认费用；自缴是否已含在下方单独确认。')}><CentInput label={tr('空窗月完整开销')} value={draft.gap.spend_cents??''} onChange={v=>patch({gap:{...draft.gap,spend_cents:v||null}})}/></FormRow>
        <FormRow label={tr('你估计找到新工作后每月能攒多少（元）')} hint={tr('收入拿到手、扣完全部花销后每月剩下的钱；留空也可以先看至少要攒多少。')}><CentInput label={tr('你估计找到新工作后每月能攒多少')} signed value={draft.recovery.monthly_cents??''} onChange={v=>patch({recovery:{...draft.recovery,monthly_cents:v||null}})}/></FormRow>
        <details><summary>{tr('资金检查条件')}</summary><FormRow label={tr('空窗资金底线（元）')} hint={tr('选填，仅约束这段空窗。')}><CentInput label={tr('空窗资金底线')} value={draft.floor_cents??''} onChange={v=>patch({floor_cents:v||null})}/></FormRow>
          <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e=>patch({liquid_funds_confirmed:e.target.checked})}/>{tr('本例资金可及时动用')}</label></details>
      </section></div>
      <LumpsSection draft={draft} patch={patch}/>
      </>}
      {q==='lower'&&<LumpsSection draft={draft} patch={patch}/>}
      <CashInsuranceSection key={state} draft={draft} patch={patch}/>
      <section id="career-results" className="career-input career-main-result" tabIndex={-1} aria-label={tr('试算结果')} aria-live="polite">
        <h2>{tr('试算结果')}{updating&&<span className="career-updating"> {tr('· 更新中…')}</span>}</h2>
        {updating?<p className="career-message">{tr('正在更新条件，旧答案已撤下。')}</p>:<>
        {!gate&&<p className="career-banner">{financialSources?.profile.status==='ready'&&financialSources.profile.value.saved?.profile.retire.simplified.income_mode==='manual'?tr('本次按手填退休收入试算；按明确月份和金额计入。'):tr('本次不计任何退休收入；不表示你实际没有养老金。')}</p>}
        {!gate&&data.income.excludePools&&<p className="career-banner" role="status">{tr('本次不计暂时取不出的钱转为可用资金（偏保守）：只用可动用的钱；如开销里有靠公积金付的部分，请按实际现金支出填写。')}</p>}
        {gate&&gate!=='source_blocked'&&<div className="career-message" role="status">{scope.issues.map(x=><p key={x}>{x}</p>)}</div>}
        {answers?.cash&&(gate||blocked||restAnswer?.status==='blocked'||lowerAnswer?.status==='blocked')&&<section aria-label={tr('仅检查已填写的空窗')}><h3>{tr('仅检查已填写的空窗区间')}</h3><p>{answers.cash.status==='ready'?tr('{from_month} 至 {until_month} 之前：{v3}，期间最低 {v4}。', { from_month: answers.cash.value.from_month, until_month: answers.cash.value.until_month, v3: answers.cash.value.first_shortfall_month?answers.cash.value.first_shortfall_month+' 首次资金不足':'未发现资金不足', v4: money(answers.cash.value.minimum_cents) }):answers.cash.issues.map(x=>x.message).join(' ')}</p><p className="career-footnote">{tr('只检查所列开销与付款，不证明退休目标满足，不是最长空窗答案。')}</p></section>}
        {blocked&&!gate&&<div className="career-message" role="status"><p>{tr('还差 {length} 项才能计算长期结果：', { length: listed.length })}</p><ul>{listed.map(m=><li key={m.label}>{m.label}</li>)}</ul><p className="career-footnote">{tr('缺项不按 0 补齐；已填但不合法的金额也会阻断。')}</p></div>}
        {sources.profile.status!=='ready' || !profile?.retire.basic
          ? <p role="status">{sources.profile.status==='error'?tr('通用资料读取失败，请重新载入资料。'):tr('尚无通用目标与资金资料，请先补齐资料。')}</p>
          : !blocked&&financialSources&&<>
            {q==='rest'&&restAnswer&&<RestResult sources={financialSources} draft={shown} answer={restAnswer}/>}
            {q==='lower'&&lowerAnswer&&<LowerResult sources={financialSources} draft={shown} patch={patch} answer={lowerAnswer}/>}
            {q==='switch'&&result&&<>
              <Result title={tr('按当前填写')} value={result.baseline}/>
              <details><summary>{tr('推迟退休目标的对照')}</summary><DelaySection sources={financialSources} draft={shown} patch={patch}/></details>
            </>}
            <p className="career-footnote">{tr('工作阶段月内付款未完整检查。结果是按所填条件计算的估算，不是职业预测或保证；当前仍为待验证的独立原型。')}</p>
          </>}
        </>}
        {/* Keep editable comparison controls mounted while deferred answers are withdrawn. */}
        {q==='switch'&&!gate&&!blocked&&result&&<details><summary>{tr('只改变一项，看看影响')}</summary>
          <FormRow label={tr('对照条件')}><select aria-label={tr('对照条件')} value={change.kind} onChange={e=>setChange(e.target.value==='gap'?{kind:'gap',months:18}:e.target.value==='recovery'?{kind:'recovery',monthly_cents:'300000'}:{kind:'budget',monthly_cents:'1000000'})}><option value="gap">{tr('空窗延长')}</option><option value="recovery">{tr('恢复后投入改变')}</option><option value="budget">{tr('退休预算改变')}</option></select></FormRow>
          {change.kind==='gap'?<FormRow label={tr('对照空窗月数')}><input aria-label={tr('对照空窗月数')} type="number" min="0" max="1200" value={change.months??''} onChange={e=>setChange({kind:'gap',months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>:<FormRow label={change.kind==='budget'?tr('对照：退休后每月预算（元）'):tr('对照：找到新工作后每月能攒多少（元）')}><CentInput label={tr('对照金额')} signed={change.kind==='recovery'} value={change.monthly_cents??''} onChange={v=>setChange({...change,monthly_cents:v||null})}/></FormRow>}
          <p className="career-footnote">{tr('每次只改变所选条件，其余保持一致。输入值是本次假设；算出的“至少要攒多少”不会自动当成你的收入。')}</p>
          {!updating&&<>
            {comparison&&<div className="career-delta"><p>{comparison.headline}</p>{comparison.detail&&<p className="career-footnote">{comparison.detail}</p>}</div>}
            <Result title={tr('对照条件')} value={result.alternative}/>
          </>}
        </details>}
      </section>
      {(gate||blocked||updating||!resultVisible)&&<div className="career-sticky" role="status" aria-live="polite"><span>{
        updating?tr('更新中…')
        :gate==='income_blocked'?tr('请确认本次退休收入条件')
        :gate==='source_blocked'?tr('资料尚未就绪，答案暂不可用')
        :blocked?tr('还差 {length} 项才能计算长期结果', { length: listed.length })
        :(()=>{
          const text=q==='rest'?(restAnswer?gapText(restAnswer):''):q==='lower'?(lowerAnswer?minText(sources,lowerAnswer):''):(result?resultText(result.baseline).requirement:'');
          const stuck=q==='rest'?restAnswer?.status==='blocked':q==='lower'?lowerAnswer?.status==='blocked':result?.baseline.requirement.status==='blocked';
          return `${stuck?'需要补充条件':'当前答案'}：${text}`;
        })()}</span><a href={blocked&&!gate?'#career-insurance':'#career-results'}>{blocked&&!gate?tr('去补填 ↑'):tr('看详细结果 ↓')}</a></div>}
    </>}
  </main></>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).get('lab')==='1'?<Preview/>:<Guided/>);
