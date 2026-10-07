// Linked-subscription dialogs (design §5–§8). Each dialog reads a fresh
// backend preview first and submits exactly one command; a stale preview is
// re-read, never confirmed silently.
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { CloseButton } from './CloseButton';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Info, Segments, Switch } from './FormControls';
import { submit, Unresolved } from './wealth';
import { saveReminderWithPermission } from './virtual';
import type { ReminderState } from './virtual';
import { shiftDays } from './recurring-model';
import { linkDeletePreview, linkRestorePreview, linkRepairPreview, linkView } from './link';
import type { LinkCreateInput, LinkRepairPreview, LinkPurgePreview, PurgeAllPreview, Purged, LinkPreview, LinkRestoreInput, LinkRestorePreview, LinkSaveInput, LinkTrashInput, ReconcileInput } from './link';
import type { PlanFields } from './recurring';
import type { VirtualFields } from './virtual';
import { virtualKindText } from './virtual';

type Close = (saved: boolean) => void;

/** 删除预览文案（设计 §7.1）：同一组影响，从任一入口读数一致。 */
export function previewText(p: LinkPreview): string[] {
  const facts = [
    `将「${p.asset_name}」的服务档案与关联付款计划「${p.plan_name}」一起移入最近删除。`,
    p.paid_count > 0
      ? `${p.paid_count} 笔已记录付款（${money(p.paid_cents)}）将暂不参与重要支出，可整组恢复。不再使用时可选择结束订阅，以保留历史支出。`
      : '还没有已记录付款；恢复时一起回来。',
  ];
  if (p.skipped_count > 0) facts.push(`另有 ${p.skipped_count} 笔“本期不付”记录一同隐藏。`);
  for (const b of p.blockers) facts.push(`注意：${b}`);
  return facts;
}

