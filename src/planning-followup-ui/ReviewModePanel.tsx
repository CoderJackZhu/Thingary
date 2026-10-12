// 区间核对方式对话框（契约 §4；设计 §18.4/§18.5）：手填合计与资金流动明细汇总是两种
// 互斥的权威来源，禁止相加。切换前展示旧合计、新合计、差额与受影响结果，明确确认后才保存，
// 取消不写入；保存新模式前需重新确认完整性。合计、差额、结果与 basis_key 全部来自端口，
// 界面只原样提交，不在保存前自行重算或拼接键。
import { useEffect, useRef, useState } from 'react';
import type { FollowupIssue, FollowupRead, FollowupWriteContext, PlanningFollowupPortV1, ReviewDraftV1, ReviewPairV1, ReviewPreviewV1 } from '../planning-followup-contract.ts';
import { reasonLabel, statusLabel } from '../investment-review/model.ts';
import { centsFromYuanText, followupReasonText, formatCents, formatSignedCents, intervalLabel, yuanTextFromCents } from './model.ts';

type UIMode = 'manual' | 'movements';
type UIDraft = { mode: UIMode; inflow: string; outflow: string; confirmed: boolean; unsupported: boolean; notes: string };

const draftOf = (draft: ReviewDraftV1, confirmation: ReviewPreviewV1['confirmation']): UIDraft => ({
  mode: draft.selection.mode,
  inflow: draft.selection.mode === 'manual' ? draft.selection.inflow_cents ?? '' : '',
  outflow: draft.selection.mode === 'manual' ? draft.selection.outflow_cents ?? '' : '',
  confirmed: confirmation === 'confirmed' && draft.confirmed_complete, unsupported: draft.unsupported_movements, notes: draft.notes,
});
const toDraft = (d: UIDraft): ReviewDraftV1 => ({
  selection: d.mode === 'manual'
    ? { mode: 'manual', inflow_cents: d.inflow === '' ? null : d.inflow, outflow_cents: d.outflow === '' ? null : d.outflow }
    : { mode: 'movements' },
  confirmed_complete: d.confirmed && !d.unsupported, unsupported_movements: d.unsupported, notes: d.notes,
});

function NullableAmount({ label, hint, value, disabled, onChange }: { label: string; hint: string; value: string; disabled: boolean; onChange: (cents: string) => void }) {
  const [raw, setRaw] = useState(() => yuanTextFromCents(value));
  useEffect(() => { if ((centsFromYuanText(raw) ?? null) !== value) setRaw(yuanTextFromCents(value)); }, [value]);
  return <label className="pfu-field-label">{label}
    <input className="pfu-amount" aria-label={label} inputMode="decimal" placeholder="未知可先留空；零须显式填 0" disabled={disabled} value={raw}
      onChange={e => { const cents = centsFromYuanText(e.target.value); if (cents === null) return; setRaw(e.target.value); onChange(cents); }}/>
    <small className="pfu-hint">{hint}</small>
  </label>;
}

function localIssues(d: UIDraft): FollowupIssue[] {
  const issues: FollowupIssue[] = [];
  if (d.mode === 'manual') {
    for (const [key, value] of [['inflow', d.inflow], ['outflow', d.outflow]] as const)
      if (value !== '' && (value === '0' ? false : !/^(0|[1-9][0-9]{0,17})$/.test(value)))
        issues.push({ path: key, code: 'invalid_cents', message: '金额必须是规范的非负整数分。' });
    if (d.confirmed && (d.inflow === '' || d.outflow === ''))
      issues.push({ path: 'confirmed', code: 'confirmed_without_amount', message: '确认完整前需要两个明确的合计：未知请先留空并取消确认，零必须显式填 0。' });
  }
  if (d.confirmed && d.unsupported)
    issues.push({ path: 'confirmed', code: 'confirmed_with_unsupported', message: '存在未支持情形时不能确认简单损益完整，可保存备注后待复核。' });
  if ([...d.notes].length > 500)
    issues.push({ path: 'notes', code: 'invalid_notes', message: '备注超过 500 字。' });
  return issues;
}

