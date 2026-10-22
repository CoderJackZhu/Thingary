import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from '../../../asset';
import { linkRepairPreview, linkRestorePreview, linkView } from '../../../link';
import type { LinkCandidate, LinkPurgePreview, LinkRepairPreview, LinkRestoreInput, LinkRestorePreview } from '../../../link';
import { submit, Unresolved } from '../../../wealth';
import { ConfirmSheet, ListGroup, ListRow, Loading, Notice, SegmentedControl } from '../../ui';

/** Closes the sheet; `saved` tells the list to reload. */
type Close = (saved: boolean) => void;
const reread = (e: unknown) => e instanceof Error && e.message.includes('重新读取');

/** Reads a preview once and again on demand; a failed read keeps the message so the sheet can offer a retry. */
function usePreview<T>(read: () => Promise<T>) {
  const [preview, setPreview] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError(''); setPreview(null);
    try { setPreview(await read()); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return { preview, error, setError, loading, load };
}

/** 整组恢复: the same preview and one transaction as the desktop dialog (link_restore). */
export function GroupRestoreSheet({ groupId, name, onClose, onDone }: { groupId: string; name: string; onClose: Close; onDone: (message: string) => void }) {
  const read = usePreview<LinkRestorePreview>(() => linkRestorePreview(groupId));
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), p = read.preview;
  async function confirm() {
    if (!p || busy) return;
    setBusy(true);
    const input: LinkRestoreInput = { request_id: crypto.randomUUID(), generation: p.generation, group_id: groupId, preview: p.preview };
    try { await submit({ command: 'link_restore', input, label: '恢复 ' + p.asset_name }); onDone('已整组恢复这组关联订阅，双方恢复原 ID。'); onClose(true); }
    catch (e) {
      if (e instanceof Unresolved) setStuck(true);
      else if (reread(e)) void read.load().then(() => read.setError(e instanceof Error ? e.message : ''));
      else read.setError(e instanceof Error ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  }
  return <ConfirmSheet title="恢复这组关联订阅？" confirm="整组恢复" busyLabel="正在处理…" busy={busy} disabled={stuck || !p || p.blockers.length > 0} error={stuck ? '恢复结果未确认，请先核对上一次请求。' : read.error} onConfirm={() => void confirm()} onClose={() => onClose(false)}>
    <p className="m-confirm-text">{name}</p>
    {read.loading ? <Loading label="正在读取恢复影响…"/> : p && <>
      <p className="m-confirm-text">将一起恢复「{p.asset_name}」服务档案与付款计划「{p.plan_name}」，原 ID 与历史付款保持不变。</p>
      {p.payments_hidden > 0 && <p className="m-confirm-text">{p.payments_hidden} 笔此前有效的付款会重新参与汇总一次。</p>}
      {p.payments_stay_deleted > 0 && <p className="m-confirm-text">另有 {p.payments_stay_deleted} 笔删除更早的付款保持删除，不会被这组恢复带回来。</p>}
      {p.blockers.map((b, i) => <Notice key={i}>注意：{b}</Notice>)}</>}
  </ConfirmSheet>;
}

/** 永久清除整组: reads the full consequences first and submits the same digest (R7). */
export function GroupPurgeSheet({ groupId, name, onClose, onDone }: { groupId: string; name: string; onClose: Close; onDone: (message: string) => void }) {
  const read = usePreview<LinkPurgePreview>(() => invoke<LinkPurgePreview>('link_purge_preview', { groupId }));
  const [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false), p = read.preview;
  async function confirm() {
    if (!p || busy) return;
    setBusy(true);
    try {
      await submit({ command: 'purge_trash', input: { request_id: crypto.randomUUID(), generation: p.generation, kind: 'link_group', id: groupId, preview: p.preview }, label: '永久清除 ' + p.asset_name });
      onDone(`已永久清除「${p.asset_name}」的关联订阅组。`); onClose(true);
    } catch (e) {
      if (e instanceof Unresolved) { setStuck(true); read.setError(e.message); }
      else if (reread(e)) void read.load().then(() => read.setError(e instanceof Error ? e.message : ''));
      else read.setError(e instanceof Error ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  }
  const outside = !!p?.external_refs.length, blockers = p?.blockers.filter(b => !b.includes('组外档案')) ?? [];
  return <ConfirmSheet title="永久清除这组关联订阅？" confirm="确认永久清除" danger busyLabel="正在处理…" busy={busy} disabled={stuck || !p || p.blockers.length > 0 || outside} error={read.error} onConfirm={() => void confirm()} onClose={() => onClose(false)}>
    <p className="m-confirm-text">{name}</p>
    {read.loading ? <Loading label="正在读取完整清除影响…"/> : p && <>
      <p className="m-confirm-text">将永久移除「{p.asset_name}」服务档案、付款计划「{p.plan_name}」及以下全部事实，删除后无法找回：</p>
      <ListGroup>
        <ListRow title={`付款记录 ${p.payments_total} 笔（含此前单独删除的 ${p.payments_deleted} 笔）`}/>
        <ListRow title={`价格分段 ${p.rate_segments} 段、生效规则 ${p.rule_segments} 段、特殊到期 ${p.period_ends} 项`}/>
        <ListRow title={`备款提醒 ${p.reminders} 条`}/>
      </ListGroup>
      {outside && <Notice>还有 {p.external_refs.length} 个组外档案按 ID 引用这项计划；请先处理那些旧档案，再永久清除这组。</Notice>}
      {blockers.map((b, i) => <Notice key={i}>注意：{b}</Notice>)}
      <p className="m-confirm-text">确认后提交会重新核对全部影响；预览后有付款或引用变化时需要重新读取。</p></>}
  </ConfirmSheet>;
}

/** 核对历史关联记录: a deleted half whose partner is still around (or several candidates) is repaired, never copied. */
export function RepairSheet({ side, id, onClose, onDone }: { side: 'virtual' | 'plan'; id: string; onClose: Close; onDone: (message: string) => void }) {
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]), [partner, setPartner] = useState<string | null>(null), [action, setAction] = useState<'restore_pair' | 'register_group'>('restore_pair');
  const [preview, setPreview] = useState<LinkRepairPreview | null>(null), [busy, setBusy] = useState(true), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  async function load(choice = partner, mode = action) {
    setBusy(true); setPreview(null); setNotice('');
    try {
      const view = await linkView(side, id);
      setCandidates(view.candidates);
      if (side === 'plan' && view.candidates.length > 1 && !choice) return;
      setPreview(await linkRepairPreview(side, id, choice, mode));
    } catch (e) { setNotice(errorMessage(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy || stuck || preview.blockers.length) return;
    setBusy(true);
    try {
      await submit({ command: 'link_reconcile', input: { request_id: crypto.randomUUID(), generation: preview.generation, action, asset_id: preview.asset_id, plan_id: preview.plan_id, asset_expected_revision: preview.asset_revision, plan_expected_revision: preview.plan_revision, preview: preview.preview }, label: '核对历史关联 ' + preview.asset_name });
      onDone(action === 'restore_pair' ? '已恢复关联双方；此前单独删除的付款保持删除。' : '已登记为一组，之后可整组恢复或清除。'); onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); } finally { setBusy(false); }
  }
  return <ConfirmSheet title="核对历史关联记录" confirm={action === 'restore_pair' ? '确认恢复关联双方' : '确认归为删除组'} busyLabel="正在处理…" busy={busy} disabled={stuck || !preview || preview.blockers.length > 0} error={notice} onConfirm={() => void confirm()} onClose={() => onClose(false)}
    message="按原有 ID 处理服务档案与付款计划，不创建或复制付款。">
    {candidates.length > 1 && <ListGroup title="选择历史档案" footer="多个已删档案曾引用这项计划，请明确选择一个">
      {candidates.map(c => <ListRow key={c.id} icon={partner === c.id ? 'check' : 'trash'} tone={partner === c.id ? 'positive' : 'neutral'} title={c.name} subtitle={`${c.deleted_at.slice(0, 10)} · ${c.id}`} disabled={busy || stuck} onClick={() => { setPartner(c.id); void load(c.id); }}/>)}
    </ListGroup>}
    <SegmentedControl label="历史关联处理方式" items={[{ id: 'restore_pair', label: '恢复关联双方' }, { id: 'register_group', label: '归为删除组' }]} value={action} onChange={v => { const mode = v as typeof action; setAction(mode); void load(partner, mode); }}/>
    {busy && !preview && <Loading label="正在读取影响…"/>}
    {preview && <>
      <p className="m-confirm-text">服务档案「{preview.asset_name}」：{preview.asset_deleted ? '已删除' : '有效'}；付款计划「{preview.plan_name}」：{preview.plan_deleted ? '已删除' : '有效'}。</p>
      <p className="m-confirm-text">{action === 'restore_pair' ? '恢复后双方均有效，原有付款重新参与汇总一次。' : '将剩余有效对象一并移入最近删除，登记为可整组恢复的删除组。'}已记录付款 {preview.paid_count} 笔（{money(preview.paid_cents)}），本期不付 {preview.skipped_count} 笔；此前单独删除的 {preview.payments_stay_deleted} 笔付款保持删除。</p>
      {preview.blockers.map(b => <Notice key={b}>{b}</Notice>)}</>}
  </ConfirmSheet>;
}