/** 整组删除：预览 → 同一事务删除双方（设计 §7.1/§7.2）。 */
export function LinkDeleteDialog({ side, id, name, partnerId, generation, onClose, onDone }: { side: 'virtual' | 'plan'; id: string; name: string; partnerId?: string | null; generation: string; onClose: Close; onDone: (groupId: string, name: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function load() {
    setError(''); setBusy(true);
    try { setPreview(await linkDeletePreview(side, id, partnerId)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    const input: LinkTrashInput = {
      request_id: crypto.randomUUID(), generation,
      side, id, partner_id: partnerId ?? null, asset_expected_revision: preview.asset_revision, plan_expected_revision: preview.plan_revision, preview: preview.preview,
    };
    try {
      const groupId = await submit<string>({ command: 'link_trash', input, label: '删除 ' + preview.asset_name });
      onDone(groupId, preview.asset_name); onClose(true);
    }
    catch (e) {
      if (e instanceof Unresolved) setStuck(true);
      // 预览过期（新增付款／修订变化）：重新读取影响，不沿用旧确认。
      else if (e instanceof Error && e.message.includes('重新读取')) { setError(e.message); setPreview(null); void load(); }
      else setError(e instanceof Error ? e.message : errorMessage(e));
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="link-delete-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="link-delete-title">移入最近删除？</h2>
    <p className="trash-name">{name}</p>
    {stuck ? <p className="notice" role="status">删除结果未确认，请先核对上一次请求，避免重复操作。</p>
      : error ? <p className="notice" role="alert">{error}</p>
      : !preview ? <p role="status" className="muted">正在读取整组影响…</p>
      : <>{previewText(preview).map((t, i) => <p className="muted" key={i}>{t}</p>)}<p className="muted small"><Info text="预览后新增付款、修改资料或引用变化时，旧确认不能继续使用；提交会重新核对全部影响。"/></p></>}
    <div className="actions">
      <CloseButton type="button" aria-label="关闭删除确认" disabled={busy} onClick={() => onClose(false)} />
      {stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button>
        : <><button type="button" disabled={busy} onClick={() => void load()}>重新读取影响</button>
          <button type="button" className="primary danger" disabled={busy || !preview || !!preview.blockers.find(b => b.includes('规划核对引用'))} onClick={() => void confirm()}>{busy ? '正在处理…' : '整组移入最近删除'}</button></>}
    </div>
  </dialog>;
}

/** 整组恢复：一次事务恢复登记的成员集合（设计 §7.2）。 */
export function LinkRestoreDialog({ groupId, name, onClose, onDone }: { groupId: string; name: string; onClose: Close; onDone: (preview: LinkRestorePreview) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<LinkRestorePreview | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function load() {
    setError(''); setBusy(true);
    try { setPreview(await linkRestorePreview(groupId)); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    const input: LinkRestoreInput = { request_id: crypto.randomUUID(), generation: preview.generation, group_id: groupId, preview: preview.preview };
    try {
      await submit({ command: 'link_restore', input, label: '恢复 ' + preview.asset_name });
      onDone(preview); onClose(true);
    } catch (e) {
      if (e instanceof Unresolved) setStuck(true);
      else if (e instanceof Error && e.message.includes('重新读取')) { setError(e.message); setPreview(null); void load(); }
      else setError(e instanceof Error ? e.message : errorMessage(e));
    } finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="link-restore-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="link-restore-title">恢复这组关联订阅？</h2>
    <p className="trash-name">{name}</p>
    {stuck ? <p className="notice" role="status">恢复结果未确认，请先核对上一次请求。</p>
      : error ? <p className="notice" role="alert">{error}</p>
      : !preview ? <p role="status" className="muted">正在读取恢复影响…</p>
      : <><p className="muted">将一起恢复「{preview.asset_name}」服务档案与付款计划「{preview.plan_name}」，原 ID 与历史付款保持不变。</p>
        {preview.payments_hidden > 0 && <p className="muted">{preview.payments_hidden} 笔此前有效的付款会重新参与汇总一次。</p>}
        {preview.payments_stay_deleted > 0 && <p className="muted small">另有 {preview.payments_stay_deleted} 笔删除更早的付款保持删除，不会被这组恢复带回来。</p>}
        {preview.blockers.map((b, i) => <p className="muted" key={i}>注意：{b}</p>)}</>}
    <div className="actions">
      <CloseButton type="button" aria-label="关闭恢复确认" disabled={busy} onClick={() => onClose(false)} />
      {stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button>
        : <button type="button" className="primary" disabled={busy || !preview || preview.blockers.length > 0} onClick={() => void confirm()}>{busy ? '正在处理…' : '整组恢复'}</button>}
    </div>
  </dialog>;
}

/** 旧停用核对（设计 §6/§8）：确认已结束或撤回误记停用，均需双方修订。 */
export function LinkReviewDialog({ assetId, planId, assetName, assetRevision, planRevision, stoppedOn, today, generation, onClose, onDone }: {
  assetId: string; planId: string; assetName: string; assetRevision: number; planRevision: number; stoppedOn: string | null; today: string; generation: string; onClose: Close; onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [lastUsed, setLastUsed] = useState(stoppedOn ?? today);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function run(action: ReconcileInput['action']) {
    setBusy(true); setNotice('');
    const input: ReconcileInput = { request_id: crypto.randomUUID(), generation, action, asset_id: assetId, plan_id: planId, asset_expected_revision: assetRevision, plan_expected_revision: planRevision, last_used: action === 'confirm_ended' ? lastUsed : null };
    try {
      await submit({ command: 'link_reconcile', input, label: (action === 'confirm_ended' ? '确认已结束 ' : '撤回误记停用 ') + assetName });
      onDone(action === 'confirm_ended' ? `已确认「${assetName}」于 ${lastUsed} 结束，续费已关闭。` : `已撤回「${assetName}」的停用标记，原排期保持。`);
      onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="link-review-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="link-review-title">核对这项订阅的停用记录</h2>
    <p className="trash-name">{assetName}</p>
    <p className="muted">档案停用{stoppedOn ? `于 ${stoppedOn}` : ''}，但关联的付款计划仍在进行。请明确处理：确认已结束会同时设置计划最后使用日并关闭续费；撤回误记停用则恢复按原排期继续。</p>
    {stuck ? <p className="notice" role="status">保存结果未确认，请先核对上一次请求。</p> : <>
      <FormRow label="确认已结束" hint="同一事务设置计划最终结束日、关闭自动续费，并清除停用标记">
        <div className="form-inline"><DateInput label="最后使用日" value={lastUsed} max={today} disabled={busy} onChange={v => v && setLastUsed(v)} /><button type="button" disabled={busy} onClick={() => void run('confirm_ended')}>确认已结束</button></div>
      </FormRow>
      <FormRow label="撤回误记停用" hint="只清除停用标记；计划期限、暂停与自动续费值保持不变">
        <button type="button" disabled={busy} onClick={() => void run('withdraw_stop')}>撤回误记停用</button>
      </FormRow>
    </>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>暂不处理</button></div>
  </dialog>;
}

/** 结束订阅（设计 §6）：明确最后使用日、关闭续费，双方一致。 */
export function EndSubscriptionDialog({ assetId, planId, assetName, assetRevision, planRevision, fields, suggestion, today, generation, onClose, onDone }: {
  assetId: string; planId: string; assetName: string; assetRevision: number; planRevision: number; fields: PlanFields; suggestion: string | null; today: string; generation: string; onClose: Close; onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [lastUsed, setLastUsed] = useState(suggestion ?? today);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function run() {
    setBusy(true); setNotice('');
    const input: LinkSaveInput = { request_id: crypto.randomUUID(), generation, asset_id: assetId, asset_expected_revision: assetRevision, plan_id: planId, plan_expected_revision: planRevision, fields: { ...fields, end_date: lastUsed, auto_renew: false } };
    try {
      await submit({ command: 'link_save', input, label: '结束订阅 ' + assetName });
      onDone(`「${assetName}」将使用至 ${lastUsed}，后续续费已关闭；历史付款与估算依据保留。`);
      onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="end-subscription-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="end-subscription-title">结束「{assetName}」？</h2>
    <p className="muted">确认最后使用日：到这一天为止仍在服务期，次日显示已结束。历史付款与估算依据保留，不再安排后续续费。这只维护记录，不代表已取消平台扣款。</p>
    {stuck ? <p className="notice" role="status">保存结果未确认，请先核对上一次请求。</p> : <FormRow label="最后使用日" hint={suggestion ? `建议为当前服务期末 ${suggestion}；可修改` : '不能早于服务开始'}>
      <DateInput label="最后使用日" value={lastUsed} disabled={busy} onChange={v => v && setLastUsed(v)} />
    </FormRow>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>取消</button><button type="button" className="primary danger" disabled={busy || stuck} onClick={() => void run()}>{busy ? '保存中…' : '确认结束订阅'}</button></div>
  </dialog>;
}

/** 统一名称（设计 §4）：用户选择采用哪个现有名称或输入新名称。 */
export function UnifyNameDialog({ assetId, planId, assetName, planName, assetRevision, planRevision, fields, generation, onClose, onDone }: {
  assetId: string; planId: string; assetName: string; planName: string; assetRevision: number; planRevision: number; fields: PlanFields; generation: string; onClose: Close; onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'asset' | 'plan' | 'new'>('asset');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const target = mode === 'asset' ? assetName : mode === 'plan' ? planName : custom.trim();
  async function run() {
    if (!target) { setNotice('请输入要统一使用的名称。'); return; }
    setBusy(true); setNotice('');
    const input: LinkSaveInput = { request_id: crypto.randomUUID(), generation, asset_id: assetId, asset_expected_revision: assetRevision, plan_id: planId, plan_expected_revision: planRevision, fields: { ...fields, name: target }, unify_name_to: target };
    try {
      await submit({ command: 'link_save', input, label: '统一名称 ' + target });
      onDone(`两页的显示名称已统一为「${target}」。`);
      onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="unify-name-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="unify-name-title">统一显示名称</h2>
    <p className="muted">当前两页名称不同：服务名称「{assetName}」、付款计划名称「{planName}」。统一后同一次保存更新双方；不改价格等其他资料。</p>
    {stuck ? <p className="notice" role="status">保存结果未确认，请先核对上一次请求。</p> : <>
      <FormRow label="采用哪个名称"><div className="form-inline">
        <label><input type="radio" name="unify-name" checked={mode === 'asset'} onChange={() => setMode('asset')} disabled={busy} /> 服务名称「{assetName}」</label>
        <label><input type="radio" name="unify-name" checked={mode === 'plan'} onChange={() => setMode('plan')} disabled={busy} /> 付款计划名称「{planName}」</label>
        <label><input type="radio" name="unify-name" checked={mode === 'new'} onChange={() => setMode('new')} disabled={busy} /> 新名称</label>
      </div></FormRow>
      {mode === 'new' && <FormRow label="新名称"><input aria-label="统一后的名称" maxLength={80} value={custom} disabled={busy} onChange={e => setCustom(e.target.value)} /></FormRow>}
    </>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose(false)}>取消</button><button type="button" className="primary" disabled={busy || stuck} onClick={() => void run()}>{busy ? '保存中…' : '统一名称'}</button></div>
  </dialog>;
}

/** 周期页给已有订阅计划建立服务档案（设计 §4.1）：仅新增档案，不动付款。 */
export function LinkCreateDialog({ planId, planName, planRevision, today, generation, onClose, onDone }: {
  planId: string; planName: string; planRevision: number; today: string; generation: string; onClose: Close; onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(planName);
  const [provider, setProvider] = useState('');
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<'general' | 'subscription' | 'domain'>('subscription');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function run() {
    if (!name.trim()) { setNotice('请填写服务名称。'); return; }
    setBusy(true); setNotice('');
    const fields = { name: name.trim(), kind, billing: 'subscription', label_id: null, pay_method: null, perpetual: false, provider, purchase_date: null, price_cents: null, expires: null, plan_id: null, url, notes: '', stopped_on: null } as VirtualFields;
    const input: LinkCreateInput = { request_id: crypto.randomUUID(), generation, plan_id: planId, plan_expected_revision: planRevision, fields };
    try {
      await submit({ command: 'link_create', input, label: '建立关联服务档案 ' + name });
      onDone(`已为「${planName}」建立服务档案「${name.trim()}」；已有付款保持原样，未补记任何新付款。`);
      onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="link-create-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void run(); }}>
    <header><div><p className="eyebrow">财富 · 周期费用</p><h2 id="link-create-title">建立关联服务档案</h2><p className="muted">把这项计划与虚拟资产里的服务档案关联：只新增档案，已有付款与排期保持原样。</p></div><CloseButton type="button" aria-label="关闭建立关联表单" disabled={busy} onClick={() => onClose(false)} /><div className="editor-header-actions">{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '建立档案并关联'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="服务名称" hint="虚拟资产里显示的名称"><input aria-label="服务名称" maxLength={80} value={name} disabled={busy} onChange={e => setName(e.target.value)} /></FormRow>
      <FormRow label="类型" hint="按服务性质选择；不影响计费方式"><select aria-label="类型" value={kind} disabled={busy} onChange={e => setKind(e.target.value as typeof kind)}>{(['subscription', 'domain', 'general'] as const).map(k => <option key={k} value={k}>{virtualKindText(k)}</option>)}</select></FormRow>
      <FormRow label="提供方" hint="可留空"><input aria-label="提供方" maxLength={80} value={provider} disabled={busy} onChange={e => setProvider(e.target.value)} /></FormRow>
      <FormRow label="链接" hint="购买或管理页面，可留空"><input aria-label="链接" maxLength={2000} value={url} disabled={busy} onChange={e => setUrl(e.target.value)} /></FormRow>
      <p className="muted small">建立后两页共用计费信息、付款记录与整组删除／恢复；计划分类保持「订阅」，不再改为其他类别。</p>
    </section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}

/** 历史关联核对：稳定 ID 候选选择 → 读取影响 → 显式恢复或归组。 */
export function LinkRepairDialog({ side, id, onClose, onDone }: { side: 'virtual' | 'plan'; id: string; onClose: Close; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [candidates, setCandidates] = useState<import('./link').LinkCandidate[]>([]);
  const [partner, setPartner] = useState<string | null>(null);
  const [action, setAction] = useState<'restore_pair' | 'register_group'>('restore_pair');
  const [preview, setPreview] = useState<LinkRepairPreview | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function load(choice = partner, mode = action) {
    setBusy(true); setPreview(null); setNotice('');
    try {
      const view = await linkView(side, id);
      setCandidates(view.candidates);
      if (side === 'plan' && view.candidates.length > 1 && !choice) return;
      setPreview(await linkRepairPreview(side, id, choice, mode));
    } catch (e) { setNotice(errorMessage(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy || stuck || preview.blockers.length) return;
    setBusy(true);
    try {
      await submit({ command: 'link_reconcile', input: { request_id: crypto.randomUUID(), generation: preview.generation, action, asset_id: preview.asset_id, plan_id: preview.plan_id, asset_expected_revision: preview.asset_revision, plan_expected_revision: preview.plan_revision, preview: preview.preview }, label: '核对历史关联 ' + preview.asset_name });
      onDone(action === 'restore_pair' ? '已恢复关联双方；此前单独删除的付款保持删除。' : '已登记为一组，之后可整组恢复或清除。'); onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="link-repair-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}>
    <h2 id="link-repair-title">核对历史关联记录</h2>
    <p className="muted">按原有 ID 处理服务档案与付款计划，不创建或复制付款。</p>
    {candidates.length > 1 && <FormRow label="选择历史档案" hint="多个已删档案曾引用这项计划，请明确选择一个"><select aria-label="选择历史档案" value={partner ?? ''} disabled={busy || stuck} onChange={e => { const choice = e.target.value || null; setPartner(choice); void load(choice); }}><option value="">请选择…</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.name} · {c.deleted_at.slice(0, 10)} · {c.id}</option>)}</select></FormRow>}
    <Segments label="历史关联处理方式" value={action} disabled={busy || stuck} options={[{ value: 'restore_pair', label: '恢复关联双方' }, { value: 'register_group', label: '归为删除组' }]} onChange={v => { const mode = v as typeof action; setAction(mode); void load(partner, mode); }} />
    {preview && <><p>服务档案「{preview.asset_name}」：{preview.asset_deleted ? '已删除' : '有效'}；付款计划「{preview.plan_name}」：{preview.plan_deleted ? '已删除' : '有效'}。</p><p className="muted small">档案 ID：{preview.asset_id}<br/>计划 ID：{preview.plan_id}</p><p className="muted">{action === 'restore_pair' ? '恢复后双方均有效，原有付款重新参与汇总一次。' : '将剩余有效对象一并移入最近删除，登记为可整组恢复的删除组。'}已记录付款 {preview.paid_count} 笔（{money(preview.paid_cents)}），本期不付 {preview.skipped_count} 笔；此前单独删除的 {preview.payments_stay_deleted} 笔付款保持删除。</p>{preview.blockers.map(b => <p className="notice" key={b}>{b}</p>)}</>}
    {notice && <p className="notice" role="alert">{notice}</p>}
    {busy && <p className="muted" role="status">正在读取或处理…</p>}
    <div className="actions"><button disabled={busy} onClick={() => onClose(false)}>关闭</button><button disabled={busy || stuck} onClick={() => void load()}>重新读取影响</button><button className="primary" disabled={busy || stuck || !preview || !!preview.blockers.length} onClick={() => void confirm()}>{action === 'restore_pair' ? '确认恢复关联双方' : '确认归为删除组'}</button></div>
  </dialog>;
}

/** 整组删除的撤销：按组重读恢复预览后一次事务恢复（设计 §7.2）。 */
export async function undoLinkDelete(groupId: string) {
  const p = await linkRestorePreview(groupId);
  if (p.blockers.length) throw new Error(p.blockers[0]);
  await submit({ command: 'link_restore', input: { request_id: crypto.randomUUID(), generation: p.generation, group_id: groupId, preview: p.preview }, label: '撤销删除 ' + p.asset_name });
}

/** 关联异常的统一提示行；relation 来自 link_view。 */
export function relationNotice(relation: string, extra: { occupied_by?: { name: string } | null }): string | null {
  switch (relation) {
    case 'plan_trashed': return '关联的付款计划在最近删除中：可恢复计划形成有效组，或整组删除。';
    case 'asset_trashed': return '关联的服务档案在最近删除中：可恢复档案形成有效组，或删除剩余计划并归成一组。';
    case 'both_trashed': return '双方分别删除过：可在最近删除中整组恢复，或登记为一组。';
    case 'plan_occupied': return `这项计划已改由「${extra.occupied_by?.name ?? '其他档案'}」使用，不能恢复后抢占；可明确删除本档案。`;
    default: return null;
  }
}

/** 读取关联视图的小工具：页面在打开详情或核对入口时调用。 */
export async function refreshLink(kind: 'virtual' | 'plan', id: string) {
  return invoke<import('./link').LinkView>('link_view', { kind, id });
}

/** 共用备款提醒编辑（R5/设计 §4/§5.2）：同一提醒源，虚拟页与周期页共用；
 * 沿用虚拟模块的启停门控（调度在 reminders.rs 按 modules.virtual_assets 门控）。 */
export function SharedReminderRow({ assetId, assetRevision, reminder, nextDue, paymentDueDate, hasServiceStart, generation, today, disabled, onNotice, onStuck, onSaved, onBusyChange, moduleEnabled = true }: {
  assetId: string; assetRevision: number; reminder: ReminderState | null; nextDue: string | null; paymentDueDate: string | null; hasServiceStart: boolean; generation: string; today: string; disabled: boolean;
  onNotice: (m: string) => void; onStuck: () => void; onSaved: (warning?: string | null) => void; onBusyChange?: (v: boolean) => void; moduleEnabled?: boolean;
}) {
  const [on, setOn] = useState(!!reminder);
  const [repeat, setRepeat] = useState(reminder ? !!reminder.repeat_every_period : hasServiceStart);
  const [lead, setLead] = useState(reminder?.lead_days ?? 3);
  const [date, setDate] = useState(reminder?.date ?? '');
  const [notes, setNotes] = useState(reminder?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const next = paymentDueDate ?? nextDue;
  const suggestion = next ? shiftDays(next, -lead) : today;
  const singleSuggestion = suggestion < today ? today : suggestion;
  async function persist(nextOn: boolean, day: string, memo: string, repeating = repeat, advance = lead) {
    setBusy(true); onBusyChange?.(true);
    try {
      const warning = await saveReminderWithPermission(nextOn && moduleEnabled, () => invoke('notification_permission'), () => submit({ command: 'virtual_reminder_save', input: { request_id: crypto.randomUUID(), generation, asset_id: assetId, expected_revision: assetRevision, repeat_every_period: repeating, lead_days: advance, reminder: nextOn ? { date: day, notes: memo } : null }, label: '备款提醒' }));
      onSaved(warning);
    } catch (e) { if (e instanceof Unresolved) onStuck(); else { setOn(!!reminder); setRepeat(reminder ? !!reminder.repeat_every_period : hasServiceStart); setLead(reminder?.lead_days ?? 3); } onNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  const frozen = disabled || busy;
  return <div className="subscription-reminder"><FormRow label="备款提醒" hint={repeat ? '每期提前提醒；确认已付后撤销该期，继续提醒下一期' : '指定日期提醒，仅本次'}>
    <div className="form-inline"><Switch label="备款提醒" value={on} disabled={frozen} onChange={v => { setOn(v); const day = date || singleSuggestion; setDate(day); void persist(v, day, notes); }} /></div>
    {hasServiceStart && <Segments label="备款提醒方式" value={repeat ? 'period' : 'once'} disabled={frozen} options={[{ value: 'period', label: '每期提醒' }, { value: 'once', label: '仅本次' }]} onChange={v => { const r = v === 'period'; setRepeat(r); if (on) void persist(true, date || singleSuggestion, notes, r); }} />}
    {on && <div className="form-inline">{repeat
      ? <label>扣款前 <select aria-label="提前几天提醒" value={lead} disabled={frozen} onChange={e => { const n = Number(e.target.value); setLead(n); void persist(true, date || singleSuggestion, notes, true, n); }}>{Array.from({ length: 31 }, (_, n) => <option key={n} value={n}>{n} 天</option>)}</select>提醒</label>
      : <DateInput label="提醒日期" value={date} disabled={frozen} onChange={setDate} />}
      <input aria-label="提醒备注" placeholder="例如：充值付款账户" maxLength={1000} value={notes} disabled={frozen} onChange={e => setNotes(e.target.value)} /><button type="button" disabled={frozen || (!repeat && !date)} onClick={() => void persist(true, date || singleSuggestion, notes)}>更新提醒</button></div>}
    {!moduleEnabled && <p className="muted small">虚拟资产模块已关闭，提醒暂停；可维护设置，重新开启模块后生效。</p>}<small className="muted">{reminder ? reminder.repeat_every_period
      ? `每期扣款前 ${reminder.lead_days ?? 3} 天提醒；下次 ${reminder.date}。确认真实扣款后转到下一期。`
      : `已安排 ${reminder.date}${reminder.notes ? ' · ' + reminder.notes : ''}（仅本次）`
      : '默认关闭；开启后按系统通知权限执行，关闭、停用或结束会撤销待通知。'}</small>
  </FormRow></div>;
}

/** 整组永久清除（设计 §7.3/R7）：先读完整影响（全部付款含已删、规则、提醒、
 * 组外引用），确认时提交同一摘要；变化后要求重读。 */
export function LinkPurgeDialog({ groupId, name, onClose, onDone }: { groupId: string; name: string; onClose: Close; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<LinkPurgePreview | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function load() {
    setError(''); setBusy(true);
    try { setPreview(await invoke<LinkPurgePreview>('link_purge_preview', { groupId })); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      await submit({ command: 'purge_trash', input: { request_id: crypto.randomUUID(), generation: preview.generation, kind: 'link_group', id: groupId, preview: preview.preview }, label: '永久清除 ' + preview.asset_name });
      onDone(`已永久清除「${preview.asset_name}」的关联订阅组。`);
      onClose(true);
    } catch (e) {
      if (e instanceof Unresolved) { setStuck(true); setError(e.message); }
      else if (e instanceof Error && e.message.includes('重新读取')) { setError(e.message); setPreview(null); void load(); }
      else setError(e instanceof Error ? e.message : errorMessage(e));
    }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="link-purge-title" onCancel={e => { e.preventDefault(); if (!busy && !stuck) onClose(false); }}>
    <h2 id="link-purge-title">永久清除这组关联订阅？</h2>
    <p className="trash-name">{name}</p>
    {error ? <p className="notice" role="alert">{error}</p>
      : !preview ? <p role="status" className="muted">正在读取完整清除影响…</p>
      : <><p className="muted">将永久移除「{preview.asset_name}」服务档案、付款计划「{preview.plan_name}」及以下全部事实，删除后无法找回：</p>
        <ul className="link-purge-facts">
          <li>付款记录 {preview.payments_total} 笔（含此前单独删除的 {preview.payments_deleted} 笔）</li>
          <li>价格分段 {preview.rate_segments} 段、生效规则 {preview.rule_segments} 段、特殊到期 {preview.period_ends} 项</li>
          <li>备款提醒 {preview.reminders} 条</li>
        </ul>
        {preview.external_refs.length > 0 && <p className="notice" role="note">还有 {preview.external_refs.length} 个组外档案按 ID 引用这项计划；请先处理那些旧档案，再永久清除这组。</p>}
        {preview.blockers.filter(b => !b.includes('组外档案')).map((b, i) => <p className="notice" role="note" key={i}>注意：{b}</p>)}
        <p className="muted small">确认后提交会重新核对全部影响；预览后有付款或引用变化时需要重新读取。</p></>}
    <div className="actions">
      <CloseButton type="button" aria-label="关闭清除确认" disabled={busy} onClick={() => onClose(false)} />
      <button type="button" disabled={busy || stuck} onClick={() => void load()}>重新读取影响</button>
      <button type="button" className="primary danger" disabled={busy || stuck || !preview || preview.blockers.length > 0 || preview.external_refs.length > 0} onClick={() => void confirm()}>{busy ? '正在处理…' : '确认永久清除'}</button>
    </div>
  </dialog>;
}

/** 清空按删除组去重，完整列出组内事实和保留原因。 */
export function PurgeAllDialog({ onClose, onDone }: { onClose: Close; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<PurgeAllPreview | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  async function load() { setBusy(true); setNotice(''); setPreview(null); try { setPreview(await invoke<PurgeAllPreview>('purge_all_preview')); } catch (e) { setNotice(errorMessage(e)); } finally { setBusy(false); } }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function confirm() {
    if (!preview || busy || stuck) return;
    setBusy(true);
    try {
      const result = await submit<Purged>({ command: 'purge_trash', input: { request_id: crypto.randomUUID(), generation: preview.generation, kind: null, id: '', preview: preview.preview }, label: '清空最近删除' });
      onDone(`已永久清除 ${result.removed} 项${result.kept ? `，保留 ${result.kept} 项。${result.kept_reasons.join('；')}` : '。'}`); onClose(true);
    } catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor trash-dialog" aria-labelledby="purge-all-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><h2 id="purge-all-title">清空最近删除？</h2><p className="muted">永久清除后无法找回；受引用保护的关联组会完整保留。</p>{preview && <><p>关联订阅 {preview.groups.length} 组，其他记录 {preview.other_count} 项（组成员已去重）。</p>{preview.groups.map(g => <section className="form-block" key={g.group_id}><h3>{g.asset_name} · {g.plan_name}</h3><p className="muted">全部付款 {g.payments_total} 笔（含已删 {g.payments_deleted} 笔）；价格 {g.rate_segments} 段、规则 {g.rule_segments} 段、特殊到期 {g.period_ends} 项、提醒 {g.reminders} 条。</p>{g.blockers.length > 0 && <p className="notice">整组保留：{g.blockers.join('；')}</p>}</section>)}</>}{notice && <p className="notice" role="alert">{notice}</p>}{busy && <p role="status">正在读取或处理…</p>}<div className="actions"><button disabled={busy} onClick={() => onClose(false)}>关闭</button><button disabled={busy || stuck} onClick={() => void load()}>重新读取影响</button><button className="primary danger" disabled={busy || stuck || !preview} onClick={() => void confirm()}>确认永久清空</button></div></dialog>;
}
