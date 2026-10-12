// 资金流动记录表单（契约 §3；设计 §18.3/§18.5）。一条记录原子维护转出／转入两端；
// 端点用稳定账户 ID，外部对象用明确说明，不用名字重绑历史账户。金额为非零正金额，
// 无法确定时不能保存成虚假事实。来源关联只用领域返回的稳定键，UI 不拼复合键。
// 受控草稿由本组件持有，普通关闭即丢弃；提交意图交给注入端口，保存与回执由领域负责。
import { useEffect, useRef, useState } from 'react';
import type { FollowupIssue, MovementAccountV1, MovementRecordV1, MovementSourceOptionV1, MovementSourceV1, PlanningFollowupPortV1, SourceQueryV1 } from '../planning-followup-contract.ts';
import { centsFromYuanText, draftFromMovement, draftToFields, formatCents, movementDraftIssues, purposeHint, purposeLabel, yuanTextFromCents } from './model.ts';
import type { MovementFormDraft } from './model.ts';

function AmountInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (cents: string) => void }) {
  const [raw, setRaw] = useState(() => yuanTextFromCents(value));
  useEffect(() => { if ((centsFromYuanText(raw) ?? null) !== value) setRaw(yuanTextFromCents(value)); }, [value]);
  return <label className="pfu-field-label">{label}
    <input className="pfu-amount" aria-label={label} inputMode="decimal" placeholder="必填，例如 8000.00" disabled={disabled} value={raw}
      onChange={e => { const cents = centsFromYuanText(e.target.value); if (cents === null) return; setRaw(e.target.value); onChange(cents); }}/>
  </label>;
}

function EndpointField({ side, label, draft, disabled, accounts, patch }: {
  side: 'from' | 'to'; label: string; draft: MovementFormDraft; disabled: boolean; accounts: MovementAccountV1[];
  patch: (fields: Partial<MovementFormDraft>) => void;
}) {
  const kind = side === 'from' ? draft.fromKind : draft.toKind;
  const account = side === 'from' ? draft.fromAccount : draft.toAccount;
  const external = side === 'from' ? draft.fromExternal : draft.toExternal;
  const setKind = (v: 'account' | 'external') => patch(side === 'from' ? { fromKind: v, fromAccount: v === 'account' ? '' : draft.fromAccount } : { toKind: v, toAccount: v === 'account' ? '' : draft.toAccount });
  // 端点选项以端口账户表为准；编辑中被引用但已不可选的历史账户仍显示，不能换成同名新账户。
  const options = [...accounts];
  if (kind === 'account' && account && !options.some(a => a.id === account)) options.push({ id: account, name: `历史账户 ${account}`, kind: '', selectable: false });
  return <fieldset className="pfu-endpoint"><legend>{label}</legend>
    <div className="pfu-segments" role="group" aria-label={`${label}类型`}>
      <button type="button" aria-pressed={kind === 'account'} disabled={disabled} onClick={() => setKind('account')}>本应用账户</button>
      <button type="button" aria-pressed={kind === 'external'} disabled={disabled} onClick={() => setKind('external')}>范围外对象</button>
    </div>
    {kind === 'account'
      ? <select aria-label={`${label}账户`} value={account} disabled={disabled} onChange={e => patch(side === 'from' ? { fromAccount: e.target.value } : { toAccount: e.target.value })}>
        <option value="">请选择账户</option>
        {options.map(a => <option key={a.id} value={a.id} disabled={!a.selectable && a.id !== account}>{a.name}{a.selectable ? '' : '（不可用于新流动）'}</option>)}
      </select>
      : <input aria-label={`${label}范围外对象说明`} placeholder="例如：转入银行、工资来源" disabled={disabled} value={external} onChange={e => patch(side === 'from' ? { fromExternal: e.target.value } : { toExternal: e.target.value })}/>}
  </fieldset>;
}

