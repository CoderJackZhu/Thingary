import { useEffect, useRef, useState } from 'react';
import { errorMessage, localDay } from '../asset';
import { resolvePending, storedPending } from '../wealth';
import type { Pending } from '../wealth';
import { HomePage } from './HomePage';
import { CheckInPage } from './CheckInPage';
import { AccountForm } from './AccountForm';
import { readMobile } from './service';
import type { MobileData } from './service';

export const mobileTabs = ['家底', '盘点', '测算'] as const;
export type MobileTab = typeof mobileTabs[number];
function TabIcon({ tab }: { tab: MobileTab }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tab === '家底' ? <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></> : tab === '盘点' ? <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h6"/></> : <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h1m6 0h1m-8 5h1m6 0h1"/></>}</svg>;
}
export function MobileApp() {
  const [tab, setTab] = useState<MobileTab>('家底');
  const [data, setData] = useState<MobileData | null>(null), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(storedPending), [notice, setNotice] = useState('');
  const [settled, setSettled] = useState<Pending | null>(null);
  const checking = useRef(false);
  const today = localDay();
  const heading = useRef<HTMLHeadingElement>(null);
  const reload = () => setRevision(value => value + 1);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    readMobile(today).then(next => { if (live) setData(next); }).catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [revision, today]);
  useEffect(() => { setCreating(false); setSettled(null); }, [data?.summary.generation]);
  const blocked = busy || loading || !!pending || !!error;
  function refreshPending() {
    const next = storedPending(); setPending(next);
    if (next) { heading.current?.focus(); window.scrollTo(0, 0); }
  }
  function navigate(next: MobileTab) { if (busy || pending) return; setCreating(false); setNotice(''); setTab(next); heading.current?.focus(); window.scrollTo(0, 0); }
  async function verify() {
    if (!pending || checking.current || pending.command === 'financial_import_commit') return;
    checking.current = true; setBusy(true); setNotice('');
    try {
      const outcome = await resolvePending(pending);
      if (outcome === 'saved') { setSettled(pending); if (pending.command === 'wealth_account_save') setCreating(false); }
      setNotice(outcome === 'saved' ? '已确认保存。请核对已更新余额，再继续剩余账户。' : outcome === 'unsaved' ? '已确认没有保存，当前输入保留，请核对后重新提交。' : '资料库已切换，请重新核对当前账户。');
      setPending(storedPending()); reload();
    } catch (cause) { setNotice(errorMessage(cause) + ' 原请求已保留，请稍后重试核对。'); }
    finally { checking.current = false; setBusy(false); }
  }
  return <div className="mobile-app">
    <header className="mobile-header"><p className="mobile-eyebrow">物谱 · THINGARY</p><h1 tabIndex={-1} ref={heading}>{tab}</h1><p className="mobile-muted">每月盘一盘，离想要的生活近一点。</p></header>
    <main id="mobile-content">
      {pending && <section className="mobile-card mobile-recovery" aria-label="保存结果核对"><h2>保存结果未确定</h2><p role="status">「{pending.label}」的结果尚未确认。原请求已保留，核对前暂停编辑和切页。</p>{pending.command === 'financial_import_commit' ? <p>请在桌面版的数据管理中核对金融导入。</p> : <button className="mobile-primary mobile-wide" disabled={busy} onClick={() => void verify()}>{busy ? '正在核对…' : '核对结果'}</button>}</section>}
      {notice && <p role="status" className="mobile-notice">{notice}</p>}
      {error && <section className="mobile-card" role="alert"><h2>资料读取失败</h2><p className="mobile-error">{error}</p><button disabled={busy} onClick={reload}>重新读取</button></section>}
      {loading && <p role="status" className="mobile-caption">正在读取账户资料…</p>}
      <div inert={!!pending}>
        {data && (tab === '家底' ? <HomePage summary={data.summary} hasAccounts={!!data.accounts.length} onCheckIn={() => navigate('盘点')} onPlan={() => navigate('测算')}/> : tab === '盘点' ? <div key={data.summary.generation}>
          {creating ? <AccountForm generation={data.summary.generation} today={today} onBusy={setBusy} onPending={refreshPending} onClose={saved => { setCreating(false); if (saved) { setNotice('账户已保存，请填写当前余额。'); reload(); } }}/>
          : <CheckInPage accounts={data.accounts} summary={data.summary} draft={data.draft} today={today} blocked={blocked} settled={settled} onBusy={setBusy} onPending={refreshPending} onReload={reload} onNew={() => setCreating(true)}/>}
        </div> : null)}
        {tab === '测算' && <section className="mobile-card mobile-placeholder"><span className="mobile-symbol"><TabIcon tab={tab}/></span><h2>还要上几年班</h2><p className="mobile-muted">测算功能将在后续接入。</p><p className="mobile-caption">先每月记下余额，为下一次测算准备好家底。</p></section>}
      </div>
    </main>
    <nav className="mobile-tabs" aria-label="主要页面">{mobileTabs.map(item => <button key={item} type="button" disabled={busy || !!pending} aria-current={tab === item ? 'page' : undefined} onClick={() => navigate(item)}><TabIcon tab={item}/><span>{item}</span></button>)}</nav>
  </div>;
}
