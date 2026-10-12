// 独立假设核对编辑器（契约 §2；设计 §18.2）。四个试算值在同一区域展示、编辑与确认：
// 「确认并保存」与普通保存是两个明确不同的意图；普通关闭不存草稿。
// 本组件只调用注入端口：不迁移旧资料、不改四问事务，也不替其他分区保存。
// 保存成功后重新读取真实来源；刷新失败只提示，不允许再提交；结果未知冻结重复提交。
import { useEffect, useRef, useState } from 'react';
import type { AssumptionKey } from './model.ts';
import { ASSUMPTION_DEFAULTS, assumptionFields, assumptionValuesOf, confirmationText, hundredthsToPctText, pctTextToHundredths } from './model.ts';
import type { AssumptionReadV1, FollowupIssue, FollowupRead, FollowupWriteContext, PlanningFollowupPortV1 } from '../planning-followup-contract.ts';

function AssumptionsEditorContent({ port, generation, onClose, onPending }: {
  port: PlanningFollowupPortV1; generation: string; /** 保存成功时把最新读取一并带回，调用方可对齐本地携带值。 */
  onClose: (saved: boolean, read: FollowupRead<AssumptionReadV1> | null) => void; onPending: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), issueRef = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState<FollowupRead<AssumptionReadV1> | null>(null);
  const [draft, setDraft] = useState<Record<AssumptionKey, string> | null>(null);
  const [issues, setIssues] = useState<FollowupIssue[]>([]);
  const [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'unresolved'>('idle');
  const [retry, setRetry] = useState(0);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dialogRef.current?.showModal(); return () => dialogRef.current?.close(); }, []);
  useEffect(() => {
    let live = true; setRead(null); setDraft(null); setIssues([]); setNotice('');
    port.readAssumptions(generation).then(v => {
      if (!live) return;
      if (v.status === 'ready' && v.value.generation !== generation) { setRead({ status: 'error', code: 'GENERATION_MISMATCH', message: '资料库已变化，请关闭后重新打开。' }); return; }
      setRead(v);
      if (v.status === 'ready') setDraft({
        real_return_before_hundredths: hundredthsToPctText(v.value.values.real_return_before_hundredths),
        real_return_after_hundredths: hundredthsToPctText(v.value.values.real_return_after_hundredths),
        inflation_hundredths: hundredthsToPctText(v.value.values.inflation_hundredths),
        volatility_hundredths: hundredthsToPctText(v.value.values.volatility_hundredths),
      });
    }).catch(e => { if (live) setRead({ status: 'error', code: 'READ_ERROR', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [port, generation, retry]);
  useEffect(() => { if (issues.length) issueRef.current?.focus(); }, [issues]);
  const busy = phase === 'saving', frozen = busy || phase === 'unresolved' || phase === 'saved' || (read?.status === 'ready' && read.value.revision === null);
  const close = (savedNow: boolean) => { if (busy) return; onClose(savedNow, savedNow && phase !== 'saved' ? read : null); };

  async function save(confirm: boolean) {
    if (!read || read.status !== 'ready' || !draft || lock.current || frozen) return;
    const local: FollowupIssue[] = [];
    for (const { key, label } of assumptionFields)
      if (pctTextToHundredths(draft[key]) === null) local.push({ path: key, code: 'invalid_rate', message: `${label.replace('（%）', '')}请填百分数，例如 2 或 2.5；缺失或非法不会按 0 保存。` });
    if (local.length) { setIssues(local); return; }
    const values = assumptionValuesOf(draft)!;
    const context: FollowupWriteContext = { generation, request_id: crypto.randomUUID(), expected_revision: read.value.revision };
    lock.current = true; setPhase('saving'); setIssues([]);
    try {
      const result = await port.saveAssumptions(values, confirm, context);
      if (!mounted.current) return;
      if (result.status === 'rejected') { setPhase('idle'); setIssues(result.issues); return; }
      if (result.status === 'unresolved') { setPhase('unresolved'); onPending(); return; }
      // saved：重新读取真实来源后再关闭；读取失败只提示，不再提交。
      try {
        const next = await port.readAssumptions(generation);
        if (!mounted.current) return;
        if (next.status === 'ready' && next.value.generation === generation) { setRead(next); setPhase('idle'); onClose(true, next); return; }
        setPhase('saved'); setNotice('已保存，刷新失败：请关闭后重新打开核对，不要重复提交。');
      } catch (e) {
        if (!mounted.current) return;
        setPhase('saved'); setNotice(`已保存，刷新失败：${e instanceof Error ? e.message : String(e)}。请关闭后重新打开核对，不要重复提交。`);
      }
    } catch (e) { if (mounted.current) setIssues([{ path: '', code: 'SAVE_ERROR', message: e instanceof Error ? e.message : String(e) }]); } finally { lock.current = false; if (mounted.current) setPhase(p => p === 'saving' ? 'idle' : p); }
  }

  const body = !read ? <p className="pfu-state" role="status">正在读取规划假设…</p>
    : read.status === 'disabled' ? <div className="pfu-state pfu-error" role="status"><h4>规划假设暂不可用</h4><p>{read.message}</p></div>
    : read.status === 'error' ? <div className="pfu-state pfu-error" role="alert"><h4>规划假设读取失败</h4><p>{read.message}</p><button type="button" className="pfu-btn" disabled={busy} onClick={() => setRetry(n => n + 1)}>重新读取</button></div>
    : draft && <>{read.value.revision === null && <p role="note">请先保存规划，再单独修改或确认这些假设。</p>}{phase !== 'unresolved' && <p className={`pfu-confirm ${read.value.confirmation}`} role="note">{confirmationText[read.value.confirmation]}</p>}
      {read.value.confirmation !== 'unconfirmed' && read.value.confirmed_values && <p className="pfu-muted small">已核对过的值：退休前 {hundredthsToPctText(read.value.confirmed_values.real_return_before_hundredths)}% · 退休后 {hundredthsToPctText(read.value.confirmed_values.real_return_after_hundredths)}% · 通胀 {hundredthsToPctText(read.value.confirmed_values.inflation_hundredths)}% · 波动率 {hundredthsToPctText(read.value.confirmed_values.volatility_hundredths)}%。</p>}
      {assumptionFields.map(f => <label key={f.key} className="pfu-field-label">{f.label}
        <input className="pfu-rate" aria-label={f.label} inputMode="decimal" placeholder="例如 2 或 2.5" disabled={frozen} value={draft[f.key]} onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}/>
        <small className="pfu-hint">{f.hint}</small>
      </label>)}
      <div className="pfu-actions-row"><button type="button" className="pfu-btn" disabled={frozen} onClick={() => setDraft({
        real_return_before_hundredths: hundredthsToPctText(ASSUMPTION_DEFAULTS.real_return_before_hundredths),
        real_return_after_hundredths: hundredthsToPctText(ASSUMPTION_DEFAULTS.real_return_after_hundredths),
        inflation_hundredths: hundredthsToPctText(ASSUMPTION_DEFAULTS.inflation_hundredths),
        volatility_hundredths: hundredthsToPctText(ASSUMPTION_DEFAULTS.volatility_hundredths),
      })}>恢复默认假设</button><span className="pfu-muted small">默认 0／0／2／5 只改表单；核对状态只能由「确认并保存」更新。</span></div>
      <p className="pfu-muted small">这些值用于试算与市场路径模拟，不保证未来收益；核对不等于保证。修改后关闭不会保存草稿。</p>
    </>;
  return <dialog ref={dialogRef} className="pfu-dialog" aria-labelledby="pfu-assumptions-heading" onCancel={e => { e.preventDefault(); if (!busy) close(phase === 'saved'); }}>
    <form noValidate onSubmit={e => { e.preventDefault(); void save(false); }}>
      <header className="pfu-dialog-head">
        <div><p className="pfu-eyebrow">规划 · 假设核对</p><h3 id="pfu-assumptions-heading">核对收益与波动假设</h3>
          <p className="pfu-meta">退休前／后实际收益、通胀和市场模拟年波动率。收益已扣通胀与费用；波动率只作用于市场路径模拟。</p></div>
        <button type="button" className="pfu-close" aria-label="关闭假设核对" disabled={busy} onClick={() => close(phase === 'saved')}>×</button>
      </header>
      {body}
      {issues.length > 0 && <div className="pfu-notice" role="alert" ref={issueRef} tabIndex={-1}>{issues.map(i => <p key={i.path + i.code}>{i.path ? `${i.path}：` : ''}{i.message}</p>)}</div>}
      {notice && <p className="pfu-notice" role="status">{notice}</p>}
      {phase === 'unresolved' && <p className="pfu-notice" role="status">提交结果未知，原请求已保留并冻结重复提交；请通过页面顶部的核对入口确认结果。<button type="button" className="pfu-btn" onClick={() => close(false)}>关闭，稍后核对</button></p>}
      {read?.status === 'ready' && draft && <footer className="pfu-dialog-foot">
        <button type="button" className="pfu-btn" disabled={busy} onClick={() => close(phase === 'saved')}>{phase === 'saved' ? '关闭（已保存）' : phase === 'unresolved' ? '关闭（结果待核对）' : '取消（不保存本次修改）'}</button>
        <span className="pfu-foot-group">
          <button type="submit" className="pfu-btn" disabled={frozen}>{busy ? '保存中…' : '保存（不改核对状态）'}</button>
          <button type="button" className="pfu-btn pfu-primary" disabled={frozen} onClick={() => void save(true)}>确认并保存</button>
        </span>
      </footer>}
    </form>
  </dialog>;
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function AssumptionsEditor(props: Parameters<typeof AssumptionsEditorContent>[0]) {
  return <AssumptionsEditorContent key={props.generation} {...props}/>;
}
