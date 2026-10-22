import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, localDay } from '../../../asset';
import { dayLabel } from '../../format';
import type { AssetRecord } from '../../../asset';
import { linkView } from '../../../link';
import type { PurgeAllPreview, Purged } from '../../../link';
import { writeSavingsGoal } from '../../../savings-goals-port';
import { contentsText, entryDisplay, recordPendingKey, restoresAsGroup, restoresViaWealth, stateText, storedRecordTrash, trashFilters } from '../../../unified-trash';
import type { TrashEntry, TrashPage } from '../../../unified-trash';
import { storedTrash } from '../../../Trash';
import { storedPending, submit } from '../../../wealth';
import { Button, ChipRow, EmptyState, ErrorState, ListGroup, ListRow, Loading, Notice, Sheet } from '../../ui';
import { SettingsShell } from './Shell';
import { GroupPurgeSheet, GroupRestoreSheet, RepairSheet } from './TrashLink';

const assetKey = 'thingary.trash-request.v1';
const pageSize = 100;
const deletedDay = (stamp: string) => { const at = new Date(stamp); return Number.isNaN(at.getTime()) ? stamp.slice(0, 10) : localDay(at); };
const hasCode = (cause: unknown, value: string) => typeof cause === 'object' && cause !== null && 'code' in cause && (cause as { code: unknown }).code === value;

