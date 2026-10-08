// Development-only, fictional source adapter. No native calls and no persistence.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CentInput, FormRow } from '../FormControls.tsx';
import { MonthInput } from '../DateInput.tsx';
import { careerSources, careerDraft } from './fixtures.ts';
import { compareCareerScenario } from '../plan-career-compare.ts';
import type { CareerChange } from '../plan-career-compare.ts';
import type { CareerDraft, CareerEvaluation } from '../plan-career-contract.ts';
import { money, resultText, comparisonText } from './result-text.ts';
import { DelaySection, InsuranceSection, LowerQuestion, QuestionPicker, RestQuestion } from './map.tsx';
import type { Question } from './map.tsx';
import { careerPensionSources } from './pension-fixture.ts';
import '../style.css';
import '../ui.css';
import '../theme.css';
import './preview.css';

const states = ['ready','pension','unknown','empty','error','shortfall'] as const;
type State = typeof states[number];
function fixture(state: State) {
  const sources=state==='pension'?careerPensionSources():careerSources(),draft=careerDraft();
  if(state==='unknown'){draft.gap_months=null;draft.check_until_month='2030-10';}
  if(state==='empty' && sources.profile.status==='ready') sources.profile.value.saved=null;
  if(state==='error') sources.profile={status:'error',value:{code:'UNAVAILABLE',message:'虚构来源读取失败'}};
  if(state==='shortfall' && sources.profile.status==='ready' && sources.profile.value.saved){
    const b=sources.profile.value.saved.profile.retire.basic!;if(b.start.kind==='simulation')b.start.available_cents='500000';
    draft.transition_month='2026-10';draft.gap_months=1;draft.gap.income_cents='1000000';
  }
  return {sources,draft};
}
function Result({title,value}:{title:string;value:CareerEvaluation}) {
  const t=resultText(value);
  return <section className="career-result" aria-label={title}><h2>{title}</h2>
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
  const result=useMemo(()=>enabled?compareCareerScenario(sources,draft,change):null,[enabled,sources,draft,change]);
  const comparison=result?comparisonText(result):null;
  const patch=(value:Partial<CareerDraft>)=>setData(x=>({...x,draft:{...x.draft,...value}}));
  const reload=(next:State)=>{setState(next);setData(fixture(next));};
  const profile=sources.profile.status==='ready'?sources.profile.value.saved?.profile:null;
  return <main className="career-preview">
    <header><p className="eyebrow">物谱 · 独立虚构预览</p><h1>职业变化，怎样影响原来的退休目标？</h1><p className="career-lead">只比较这次变化的条件。所有样例数字均为虚构，刷新或关闭后丢弃。</p></header>
    <div className="career-toolbar"><label>样例状态 <select aria-label="样例状态" value={state} onChange={e=>reload(e.target.value as State)}><option value="ready">完整条件</option><option value="pension">含北京养老金（虚构）</option><option value="unknown">恢复时间未知</option><option value="empty">尚无资料</option><option value="error">来源读取失败</option><option value="shortfall">月内付款不足</option></select></label>
      <label>外观 <select aria-label="外观" value={style} onChange={e=>setStyle(e.target.value)}><option value="bento">柔和卡片</option><option value="native">清新原生</option><option value="olive">暖米橄榄</option></select></label>
      <label><input type="checkbox" checked={dark} onChange={e=>setDark(e.target.checked)}/> 深色</label></div>
    <section className="career-source"><h2>沿用的条件</h2>{profile?<p>资金截至 2026-09-30 · {state==='shortfall'?'可动用资金 5,000 元':'可动用资金 60 万元'} · 现在每月攒 15,000 元 · 50 岁退休，检查到 90 岁 · 退休预算 {money(profile.retire.spend_cents!)} / 月 · 收益、通胀为 0 · {state==='pension'?'本例计入北京养老金（虚构的缴费史）':'本例不计养老金'}</p>:<p role="status">{state==='error'?'虚构来源读取失败；可重新载入样例。':'尚无通用目标与资金资料。'}</p>}
      <button type="button" className={enabled?'':'primary'} onClick={()=>{if(enabled){setEnabled(false);reload(state);setChange({kind:'gap',months:18});}else setEnabled(true);}}>{enabled?'关闭试算并丢弃修改':'打开职业变化试算'}</button>
      {enabled&&q==='switch'&&<a className="career-result-link" href="#career-results">查看两组结果 ↓</a>}
      {(state==='empty'||state==='error')&&<button type="button" onClick={()=>reload('ready')}>重新载入虚构资料</button>}</section>
    {enabled&&<>
      <QuestionPicker value={q} onChange={setQ}/>
      {q==='rest'&&<RestQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='lower'&&<LowerQuestion sources={sources} draft={draft} patch={patch}/>}
      {q==='switch'&&<>
      <div className="career-layout"><section className="career-input"><h2>这次变化</h2>
        <FormRow label="变化月份"><MonthInput label="变化月份" value={draft.transition_month??''} onChange={v=>patch({transition_month:v||null})}/></FormRow>
        <FormRow label="空窗月数" hint="留空表示尚不知道何时恢复；0 表示直接转变。"><input aria-label="空窗月数" type="number" min="0" max="1200" step="1" value={draft.gap_months??''} onChange={e=>patch({gap_months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>
        {draft.gap_months===null&&<FormRow label="局部检查到"><MonthInput label="局部检查到" value={draft.check_until_month??''} onChange={v=>patch({check_until_month:v||null})}/></FormRow>}
        <FormRow label="空窗月可靠到账（元）"><CentInput label="空窗月可靠到账" value={draft.gap.income_cents??''} onChange={v=>patch({gap:{...draft.gap,income_cents:v||null}})}/></FormRow>
        <FormRow label="空窗月完整开销（元）" hint="本例已确认没有另外的月供、自缴或额外费用。"><CentInput label="空窗月完整开销" value={draft.gap.spend_cents??''} onChange={v=>patch({gap:{...draft.gap,spend_cents:v||null}})}/></FormRow>
        <FormRow label="你估计找到新工作后每月能攒多少（元）" hint="收入拿到手、扣完全部花销后每月剩下的钱；留空也可以先看至少要攒多少。"><CentInput label="你估计找到新工作后每月能攒多少" signed value={draft.recovery.monthly_cents??''} onChange={v=>patch({recovery:{...draft.recovery,monthly_cents:v||null}})}/></FormRow>
        <details><summary>资金检查条件</summary><FormRow label="空窗资金底线（元）" hint="选填，仅约束这段空窗。"><CentInput label="空窗资金底线" value={draft.floor_cents??''} onChange={v=>patch({floor_cents:v||null})}/></FormRow>
          <label className="career-check"><input type="checkbox" checked={draft.liquid_funds_confirmed} onChange={e=>patch({liquid_funds_confirmed:e.target.checked})}/>本例资金可及时动用</label></details>
      </section><section className="career-input"><h2>只改变一项，看看影响</h2>
        <FormRow label="对照条件"><select aria-label="对照条件" value={change.kind} onChange={e=>setChange(e.target.value==='gap'?{kind:'gap',months:18}:e.target.value==='recovery'?{kind:'recovery',monthly_cents:'300000'}:{kind:'budget',monthly_cents:'1000000'})}><option value="gap">空窗延长</option><option value="recovery">恢复后投入改变</option><option value="budget">退休预算改变</option></select></FormRow>
        {change.kind==='gap'?<FormRow label="对照空窗月数"><input aria-label="对照空窗月数" type="number" min="0" max="1200" value={change.months??''} onChange={e=>setChange({kind:'gap',months:e.target.value===''?null:Number(e.target.value)})}/></FormRow>:<FormRow label={change.kind==='budget'?'对照：退休后每月预算（元）':'对照：找到新工作后每月能攒多少（元）'}><CentInput label="对照金额" signed={change.kind==='recovery'} value={change.monthly_cents??''} onChange={v=>setChange({...change,monthly_cents:v||null})}/></FormRow>}
        <p className="career-footnote">每次只改变所选条件，其余保持一致。输入值是本次假设；算出的“至少要攒多少”不会自动当成你的收入。</p>
        {comparison&&<div className="career-delta" role="status"><p>{comparison.headline}</p>{comparison.detail&&<p className="career-footnote">{comparison.detail}</p>}<a href="#career-results">查看两组结果 ↓</a></div>}
      </section></div>
      {result&&<><div id="career-results" className="career-layout" tabIndex={-1} aria-label="两组比较结果" aria-live="polite"><Result title="原条件" value={result.baseline}/><Result title="对照条件" value={result.alternative}/></div><aside className="career-notes">{[...new Set([...result.baseline.notes,...result.alternative.notes])].map(n=><p key={n}>{n}</p>)}</aside></>}
      <DelaySection sources={sources} draft={draft} patch={patch}/>
      <InsuranceSection sources={sources} draft={draft} patch={patch} defaultStage="recovery"/>
      </>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