/** 来源选择：候选与稳定键全部来自端口；不可用候选展示原因，不能被选中。 */
function SourcePicker({ port, generation, movementId, source, onPick, disabled }: {
  port: PlanningFollowupPortV1; generation: string; movementId: string | null; source: MovementSourceV1 | null;
  onPick: (source: MovementSourceV1 | null) => void; disabled: boolean;
}) {
  const [kind, setKind] = useState<'income' | 'expense'>('income'), [text, setText] = useState('');
  const [options, setOptions] = useState<MovementSourceOptionV1[] | null>(null), [error, setError] = useState('');
  const requestId = useRef(0);
  const [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false);
  useEffect(() => { requestId.current++; setOptions(null); setCursor(null); return () => { requestId.current++; }; }, [port, generation, movementId]);
  const search = (nextKind: 'income' | 'expense' = kind, nextText: string = text, nextCursor: string | null = null) => {
    if (disabled) return;
    const request = ++requestId.current;
    const query: SourceQueryV1 = { kind: nextKind, text: nextText.trim(), cursor: nextCursor, movement_id: movementId };
    if (nextCursor === null) { setOptions(null); setCursor(null); } setError(''); setLoading(true);
    port.listSources(query, generation).then(v => {
      if (request !== requestId.current) return;
      if (v.status === 'ready') { if (v.value.generation !== generation) { setError('资料库已变化，请重新搜索。'); return; } setOptions(prev => nextCursor === null ? v.value.options : [...(prev ?? []), ...v.value.options]); setCursor(v.value.next_cursor); }
      else if (v.status === 'error') setError(v.message);
      else setError(v.message);
    }).catch(e => { if (request === requestId.current) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (request === requestId.current) setLoading(false); });
  };
  return <div className="pfu-source">
    <p className="pfu-muted small">关联一条已有的收入或重要支出记录（选填）：只说明同一笔现实发生，首版要求整笔、同额、同日，不产生额外余额或收益。没有可靠来源也可以不关联。</p>
    {source ? <p role="status">已关联{source.kind === 'income' ? '收入' : '支出'}来源。<button type="button" className="pfu-btn" disabled={disabled} onClick={() => onPick(null)}>解除关联</button></p>
      : <p className="pfu-muted small">尚未关联来源。</p>}
    <div className="pfu-segments" role="group" aria-label="来源类型">
      <button type="button" aria-pressed={kind === 'income'} disabled={disabled} onClick={() => { setKind('income'); search('income'); }}>收入记录</button>
      <button type="button" aria-pressed={kind === 'expense'} disabled={disabled} onClick={() => { setKind('expense'); search('expense'); }}>支出记录</button>
    </div>
    <div className="pfu-source-search">
      <input aria-label="搜索来源记录" placeholder="按说明文字搜索" disabled={disabled} value={text} onChange={e => { requestId.current++; setText(e.target.value); setOptions(null); setCursor(null); setLoading(false); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}/>
      <button type="button" className="pfu-btn" disabled={disabled} onClick={() => search()}>搜索</button>
    </div>
    {loading && <p role="status">正在读取来源…</p>}
    {cursor && <button type="button" className="pfu-btn" disabled={disabled || loading} onClick={() => search(kind, text, cursor)}>更多来源</button>}
    {error && <p className="pfu-notice" role="alert">{error}</p>}
    {options === null ? <p className="pfu-muted small" role="status">点击类型或搜索后显示候选。</p>
      : options.length === 0 ? <p className="pfu-muted small">没有可关联的记录。可先不关联，稍后再补充。</p>
      : <ul className="pfu-source-list">{options.map(o => <li key={o.ref.kind + o.ref.key}>
        <button type="button" disabled={disabled || !o.available} aria-pressed={source?.kind === o.ref.kind && source?.key === o.ref.key} onClick={() => onPick(o.ref)}>
          <span>{o.label}</span><small>{o.date} · {formatCents(o.amount_cents)}{o.available ? '' : ` · ${o.unavailable_reason ?? '不可关联'}`}</small>
        </button>
      </li>)}</ul>}
  </div>;
}

function MovementFormContent({ port, generation, accounts, record, today, blocked = false, onClose, onPending }: {
  port: PlanningFollowupPortV1; generation: string; accounts: MovementAccountV1[]; record: MovementRecordV1 | null; today: string;
  blocked?: boolean; onClose: (saved: boolean) => void; onPending: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), issueRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<MovementFormDraft>(() => draftFromMovement(record));
  const [issues, setIssues] = useState<FollowupIssue[]>([]);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'unresolved'>('idle');
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dialogRef.current?.showModal(); return () => dialogRef.current?.close(); }, []);
  useEffect(() => { if (issues.length) issueRef.current?.focus(); }, [issues]);
  const busy = phase === 'saving', frozen = busy || phase === 'unresolved' || blocked;
  const patch = (fields: Partial<MovementFormDraft>) => setDraft(d => ({ ...d, ...fields }));

  async function submit() {
    if (lock.current || frozen) return;
    const local = movementDraftIssues(draft);
    if (local.length) { setIssues(local); return; }
    lock.current = true; setPhase('saving'); setIssues([]);
    try {
      const result = await port.saveMovement(record?.id ?? null, draftToFields(draft), { generation, request_id: crypto.randomUUID(), expected_revision: record?.revision ?? null });
      if (!mounted.current) return;
      if (result.status === 'rejected') { setPhase('idle'); setIssues(result.issues); return; }
      if (result.status === 'unresolved') { setPhase('unresolved'); onPending(); return; }
      onClose(true);
    } catch (e) { if (mounted.current) setIssues([{ path: '', code: 'SAVE_ERROR', message: e instanceof Error ? e.message : String(e) }]); } finally { lock.current = false; if (mounted.current) setPhase(p => p === 'saving' ? 'idle' : p); }
  }

  return <dialog ref={dialogRef} className="pfu-dialog" aria-labelledby="pfu-movement-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}>
    <form noValidate onSubmit={e => { e.preventDefault(); void submit(); }}>
      <header className="pfu-dialog-head">
        <div><p className="pfu-eyebrow">财富 · 资金流动</p><h3 id="pfu-movement-heading">{record ? '修改资金流动' : '记一笔资金流动'}</h3>
          <p className="pfu-meta">只解释余额变化，不直接改变账户余额；余额事实仍以盘点为准。带手续费的转账请拆出本金与费用分别记录。</p></div>
        <button type="button" className="pfu-close" aria-label="关闭资金流动表单" disabled={busy} onClick={() => onClose(false)}>×</button>
      </header>
      <div className="pfu-form-grid">
        <label className="pfu-field-label">发生日期（按实际结算日）
          <input aria-label="发生日期" placeholder="YYYY-MM-DD，例如 2026-10-15" disabled={frozen} max={today} value={draft.date} onChange={e => patch({ date: e.target.value })}/>
          <small className="pfu-hint">跨期未到账的在途差异不当收益；记录后仍需按区间核对。</small>
        </label>
        <AmountInput label="金额（元）" value={draft.amount} disabled={frozen} onChange={v => patch({ amount: v })}/>
      </div>
      <div className="pfu-form-grid">
        <EndpointField side="from" label="转出端" draft={draft} disabled={frozen} accounts={accounts} patch={patch}/>
        <EndpointField side="to" label="转入端" draft={draft} disabled={frozen} accounts={accounts} patch={patch}/>
      </div>
      <label className="pfu-field-label">用途
        <select aria-label="用途" value={draft.purpose} disabled={frozen} onChange={e => patch({ purpose: e.target.value as MovementFormDraft['purpose'] })}>
          {(Object.keys(purposeLabel) as (keyof typeof purposeLabel)[]).map(p => <option key={p} value={p}>{purposeLabel[p]}</option>)}
        </select>
        <small className="pfu-hint">{purposeHint[draft.purpose]}</small>
      </label>
      <details className="pfu-source-block"><summary>关联来源记录（选填）</summary>
        <SourcePicker port={port} generation={generation} movementId={record?.id ?? null} source={draft.source} disabled={frozen} onPick={source => patch({ source })}/>
      </details>
      <label className="pfu-field-label">备注（选填）
        <textarea aria-label="资金流动备注" rows={2} disabled={frozen} value={draft.notes} onChange={e => patch({ notes: e.target.value })}/>
      </label>
      {issues.length > 0 && <div className="pfu-notice" role="alert" ref={issueRef} tabIndex={-1}>{issues.map(i => <p key={i.path + i.code}>{i.path ? `${i.path}：` : ''}{i.message}</p>)}</div>}
      {phase === 'unresolved' && <p className="pfu-notice" role="status">提交结果未知，原请求已保留并冻结重复提交；请稍后通过页面顶部的核对入口确认结果。<button type="button" className="pfu-btn" onClick={() => onClose(false)}>关闭，稍后核对</button></p>}
      <footer className="pfu-dialog-foot">
        <button type="button" className="pfu-btn" disabled={busy} onClick={() => onClose(false)}>{phase === 'unresolved' ? '关闭（结果待核对）' : '取消（不保存）'}</button>
        <button type="submit" className="pfu-btn pfu-primary" disabled={frozen}>{busy ? '保存中…' : record ? '保存修改' : '保存资金流动'}</button>
      </footer>
    </form>
  </dialog>;
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function MovementForm(props: Parameters<typeof MovementFormContent>[0]) {
  return <MovementFormContent key={props.generation + ":" + (props.record?.id ?? "new")} {...props}/>;
}
