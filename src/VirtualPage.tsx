import { useSource } from './useSource';
import type { SourceProps } from './source';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';
import { DateInput } from './DateInput';
import { CentInput, FormRow, Segments, Switch } from './FormControls';
import { Icon } from './AssetViews';
import { storedPending, submit, Unresolved } from './wealth';
import { DeleteButton, usePendingReceipt } from './WealthPage';
import { intervalText } from './recurring';
import { matchesFilter, statusText, validityText, virtualFilters, virtualKinds, virtualKindText } from './virtual';
import type { VirtualAsset, VirtualFields, VirtualFilter, VirtualKind, VirtualOverview, VirtualSave } from './virtual';
import './wealth.css';
import { useRestored } from './undo';

export function VirtualPage({ today, onEditingChange, source, onSourceDone }: SourceProps & { today: string; onEditingChange: (value: boolean) => void }) {
  const [data, setData] = useState<VirtualOverview | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<VirtualAsset | 'new' | null>(null);
  const [filter, setFilter] = useState<VirtualFilter>('all');
  const reload = () => setRetry(n => n + 1);
  useRestored(reload);
  const { pending, setPending, notice, busy, verify } = usePendingReceipt(reload);
  useEffect(() => { onEditingChange(!!editing || !!pending || busy); return () => onEditingChange(false); }, [editing, pending, busy, onEditingChange]);
  useEffect(() => {
    let live = true; setError('');
    invoke<VirtualOverview>('virtual_overview').then(o => { if (live) setData(o); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [retry]);
  const sourceError = useSource({source,onSourceDone}, data?.generation, async (target, alive) => {
    if (target.kind !== 'virtual') return false;
    if (pending || busy) throw new Error('请先核对上次保存结果，再打开来源档案。');
    // Re-read so a same-generation correction is what opens, not a stale row.
    const fresh = await invoke<VirtualOverview>('virtual_overview');
    if (!alive()) return false;
    if (fresh.generation !== data?.generation) return false;
    setData(fresh);
    const item = fresh.items.find(v => v.id === target.id);
    if (!item) return false;
    setEditing(item); return true;
  });
  useEffect(() => { if (sourceError) reload(); }, [sourceError]);
  const closed = (saved: boolean) => { setEditing(null); setPending(storedPending()); if (saved) reload(); };
  const shown = data?.items.filter(v => matchesFilter(v, filter)) ?? [];
  return <section className="stats-section wealth-section" aria-label="虚拟资产">
    {sourceError && <p role="alert" className="notice">{sourceError}</p>}
    {pending && <div className="notice" role="status">上次「{pending.label}」的保存结果未确认。<button disabled={busy} onClick={() => void verify()}>核对结果</button></div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="wealth-toolbar"><span className="muted small">状态按有效期自动推算；订阅关联周期计划后，有效期和费用都来自已确认的付款。</span>
      <div className="wealth-actions"><button className="primary" disabled={!!pending || !data} onClick={() => setEditing('new')}><Icon name="plus"/><span>新增虚拟资产</span></button></div></div>
    {error ? <article className="detail-section" role="alert"><p>虚拟资产读取失败：{error}</p><button onClick={reload}>重新读取</button></article>
      : !data ? <p role="status" className="muted">正在读取虚拟资产…</p>
      : !data.items.length ? <div className="empty"><span className="empty-mark">◇</span><h2>还没有虚拟资产</h2><p>把买断的软件、注册的域名和订阅的服务记下来，就能看到它们什么时候到期、一共花了多少。</p><button className="primary" disabled={!!pending} onClick={() => setEditing('new')}>新增虚拟资产</button></div>
      : <>
        <div className="stats-kpis wealth-kpis">
          <article><span>使用中</span><strong>{data.in_use}<small> 件</small></strong><em>共 {data.items.length} 件，不含已停用</em></article>
          <article><span>即将到期</span><strong>{data.expiring}<small> 件</small></strong><em>手填有效期 30 天内；关联计划 7 天内</em></article>
          <article><span>已到期</span><strong>{data.expired}<small> 件</small></strong><em>未停用且有效期已过</em></article>
          <article><span>已花费</span><strong>{money(data.spent_cents)}</strong><em>{data.unknown_price ? `${data.unknown_price} 件价格未知，未计入` : '一次性价格＋已确认的周期付款'}</em></article>
        </div>
        <div className="virtual-filter" role="group" aria-label="按状态筛选虚拟资产">
          {virtualFilters.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <article className="detail-section overview-card"><div className="section-heading"><h3>{virtualFilters.find(([k]) => k === filter)?.[1]}</h3><span>点名称编辑；停用和到期都保留档案</span></div>
          {!shown.length ? <p className="muted">这一类目前没有虚拟资产。</p> : <table className="distribution-table virtual-table"><thead><tr><th>名称</th><th>类型</th><th>有效至</th><th>状态</th><th>已花费</th></tr></thead><tbody>
            {shown.map(v => <tr key={v.id} className={v.status === 'stopped' ? 'closed' : undefined}>
              <td><button className="link-cell" onClick={() => setEditing(v)}>{v.fields.name}</button>{(v.fields.provider || v.plan_name) && <small className="muted">{[v.fields.provider, v.plan_name && `关联「${v.plan_name}」`].filter(Boolean).join(' · ')}</small>}</td>
              <td>{virtualKindText(v.fields.kind)}</td><td>{validityText(v)}</td>
              <td><span className="virtual-state" data-state={v.status}>{statusText[v.status]}{v.status === 'stopped' && v.fields.stopped_on ? ` · ${v.fields.stopped_on}` : ''}</span></td>
              <td className="amount">{v.spent_cents === null ? <span className="muted">未知</span> : money(v.spent_cents)}</td></tr>)}
          </tbody></table>}</article>
      </>}
    {editing && data && <VirtualDialog item={editing === 'new' ? null : editing} data={data} today={today} onClose={closed}/>}
  </section>;
}

const blank = (): VirtualFields => ({ name: '', kind: 'subscription', provider: '', purchase_date: null, price_cents: null, expires: null, plan_id: null, url: '', notes: '', stopped_on: null });
const providerLabel: Record<VirtualKind, string> = { license: '软件商', domain: '注册商', subscription: '平台' };
const priceLabel: Record<VirtualKind, string> = { license: '买断价格', domain: '注册价格', subscription: '价格' };

function VirtualDialog({ item, data, today, onClose }: { item: VirtualAsset | null; data: VirtualOverview; today: string; onClose: (saved: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [f, setF] = useState<VirtualFields>(item?.fields ?? blank());
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [stuck, setStuck] = useState(false);
  useEffect(() => { dialog.current?.showModal(); document.getElementById('virtual-name')?.focus(); return () => dialog.current?.close(); }, []);
  const set = <K extends keyof VirtualFields>(k: K, v: VirtualFields[K]) => setF(x => ({ ...x, [k]: v }));
  const frozen = busy || stuck;
  const linked = f.kind !== 'license' && !!f.plan_id;
  const plan = data.plans.find(p => p.id === f.plan_id);
  // A link to a plan now in Recently Deleted stays selectable only for this item.
  const deletedLink = !!f.plan_id && !plan;
  async function save() {
    if (!f.name.trim()) { setNotice('请填写名称。'); document.getElementById('virtual-name')?.focus(); return; }
    const fields: VirtualFields = { ...f, name: f.name.trim(), plan_id: f.kind === 'license' ? null : f.plan_id, ...(linked ? { price_cents: null, expires: null } : {}) };
    const input: VirtualSave = { request_id: crypto.randomUUID(), generation: data.generation, id: item?.id ?? null, expected_revision: item?.revision ?? null, fields };
    setBusy(true); setNotice('');
    try { await submit({ command: 'virtual_save', input, label: `虚拟资产 ${fields.name}` }); onClose(true); }
    catch (e) { if (e instanceof Unresolved) setStuck(true); setNotice(e instanceof Error ? e.message : errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="editor wealth-account-editor" aria-labelledby="virtual-heading" onCancel={e => { e.preventDefault(); if (!busy) onClose(false); }}><form noValidate onSubmit={e => { e.preventDefault(); void save(); }}>
    <header><div><p className="eyebrow">财富 · 虚拟资产</p><h2 id="virtual-heading">{item ? '编辑虚拟资产' : '新增虚拟资产'}</h2><p className="muted">只记档案、有效期和花费，不保存账号、密码或激活码。不再使用时打开“停用”，档案和花费仍保留。</p></div><button type="button" aria-label="关闭虚拟资产表单" disabled={busy} onClick={() => onClose(false)}>×</button><div className="editor-header-actions">{item && !stuck && <DeleteButton label="删除" disabled={busy} kind="virtual" id={item.id} revision={item.revision} generation={data.generation} name={`虚拟资产 ${item.fields.name}`} onDone={() => onClose(true)} onError={(m, s) => { setNotice(m); setStuck(s); }}/>}{stuck ? <button type="button" onClick={() => onClose(false)}>关闭，稍后核对</button> : <button className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button>}</div></header>
    <section className="form-block">
      <FormRow label="名称"><input id="virtual-name" aria-label="名称" maxLength={80} value={f.name} disabled={frozen} onChange={e => set('name', e.target.value)} placeholder="例如 Final Cut Pro、my-site.cn"/></FormRow>
      <FormRow label="类型"><Segments label="类型" value={f.kind} disabled={frozen} options={virtualKinds.map(([value, label]) => ({ value, label }))} onChange={v => set('kind', v)}/></FormRow>
      <FormRow label={providerLabel[f.kind]}><input aria-label={providerLabel[f.kind]} maxLength={80} value={f.provider} disabled={frozen} onChange={e => set('provider', e.target.value)} placeholder="可留空"/></FormRow>
      <FormRow label="购买日期" hint="可留空"><DateInput id="virtual-purchase" value={f.purchase_date ?? ''} max={today} allowClear disabled={frozen} onChange={v => set('purchase_date', v || null)}/></FormRow>
      {f.kind !== 'license' && <FormRow label="关联周期计划" hint="关联后有效期与费用由计划的已付期推算"><select aria-label="关联周期计划" value={f.plan_id ?? ''} disabled={frozen} onChange={e => set('plan_id', e.target.value || null)}>
        <option value="">不关联，手填价格与有效期</option>
        {deletedLink && <option value={f.plan_id!}>（关联计划在最近删除中）</option>}
        {data.plans.map(p => { const taken = !!p.linked_to && p.id !== item?.fields.plan_id; return <option key={p.id} value={p.id} disabled={taken}>{p.name} · {intervalText(p.interval_months)}{taken ? `（已关联「${p.linked_to}」）` : ''}</option>; })}
      </select></FormRow>}
      {linked ? <p className="muted small virtual-linked-note">{deletedLink ? '关联的计划在最近删除中，恢复计划后才会继续推算有效期和费用。' : `有效期与已花费来自「${plan?.name}」已确认的付款，请在“周期费用”中确认每期付款。`}{item?.fields.plan_id === f.plan_id && item?.valid_until ? ` 当前有效至 ${item.valid_until}。` : ''}</p> : <>
        <FormRow label={priceLabel[f.kind]} hint="计入重要支出；可留空"><CentInput label={priceLabel[f.kind]} value={f.price_cents ?? ''} disabled={frozen} placeholder="0.00" onChange={v => set('price_cents', v || null)}/></FormRow>
        <FormRow label="有效至" hint={f.kind === 'license' ? '留空表示永久有效' : '留空显示为待补充'}><DateInput id="virtual-expires" value={f.expires ?? ''} allowClear disabled={frozen} onChange={v => set('expires', v || null)}/></FormRow>
      </>}
      <FormRow label="链接" hint="购买或管理页面"><input aria-label="链接" maxLength={2000} value={f.url} disabled={frozen} onChange={e => set('url', e.target.value)} placeholder="可留空"/></FormRow>
      {item && <FormRow label="停用" hint="不再使用；可随时撤回"><Switch label="停用" value={!!f.stopped_on} disabled={frozen} onChange={v => set('stopped_on', v ? today : null)}/></FormRow>}
      {item && f.stopped_on && <FormRow label="停用日期"><DateInput id="virtual-stopped" value={f.stopped_on} min={f.purchase_date ?? undefined} max={today} disabled={frozen} onChange={v => v && set('stopped_on', v)}/></FormRow>}
    </section>
    <section className="form-block form-notes"><label htmlFor="virtual-notes">备注</label><textarea id="virtual-notes" maxLength={10000} value={f.notes} disabled={frozen} onChange={e => set('notes', e.target.value)}/></section>
    {notice && <p className="notice" role="status">{notice}</p>}
  </form></dialog>;
}
