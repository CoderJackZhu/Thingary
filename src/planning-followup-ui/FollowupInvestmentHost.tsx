import { useEffect, useRef, useState } from 'react';
import type { PlanningFollowupPortV1, ReviewRecordV1, ReviewPreviewV1 } from '../planning-followup-contract';
import { InvestmentReviewCard } from '../investment-review/InvestmentReviewCard';
import type { ReviewOuter } from '../investment-review/InvestmentReviewCard';
import { InvestmentReviewDisclosure, reviewDisclosureState } from '../investment-review/InvestmentReviewDisclosure';
import { FollowupSection } from './FollowupSection';
import { followupReasonText } from './model';
import type { Income } from '../plan';
import { incomeCategories } from '../income-classification';
import type { FinancePeriod } from '../finance-contract';
import { money } from '../asset';

/** Port-backed host: current result and history share the same mode-aware native reader. */
export function FollowupInvestmentHost({ port, generation, fromSnapshotId, toSnapshotId, writeVersion, accountNames = {}, blocked, reload, onPending, onEditingChange, today = '', incomes, movementPresentation = 'records', movementsEnabled = true, onViewAllMovements, receiptResolutionVersion = 0, onPreviewChange, pendingReceipt = false }: {
  port: PlanningFollowupPortV1; generation: string; fromSnapshotId: string | null; toSnapshotId: string; writeVersion: number;
  accountNames?: Record<string, string>; blocked: boolean; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void; today?: string; incomes: Income[] | null; pendingReceipt?: boolean;
  onPreviewChange?: (preview: { fromSnapshotId: string; toSnapshotId: string; result: import('../investment-review/model').InvestmentReviewResultV1 } | null) => void; receiptResolutionVersion?: number; movementPresentation?: 'records' | 'review'; movementsEnabled?: boolean; onViewAllMovements?: (period: FinancePeriod, accountIds: string[]) => void;
}) {
  const [pair, setPair] = useState({ from: fromSnapshotId, to: toSnapshotId });
  const [outer, setOuter] = useState<ReviewOuter>({ status: 'loading' });
  const [preview, setPreview] = useState<ReviewPreviewV1 | null>(null);
  const [records, setRecords] = useState<ReviewRecordV1[] | null>(null), [listError, setListError] = useState('');
  const [retry, setRetry] = useState(0), [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [editing, setEditing] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onEditingChange(editing || busy || uncertain); return () => onEditingChange(false); }, [editing, busy, uncertain, onEditingChange]);
  useEffect(() => { setPair({ from: fromSnapshotId, to: toSnapshotId }); }, [generation, fromSnapshotId, toSnapshotId]);
  useEffect(() => {
    let live = true; onPreviewChange?.(null); setPreview(null); setRecords(null); setListError(''); setOuter(pair.from ? { status: 'loading' } : { status: 'empty' });
    port.listReviews(generation).then(v => { if (!live) return; if (v.status !== 'ready') throw Error(v.message); if (v.value.generation !== generation) throw Error('资料库已变化，请重新读取。'); setRecords(v.value.records); }).catch(e => { if (live) setListError(String(e)); });
    if (pair.from) port.readReview({ from_snapshot_id: pair.from, to_snapshot_id: pair.to }, generation).then(v => {
      if (!live) return;
      if (v.status !== 'ready') throw Error(v.message);
      if (v.value.preview.generation !== generation) throw Error('资料库已变化，请重新读取。');
      const p = v.value.preview; onPreviewChange?.({ fromSnapshotId: pair.from!, toSnapshotId: pair.to, result: p.result }); setPreview(p); setOuter({ status: 'ready', input: p.input, result: p.result });
    }).catch(e => { if (live) setOuter({ status: 'error', code: 'READ_ERROR', message: String(e) }); });
    return () => { live = false; };
  }, [port, generation, pair.from, pair.to, writeVersion, retry, movementsEnabled]);
  // Only increment this signal after verifying the original request and clearing its pending receipt.
  const uncertainVersion = useRef(receiptResolutionVersion);
  useEffect(() => { if (uncertain && !blocked && receiptResolutionVersion > uncertainVersion.current) { setUncertain(false); setNotice(''); } }, [receiptResolutionVersion, blocked, uncertain]);
  const frozen = blocked || busy || uncertain;
  const saved = () => { setRetry(n => n + 1); reload(); };
  async function trash(r: ReviewRecordV1) {
    if (lock.current || frozen || editing) return;
    lock.current = true; setBusy(true); setNotice('');
    try {
      const result = await port.setReviewDeleted(r.id, !r.deleted, { generation, request_id: crypto.randomUUID(), expected_revision: r.revision });
      if (!mounted.current) return;
      if (result.status === 'rejected') setNotice(result.issues.map(i => i.message).join('；'));
      else if (result.status === 'unresolved') { uncertainVersion.current = receiptResolutionVersion; setUncertain(true); onPending(); setNotice('提交结果未知，原请求已保留；请通过页面顶部核对结果。'); }
      else { setDeleting(null); saved(); }
    } catch (e) { if (mounted.current) setNotice(String(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const hints = preview && incomes?.filter(i => i.fields.date > preview.input.from.date && i.fields.date <= preview.input.to.date && ['interest', 'cash_dividend', 'other_investment'].includes(i.fields.category ?? ''));
  const disclosure = reviewDisclosureState(outer);
  const disclosureLabel = preview && preview.confirmation !== 'confirmed' ? { unconfirmed: '尚未确认', needs_review: '待重新确认', unavailable: '暂不可用' }[preview.confirmation] : disclosure.label;
  const historyPending = records?.filter(r => !r.deleted && r.confirmation !== 'confirmed').length ?? 0;
  const messages = [disclosure.attention, ...new Set(preview?.reasons.map(reason => followupReasonText[reason.code] ?? reason.message) ?? []), preview?.confirmation === 'needs_review' ? '需重新确认本区间资金流动，原有确认已失效。' : '', preview?.confirmation === 'unavailable' ? '本区间核对暂不可用，原核对方式保留。' : '', preview?.saved_mode && preview.confirmation === 'unconfirmed' ? '已保存的本区间资金流动尚未确认完整。' : '', listError && `已保存投资核对区间读取失败：${listError}`, historyPending ? `有 ${historyPending} 个已保存投资核对区间还需确认资金流动，请查看已保存区间。` : '', preview && incomes === null ? '投资现金收入明细读取失败，请展开查看。' : '', notice, pendingReceipt || uncertain ? '存在未确认的保存结果，请通过页面顶部“核对结果”确认。' : ''].filter((m): m is string => !!m);
  return <section aria-label="投资区间复盘"><InvestmentReviewDisclosure label={disclosureLabel} messages={messages} editing={editing || busy || deleting !== null}>
    <InvestmentReviewCard accountNames={accountNames} outer={outer} disabled={frozen}/>
    {preview && <p className="muted small">核对方式：{preview.saved_mode === 'movements' ? '资金流动明细汇总' : preview.saved_mode === 'manual' ? '手填合计' : '尚未保存'}。{preview.confirmation === 'confirmed' ? '已核对' : preview.confirmation === 'needs_review' ? '需重新确认本区间资金流动' : preview.confirmation === 'unavailable' ? '暂不可用' : '还未确认本区间资金流动'}。</p>}
    {!!preview?.reasons.length && <ul className="pfu-reasons">{preview.reasons.map(i => <li key={i.code + i.path}>{followupReasonText[i.code] ?? i.message}</li>)}</ul>}
    <FollowupSection port={port} generation={generation} pair={pair.from ? { from_snapshot_id: pair.from, to_snapshot_id: pair.to } : null} writeVersion={writeVersion + retry} today={today} blocked={frozen} onPending={onPending} onEditingChange={setEditing} onSaved={saved} receiptResolutionVersion={receiptResolutionVersion} movementPresentation={movementPresentation} movementsEnabled={movementsEnabled} onViewAllMovements={onViewAllMovements} input={preview?.input}/>
    {outer.status === 'error' && <button className="ui-btn" disabled={busy} onClick={() => setRetry(n => n + 1)}>重新读取投资区间</button>}
    {(pair.from !== fromSnapshotId || pair.to !== toSnapshotId) && <button className="ui-btn" disabled={frozen || editing} onClick={() => setPair({ from: fromSnapshotId, to: toSnapshotId })}>返回本期区间</button>}
    {preview && <details><summary>已记录投资现金收入（仅供核对）</summary><p className="muted small">转到范围外的分红已包含在转出合计中，不再加进总损益。记录存在不代表资金流动已核对完整。</p>{incomes === null ? <p role="alert">收入明细读取失败。</p> : !hints?.length ? <p>这一期间没有已记录的投资现金收入。</p> : <ul>{hints.map(i => <li key={i.id}>{i.fields.date} · {incomeCategories[i.fields.category ?? 'unclassified']} · {money(i.fields.net_cents)}{i.fields.notes && ` · ${i.fields.notes}`}</li>)}</ul>}</details>}
    <details><summary>已保存的投资核对区间（含最近删除）</summary><p className="muted small">插入中间盘点不会拆分旧核对。替换重叠区间前，请先明确删除旧记录。</p>
      {listError ? <p role="alert">{listError}<button disabled={busy} onClick={() => setRetry(n => n + 1)}>重试</button></p> : records === null ? <p role="status">正在读取已保存区间…</p> : !records.length ? <p>还没有已保存的投资核对。</p> : <ul>{records.map(r => <li key={r.id}>
        {r.from_date} → {r.to_date} · {r.mode === 'movements' ? '明细汇总' : '手填合计'} · {r.deleted ? '已删除' : r.confirmation === 'confirmed' ? '已核对' : '还需确认本区间资金流动'}
        {!r.deleted && <button className="ui-btn" disabled={frozen || editing} onClick={() => setPair({ from: r.pair.from_snapshot_id, to: r.pair.to_snapshot_id })}>查看原区间</button>}
        {r.deleted ? <button className="ui-btn" disabled={frozen || editing} onClick={() => void trash(r)}>恢复核对</button> : deleting === r.id ? <><button className="ui-btn" disabled={frozen || editing} onClick={() => void trash(r)}>确认删除核对</button><button className="ui-btn" disabled={busy} onClick={() => setDeleting(null)}>取消</button></> : <button className="ui-btn" disabled={frozen || editing} onClick={() => setDeleting(r.id)}>删除核对</button>}
      </li>)}</ul>}
    </details>
    {notice && <p role="alert" className="notice">{notice}</p>}
  </InvestmentReviewDisclosure></section>;
}
