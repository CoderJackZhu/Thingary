import { money } from '../../asset';
import type { Summary } from '../../wealth';
import { homeView } from '../model';

export function HomePage({ summary, hasAccounts, onCheckIn, onPlan }: { summary: Summary; hasAccounts: boolean; onCheckIn: () => void; onPlan?: () => void }) {
  const { latest, shown, change, comparedTo } = homeView(summary);
  return <>
    <section className="mobile-card mobile-hero" aria-label="资产总览">
      <p className="mobile-muted">总资产{shown && !shown.complete ? ' · 已知部分' : ''}</p>
      <strong className="mobile-amount">{shown ? money(shown.assets_cents) : '待盘点'}</strong>
      <p className="mobile-caption">计入金融净资产的资产账户{shown ? ` · ${shown.date}` : ''}</p>
      {shown?.has_unchanged && <p className="mobile-caption">含沿用金额，并非所有账户都在当天重新核对。</p>}
      <div className="mobile-metrics"><div><span>负债</span><strong>{shown ? money(shown.liabilities_cents) : '待盘点'}</strong></div><div><span>金融净资产</span><strong>{shown?.complete ? money(shown.net_cents) : '待补录'}</strong></div></div>
    </section>
    <section className="mobile-card" aria-label="盘点变化"><div className="mobile-row"><h2>与上次相比</h2><strong className="mobile-change">{change}</strong></div><p className="mobile-caption">金融净资产变化{comparedTo ? ` · 对比 ${comparedTo}` : ' · 两次完整盘点后显示'}</p>
      {shown?.scope_changed && <p className="mobile-muted">账户的计入范围有变化，暂不直接比较。</p>}
      <div className="mobile-divider"/><p className="mobile-caption">上次盘点 <time>{latest?.date ?? '尚未盘点'}</time></p>
      {latest && !latest.complete && <p className="mobile-notice">最近一次有 {latest.missing} 个账户待补录。{shown?.complete ? `总览沿用 ${shown.date} 的完整盘点。` : '总资产和负债仅为已知部分，金融净资产未知。'}</p>}
      {!shown && <p className="mobile-muted">{hasAccounts ? '填下各账户余额，留下第一份家底。' : '先建一个账户，再记下当前余额。'}</p>}
      <button className="mobile-primary mobile-wide" onClick={onCheckIn}>{hasAccounts ? '更新本月余额' : '开始第一次盘点'}</button>
    </section>
    {onPlan && <section className="mobile-card mobile-plan"><span className="mobile-caption">给未来留一点余地</span><h2>还要上几年班</h2><p className="mobile-muted">记录家底之后，再看看离想要的生活还有多远。</p><button className="mobile-wide" onClick={onPlan}>去测算 <span aria-hidden="true">→</span></button></section>}
  </>;
}
