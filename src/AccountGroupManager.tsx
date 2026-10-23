import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CloseButton } from './CloseButton';
import { DragHandle } from './FormControls';
import { errorMessage } from './asset';
import { storedPending, submit, resolvePending } from './wealth';
import { groupNameError } from './account-groups';
import type { AccountGroup, AccountGroupList } from './account-groups';
import './account-groups.css';
import { t } from './i18n.ts';
export function AccountGroupManager({ generation, onClose, onChanged }: { generation: string; onClose: () => void; onChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), locked = useRef(false);
  const [groups, setGroups] = useState<AccountGroup[] | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [name, setName] = useState(''), [editing, setEditing] = useState<AccountGroup | null>(null), [removing, setRemoving] = useState<AccountGroup | null>(null);
  const [pending, setPending] = useState(storedPending);
  const frozen = busy || !!pending;
  async function load() {
    try { const data = await invoke<AccountGroupList>('account_groups_list'); if (data.generation !== generation) throw new Error(t('资料库已切换，请关闭后重新打开。')); setGroups(data.groups); }
    catch (e) { setError(errorMessage(e)); }
  }
  useEffect(() => { dialog.current?.showModal(); void load(); return () => dialog.current?.close(); }, []);
  async function write(run: () => Promise<unknown>) {
    if (locked.current || storedPending()) return;
    locked.current = true; setBusy(true); setError('');
    try { await run(); setName(''); setEditing(null); setRemoving(null); onChanged(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : errorMessage(e)); setPending(storedPending()); onChanged(); }
    finally { locked.current = false; setBusy(false); }
  }
  function save() {
    const problem = groupNameError(name); if (problem) { setError(problem); return; }
    void write(() => submit({ command: 'account_group_save', input: { request_id: crypto.randomUUID(), generation, id: editing?.id ?? null, expected_revision: editing?.revision ?? null, name: name.trim() }, label: editing ? t('分组改名') : t('新增分组') }));
  }
  function move(id: string, target: string) {
    if (!groups) return;
    const ids = groups.map(g => g.id), from = ids.indexOf(id), to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1); ids.splice(to, 0, id);
    void write(() => submit({ command: 'account_groups_reorder', input: { request_id: crypto.randomUUID(), generation, ids }, label: t('分组排序') }));
  }
  async function verify() {
    if (!pending || locked.current) return;
    locked.current = true; setBusy(true);
    try { const outcome = await resolvePending(pending); setPending(null); if (outcome === 'saved') { setEditing(null); setRemoving(null); setName(''); } setError(outcome === 'saved' ? t('已确认上次分组操作保存成功。') : t('已确认上次操作未保存，可以重新操作。')); onChanged(); await load(); }
    catch (e) { setError(errorMessage(e)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor account-group-manager" aria-labelledby="account-group-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><div>
    <header><div><h2 id="account-group-heading">{t('管理分组')}</h2><p className="muted">{t('分组只影响查看，不改变账户类型、计入设置或规划。拖动手柄排序，也可聚焦后用上下方向键。')}</p></div><CloseButton type="button" disabled={busy} aria-label={t('关闭分组管理')} onClick={onClose}/></header>
    {error && <p role="alert" className="notice">{error}<button type="button" disabled={busy || !!pending} onClick={() => void load()}>{t('重新读取分组')}</button></p>}
    {pending && <p role="status" className="notice">{t('原请求已保留，请先核对结果。')}<button type="button" disabled={busy} onClick={() => void verify()}>{t('核对结果')}</button></p>}
    {!groups ? <p role="status">{t('正在读取分组…')}<button type="button" disabled={busy} onClick={() => void load()}>{t('重新读取')}</button></p> : <>{groups.length === 0 && <p className="muted">{t('还没有分组，可创建“应急金”等分组；账户也可以保持未分组。')}</p>}<div className="choice-list">{groups.map((g, i) => <div className="choice-item" data-sort-id={g.id} key={g.id}>
      <DragHandle label={g.name} disabled={frozen || !!editing || !!removing} onDrop={target => move(g.id, target)} onStep={step => { const target = groups[i + step]; if (target) move(g.id, target.id); }}/><span>{g.name}</span><small className="muted">{t('{accounts} 个账户（含已停用和最近删除）', { accounts: g.accounts })}</small><button type="button" disabled={frozen || !!removing} onClick={() => { setEditing(g); setName(g.name); }}>{t('改名')}</button><button type="button" disabled={frozen || !!editing} onClick={() => setRemoving(g)}>{t('删除')}</button>
    </div>)}</div></>}
    {removing ? <section className="choice-edit"><h3>{t('删除「{name}」', { name: removing.name })}</h3><p>{t('删除后，{accounts} 个账户会变成未分组，账户本身不会删除。此操作无法撤销；重新建组后仍需重新分配账户。', { accounts: removing.accounts })}</p><div className="actions"><button type="button" disabled={frozen} onClick={() => setRemoving(null)}>{t('取消')}</button><button type="button" className="danger" disabled={frozen} onClick={() => void write(() => submit({ command: 'account_group_delete', input: { request_id: crypto.randomUUID(), generation, id: removing.id, expected_revision: removing.revision, expected_accounts: removing.accounts }, label: t('删除分组') }))}>{t('确认删除')}</button></div></section> : <form className="choice-create" onSubmit={e => { e.preventDefault(); save(); }}><label>{editing ? t('分组新名称') : t('新分组名称')}<input aria-label={editing ? t('分组新名称') : t('新分组名称')} value={name} maxLength={40} disabled={frozen} onChange={e => setName(e.target.value)}/></label><button type="submit" disabled={frozen || !name.trim()}>{editing ? t('保存名称') : t('创建分组')}</button>{editing && <button type="button" disabled={frozen} onClick={() => { setEditing(null); setName(''); }}>{t('取消改名')}</button>}</form>}
  </div></dialog>;
}
