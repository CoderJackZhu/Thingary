import type { FinancePeriod } from './finance-contract';
import { FollowupInvestmentHost } from './planning-followup-ui/FollowupInvestmentHost';
import { incomeCategories } from './income-classification';
import { useEffect, useRef, useState } from 'react';
import { errorMessage, money } from './asset';
import type { Income } from './plan';
import { readInvestmentReview, listInvestmentReviews, saveInvestmentReview, trashInvestmentReview, storedPending, Unresolved } from './wealth';
import type { InvestmentReviewRead, InvestmentReviewRecord } from './wealth';
import { InvestmentReviewCard } from './investment-review/InvestmentReviewCard';
import type { ReviewOuter } from './investment-review/InvestmentReviewCard';
import { InvestmentReviewDisclosure, reviewDisclosureState } from './investment-review/InvestmentReviewDisclosure';
import { InvestmentFlowDialog } from './investment-review/InvestmentFlowDialog';
import { FollowupSection } from './planning-followup-ui/FollowupSection';
import type { PlanningFollowupPortV1 } from './planning-followup-contract';
import { draftFromFlow, draftToFlowPatch, parseReviewInput, parseReviewResult } from './investment-review/model';
import type { FieldIssueV1, FlowDraft } from './investment-review/model';
import './investment-review/investment-review.css';
import './planning-followup-ui/planning-followup-ui.css';
import { t } from './i18n.ts';
/** Real Store boundary. All balances, content keys and profit are native results. */
function LegacyInvestmentReviewHost({ generation, fromSnapshotId, toSnapshotId, writeVersion, incomes, accountNames = {}, blocked, reload, onPending, onEditingChange, followupPort, today, movementPresentation = 'records', movementsEnabled = true, onViewAllMovements, receiptResolutionVersion = 0, onPreviewChange, pendingReceipt = false }: {
  generation: string; fromSnapshotId: string | null; toSnapshotId: string; writeVersion: number; incomes: Income[] | null;
  accountNames?: Record<string, string>; blocked: boolean; reload: () => void; onPending: () => void; onEditingChange: (v: boolean) => void;
  followupPort?: PlanningFollowupPortV1; today?: string; pendingReceipt?: boolean;
  onPreviewChange?: (preview: { fromSnapshotId: string; toSnapshotId: string; result: import('./investment-review/model').InvestmentReviewResultV1 } | null) => void; receiptResolutionVersion?: number; movementPresentation?: 'records' | 'review'; movementsEnabled?: boolean; onViewAllMovements?: (period: FinancePeriod, accountIds: string[]) => void;
}) {
  const [pair, setPair] = useState({ from: fromSnapshotId, to: toSnapshotId });
  const [outer, setOuter] = useState<ReviewOuter>({ status: 'loading' });
  const [read, setRead] = useState<InvestmentReviewRead | null>(null), [records, setRecords] = useState<InvestmentReviewRecord[]>([]);
  const [retry, setRetry] = useState(0), [listError, setListError] = useState(''), [listLoading, setListLoading] = useState(true), [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<FlowDraft | null>(null), [issues, setIssues] = useState<FieldIssueV1[]>([]);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), mounted = useRef(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onEditingChange(draft !== null || busy || uncertain); return () => onEditingChange(false); }, [draft !== null, busy, uncertain, onEditingChange]);
  useEffect(() => { setPair({ from: fromSnapshotId, to: toSnapshotId }); setDraft(null); }, [fromSnapshotId, toSnapshotId, generation]);
  useEffect(() => {
    let live = true; onPreviewChange?.(null); setOuter({ status: 'loading' }); setRead(null); setListError(''); setListLoading(true);
    listInvestmentReviews(generation).then(v => { if (!live) return; if (v.generation !== generation) throw Error(t('资料库已变化，请重新读取。')); setRecords(v.records); }).catch(e => { if (live) setListError(errorMessage(e)); }).finally(() => { if (live) setListLoading(false); });
    if (!pair.from) setOuter({ status: 'empty' });
    else readInvestmentReview(generation, pair.from, pair.to).then(v => {
      if (!live) return;
      if (v.generation !== generation || !parseReviewInput(v.input) || !parseReviewResult(v.result)) throw Error(t('投资核对资料格式不兼容或资料库已变化。'));
      onPreviewChange?.({ fromSnapshotId: pair.from!, toSnapshotId: pair.to, result: v.result }); setRead(v); setOuter({ status: 'ready', input: v.input, result: v.result });
    }).catch(e => { if (live) setOuter({ status: 'error', code: 'READ_ERROR', message: errorMessage(e) }); });
    return () => { live = false; };
  }, [generation, pair.from, pair.to, writeVersion, retry, movementsEnabled]);
  const uncertainVersion = useRef(receiptResolutionVersion);
  useEffect(() => { if (uncertain && !busy && !storedPending() && receiptResolutionVersion > uncertainVersion.current) { setUncertain(false); setNotice(''); } }, [busy, uncertain, receiptResolutionVersion]);
  const frozen = busy || uncertain || blocked;
  const edit = () => { if (!read || frozen || storedPending()) return; setIssues([]); setNotice(''); const next = draftFromFlow(read.input.flow); if (read.result.status !== 'ready') next.confirmed = false; setDraft(next); };
  async function save(next: FlowDraft) {
    if (!read || lock.current || frozen || storedPending()) return;
    lock.current = true; setBusy(true); setIssues([]);
    try {
      const flow = read.input.flow;
      await saveInvestmentReview({ request_id: crypto.randomUUID(), generation, id: flow?.id ?? null, expected_revision: flow?.revision ?? null,
        from_snapshot_id: read.input.from.snapshot_id, to_snapshot_id: read.input.to.snapshot_id,
        from_value_key: read.from_value_key, to_value_key: read.to_value_key, fields: draftToFlowPatch(next) });
      if (mounted.current) { setDraft(null); setRetry(n => n + 1); reload(); }
    } catch (e) { if (mounted.current) { if (e instanceof Unresolved) { uncertainVersion.current = receiptResolutionVersion; setUncertain(true); } setIssues([{ path: 'submission', code: 'SAVE_ERROR', message: errorMessage(e) }]); } }
    finally { lock.current = false; if (mounted.current) { setBusy(false); onPending(); } }
  }
  async function trash(record: InvestmentReviewRecord) {
    if (lock.current || frozen || storedPending()) return;
    lock.current = true; setBusy(true); setNotice('');
    try {
      await trashInvestmentReview({ request_id: crypto.randomUUID(), generation, id: record.flow.id, expected_revision: record.flow.revision, deleted: !record.deleted });
      if (mounted.current) { setDeleting(null); setRetry(n => n + 1); reload(); }
    } catch (e) { if (mounted.current) { if (e instanceof Unresolved) { uncertainVersion.current = receiptResolutionVersion; setUncertain(true); } setNotice(errorMessage(e)); } }
    finally { lock.current = false; if (mounted.current) { setBusy(false); onPending(); } }
  }
  const hints = read && incomes ? incomes.filter(i => i.fields.date > read.input.from.date && i.fields.date <= read.input.to.date && ['interest','cash_dividend','other_investment'].includes(i.fields.category ?? 'unclassified')) : [];
  const scope = new Set(read?.input.from.members.filter(m => m.counted).map(m => m.account_id));
  const assigned = (i: Income) => !!i.fields.source_account_id && scope.has(i.fields.source_account_id) && (i.fields.destination === 'retained' || i.fields.destination === 'transferred' && !!i.fields.receiving_account_id);
  const hintsView = <details><summary>{t('已记录投资现金收入（仅供核对）')}</summary><p className="muted small">{t('转到范围外的分红已包含在转出合计中，不再加进总损益。记录存在不代表资金流动已核对完整。')}</p>{incomes === null ? <p role="alert">{t('收入明细读取失败。')}</p> : !hints.length ? <p>{t('这一期间没有已记录的投资现金收入。')}</p> : <ul>{hints.map(i => <li key={i.id}>{i.fields.date} · {incomeCategories[i.fields.category ?? 'unclassified']} · {money(i.fields.net_cents)} · {assigned(i) ? i.fields.destination === 'retained' ? t('留在投资账户') : scope.has(i.fields.receiving_account_id!) ? t('范围内转移') : t('转到范围外') : t('未归属明细')}{i.fields.notes && ` · ${i.fields.notes}`}</li>)}</ul>}</details>;
  const disclosure = reviewDisclosureState(outer);
  const historyPending = records.filter(r => !r.deleted && !r.flow.confirmed_complete).length;
  const messages = [disclosure.attention, listError && t('已保存投资核对区间读取失败：{listError}', { listError }), historyPending ? t('有 {historyPending} 个已保存投资核对区间尚未确认完整，请查看已保存区间。', { historyPending }) : '', read && incomes === null ? t('投资现金收入明细读取失败，请展开查看。') : '', notice, pendingReceipt || uncertain ? t('存在未确认的保存结果，请通过页面顶部“核对结果”确认。') : ''].filter((m): m is string => !!m);
  return <section aria-label={t('投资区间复盘')}><InvestmentReviewDisclosure label={disclosure.label} messages={messages} editing={draft !== null || busy || deleting !== null}>
    <InvestmentReviewCard accountNames={accountNames} outer={outer} onCheckFlow={followupPort ? undefined : edit} onEditFlow={followupPort ? undefined : edit} disabled={frozen}/>
    {/* 注入端口后由 FollowupSection 提供核对方式（手填／明细）与资金流动入口，避免双核对窗。 */}
    {followupPort && <FollowupSection port={followupPort} generation={generation} pair={pair.from ? { from_snapshot_id: pair.from, to_snapshot_id: pair.to } : null} writeVersion={writeVersion} today={today ?? ''} blocked={frozen} onPending={onPending} onEditingChange={onEditingChange} receiptResolutionVersion={receiptResolutionVersion} movementPresentation={movementPresentation} movementsEnabled={movementsEnabled} onViewAllMovements={onViewAllMovements} input={read?.input}/>}
    {outer.status === 'error' && <button className="ui-btn" disabled={busy} onClick={() => setRetry(n => n + 1)}>{t('重新读取投资区间')}</button>}
    {(pair.from !== fromSnapshotId || pair.to !== toSnapshotId) && <button type="button" disabled={frozen || draft !== null} onClick={() => setPair({ from: fromSnapshotId, to: toSnapshotId })}>{t('返回本期区间')}</button>}
    {read && hintsView}
    <details><summary>{t('已保存的投资核对区间（含最近删除）')}</summary>
      <p className="muted small">{t('插入中间盘点不会拆分旧核对。替换重叠区间前，请先明确删除旧记录；恢复冲突会保留原记录并提示。')}</p>
      {listLoading ? <p role="status">{t('正在读取已保存区间…')}</p> : listError ? <p role="alert">{t('读取区间记录失败：{listError}', { listError })}<button disabled={busy} onClick={() => setRetry(n => n + 1)}>{t('重试')}</button></p> : !records.length ? <p>{t('还没有已保存的投资核对。')}</p> : <ul>{records.map(r => <li key={r.flow.id}>
        {r.flow.from_date} → {r.flow.to_date} · {r.deleted ? t('已删除') : t('已保存')}
        {!r.deleted && <button type="button" disabled={frozen || draft !== null} onClick={() => { setPair({ from: r.flow.from_snapshot_id, to: r.flow.to_snapshot_id }); setNotice(''); }}>{t('查看原区间')}</button>}
        {r.deleted ? <button type="button" disabled={frozen || draft !== null} onClick={() => void trash(r)}>{t('恢复核对')}</button> : deleting === r.flow.id ? <><button type="button" disabled={frozen} onClick={() => void trash(r)}>{t('确认删除核对')}</button><button type="button" disabled={busy} onClick={() => setDeleting(null)}>{t('取消')}</button></> : <button type="button" disabled={frozen || draft !== null} onClick={() => setDeleting(r.flow.id)}>{t('删除核对')}</button>}
      </li>)}</ul>}
    </details>
    {notice && <p role="alert" className="notice">{notice}</p>}
    {draft && read && !followupPort && <InvestmentFlowDialog accountNames={accountNames} input={read.input} initial={draft} issues={issues} busy={frozen} canClose={!busy} onDraftChange={setDraft} onSubmit={next => void save(next)} onCancel={() => { if (!busy) setDraft(null); }}>{hintsView}{uncertain && <p className="notice" role="status">{t('原请求已保留，请回到页面顶部核对结果。')}<button type="button" onClick={() => setDraft(null)}>{t('关闭，稍后核对')}</button></p>}</InvestmentFlowDialog>}
    {uncertain && <p className="notice" role="status">{t('提交结果未知，原请求已保留。请通过页面顶部“核对结果”确认。')}{draft && <button type="button" onClick={() => setDraft(null)}>{t('关闭，稍后核对')}</button>}</p>}
  </InvestmentReviewDisclosure></section>;
}

export function InvestmentReviewHost(props: Parameters<typeof LegacyInvestmentReviewHost>[0]) {
  return props.followupPort ? <FollowupInvestmentHost {...props} port={props.followupPort}/> : <LegacyInvestmentReviewHost {...props}/>;
}
