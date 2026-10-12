import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SaveContextV1 } from '../../plan-simplified-contract.ts';
import { SimplifiedPlanningDialog } from '../SimplifiedPlanningDialog';
import { fictionalPort, type PreviewState } from '../fixtures';
import '../../theme.css';
import '../../ui.css';
import '../../controls.css';
import '../../wealth.css';
import '../../planning.css';
import '../../date-input.css';
import '../simplified-ui.css';
import './preview.css';

const states: { value: PreviewState; label: string }[] = [
  { value: 'normal', label: '正常：两笔已保存收入' },
  { value: 'unknown', label: '未知：金额／时间未填' },
  { value: 'empty', label: '空白：全新资料' },
  { value: 'legacy', label: '旧计划：待重新设置' },
  { value: 'reject', label: '保存被拒绝' },
  { value: 'unresolved', label: '提交结果未知' },
  { value: 'read-error', label: '读取失败' },
];

function App() {
  const url = new URL(location.href);
  const [state, setState] = useState<PreviewState>(() => {
    const v = url.searchParams.get('state') as PreviewState | null;
    return v && states.some(s => s.value === v) ? v : 'normal';
  });
  const [mode, setMode] = useState<'light' | 'dark'>(url.searchParams.get('theme') === 'dark' ? 'dark' : 'light');
  const [open, setOpen] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [savedNote, setSavedNote] = useState('');
  document.documentElement.dataset.mode = mode;
  const port = useMemo(() => fictionalPort(state), [state]);
  const [pending, setPending] = useState<SaveContextV1 | null>(null);
  return <>
    <div className="prototype-bar">
      <span>独立组件预览 · 虚构资料 · 未接入真实保存 · 刷新重置</span>
      <span className="prototype-bar-controls">
        <label>状态 <select value={state} onChange={e => { setPending(null); setState(e.target.value as PreviewState); setNonce(n => n + 1); setSavedNote(''); setOpen(true); }}>{states.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label>模式 <select value={mode} onChange={e => setMode(e.target.value as 'light' | 'dark')}><option value="light">浅色</option><option value="dark">深色</option></select></label>
      </span>
    </div>
    <main className="simplified-preview">
      <header><div><p className="eyebrow">物谱 / 规划（简化后示意）</p><h1>时间与未来收入</h1>
        <p>这是「删政策测算、留客观事实」后的第四问与时间输入原型：养老金是一种可选未来收入，官方只留链接。</p></div></header>
      {savedNote && <p className="notice" role="status">{savedNote}</p>}
      <button type="button" className="ui-btn" onClick={() => { setOpen(true); setNonce(n => n + 1); setSavedNote(''); }}>打开编辑窗口</button>
      {open && <SimplifiedPlanningDialog key={`${state}-${nonce}`} port={port} pendingContext={pending} onPendingChange={setPending} today="2026-10-12"
        onClose={saved => { setOpen(false); setSavedNote(saved ? '虚构保存成功（预览内存）；真实保存与重启须等领域接入后另行验收。' : pending ? '原保存请求已保留，重新打开窗口可继续核对。' : '已取消，未保存草稿。'); }}/>}
    </main>
  </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
