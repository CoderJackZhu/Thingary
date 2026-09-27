import {persistSubmission} from './editor-session';
import {ChoiceField,FormRow} from './FormControls';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, localDay, money } from './asset';
import type { AssetRecord } from './asset';
import type { CloseIntent } from './AssetEditor';
import { DateInput } from './DateInput';
import { saleError, saleAction, saleKey, settlement, incompleteCostReason } from './sales';
import type { SaleDraft, SaleChange, SaleForm } from './sales';

export function SaleEditor({ initial, closeIntent, onKeep, onClose, onSaved }: { initial: SaleDraft; closeIntent: CloseIntent | null; onKeep: () => void; onClose: (intent: CloseIntent) => void; onSaved: (record: AssetRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.pending ? '上次售出保存结果待确认，请先核对。' : '');
  const [conflict, setConflict] = useState(false);
  const title = draft.mode === 'revoke' ? '撤销误记售出' : draft.mode === 'correct' ? '修改售出记录' : '标记售出';
  useEffect(() => { dialog.current?.showModal(); document.getElementById('sale-date')?.focus(); return () => dialog.current?.close(); }, []);
  useEffect(() => { if (closeIntent) askClose(closeIntent); }, [closeIntent]);
  function remember(next: SaleDraft) { persistSubmission(saleKey, next); setDraft(next); }
  function edit(key: keyof SaleForm, value: string) {
    const next = {...draft, fields:{...draft.fields,[key]:value}}; setDraft(next);
    try { persistSubmission(saleKey, next); } catch {setNotice('暂时无法更新编辑状态，请重试。');}
  }
  function askClose(intent: CloseIntent) {
    if (lock.current || draft.pending) { setNotice('请先核对售出保存结果，再关闭表单。'); onKeep(); return; }
    onClose(intent);
  }
  function success(record: AssetRecord) { localStorage.removeItem(saleKey); onSaved(record); }
  async function check() {
    if (!draft.pending || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await invoke<AssetRecord | null>('saved_request', { request: draft.pending.request_id, generation: draft.generation });
      if (result) success(result);
      else { remember({ ...draft, pending: null }); setNotice('确认尚未提交。输入已保留，可以重试或修改。'); }
    } catch (e) { setNotice(errorMessage(e) + ' 原请求与输入已保留，请稍后核对。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || draft.pending || conflict) return;
    const error = saleError(draft, localDay());
    if (error) { setNotice(error); document.getElementById('sale-date')?.focus(); return; }
    const input: SaleChange = { request_id: crypto.randomUUID(), generation: draft.generation, asset_id: draft.record.asset.id, expected_revision: draft.record.asset.revision, action: saleAction(draft) };
    lock.current = true; setBusy(true);
    try { remember({ ...draft, pending: input }); }
    catch { lock.current = false; setBusy(false); setNotice('无法暂存本次请求，尚未提交，请检查可用空间后重试。'); return; }
    try { success(await invoke<AssetRecord>('change_sale', { input })); }
    catch (e) {
      try {
        const result = await invoke<AssetRecord | null>('saved_request', { request: input.request_id, generation: input.generation });
        if (result) success(result);
        else { remember({ ...draft, pending: null }); setConflict(typeof e === 'object' && e !== null && 'code' in e && ['REVISION_CONFLICT','STATE_CONFLICT'].includes(String(e.code))); setNotice(errorMessage(e) + ' 输入已保留。'); }
      } catch { setNotice('暂时无法确认结果。原请求和输入已保留，请核对售出保存结果。'); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const record = await invoke<AssetRecord | null>('read_asset', { id: draft.record.asset.id });
      if (!record || record.deleted) { setNotice('档案已删除或不可用，请关闭后重新读取。'); return; }
      remember({ ...draft, record }); setConflict(false);
      setNotice(`已读取最新状态：${record.lifecycle?.state === 'sold' ? '已售出' : record.lifecycle?.state === 'retired' ? '已退役' : '使用中'}。你的输入仍保留，请核对最新售出资料后再保存。`);
    } catch (e) { setNotice(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const validation = saleError(draft, localDay());
  const action = !validation && draft.mode !== 'revoke' ? saleAction(draft) : null;
  const preview = action && 'fields' in action ? settlement(draft.record, action.fields) : null;
  return <dialog ref={dialog} className="editor sale-editor" aria-labelledby="sale-title" onCancel={e => { e.preventDefault(); askClose('form'); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><h2 id="sale-title">{title}</h2><button type="button" aria-label="关闭售出表单" onClick={() => askClose('form')}>×</button><div className="editor-header-actions">{draft.pending ? <button type="button" disabled={busy} onClick={() => void check()}>核对售出保存结果</button> : conflict ? <button type="button" disabled={busy} onClick={() => void reload()}>读取最新状态</button> : <button className="primary" disabled={busy}>{busy ? '正在保存…' : draft.mode === 'revoke' ? '确认撤销误记售出' : '保存售出记录'}</button>}</div></header>
    <p>{draft.record.asset.name}</p>
    {draft.mode === 'revoke' ? <p>确认这是误记的售出？撤销后恢复为<strong>{draft.record.sale?.previous_state === 'retired' ? '已退役' : '使用中'}</strong>，保留原档案和图片，持有天数重新计算到今天。真实卖出后又买回，请新增另一件物品。</p> : <>
      <p className="muted">售出后持有天数截止到售出日。实际售价必填，可为 0；购入资料未知时仍可记录售出。</p>
      <div className="field"><label htmlFor="sale-date">售出日期（必填）</label><DateInput id="sale-date" value={draft.fields.date} disabled={busy || !!draft.pending} min={draft.record.asset.purchase_date ?? undefined} max={localDay()} onChange={value => edit('date', value)}/></div>
      <label className="field">实际售价（元，必填）<input id="sale-price" inputMode="decimal" value={draft.fields.price} disabled={busy || !!draft.pending} onChange={e => edit('price',e.target.value)}/></label>
      <FormRow label="售出渠道"><ChoiceField kind="sale_channel" label="售出渠道" generation={draft.generation} value={draft.fields.platform||null} disabled={busy||!!draft.pending} byName onChange={v=>edit('platform',v||'')}/></FormRow>
      <label className="field">买家（可选）<input value={draft.fields.buyer} disabled={busy || !!draft.pending} onChange={e => edit('buyer',e.target.value)}/></label>
      <label className="field">备注（可选）<textarea rows={2} value={draft.fields.notes} disabled={busy || !!draft.pending} onChange={e => edit('notes',e.target.value)}/></label>
      <div className="sale-preview" aria-label="售出结算预览"><span>购入金额 {money(draft.record.asset.price_cents)}</span>{preview && <><p>净生命周期成本 {money(preview.net)} · 净日均 {money(preview.daily)}{preview.daily !== null ? ' / 天' : ''}</p><p>{preview.days === null ? '购入日期未知，持有天数待补充。' : `截至售出日持有 ${preview.days} 天`}</p>{preview.net === null && <p>{incompleteCostReason(draft.record)}</p>}</>}</div>
    </>}
    {draft.record.sale && <details><summary>当前有效售出记录</summary><p>{draft.record.sale.fields.date} · {money(draft.record.sale.fields.price_cents)} · 售出前{draft.record.sale.previous_state === 'retired' ? '已退役' : '使用中'}</p></details>}
    {notice && <p className="notice" role="status">{notice}</p>}

  </form></dialog>;
}
