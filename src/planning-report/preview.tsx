// 独立开发预览入口：只被 planning-report-preview.html 引用，不进入生产入口与正式路由。
// 固定虚构日期与夹具，可切换三模式 / 五外围状态 / 完整与隐私，并可打开打印版。
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../style.css';
import '../ui.css';
import '../theme.css';
import './planning-report.css';
import { PlanningReport, type ReportOuter } from './PlanningReport.tsx';
import { fixtures, FIXTURE_TODAY, type FixtureKey } from './fixtures.ts';
import { printableHtml } from './model.ts';

type StateKey = 'ready' | 'loading' | 'empty' | 'error' | 'invalid';

/** 预览支持 URL 参数定初始状态（?fixture=baseline&state=ready&privacy=1&dark=0），便于对照截图。 */
function initialParams() {
  const q = new URLSearchParams(location.search);
  const fixture = (['current', 'baseline', 'comparison'] as const).find(k => k === q.get('fixture')) ?? 'current';
  const state = (['ready', 'loading', 'empty', 'error', 'invalid'] as const).find(k => k === q.get('state')) ?? 'ready';
  return {
    fixture, state,
    privacy: q.get('privacy') === '1',
    dark: q.has('dark') ? q.get('dark') !== '0' : (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches),
  };
}

function Preview() {
  const init = useMemo(initialParams, []);
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>(init.fixture);
  const [stateKey, setStateKey] = useState<StateKey>(init.state);
  const [privacy, setPrivacy] = useState(init.privacy);
  const [dark, setDark] = useState(init.dark);

  const report = fixtures[fixtureKey];
  const outer: ReportOuter = useMemo(() => {
    if (stateKey === 'loading') return { status: 'loading' };
    if (stateKey === 'empty') return { status: 'empty' };
    if (stateKey === 'error') return { status: 'error', code: 'read_failed', message: '（虚构）读取报告来源时发生错误，成功资料保留，可重试。' };
    if (stateKey === 'invalid') return { status: 'ready', input: { ...report, contract_version: 99 } };
    return { status: 'ready', input: report };
  }, [stateKey, report]);

  document.documentElement.dataset.style = 'bento';
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';

  const openPrint = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(printableHtml(report, { privacy }));
    win.document.close();
  };

  return <div style={{ maxWidth: 1080, margin: '0 auto', padding: '20px 22px 60px' }}>
    <div className="pr-preview-bar">
      <span className="pr-fictional">虚构报告组件预览 · 固定日期 {FIXTURE_TODAY} · 数据均为虚构</span>
      <label>模式 <select value={fixtureKey} onChange={e => setFixtureKey(e.target.value as FixtureKey)}>
        <option value="current">当前方案（完整）</option>
        <option value="baseline">历史基准（partial 不完整）</option>
        <option value="comparison">方案比较（含恶意名称转义）</option>
      </select></label>
      <label>状态 <select value={stateKey} onChange={e => setStateKey(e.target.value as StateKey)}>
        <option value="ready">ready（含 complete/partial）</option>
        <option value="loading">loading</option>
        <option value="empty">empty</option>
        <option value="error">error（读取失败）</option>
        <option value="invalid">error（协议版本不支持）</option>
      </select></label>
      <label><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} /> 深色</label>
      <button type="button" onClick={openPrint}>观看打印版（{privacy ? '隐私' : '完整'}）</button>
    </div>
    <PlanningReport outer={outer} privacy={privacy} onPrivacyChange={setPrivacy} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
