import { useRef, useState } from 'react';

export const mobileTabs = ['家底', '盘点', '测算'] as const;
export type MobileTab = typeof mobileTabs[number];
function TabIcon({ tab }: { tab: MobileTab }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{tab === '家底' ? <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></> : tab === '盘点' ? <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zM9 12h6m-6 4h6"/></> : <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h1m6 0h1m-8 5h1m6 0h1"/></>}</svg>;
}
export function MobileApp() {
  const [tab, setTab] = useState<MobileTab>('家底');
  const heading = useRef<HTMLHeadingElement>(null);
  function navigate(next: MobileTab) { setTab(next); heading.current?.focus(); window.scrollTo(0, 0); }
  return <div className="mobile-app">
    <header className="mobile-header"><p className="mobile-eyebrow">物谱 · THINGARY</p><h1 tabIndex={-1} ref={heading}>{tab}</h1><p className="mobile-muted">每月盘一盘，离想要的生活近一点。</p></header>
    <main id="mobile-content"><section className="mobile-card mobile-placeholder"><span className="mobile-symbol"><TabIcon tab={tab}/></span><h2>{tab === '家底' ? '你的家底，一目了然' : tab === '盘点' ? '更新余额，记下这个月' : '还要上几年班'}</h2><p className="mobile-muted">{tab === '家底' ? '账户总览将在这里呈现。' : tab === '盘点' ? '账户盘点将在这里开始。' : '测算功能将在后续接入。'}</p></section></main>
    <nav className="mobile-tabs" aria-label="主要页面">{mobileTabs.map(item => <button key={item} type="button" aria-current={tab === item ? 'page' : undefined} onClick={() => navigate(item)}><TabIcon tab={item}/><span>{item}</span></button>)}</nav>
  </div>;
}
