import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { linkView } from './link';
import type { LinkView } from './link';
import { relationNotice } from './LinkDialogs';
import { intervalUnit, planStatus, recurringCategoryText } from './recurring';
import type { Payment, Plan, SubscriptionDetailData } from './recurring';
import { periodLabel } from './recurring-model';
import type { Modules } from './modules';
import './wealth.css';

export type SubscriptionDetailActions = {
  onEdit: (plan: Plan) => void; onPay: (plan: Plan, amount: string) => void; onResume: (p: { plan: Plan; link: LinkView }) => void; onBackfill: (plan: Plan) => void; onCreate?: (p: Plan) => void; onGroupDelete: (id: string, name: string) => void;
  onEnd: (p: { plan: Plan; link: LinkView }) => void; onReview: (p: { plan: Plan; link: LinkView }) => void; onUnify: (p: { plan: Plan; link: LinkView }) => void;
  onCandidates: (p: Plan, list: LinkView['candidates']) => void;
};

/**
 * 订阅／周期计划只读详情：周期费用、虚拟资产和重要支出三个入口共用同一份
 * 内容与口径（设计 §5.1）。主信息在上，次要字段折叠；关联只在异常时提示。
 * 只有一半的对象（房租没有服务档案）自然少显示对应字段。
 */