/** 最近删除: every kind of deleted record, restore (with the desktop receipt recovery) and two-step permanent deletion. */
export default function TrashPage() {
  const [filter, setFilter] = useState('all'), [offset, setOffset] = useState(0), [page, setPage] = useState<TrashPage | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [armed, setArmed] = useState<TrashEntry | null>(null);
  const [groupRestore, setGroupRestore] = useState<{ id: string; name: string } | null>(null), [groupPurge, setGroupPurge] = useState<{ id: string; name: string } | null>(null), [repairing, setRepairing] = useState<{ side: 'virtual' | 'plan'; id: string } | null>(null);
  const [clearing, setClearing] = useState<{ preview: PurgeAllPreview | null; error: string } | null>(null);
  const [pendingNote, setPendingNote] = useState(() => !!storedTrash() || !!storedRecordTrash());
  const lock = useRef(false);
  const reload = useCallback(() => setRetry(n => n + 1), []);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    invoke<TrashPage>('list_trash', { query: { filter, offset, search: '' } })
      .then(result => { if (!live) return; if (offset > 0 && !result.items.length) setOffset(Math.max(0, Math.ceil(result.total / pageSize) * pageSize - pageSize)); else setPage(result); })
      .catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filter, offset, retry]);

  async function guarded(action: () => Promise<string | null>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice('');
    try { const message = await action(); if (message) setNotice(message); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); reload(); }
  }
  /** Settle a left-over asset or record restore request whose answer never arrived. */
  const settle = () => guarded(async () => {
    const asset = storedTrash(), record = storedRecordTrash();
    if (asset) {
      const result = await invoke<AssetRecord | null>('saved_request', { request: asset.input.request_id, generation: asset.input.generation });
      localStorage.removeItem(assetKey); setPendingNote(false);
      return result ? '已核对：上次操作已保存。' : '已核对：上次操作未提交，可以重新操作。';
    }
    if (record) {
      const result = await invoke<AssetRecord | null>('saved_record_trash_request', { input: record.input });
      localStorage.removeItem(recordPendingKey); setPendingNote(false);
      return result ? '已核对：上次操作已保存。' : '已核对：上次操作未提交，可以重新操作。';
    }
    setPendingNote(false); return null;
  });

  const restore = (entry: TrashEntry, generation: string) => guarded(async () => {
    const title = entryDisplay(entry).title;
    if (storedPending() || storedTrash() || storedRecordTrash()) return '上次保存结果待核对，请先核对后再恢复。';
    if (entry.kind === 'asset') {
      const record = await invoke<AssetRecord | null>('read_asset', { id: entry.id });
      if (!record) return '找不到这件物品，请重新读取。';
      const input = { request_id: crypto.randomUUID(), generation, asset_id: entry.id, expected_revision: record.asset.revision, deleted: false };
      try { localStorage.setItem(assetKey, JSON.stringify({ input, record, pending: true })); } catch { return '无法暂存操作请求，尚未提交。请检查可用空间。'; }
      try { await invoke('change_trash', { input }); localStorage.removeItem(assetKey); }
      catch (cause) {
        const saved = await invoke<AssetRecord | null>('saved_request', { request: input.request_id, generation }).catch(() => undefined);
        if (saved === undefined) { setPendingNote(true); return '暂时无法确认结果，原请求已保留，请核对。'; }
        localStorage.removeItem(assetKey);
        if (!saved) return errorMessage(cause) + ' 本次操作未提交。';
      }
      return `已恢复「${title}」。`;
    }
    if (entry.kind === 'maintenance' || entry.kind === 'warranty') {
      if (!entry.asset_id) return null;
      const input = { request_id: crypto.randomUUID(), generation, asset_id: entry.asset_id, record_id: entry.id, kind: entry.kind, expected_revision: entry.asset_revision, deleted: false };
      try { localStorage.setItem(recordPendingKey, JSON.stringify({ input, meta: { title: entry.title || title, assetName: entry.asset_name ?? '' }, pending: true })); } catch { return '无法暂存操作请求，尚未提交。请检查可用空间。'; }
      try { await invoke('change_record_trash', { input }); localStorage.removeItem(recordPendingKey); }
      catch (cause) {
        const saved = await invoke<AssetRecord | null>('saved_record_trash_request', { input }).catch(() => undefined);
        if (saved === undefined) { setPendingNote(true); return '暂时无法确认结果，原请求已保留，请核对。'; }
        localStorage.removeItem(recordPendingKey);
        if (!saved) return errorMessage(cause) + (hasCode(cause, 'PARENT_DELETED') ? '' : ' 本次操作未提交。');
      }
      return `已恢复「${title}」。`;
    }
    if (restoresAsGroup(entry.kind)) { setGroupRestore({ id: entry.id, name: title }); return null; }
    if (entry.kind === 'virtual' || entry.kind === 'plan') {
      const link = await linkView(entry.kind, entry.id);
      if (link.group) { setGroupRestore({ id: link.group.id, name: title }); return null; }
      if ((link.asset && link.plan) || link.candidates.length) { setRepairing({ side: entry.kind, id: entry.id }); return null; }
    }
    const base = { request_id: crypto.randomUUID(), generation, id: entry.id, expected_revision: entry.asset_revision, deleted: false };
    if (entry.kind === 'savings_goal') await writeSavingsGoal('savings_goals_trash', base, '恢复存钱目标');
    else await submit({ command: 'wealth_trash', input: { ...base, kind: entry.kind }, label: '恢复' + title });
    return `已恢复「${title}」。`;
  });
  const purge = (entry: TrashEntry, generation: string) => guarded(async () => {
    setArmed(null);
    await invoke('purge_trash', { input: { request_id: crypto.randomUUID(), generation, kind: entry.kind, id: entry.id } });
    return `已永久删除「${entryDisplay(entry).title}」。`;
  });
  async function openClear() {
    setClearing({ preview: null, error: '' });
    try { setClearing({ preview: await invoke<PurgeAllPreview>('purge_all_preview'), error: '' }); } catch (cause) { setClearing({ preview: null, error: errorMessage(cause) }); }
  }
  const clearAll = (preview: PurgeAllPreview) => guarded(async () => {
    try {
      const result = await submit<Purged>({ command: 'purge_trash', input: { request_id: crypto.randomUUID(), generation: preview.generation, kind: null, id: '', preview: preview.preview }, label: '清空最近删除' });
      setClearing(null);
      return `已永久清除 ${result.removed} 项${result.kept ? `，保留 ${result.kept} 项。${result.kept_reasons.join('；')}` : '。'}`;
    } catch (cause) { setClearing(null); throw cause; }
  });

  const total = page?.total ?? 0;
  return <SettingsShell title="最近删除" lead="误删的物品、记录、心愿、盘点、账户和周期费用都在这里，可以随时找回。资料与图片会保留；只有永久删除才会真正移除。">
    <ChipRow label="按类型筛选" items={trashFilters.map(([id, label]) => ({ id, label }))} value={filter} onChange={next => { setFilter(next); setOffset(0); }}/>
    {pendingNote && <Notice>上次恢复操作的结果待核对。 <Button variant="plain" disabled={busy} onClick={() => void settle()}>核对操作结果</Button></Notice>}
    {notice && <Notice tone={/已恢复|已永久|已核对|已整组|已登记/.test(notice) ? 'positive' : 'danger'}>{notice}</Notice>}
    {error && !page ? <ErrorState title="最近删除读取失败" message={error} onRetry={reload}/>
      : loading && !page ? <Loading label="正在读取最近删除…"/>
      : !page?.items.length ? <EmptyState icon="user" title="最近删除是空的" message={filter === 'all' ? '删除的物品和记录会出现在这里。' : '这一类目前没有已删除的记录。'}/>
      : <>
        <ListGroup title={`${total} 项 · 按删除时间从新到旧`}>
          {page.items.map(entry => {
            const display = entryDisplay(entry);
            const facts = [display.typeLabel, entry.kind !== 'asset' && entry.asset_name ? `所属：${entry.asset_name}` : '', entry.asset_id ? `状态：${stateText[entry.asset_state ?? 'active'] ?? '使用中'}` : '', entry.deleted_at ? `删除于 ${dayLabel(deletedDay(entry.deleted_at))}` : '删除时间未知', ...display.facts, contentsText(entry.contents) ? contentsText(entry.contents) + '，恢复时一起回来' : '', display.parentBlocked ? '所属物品仍在最近删除中，请先恢复所属物品' : ''].filter(Boolean);
            return <ListRow key={entry.kind + entry.id} icon="trash" tone="danger" title={display.title} subtitle={facts.join(' · ')} onClick={() => setArmed(entry)}/>;
          })}
        </ListGroup>
        {total > pageSize && <nav className="me-pager" aria-label="分页"><Button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - pageSize))}>上一页</Button><span>第 {Math.floor(offset / pageSize) + 1} 页</span><Button disabled={offset + pageSize >= total} onClick={() => setOffset(n => n + pageSize)}>下一页</Button></nav>}
        {filter === 'all' && <Button variant="danger" block disabled={busy} onClick={() => void openClear()}>清空最近删除…</Button>}
      </>}
    {armed && page && <Sheet title={entryDisplay(armed).title} doneLabel="关闭" onClose={() => setArmed(null)}>
      <div className="m-page">
        {entryDisplay(armed).parentBlocked && <Notice>所属物品「{armed.asset_name}」仍在最近删除中，请先恢复它。</Notice>}
        {restoresAsGroup(armed.kind) && <Notice>关联订阅的服务档案与付款计划会整组恢复，或整组永久清除；操作前会先读取影响。</Notice>}
        {entryDisplay(armed).parentBlocked && armed.asset_id
          ? <Button variant="primary" block disabled={busy} onClick={() => { const parent = page.items.find(item => item.kind === 'asset' && item.id === armed.asset_id); setArmed(null); if (parent) setArmed(parent); else setFilter('asset'); }}>先恢复所属物品</Button>
          : <Button variant="primary" block disabled={busy} onClick={() => { const entry = armed; setArmed(null); void restore(entry, page.generation); }}>{restoresAsGroup(armed.kind) ? '整组恢复' : restoresViaWealth(armed.kind) || armed.kind === 'asset' ? '恢复' : '恢复记录'}</Button>}
        {restoresAsGroup(armed.kind)
          ? <Button variant="danger" block disabled={busy} onClick={() => { const entry = armed; setArmed(null); setGroupPurge({ id: entry.id, name: entryDisplay(entry).title }); }}>永久清除…（不可恢复）</Button>
          : <Button variant="danger" block disabled={busy} onClick={() => void purge(armed, page.generation)}>永久删除（不可恢复）</Button>}
      </div>
    </Sheet>}
    {groupRestore && <GroupRestoreSheet groupId={groupRestore.id} name={groupRestore.name} onClose={saved => { setGroupRestore(null); if (saved) reload(); }} onDone={setNotice}/>}
    {groupPurge && <GroupPurgeSheet groupId={groupPurge.id} name={groupPurge.name} onClose={saved => { setGroupPurge(null); if (saved) reload(); }} onDone={setNotice}/>}
    {repairing && <RepairSheet side={repairing.side} id={repairing.id} onClose={saved => { setRepairing(null); if (saved) reload(); }} onDone={setNotice}/>}
    {clearing && <Sheet title="清空最近删除" doneLabel="取消" onClose={() => { if (!busy) setClearing(null); }}>
      <div className="m-page">
        {clearing.error ? <Notice tone="danger">{clearing.error}</Notice> : !clearing.preview ? <Loading label="正在读取影响…"/> : <>
          <Notice>将永久清除最近删除里的全部内容，不可恢复。其中关联订阅 {clearing.preview.groups.length} 组，其他 {clearing.preview.other_count} 项。由心愿实现的物品需先永久删除对应心愿，会被保留。</Notice>
          <Button variant="danger" block disabled={busy} onClick={() => void clearAll(clearing.preview!)}>确认永久清除全部</Button>
        </>}
      </div>
    </Sheet>}
  </SettingsShell>;
}
