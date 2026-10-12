import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InvestmentReviewCard, type ReviewOuter } from '../InvestmentReviewCard';
import { InvestmentFlowDialog } from '../InvestmentFlowDialog';
import { draftFromFlow, type FlowDraft } from '../model';
import { reviewFixtures } from '../fixtures';
import '../../theme.css';
import '../investment-review.css';
import './preview.css';

function App() {
  const query = new URLSearchParams(location.search);
  const key = query.get('state') ?? 'ready-profit';
  const fixture = reviewFixtures[key as keyof typeof reviewFixtures] ?? reviewFixtures['ready-profit'];
  const [draft, setDraft] = useState<FlowDraft | null>(null);
  const [notice, setNotice] = useState('');
  document.documentElement.dataset.mode = query.get('theme') === 'dark' ? 'dark' : 'light';
  const outer: ReviewOuter = key === 'empty' ? {status:'empty'} : key === 'error' ? {status:'error',code:'fictional',message:'虚构来源读取失败'} : {status:'ready',...fixture};
  const open = () => {setNotice('');setDraft(draftFromFlow(fixture.input.flow));};
  return <main className="ivr-preview">
    <h1>投资区间核对 · 独立组件预览</h1>
    <p>全部为虚构资料，结果来自固定夹具；提交只展示草稿，不保存、不重算损益。</p>
    <nav aria-label="预览状态">{[...Object.keys(reviewFixtures),'empty','error'].map(state => <a key={state} href={`?state=${state}&theme=${query.get('theme') ?? 'light'}`}>{state}</a>)}</nav>
    <InvestmentReviewCard outer={outer} onCheckFlow={open} onEditFlow={open}/>
    {notice && <p role="status">{notice}</p>}
    {draft && <InvestmentFlowDialog input={fixture.input} initial={draft} issues={[]} onDraftChange={setDraft}
      onCancel={()=>setDraft(null)} onSubmit={value=>{setDraft(null);setNotice(`已收到虚构草稿：转入 ${value.inflow || '未知'} 分、转出 ${value.outflow || '未知'} 分；尚未持久化。`);}}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
