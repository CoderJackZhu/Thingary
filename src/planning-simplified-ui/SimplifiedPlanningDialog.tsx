import { useEffect, useRef, useState } from 'react';
import { CloseButton } from '../CloseButton';
import type { FieldIssueV1, SaveContextV1, SimplifiedPlanningFieldsV1, SimplifiedPlanningPortV1, SimplifiedPlanningReadV1 } from '../plan-simplified-contract.ts';
import { resetReasonText } from './income-view';
import { TimeFields } from './TimeFields';
import { FutureIncomeSection } from './FutureIncomeSection';
import './simplified-ui.css';

type ReadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; read: SimplifiedPlanningReadV1 };

/**
 * 「确认时间与未来收入」编辑入口：消费领域 D0 端口（读取／保存／核对），
 * 不自带第二套保存协议。保存成功才关闭；拒绝保留输入；提交未知冻结重复提交，
 * 走既有回执核对；普通关闭不存草稿。首次向导接入时由 saveSetup 一次提交
 * 全部四问（契约 §3），本组件只负责该分区的界面状态。
 */
export function SimplifiedPlanningDialog({ port, today, onClose, pendingContext = null, onPendingChange, onOpenOfficial }: {
  port: SimplifiedPlanningPortV1; today: string; onClose: (saved: boolean) => void;
  pendingContext?: SaveContextV1 | null;
  onPendingChange?: (context: SaveContextV1 | null) => void;
  onOpenOfficial?: (url: string) => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [read, setRead] = useState<ReadState>({ status: 'loading' });
  const [draft, setDraft] = useState<SimplifiedPlanningFieldsV1 | null>(null);
  const [issues, setIssues] = useState<FieldIssueV1[]>([]);
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<SaveContextV1 | null>(pendingContext);
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const pending = useRef<SaveContextV1 | null>(pendingContext);
  const alive = useRef(true);
  const readTicket = useRef(0);
  const editing = useRef(false);
  const [editingIncome, setEditingIncome] = useState(false);
  const issueSummary = useRef<HTMLParagraphElement>(null);
  function retain(context: SaveContextV1 | null) {
    pending.current = context;
    setUnresolved(context);
    onPendingChange?.(context);
  }
  function close() {
    if (locked.current || (pending.current && !onPendingChange)) return;
    onClose(false);
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; readTicket.current += 1; }; }, []);
  useEffect(() => { if (issues.length) issueSummary.current?.focus(); }, [issues]);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.simplified-body')?.scrollTo(0, 0); }, [read.status]);
  useEffect(() => { void reload(); }, []);
  async function reload() {
    const ticket = ++readTicket.current;
    setRead({ status: 'loading' }); setNotice('');
    try {
      const value = await port.read();
      if (!alive.current || ticket !== readTicket.current) return;
      setRead({ status: 'ready', read: value });
      setDraft(structuredClone(value.fields));
      setIssues([]);
    } catch (e) {
      if (!alive.current || ticket !== readTicket.current) return;
      setRead({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function submit() {
    if (!draft || read.status !== 'ready' || locked.current || pending.current || editing.current) return;
    const context: SaveContextV1 = { request_id: crypto.randomUUID(), generation: read.read.generation, expected_revision: read.read.revision };
    locked.current = true;
    setBusy(true); setNotice('');
    // The host retains the original request before dispatch, including if it unmounts this dialog.
    retain(context);
    try {
      const outcome = await port.save(draft, context);
      if (!alive.current) return; // The host reconciles the retained request after a remount.
      if (outcome.status === 'saved') { retain(null); setIssues([]); onClose(true); }
      else if (outcome.status === 'rejected') { retain(null); setIssues(outcome.issues); }
    } catch {
      if (alive.current) setNotice('未能确认保存结果，请核对原请求，避免重复保存。');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function resolveReceipt() {
    const context = pending.current;
    if (!context || locked.current) return;
    locked.current = true;
    setBusy(true); setNotice('');
    try {
      const outcome = await port.resolve(context);
      if (!alive.current) return; // The host reconciles the retained request after a remount.
      if (outcome.status === 'saved') { retain(null); setIssues([]); onClose(true); }
      else if (outcome.status === 'rejected') { retain(null); setIssues(outcome.issues); }
      else setNotice('仍未能确认上次保存的结果；原请求保留，请稍后继续核对。');
    } catch {
      if (alive.current) setNotice('暂时无法核对；原请求仍保留，请稍后重试。');
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const frozen = busy || !!unresolved;
  const cannotClose = busy || (!!unresolved && !onPendingChange);
  return <dialog ref={dialog} className="editor wealth-account-editor simplified-dialog" aria-labelledby="simplified-heading"
    onCancel={e => { e.preventDefault(); close(); }}>
    <header><div><p className="eyebrow">规划 · 时间与收入</p><h2 id="simplified-heading" ref={heading} tabIndex={-1}>时间与未来收入</h2>
      <p className="muted">目标时间是你自己的安排，不等于法定退休或养老金开始领取时间。</p></div>
      <CloseButton type="button" aria-label="关闭时间与未来收入" disabled={cannotClose} onClick={close}/></header>
    <div className="simplified-body">
      {read.status === 'loading' && <p className="muted">正在读取…</p>}
      {read.status === 'error' && <section className="form-block"><p className="error" role="alert">暂时读不到规划资料：{read.message}</p>
        <p className="muted small">读取失败不当作「暂不计入」，也不会用旧结果冒充。</p>
        <button type="button" className="ui-btn" onClick={() => void reload()}>重新读取</button></section>}
      {read.status === 'ready' && draft && <>
        {read.read.reset_reasons.length > 0 && <div className="caution" role="status"><strong>规划条件已简化</strong>
          <p>{resetReasonText(read.read.reset_reasons)}</p>
          <p className="muted small">旧政策资料已移除；下面的时间和收入按你的安排重新确认即可。</p></div>}
        <TimeFields value={draft.time} issues={issues} busy={frozen} today={today} onChange={time => setDraft({ ...draft, time })}/>
        <FutureIncomeSection fields={draft} issues={issues} busy={frozen} today={today} onOpenOfficial={onOpenOfficial} onEditingChange={active => { editing.current = active; setEditingIncome(active); }} onDraftChange={setDraft}/>
        <p className="muted small">关闭不保存草稿；金额或时间没填的收入会保留为「未计入」，不会当成 0。</p>
      </>}
    </div>
    {(notice || unresolved) && <div className="caution" role="alert">
      {unresolved && <><strong>保存请求已发出，结果未知</strong><p>已冻结重复提交，防止重复保存。可以先核对上次保存的结果。</p>
        <button type="button" className="ui-btn" disabled={busy} onClick={() => void resolveReceipt()}>核对保存结果</button></>}
      {notice && <p>{notice}</p>}
    </div>}
    {issues.length > 0 && <p ref={issueSummary} tabIndex={-1} className="notice" role="alert">有 {issues.length} 项内容需要修改：{issues.map(i => i.message).join(' ')}</p>}
    {editingIncome && <p className="notice" role="status">请先完成或取消正在编辑的收入，再保存整个安排。</p>}
    <footer className="rs-actions">
      <button type="button" disabled={cannotClose} onClick={close}>{unresolved ? (onPendingChange ? '关闭，稍后核对保存结果' : '请先核对保存结果') : '取消'}</button>
      <button type="button" className="primary" aria-label="保存" disabled={frozen || editingIncome || read.status !== 'ready'} onClick={() => void submit()}>{busy ? '保存中…' : '保存'}</button>
    </footer>
  </dialog>;
}