export function SubscriptionDetail({ plan: initialPlan, today, modules, sourcePayment, onCorrectPayment, onClose, ...act }: {
  plan: Plan; today: string; modules: Modules; sourcePayment?: Payment | null; onCorrectPayment?: (payment: Payment) => void; onClose: () => void;
} & SubscriptionDetailActions) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<LinkView | null>(null), [linkError, setLinkError] = useState('');
  const [linkRetry, setLinkRetry] = useState(0);
  const [detail, setDetail] = useState<SubscriptionDetailData | null>(null), [historyError, setHistoryError] = useState('');
  const [page, setPage] = useState(0);
  const plan = detail?.plan ?? initialPlan;
  useEffect(() => {
    let live = true; setDetail(null); setHistoryError(''); setPage(0);
    invoke<SubscriptionDetailData>('recurring_detail', { planId: initialPlan.id }).then(d => { if (live) setDetail(d); })
      .catch(e => { if (live) setHistoryError(errorMessage(e)); });
    return () => { live = false; };
  }, [initialPlan.id, linkRetry]);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => {
    let live = true; setLink(null); setLinkError('');
    linkView('plan', plan.id).then(l => { if (live) setLink(l); }).catch(e => { if (live) setLinkError(errorMessage(e)); });
    return () => { live = false; };
  }, [plan.id, linkRetry]);
  const f = plan.fields;
  const linked = link?.relation === 'linked' && !!link.asset;
  const asset = linked ? link!.asset! : null;
  const ended = f.end_date != null && f.end_date < today;
  const notice = link ? relationNotice(link.relation, { occupied_by: link.occupied_by }) : null;
  const namesDiffer = !!asset && asset.name !== f.name;
  const state = ended ? 'expired' : f.paused ? 'paused' : 'ongoing';
  const monthly = plan.monthly_cents && !f.interval_days && f.interval_months > 1 ? plan.monthly_cents : null;
  const schedule = ended ? `已于 ${f.end_date} 结束` : f.paused ? '续费已暂停' : plan.next_due ? `下次付款 ${plan.next_due}` : '当前没有待记录期';
  const paidText = link ? (link.paid_count ? `${money(link.paid_cents ?? '0')} · ${link.paid_count} 笔` : '未记录付款') : plan.paid_cents ? money(plan.paid_cents) : '未记录付款';
  const meta = asset ? [asset.provider, asset.label_name].filter(Boolean).join(' · ') : '';
  const sub = f.category === 'subscription' || linked;
  const stale = !!link && !!detail && (link.generation !== detail.generation || (!!link.plan && link.plan.revision !== plan.revision));
  const ready = !!link && !!detail && !stale;
  const canResume = sub && ended && !!f.service_start && (linked || link?.relation === 'unlinked');
  const records = detail?.payments ?? [];
  const pageCount = Math.max(1, Math.ceil(records.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  return <dialog ref={dialog} className="editor wealth-account-editor sub-detail" aria-labelledby="plan-detail-heading" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><p className="eyebrow">财富 · {sub ? '订阅' : '周期费用'}</p><h2 id="plan-detail-heading">{f.name}</h2>
      <p className="sub-detail-line"><span className="virtual-state" data-state={state}>{planStatus(plan, today)}</span> <strong>{money(f.amount_cents)}／{intervalUnit(f)}</strong>{!ended && <> · {schedule}</>}</p>
      {meta && <p className="muted small">{meta}</p>}</div>
      <CloseButton type="button" aria-label="关闭计划详情" onClick={onClose} /><div className="editor-header-actions"><button disabled={!ready} onClick={() => act.onEdit(plan)}>修改价格与设置</button></div></header>
    <section className="subscription-body">
      {!link && (linkError ? <p className="notice" role="alert">关联信息读取失败：{linkError} <button onClick={() => setLinkRetry(n => n + 1)}>重新读取关联</button></p> : <p className="muted" role="status">正在读取关联信息…</p>)}
      {sourcePayment && onCorrectPayment && <section className="form-block" aria-label="来源付款记录"><h3>来源付款记录</h3><dl className="facts">
        <dt>原付款期</dt><dd>{sourcePayment.due_date}</dd>
        <dt>实际付款日</dt><dd>{sourcePayment.paid_date ?? '未记录'}</dd>
        <dt>付款事实</dt><dd>{sourcePayment.state === 'skipped' ? '本期不付' : money(sourcePayment.amount_cents)}{sourcePayment.off_schedule && <small className="muted"> · 原排期已更正，保留历史事实</small>}</dd>
        {sourcePayment.coverage_start && sourcePayment.coverage_end && <><dt>原服务覆盖期</dt><dd>{periodLabel(sourcePayment.coverage_start, sourcePayment.coverage_end)}</dd></>}
        {sourcePayment.notes && <><dt>付款备注</dt><dd>{sourcePayment.notes}</dd></>}
      </dl><button className="ui-link" disabled={!ready} onClick={() => onCorrectPayment(sourcePayment)}>更正这笔付款</button></section>}
      {link?.needs_review && <div className="notice" role="note">档案停用{asset?.stopped_on ? `于 ${asset.stopped_on}` : ''}，但计划仍在进行。<button className="ui-link" onClick={() => act.onReview({ plan, link })}>核对停用记录…</button></div>}
      {notice && <div className="notice" role="note">{notice}{link && link.relation === 'asset_trashed' && link.candidates.length > 0 && (link.candidates.length > 1
        ? <button className="ui-link" onClick={() => act.onCandidates(plan, link.candidates)}>选择要归组的历史档案…</button>
        : <button className="ui-link" onClick={() => act.onCandidates(plan, link.candidates)}>处理关联档案…</button>)}</div>}
      {namesDiffer && <div className="notice" role="note">服务名称为「{asset!.name}」，付款计划名称为「{f.name}」。<button className="ui-link" onClick={() => act.onUnify({ plan, link: link! })}>统一名称…</button></div>}
      <div className="inspector-metrics sub-metrics">
        <div><span>每期价格</span><strong>{money(f.amount_cents)}<small>／{intervalUnit(f)}</small></strong>{monthly && <small className="muted">月均 {money(monthly)}</small>}</div>
        <div><span>实际已付</span><strong>{paidText}</strong><small className="muted">只合计已记录的真实付款</small></div>
        <div><span>{ended ? '上次使用至' : '当前服务期至'}</span><strong>{plan.current_coverage ? plan.current_coverage[1] : ended ? f.end_date : '—'}</strong></div>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => act.onPay(plan, detail?.payment_candidate?.amount_cents ?? f.amount_cents)} disabled={!ready || !plan.next_due || f.paused || ended}>记录实际扣款</button>
        {canResume && <button className="primary" disabled={!ready} onClick={() => act.onResume({ plan, link: link! })}>重新订阅…</button>}
        {sub && !ended && <button type="button" onClick={() => act.onEnd({ plan, link: link! })} disabled={!ready || !(linked || link?.relation === 'unlinked')}>取消后续续费…</button>}
        <details className="more-actions"><summary>更多操作</summary>
          {act.onCreate && link?.relation === 'unlinked' && f.category === 'subscription' && <button onClick={() => act.onCreate!(plan)}>建立关联服务档案…</button>}
          <button type="button" className="ui-link danger-text" disabled={!link} onClick={() => linked ? act.onGroupDelete(plan.id, f.name) : act.onEdit(plan)}>{linked ? '整组删除…' : '删除（在编辑中）'}</button>
        </details>
      </div>
      {stale && <p className="notice" role="alert">资料已变化，请重新读取。<button onClick={() => setLinkRetry(n => n + 1)}>重新读取</button></p>}
      <p className="muted small">仅向付款账户充值时，等服务实际扣款后再记录。取消续费保留以前的付款。</p>
      {sub && f.paused && !ended && <p className="muted small">如果实际已经停订，请在「取消后续续费」里填写上次最后使用日，之后可重新订阅。</p>}
      {sub && ended && !f.service_start && <p className="muted small">这条旧记录还没有服务开始日期。<button className="ui-link" disabled={!ready} onClick={() => act.onEdit(plan)}>补充开始日期</button>后，即可在原档案重新订阅。</p>}
      <section className="subscription-payments" aria-label="这项订阅的付款记录">
        <div className="ui-section-head"><h3>付款记录</h3><button className="ui-link" disabled={!ready} onClick={() => act.onBackfill(plan)}>补记以前的付款</button></div>
        {historyError ? <p className="notice" role="alert">付款记录读取失败：{historyError} <button onClick={() => setLinkRetry(n => n + 1)}>重新读取</button></p>
          : !detail ? <p className="muted" role="status">正在读取付款记录…</p>
          : !records.length ? <p className="muted">还没有记录付款。已经扣过的钱可以补记；预计费用不会算成实际已付。</p>
          : <><p className="muted small">记错金额、日期或提前误记已付，点「更正」处理。</p>
            <div className="subscription-payment-list">{records.slice(currentPage * 50, (currentPage + 1) * 50).map(payment => <article key={payment.id}>
              <div><strong>{payment.state === 'paid' ? money(payment.amount_cents) : '本期不付'}</strong><span className="muted small">{payment.paid_date ? `${payment.paid_date} 实付` : `${payment.due_date} 这一期`}</span>
                <small className="muted">{periodLabel(payment.coverage_start, payment.coverage_end)}</small>{payment.off_schedule && <small className="muted">原排期已更正，历史付款保留</small>}</div>
              {onCorrectPayment && <button type="button" disabled={!ready} aria-label={`更正 ${payment.due_date} 付款`} onClick={() => onCorrectPayment(payment)}>更正</button>}
            </article>)}</div>
            {pageCount > 1 && <div className="actions"><button disabled={currentPage === 0} onClick={() => setPage(n => n - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setPage(n => n + 1)}>下一页</button></div>}
          </>}
      </section>
      {!!plan.resumptions?.length && <section className="subscription-periods" aria-label="订阅期间"><h3>订阅期间</h3>
        {plan.resumptions.map((r,i) => <p key={r.resumed_on}>{i === 0 ? f.service_start : plan.resumptions![i-1].resumed_on} 至 {r.previous_end}<small className="muted"> · 已结束</small></p>)}
        <p>{plan.resumptions.at(-1)!.resumed_on} 起{f.end_date ? `，使用至 ${f.end_date}` : '，持续订阅'}</p><p className="muted small">中间停订的时间不计入费用估算，也不会要求补付款。</p>
      </section>}
      <details className="plan-advanced"><summary>排期与费用估算</summary><dl className="facts">
        <dt>当前服务期</dt><dd>{plan.current_coverage ? periodLabel(...plan.current_coverage) : ended ? `已于 ${f.end_date} 结束` : '—'}</dd>
        <dt>下一笔待记录付款</dt><dd>{f.paused ? '暂停中' : plan.next_due && !ended ? plan.next_due : '当前没有待记录期'}</dd>
        <dt>已付覆盖期</dt><dd>{link ? link.paid_until ?? '未记录' : '关联信息待读取'}</dd>
        <dt>最终结束日</dt><dd>{f.end_date ? `使用至 ${f.end_date}` : '未设置（持续进行）'}</dd>
        <dt>累计估算</dt><dd>{plan.estimated_cents ? <>{money(plan.estimated_cents)}<small className="muted"> 按每期价格与服务期间估算，不代表实付</small></> : '—'}</dd>
        <dt>分类</dt><dd>{recurringCategoryText(f.category)}</dd>
        {f.auto_renew === false && <><dt>续费</dt><dd>自动续费已关闭</dd></>}
        {f.trial_days ? <><dt>免费试用</dt><dd>{f.trial_days} 天</dd></> : null}
        {(f.service_start) && <><dt>开始日期</dt><dd>{f.service_start}</dd></>}
        {linked && <><dt>备款提醒</dt><dd>{link!.reminder ? (link!.reminder.repeat_every_period ? `每期提前 ${link!.reminder.lead_days ?? 3} 天` : `仅本次 · ${link!.reminder.date}`) : '未开启'}{!modules.virtual ? <small className="muted">（虚拟资产模块关闭，提醒暂停）</small> : <small className="muted"> 在编辑中调整</small>}</dd></>}
        {namesDiffer && <><dt>服务名称</dt><dd>{asset!.name}</dd></>}
        {f.notes && <><dt>计划备注</dt><dd>{f.notes}</dd></>}
      </dl></details>
    </section>
  </dialog>;
}
