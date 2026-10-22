import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { linkView } from './link';
import type { LinkView } from './link';
import { relationNotice } from './LinkDialogs';
import { intervalUnit, pendingSubscriptionStart, planStatus, recurringCategoryText } from './recurring';
import type { Payment, Plan, SubscriptionDetailData } from './recurring';
import { submit, Unresolved } from './wealth';
import { periodLabel } from './recurring-model';
import type { Modules } from './modules';
import './wealth.css';
import { t } from './i18n.ts';
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
export function SubscriptionDetail({ plan: initialPlan, today, modules, sourcePayment, onCorrectPayment, onClose, onSaved, ...act }: {
  plan: Plan; today: string; modules: Modules; sourcePayment?: Payment | null; onCorrectPayment?: (payment: Payment) => void; onClose: () => void; onSaved?: () => void;
} & SubscriptionDetailActions) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<LinkView | null>(null), [linkError, setLinkError] = useState('');
  const [linkRetry, setLinkRetry] = useState(0);
  const [detail, setDetail] = useState<SubscriptionDetailData | null>(null), [historyError, setHistoryError] = useState('');
  const [page, setPage] = useState(0);
  const [cancelPrompt, setCancelPrompt] = useState(false), [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), [mutationError, setMutationError] = useState('');
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
  const pending = pendingSubscriptionStart(plan, today);
  const notice = link ? relationNotice(link.relation, { occupied_by: link.occupied_by }) : null;
  const namesDiffer = !!asset && asset.name !== f.name;
  const state = ended ? 'expired' : pending ? 'future' : f.paused ? 'paused' : 'ongoing';
  const monthly = !pending && plan.monthly_cents && !f.interval_days && f.interval_months > 1 ? plan.monthly_cents : null;
  const schedule = ended ? `已于 ${f.end_date} 结束` : f.paused ? '续费已暂停' : plan.next_due ? `下次付款 ${plan.next_due}` : '当前没有待记录期';
  const paidText = link ? (link.paid_count ? `${money(link.paid_cents ?? '0')} · ${link.paid_count} 笔` : '未记录付款') : plan.paid_cents ? money(plan.paid_cents) : '未记录付款';
  const meta = asset ? [asset.provider, asset.label_name].filter(Boolean).join(' · ') : '';
  const sub = f.category === 'subscription' || linked;
  const stale = !!link && !!detail && (link.generation !== detail.generation || (!!link.plan && link.plan.revision !== plan.revision));
  const ready = !!link && !!detail && !stale && !busy && !stuck;
  const canResume = sub && ended && !!f.service_start && (linked || link?.relation === 'unlinked');
  const records = detail?.payments ?? [];
  const pendingResumption = !!pending && !!plan.resumptions?.length;
  const pendingPayments = pendingResumption && (detail?.pending_has_payments ?? records.some(p => p.coverage_start ? p.coverage_start >= pending! : p.due_date >= f.first_due));
  const editablePending = pendingResumption && !pendingPayments && (linked || link?.relation === 'unlinked');
  async function cancelPending() {
    if (!ready || !editablePending || !link) return;
    setBusy(true); setMutationError('');
    try {
      await submit({ command: 'recurring_cancel_resumption', input: { request_id: crypto.randomUUID(), generation: link.generation, plan_id: plan.id, expected_revision: plan.revision, asset_id: link.asset?.id ?? null, asset_expected_revision: link.asset?.revision ?? null }, label: '撤销待生效订阅 ' + f.name });
      if (onSaved) onSaved(); else { setCancelPrompt(false); setLinkRetry(n => n + 1); }
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setMutationError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  const pageCount = Math.max(1, Math.ceil(records.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  return <dialog ref={dialog} className="editor wealth-account-editor sub-detail" aria-labelledby="plan-detail-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header><div><p className="eyebrow">{t('财富 ·')} {sub ? t('订阅') : t('周期费用')}</p><h2 id="plan-detail-heading">{f.name}</h2>
      <p className="sub-detail-line"><span className="virtual-state" data-state={state}>{planStatus(plan, today)}</span> <strong>{money(f.amount_cents)}／{intervalUnit(f)}</strong>{!ended && <> · {schedule}</>}</p>
      {meta && <p className="muted small">{meta}</p>}</div>
      <CloseButton type="button" aria-label={t('关闭计划详情')} disabled={busy} onClick={onClose} /><div className="editor-header-actions"><button disabled={!ready || pendingResumption && !editablePending} onClick={() => editablePending ? act.onResume({ plan, link: link! }) : act.onEdit(plan)}>{pendingResumption ? t('调整订阅安排') : t('修改价格与设置')}</button></div></header>
    <section className="subscription-body">
      {!link && (linkError ? <p className="notice" role="alert">{t('关联信息读取失败：{linkError}', { linkError })} <button onClick={() => setLinkRetry(n => n + 1)}>{t('重新读取关联')}</button></p> : <p className="muted" role="status">{t('正在读取关联信息…')}</p>)}
      {sourcePayment && onCorrectPayment && <section className="form-block" aria-label={t('来源付款记录')}><h3>{t('来源付款记录')}</h3><dl className="facts">
        <dt>{t('原付款期')}</dt><dd>{sourcePayment.due_date}</dd>
        <dt>{t('实际付款日')}</dt><dd>{sourcePayment.paid_date ?? t('未记录')}</dd>
        <dt>{t('付款事实')}</dt><dd>{sourcePayment.state === 'skipped' ? t('本期不付') : money(sourcePayment.amount_cents)}{sourcePayment.off_schedule && <small className="muted"> {t('· 原排期已更正，保留历史事实')}</small>}</dd>
        {sourcePayment.coverage_start && sourcePayment.coverage_end && <><dt>{t('原服务覆盖期')}</dt><dd>{periodLabel(sourcePayment.coverage_start, sourcePayment.coverage_end)}</dd></>}
        {sourcePayment.notes && <><dt>{t('付款备注')}</dt><dd>{sourcePayment.notes}</dd></>}
      </dl><button className="ui-link" disabled={!ready} onClick={() => onCorrectPayment(sourcePayment)}>{t('更正这笔付款')}</button></section>}
      {link?.needs_review && <div className="notice" role="note">{t('档案停用')}{asset?.stopped_on ? t('于 {stopped_on}', { stopped_on: asset.stopped_on }) : ''}{t('，但计划仍在进行。')}<button className="ui-link" onClick={() => act.onReview({ plan, link })}>{t('核对停用记录…')}</button></div>}
      {notice && <div className="notice" role="note">{notice}{link && link.relation === 'asset_trashed' && link.candidates.length > 0 && (link.candidates.length > 1
        ? <button className="ui-link" onClick={() => act.onCandidates(plan, link.candidates)}>{t('选择要归组的历史档案…')}</button>
        : <button className="ui-link" onClick={() => act.onCandidates(plan, link.candidates)}>{t('处理关联档案…')}</button>)}</div>}
      {namesDiffer && <div className="notice" role="note">{t('服务名称为「{name}」，付款计划名称为「{v2}」。', { name: asset!.name, v2: f.name })}<button className="ui-link" onClick={() => act.onUnify({ plan, link: link! })}>{t('统一名称…')}</button></div>}
      <div className="inspector-metrics sub-metrics">
        <div><span>{t('每期价格')}</span><strong>{money(f.amount_cents)}<small>／{intervalUnit(f)}</small></strong>{monthly && <small className="muted">{t('月均 {v1}', { v1: money(monthly) })}</small>}</div>
        <div><span>{t('实际已付')}</span><strong>{paidText}</strong><small className="muted">{t('只合计已记录的真实付款')}</small></div>
        <div><span>{pending ? t('本次服务生效日') : ended ? t('上次使用至') : t('当前服务期至')}</span><strong>{pending ?? (plan.current_coverage ? plan.current_coverage[1] : ended ? f.end_date : '—')}</strong></div>
      </div>
      <div className="actions">
        <button className="primary" onClick={() => act.onPay(detail?.payment_candidate ? { ...plan, next_due: detail.payment_candidate.due_date, next_coverage: detail.payment_candidate.coverage_start && detail.payment_candidate.coverage_end ? [detail.payment_candidate.coverage_start, detail.payment_candidate.coverage_end] : plan.next_coverage } : plan, detail?.payment_candidate?.amount_cents ?? f.amount_cents)} disabled={!ready || !(detail?.payment_candidate || plan.next_due) || f.paused || ended}>{t('记录实际扣款')}</button>
        {canResume && <button className="primary" disabled={!ready} onClick={() => act.onResume({ plan, link: link! })}>{t('重新订阅…')}</button>}
        {sub && !ended && (!pendingResumption || pendingPayments) && <button type="button" onClick={() => act.onEnd({ plan, link: link! })} disabled={!ready || !(linked || link?.relation === 'unlinked')}>{t('取消后续续费…')}</button>}
        {editablePending && <button type="button" disabled={!ready} onClick={() => setCancelPrompt(true)}>{t('撤销待生效安排…')}</button>}
        <details className="more-actions"><summary>{t('更多操作')}</summary>
          {act.onCreate && link?.relation === 'unlinked' && f.category === 'subscription' && <button onClick={() => act.onCreate!(plan)}>{t('建立关联服务档案…')}</button>}
          <button type="button" className="ui-link danger-text" disabled={!link} onClick={() => linked ? act.onGroupDelete(plan.id, f.name) : act.onEdit(plan)}>{linked ? t('整组删除…') : t('删除（在编辑中）')}</button>
        </details>
      </div>
      {pending && <p className="muted small">{t('服务将于 {pending} 生效。若已提前扣款，现在就可以记录；付款不会把生效日提前，也不会改动以后的续费日期。', { pending })}</p>}
      {pendingPayments && <p className="muted small">{t('本段已有付款记录，不能直接改动日期或撤销安排。记错付款可在下方更正；不再续费可选择「取消后续续费」，保留已付服务期。')}</p>}
      {cancelPrompt && <section className="form-block" aria-label={t('确认撤销待生效安排')}><h3>{t('撤销这段尚未生效的安排？')}</h3><p>{t('将恢复为上段已结束的订阅。旧期间与旧付款保持原样；不会取消服务方的订阅或办理退款。')}</p><div className="actions"><button disabled={busy || stuck} onClick={() => setCancelPrompt(false)}>{t('保留安排')}</button><button disabled={!ready} onClick={() => void cancelPending()}>{busy ? t('正在撤销…') : t('确认撤销安排')}</button></div></section>}
      {mutationError && <p className="notice" role="alert">{mutationError}{stuck && t(' 请关闭详情并核对上一次请求，不要重复提交。')}</p>}
      {stale && <p className="notice" role="alert">{t('资料已变化，请重新读取。')}<button onClick={() => setLinkRetry(n => n + 1)}>{t('重新读取')}</button></p>}
      <p className="muted small">{t('仅向付款账户充值时，等服务实际扣款后再记录。取消续费保留以前的付款。')}</p>
      {sub && f.paused && !ended && <p className="muted small">{t('如果实际已经停订，请在「取消后续续费」里填写上次最后使用日，之后可重新订阅。')}</p>}
      {sub && ended && !f.service_start && <p className="muted small">{t('这条旧记录还没有服务开始日期。')}<button className="ui-link" disabled={!ready} onClick={() => act.onEdit(plan)}>{t('补充开始日期')}</button>{t('后，即可在原档案重新订阅。')}</p>}
      <section className="subscription-payments" aria-label={t('这项订阅的付款记录')}>
        <div className="ui-section-head"><h3>{t('付款记录')}</h3><button className="ui-link" disabled={!ready} onClick={() => act.onBackfill(plan)}>{t('补记以前的付款')}</button></div>
        {historyError ? <p className="notice" role="alert">{t('付款记录读取失败：{historyError}', { historyError })} <button onClick={() => setLinkRetry(n => n + 1)}>{t('重新读取')}</button></p>
          : !detail ? <p className="muted" role="status">{t('正在读取付款记录…')}</p>
          : !records.length ? <p className="muted">{t('还没有记录付款。已经扣过的钱可以补记；预计费用不会算成实际已付。')}</p>
          : <><p className="muted small">{t('记错金额、日期或提前误记已付，点「更正」处理。')}</p>
            <div className="subscription-payment-list">{records.slice(currentPage * 50, (currentPage + 1) * 50).map(payment => <article key={payment.id}>
              <div><strong>{payment.state === 'paid' ? money(payment.amount_cents) : t('本期不付')}</strong><span className="muted small">{payment.paid_date ? t('{paid_date} 实付', { paid_date: payment.paid_date }) : t('{due_date} 这一期', { due_date: payment.due_date })}</span>
                <small className="muted">{periodLabel(payment.coverage_start, payment.coverage_end)}</small>{payment.off_schedule && <small className="muted">{t('原排期已更正，历史付款保留')}</small>}</div>
              {onCorrectPayment && <button type="button" disabled={!ready} aria-label={t('更正 {due_date} 付款', { due_date: payment.due_date })} onClick={() => onCorrectPayment(payment)}>{t('更正')}</button>}
            </article>)}</div>
            {pageCount > 1 && <div className="actions"><button disabled={currentPage === 0} onClick={() => setPage(n => n - 1)}>{t('上一页')}</button><span>{currentPage + 1} / {pageCount}</span><button disabled={currentPage + 1 === pageCount} onClick={() => setPage(n => n + 1)}>{t('下一页')}</button></div>}
          </>}
      </section>
      {!!plan.resumptions?.length && <section className="subscription-periods" aria-label={t('订阅期间')}><h3>{t('订阅期间')}</h3>
        {plan.resumptions.map((r,i) => <p key={r.resumed_on}>{i === 0 ? f.service_start : plan.resumptions![i-1].resumed_on} {t('至 {previous_end}', { previous_end: r.previous_end })}<small className="muted"> {t('· 已结束')}</small></p>)}
        <p>{t('{resumed_on} 起', { resumed_on: plan.resumptions.at(-1)!.resumed_on })}{f.end_date ? t('，使用至 {end_date}', { end_date: f.end_date }) : t('，持续订阅')}</p><p className="muted small">{t('中间停订的时间不计入费用估算，也不会要求补付款。')}</p>
      </section>}
      <details className="plan-advanced"><summary>{t('排期与费用估算')}</summary><dl className="facts">
        <dt>{t('当前服务期')}</dt><dd>{plan.current_coverage ? periodLabel(...plan.current_coverage) : ended ? t('已于 {end_date} 结束', { end_date: f.end_date }) : '—'}</dd>
        <dt>{t('下一笔待记录付款')}</dt><dd>{f.paused ? t('暂停中') : plan.next_due && !ended ? plan.next_due : t('当前没有待记录期')}</dd>
        <dt>{t('已付覆盖期')}</dt><dd>{link ? link.paid_until ?? t('未记录') : t('关联信息待读取')}</dd>
        <dt>{t('最终结束日')}</dt><dd>{f.end_date ? t('使用至 {end_date}', { end_date: f.end_date }) : t('未设置（持续进行）')}</dd>
        <dt>{t('累计估算')}</dt><dd>{plan.estimated_cents ? <>{money(plan.estimated_cents)}<small className="muted"> {t('按每期价格与服务期间估算，不代表实付')}</small></> : '—'}</dd>
        <dt>{t('分类')}</dt><dd>{recurringCategoryText(f.category)}</dd>
        {f.auto_renew === false && <><dt>{t('续费')}</dt><dd>{t('自动续费已关闭')}</dd></>}
        {f.trial_days ? <><dt>{t('免费试用')}</dt><dd>{t('{trial_days} 天', { trial_days: f.trial_days })}</dd></> : null}
        {(f.service_start) && <><dt>{t('开始日期')}</dt><dd>{f.service_start}</dd></>}
        {linked && <><dt>{t('备款提醒')}</dt><dd>{link!.reminder ? (link!.reminder.repeat_every_period ? t('每期提前 {v1} 天', { v1: link!.reminder.lead_days ?? 3 }) : t('仅本次 · {date}', { date: link!.reminder.date })) : t('未开启')}{!modules.virtual ? <small className="muted">{t('（虚拟资产模块关闭，提醒暂停）')}</small> : <small className="muted"> {t('在编辑中调整')}</small>}</dd></>}
        {namesDiffer && <><dt>{t('服务名称')}</dt><dd>{asset!.name}</dd></>}
        {f.notes && <><dt>{t('计划备注')}</dt><dd>{f.notes}</dd></>}
      </dl></details>
    </section>
  </dialog>;
}