function ReviewModeDialogContent({ port, generation, pair, blocked = false, onClose, onPending, movementsEnabled = true }: {
  port: PlanningFollowupPortV1; generation: string; pair: ReviewPairV1; blocked?: boolean; onClose: (saved: boolean) => void; onPending: () => void; movementsEnabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), issueRef = useRef<HTMLDivElement>(null);
  const [read, setRead] = useState<FollowupRead<{ draft: ReviewDraftV1; preview: ReviewPreviewV1 }> | null>(null);
  const [draft, setDraft] = useState<UIDraft | null>(null);
  const [intent, setIntent] = useState<{ target: UIMode; preview: ReviewPreviewV1 } | null>(null), [intentBusy, setIntentBusy] = useState(false);
  const [issues, setIssues] = useState<FollowupIssue[]>([]), [notice, setNotice] = useState('');
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved' | 'unresolved'>('idle');
  const [retry, setRetry] = useState(0);
  const [previewRead, setPreviewRead] = useState<{ key: string; value: ReviewPreviewV1 } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const draftKey = draft ? JSON.stringify(toDraft(draft)) : '';
  useEffect(() => {
    let live = true; setPreviewRead(null); setPreviewError('');
    if (draft) port.previewReview(pair, toDraft(draft), generation).then(v => {
      if (!live) return;
      if (v.status === 'ready' && v.value.generation === generation) setPreviewRead({ key: draftKey, value: v.value });
      else setPreviewError(v.status === 'ready' ? '资料库已变化，请关闭后重读。' : v.message);
    }).catch(e => { if (live) setPreviewError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [port, generation, pair.from_snapshot_id, pair.to_snapshot_id, draftKey, movementsEnabled]);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { dialogRef.current?.showModal(); return () => dialogRef.current?.close(); }, []);
  useEffect(() => { if (issues.length) issueRef.current?.focus(); }, [issues]);

  const reread = async () => {
    const next = await port.readReview(pair, generation);
    if (!mounted.current) return false;
    if (next.status === 'ready' && next.value.preview.generation !== generation) { setRead({ status: 'error', code: 'GENERATION_MISMATCH', message: '资料库已变化，请关闭后重新打开。' }); return false; }
    setRead(next);
    if (next.status === 'ready') setDraft(draftOf(next.value.draft, next.value.preview.confirmation));
    return next.status === 'ready';
  };
  useEffect(() => {
    let live = true; setRead(null); setDraft(null); setIntent(null); setIssues([]); setNotice('');
    port.readReview(pair, generation).then(v => {
      if (!live) return;
      if (v.status === 'ready' && v.value.preview.generation !== generation) { setRead({ status: 'error', code: 'GENERATION_MISMATCH', message: '资料库已变化，请关闭后重新打开。' }); return; }
      setRead(v); if (v.status === 'ready') setDraft(draftOf(v.value.draft, v.value.preview.confirmation));
    }).catch(e => { if (live) setRead({ status: 'error', code: 'READ_ERROR', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [port, generation, pair.from_snapshot_id, pair.to_snapshot_id, retry, movementsEnabled]);
  const busy = phase === 'saving' || intentBusy, frozen = busy || phase === 'unresolved' || phase === 'saved' || blocked;
  const patch = (fields: Partial<UIDraft>) => setDraft(d => d && { ...d, ...fields });

  function switchMode(target: UIMode) {
    if (!draft || frozen || target === draft.mode || target === 'movements' && !movementsEnabled) return;
    setIntentBusy(true); setIssues([]);
    const candidate: UIDraft = { ...draft, mode: target, confirmed: false }; // 切换后需重新确认完整性
    port.previewReview(pair, toDraft(candidate), generation).then(v => {
      if (!mounted.current) return;
      if (v.status === 'ready' && v.value.generation === generation) setIntent({ target, preview: v.value });
      else setIssues([{ path: 'selection', code: v.status === 'error' ? v.code : 'PREVIEW_UNAVAILABLE', message: v.status === 'ready' ? '资料库已变化，请重试。' : v.status === 'error' ? v.message : v.message }]);
    }).catch(e => setIssues([{ path: 'selection', code: 'PREVIEW_ERROR', message: e instanceof Error ? e.message : String(e) }]))
      .finally(() => { if (mounted.current) setIntentBusy(false); });
  }

  async function saveDraft(next: UIDraft) {
    if (!read || read.status !== 'ready' || lock.current || frozen || next.mode === 'movements' && !movementsEnabled) return;
    const local = localIssues(next);
    if (local.length) { setIssues(local); return; }
    const contractDraft = toDraft(next);
    lock.current = true; setPhase('saving'); setIssues([]);
    try {
      // 保存用户已看到的预览与打开编辑器时的修订，不能偷偷刷新依据再覆盖。
      if (!previewRead || previewRead.key !== JSON.stringify(contractDraft) || previewRead.value.result.status === 'unavailable' || previewRead.value.result.status === 'invalid') return;
      const context: FollowupWriteContext = { generation, request_id: crypto.randomUUID(), expected_revision: read.value.preview.revision };
      const result = await port.saveReview(pair, contractDraft, previewRead.value.basis_key, context);
      if (!mounted.current) return;
      if (result.status === 'rejected') { setIssues(result.issues); return; }
      if (result.status === 'unresolved') { setPhase('unresolved'); onPending(); return; }
      setIntent(null);
      try { if (await reread()) { setPhase('idle'); onClose(true); return; } }
      catch (e) { void e; }
      setPhase('saved'); setNotice('已保存，刷新失败：请关闭后重新打开核对，不要重复提交。');
    } catch (e) { if (mounted.current) setIssues([{ path: '', code: 'SAVE_ERROR', message: e instanceof Error ? e.message : String(e) }]); } finally { lock.current = false; if (mounted.current) setPhase(p => p === 'saving' ? 'idle' : p); }
  }

  const preview = previewRead?.key === draftKey ? previewRead.value : read?.status === 'ready' ? read.value.preview : null;
  const previewReady = previewRead?.key === draftKey;
  const result = previewReady ? preview?.result : null;
  const totals = (t: { inflow_cents: string | null; outflow_cents: string | null } | null) => !t ? null : `转入 ${t.inflow_cents === null ? '未知' : formatCents(t.inflow_cents)} · 转出 ${t.outflow_cents === null ? '未知' : formatCents(t.outflow_cents)}`;
  return <dialog ref={dialogRef} className="pfu-dialog pfu-review-dialog" aria-labelledby="pfu-review-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(phase === 'saved'); }}>
    <form noValidate onSubmit={e => { e.preventDefault(); if (draft) void saveDraft(draft); }}>
      <header className="pfu-dialog-head">
        <div><p className="pfu-eyebrow">财富 · 财务复盘</p><h3 id="pfu-review-heading">核对区间资金</h3>
          {preview && <p className="pfu-meta">区间 {intervalLabel(preview.input.from.date, preview.input.to.date)} · 投资范围 {preview.input.from.members.length} 个账户{preview.review_id !== null ? ` · 已有核对记录（${preview.saved_mode === 'movements' ? '明细汇总' : '手填合计'}）` : ' · 尚无核对记录'}</p>}</div>
        <button type="button" className="pfu-close" aria-label="关闭区间核对" disabled={busy} onClick={() => onClose(phase === 'saved')}>×</button>
      </header>
      {!read ? <p className="pfu-state" role="status">正在读取核对方式…</p>
        : read.status === 'disabled' ? <div className="pfu-state pfu-error" role="status"><h4>区间核对暂不可用</h4><p>{read.message}</p></div>
        : read.status === 'error' ? <div className="pfu-state pfu-error" role="alert"><h4>核对资料读取失败</h4><p>{read.message}</p><button type="button" className="pfu-btn" disabled={busy} onClick={() => setRetry(n => n + 1)}>重新读取</button></div>
        : draft && preview && <>
          <p className={`pfu-confirm ${preview.confirmation}`} role="note">{confirmationChip(preview)}</p>
          <fieldset className="pfu-mode"><legend>核对方式（合计与明细二选一，不相加）</legend>
            <div className="pfu-segments" role="group" aria-label="核对方式">
              <button type="button" aria-pressed={draft.mode === 'manual'} disabled={frozen || intent !== null} onClick={() => switchMode('manual')}>手填合计</button>
              <button type="button" aria-pressed={draft.mode === 'movements'} disabled={frozen || intent !== null || !movementsEnabled} onClick={() => switchMode('movements')}>由资金流动明细汇总</button>
            </div>
            {!movementsEnabled && <p role="status">资金流动记录已关闭；明细模式保留但暂不可用，可明确切换到手填合计。</p>}
            {draft.mode === 'manual' ? <>
              <NullableAmount label="期间从范围外转入的资金合计（元）" hint="不含已留在范围内的利息／分红；本人投资账户之间互转在组合内抵消，不填入。" value={draft.inflow} disabled={frozen} onChange={v => patch({ inflow: v })}/>
              <NullableAmount label="期间转到范围外的资金合计（元）" hint="包含取回资金及转出的现金收益；不含应计入损益的投资手续费／税费。" value={draft.outflow} disabled={frozen} onChange={v => patch({ outflow: v })}/>
              <p className="pfu-muted small">明细只作旁证，不会自动修改这里的合计；新增相关明细后需要重新核对。</p>
            </> : <>
              <dl className="pfu-totals">
                <div><dt>明细汇总合计（只读）</dt><dd>{totals(preview.selected_totals) ?? '暂不可用（未读取合计）'}</dd></div>
                <div><dt>纳入流动条数</dt><dd>{preview.movement_count === null ? '暂不可用（未读取明细）' : `${preview.movement_count} 条`}</dd></div>
              </dl>
              <p className="pfu-muted small">合计按日期与投资范围从资金流动汇总，仅供查看；明细模式不再叠加手填数字。没有明细不能证明没有流动，空明细须明确确认后才能按 0／0 核对。</p>
            </>}
            <label className="pfu-choice"><input type="checkbox" disabled={frozen} checked={draft.unsupported} onChange={e => patch({ unsupported: e.target.checked, confirmed: false })}/>
              <span>期间有证券实物转入转出、杠杆借款或未解释的余额调整<small className="pfu-muted">（勾选后不能确认简单损益完整）</small></span></label>
            <label className="pfu-choice"><input type="checkbox" disabled={frozen || draft.unsupported || draft.mode === 'movements' && !movementsEnabled} checked={draft.confirmed && !draft.unsupported} onChange={e => patch({ confirmed: e.target.checked })}/>
              <span>已核对本区间相关资金流动全部记全<small className="pfu-muted">（0／0 也必须经此确认；未确认只显示余额变化与“损益待核对”）</small></span></label>
            <label className="pfu-field-label">备注（选填）<textarea aria-label="核对备注" rows={2} disabled={frozen} value={draft.notes} onChange={e => patch({ notes: e.target.value })}/></label>
          </fieldset>
          {intent && <div className="pfu-switch-preview" role="alert">
            <h4>切换核对方式前请核对差额</h4>
            <p>将从「{intent.target === 'manual' ? '明细汇总' : '手填合计'}」改为「{intent.target === 'manual' ? '手填合计' : '明细汇总'}」；原合计保留审计，不按差额自动生成流动。</p>
            <dl className="pfu-totals">
              <div><dt>原合计（已保存）</dt><dd>{totals(intent.preview.previous_totals) ?? '无历史核对'}</dd></div>
              <div><dt>新合计（切换后）</dt><dd>{totals(intent.preview.selected_totals) ?? '暂不可用（未读取合计）'}</dd></div>
              <div><dt>差额（新 − 旧）</dt><dd>{intent.preview.difference.inflow_cents === null || intent.preview.difference.outflow_cents === null ? '未知（存在未知合计）' : `转入 ${formatSignedCents(intent.preview.difference.inflow_cents)} · 转出 ${formatSignedCents(intent.preview.difference.outflow_cents)}`}</dd></div>
              <div><dt>纳入流动条数</dt><dd>{intent.preview.movement_count === null ? '暂不可用（未读取明细）' : `${intent.preview.movement_count} 条`}</dd></div>
            </dl>
            <p role="status">切换后结果：{intent.preview.result.status === 'ready' ? formatSignedCents(intent.preview.result.value.profit_cents) : statusLabel[intent.preview.result.status]}</p>
            <p className="pfu-muted small">切换后完整性确认会重置，需要重新确认；受影响结果以预览为准，保存时会检查依据是否变化。</p>
            <div className="pfu-actions-row">
              <button type="button" className="pfu-btn" disabled={busy} onClick={() => setIntent(null)}>取消（不切换）</button>
              <button type="button" className="pfu-btn pfu-primary" disabled={busy} onClick={() => { const next = { ...draft, mode: intent.target, confirmed: false }; setDraft(next); setIntent(null); }}>确认切换（保存前需重新核对）</button>
            </div>
          </div>}
          {result && <details className="pfu-result" open><summary>核对预览（按当前表单与读取到的事实；不是已保存结果）</summary>
            {result.status === 'ready' ? <dl className="pfu-totals">
              <div><dt>{statusLabel.ready}</dt><dd><strong>{formatSignedCents(result.value.profit_cents)}</strong></dd></div>
              <div><dt>余额变化</dt><dd>{formatSignedCents(result.value.change_cents)}</dd></div>
              <div><dt>计算式</dt><dd>期末 − 期初 − 转入 + 转出</dd></div>
            </dl> : <p><span className="pfu-tag warn">{statusLabel[result.status]}</span> {result.status === 'invalid' ? result.issues.map(i => i.message).join('；') : result.reasons.map(r => reasonLabel[r] ?? r).join('；')}</p>}
            {preview.reasons.length > 0 && <ul className="pfu-reasons">{preview.reasons.map(i => <li key={i.path + i.code}>{followupReasonText[i.code] ?? i.message}</li>)}</ul>}
            <p className="pfu-muted small">例：投资账户赚 5000、转出 8000，余额减少 3000——损益 +5000，提款不等于消费；直接从投资账户支付生活费属于投资范围流出。范围外账户另付的投资费用不自动计入所选组合净损益，结果未包含该成本。</p>
          </details>}
        </>}
      {issues.length > 0 && <div className="pfu-notice" role="alert" ref={issueRef} tabIndex={-1}>{issues.map(i => <p key={i.path + i.code}>{i.path ? `${i.path}：` : ''}{i.message}</p>)}</div>}
      {previewError && <p className="pfu-notice" role="alert">预览失败：{previewError}。请关闭后重新读取。</p>}
      {draft && !previewReady && !previewError && <p role="status">正在更新核对预览…</p>}
      {notice && <p className="pfu-notice" role="status">{notice}</p>}
      {phase === 'unresolved' && <p className="pfu-notice" role="status">提交结果未知，原请求已保留并冻结重复提交；请通过页面顶部的核对入口确认结果。<button type="button" className="pfu-btn" onClick={() => onClose(false)}>关闭，稍后核对</button></p>}
      {read?.status === 'ready' && draft && <footer className="pfu-dialog-foot">
        <button type="button" className="pfu-btn" disabled={busy} onClick={() => onClose(phase === 'saved')}>{phase === 'saved' ? '关闭（已保存）' : phase === 'unresolved' ? '关闭（结果待核对）' : '取消（不保存本次修改）'}</button>
        <button type="submit" className="pfu-btn pfu-primary" disabled={frozen || intent !== null || !previewReady || draft.mode === 'movements' && !movementsEnabled || result?.status === 'unavailable' || result?.status === 'invalid'}>{busy ? '保存中…' : '保存核对方式'}</button>
      </footer>}
    </form>
  </dialog>;
}

/** 核对状态与假设确认分开：这里说明区间核对来源的确认情况。 */
function confirmationChip(preview: ReviewPreviewV1): string {
  if (preview.confirmation === 'unavailable') return '明细核对暂不可用：资金流动记录已关闭，原方式保留；没有读取明细或确认完整性。';
  if (preview.confirmation === 'confirmed') return '本区间已确认核对完整；相关流动或来源变化会使它回到待核对。';
  if (preview.confirmation === 'needs_review') return '本区间待核对：相关流动、端点或来源已变化，原有确认失效。';
  return '本区间尚未核对：损益未知，不显示就绪结果。';
}

/** A changed library or interval starts a fresh editor; old async work stays unmounted. */
export function ReviewModeDialog(props: Parameters<typeof ReviewModeDialogContent>[0]) {
  return <ReviewModeDialogContent key={props.generation + ":" + props.pair.from_snapshot_id + ":" + props.pair.to_snapshot_id} {...props}/>;
}
