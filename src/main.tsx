import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AssetEditor, draftKey } from './AssetEditor';
import type { Draft, CloseIntent } from './AssetEditor';
import { emptyFields, errorMessage, fieldsOf, localDay, money } from './asset';
import type { AssetRecord, Page, Query } from './asset';
import { TrashPanel, TrashDialog, storedTrash } from './Trash';
import type { TrashAction } from './Trash';
import { SaleEditor } from './SaleEditor';
import { MaintenanceEditor } from './MaintenanceEditor';
import { maintenanceDraft as maintenanceFields, maintenanceKey, recoverMaintenance, refreshCostsForNewDay, storedMaintenance } from './maintenance';
import type { MaintenanceState, MaintenanceSession } from './maintenance';
import { WarrantyEditor } from './WarrantyEditor';
import { storedWarranty, warrantyDraft as warrantyFields, warrantyKey, recoverWarranty } from './warranty';
import type { WarrantyState, WarrantySession } from './warranty';
import { storedSale, saleKey, saleFields } from './sales';
import type { SaleDraft } from './sales';
import { LifecycleEditor } from './LifecycleEditor';
import { storedLifecycle, lifecycleKey, stateLabel } from './lifecycle';
import type { LifecycleDraft, LifecycleAction } from './lifecycle';
import { Cover } from './Photos';
import { Icon, AssetOverview, AssetFacts, AssetDetail } from './AssetViews';
import { MaterialLibrary } from './MaterialLibrary';
import { useTaxonomy } from './useTaxonomy';
import TaxonomyManager from './TaxonomyManager';
import { CategoryFilter } from './TaxonomyFields';
import { validateTaxonomyName } from './taxonomy';
import './taxonomy.css';
import './style.css';
import './app-layout.css';
const defaultQuery: Query = { search: '', filter: 'all', category: { mode: 'all' }, sort: 'created', descending: true, offset: 0, warranty: 'all' };
function storedDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (d && typeof d.generation === 'string' && Object.keys(emptyFields).every(k => typeof d.fields?.[k] === 'string' && typeof d.original?.[k] === 'string')) return d;
  } catch { /* Invalid local draft must not prevent the library from loading. */ }
  return null;
}
function TaxonomyCloseNotice({ onKeep }: { onKeep: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="editor" aria-labelledby="taxonomy-close-heading" onCancel={e => { e.preventDefault(); onKeep(); }}><h2 id="taxonomy-close-heading">分类资料尚未处理完</h2><p>请先保存或取消草稿；结果待确认的操作需要重新加载核对。</p><button autoFocus onClick={onKeep}>返回设置继续处理</button></dialog>;
}
function App() {
  const [section, setSection] = useState<'assets' | 'materials' | 'trash' | 'settings'>('assets');
  const [trashAction, setTrashAction] = useState<TrashAction | null>(null);
  const [trashRecovery, setTrashRecovery] = useState<TrashAction | null>(storedTrash);
  const [lifecycleDraft, setLifecycleDraft] = useState<LifecycleDraft | null>(null);
  const [saleDraft, setSaleDraft] = useState<SaleDraft | null>(null);
  const [maintenanceDraft, setMaintenanceDraft] = useState<MaintenanceSession | null>(null);
  const [maintenanceRecovery, setMaintenanceRecovery] = useState<MaintenanceState | null>(storedMaintenance);
  const [warrantyDraft, setWarrantyDraft] = useState<WarrantySession | null>(null);
  const [warrantyRecovery, setWarrantyRecovery] = useState<WarrantyState | null>(storedWarranty);
  const [saleRecovery, setSaleRecovery] = useState<SaleDraft | null>(storedSale);
  const [lifecycleRecovery, setLifecycleRecovery] = useState<LifecycleDraft | null>(storedLifecycle);
  const [trashVersion, setTrashVersion] = useState(0);
  const [query, setQuery] = useState(defaultQuery);
  const [page, setPage] = useState<Page | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AssetRecord | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [recovered, setRecovered] = useState<Draft | null>(storedDraft);
  const [closeIntent, setCloseIntent] = useState<CloseIntent | null>(null);
  const [today, setToday] = useState(localDay);
  const loadedDay = useRef(today);
  const maintenanceOpening = useRef(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('possio.theme') || 'system');
  const [eventsReady, setEventsReady] = useState(false);
  const menuAction = useRef<(action: string) => void>(() => {});
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const queryTicket = useRef(0), detailTicket = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null), collectionRef = useRef<HTMLDivElement>(null), listScroll = useRef(0);
  const [taxonomyDirty, setTaxonomyDirty] = useState(false);
  const taxonomy = useTaxonomy(() => { void refresh(); if (selected) void select(selected.asset.id); setTrashVersion(v => v + 1); });
  const taxonomyGuard = taxonomyDirty || taxonomy.busy || taxonomy.blocked;
  useEffect(() => { void invoke('set_editing', { editing: !!draft || !!trashAction || !!lifecycleDraft || !!lifecycleRecovery || !!saleDraft || !!saleRecovery || !!maintenanceDraft || !!maintenanceRecovery || !!warrantyDraft || !!warrantyRecovery || taxonomyGuard }).catch(e => setNotice(errorMessage(e))); }, [draft, trashAction, lifecycleDraft, lifecycleRecovery, saleDraft, saleRecovery, maintenanceDraft, maintenanceRecovery, warrantyDraft, warrantyRecovery, taxonomyGuard]);
  async function refresh(q = query) {
    const ticket = ++queryTicket.current; setLoading(true); setLoadError('');
    try { const result = await invoke<Page>('list_assets', { query: q }); if (ticket === queryTicket.current) { setPage(result); setToday(result.today); if (q.offset > 0 && !result.items.length) setQuery({ ...q, offset: Math.max(0, Math.ceil(result.total / 100) * 100 - 100) }); } }
    catch (e) { if (ticket === queryTicket.current) setLoadError(errorMessage(e)); }
    finally { if (ticket === queryTicket.current) setLoading(false); }
  }
  useEffect(() => { void refresh(query); }, [query]);
  useEffect(() => {
    const subscription = listen<boolean>('close-intent', event => setCloseIntent(event.payload ? 'quit' : 'window'));
    const actions = listen<string>('asset-action', event => menuAction.current(event.payload));
    void Promise.all([subscription, actions]).then(() => setEventsReady(true)).catch(e => setNotice(errorMessage(e)));
    const timer = window.setInterval(() => setToday(localDay()), 60000);
    return () => { void subscription.then(off => off()); void actions.then(off => off()); clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (loadedDay.current === today) return;
    const previousDay = loadedDay.current; loadedDay.current = today;
    void refreshCostsForNewDay(previousDay, today, () => refresh(), detailId, selected?.asset.id ?? null, id => select(id));
  }, [today]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme; localStorage.setItem('possio.theme', theme);
    void invoke('set_appearance', { appearance: theme }).catch(e => setNotice(errorMessage(e)));
  }, [theme]);
  menuAction.current = action => {
    if (draft || trashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (action === 'new-asset') void openEditor(null);
    if (action === 'find-asset') { setSection('assets'); setDetailId(null); requestAnimationFrame(() => searchRef.current?.focus()); }
    if (action === 'edit-asset' && section === 'assets' && selected && !selected.deleted) void openEditor(selected);
  };
  function adjust(part: Partial<Query>) {
    if (part.search !== undefined || part.filter !== undefined || part.category !== undefined) {
      // A result-scope change must also invalidate any in-flight summary read.
      ++detailTicket.current; setSelected(null); setDetailError(''); setDetailLoading(false);
    }
    setQuery(q => ({ ...q, ...part, offset: 0 }));
  }
  async function select(id: string, full = false) {
    const ticket = ++detailTicket.current; setDetailLoading(true); setDetailError('');
    if (full) { if (!detailId) listScroll.current = collectionRef.current?.scrollTop ?? 0; setDetailId(id); requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }); }
    try { const r = await invoke<AssetRecord | null>('read_asset', { id }); if (ticket === detailTicket.current) { setSelected(r); if (!r) setDetailError('找不到这件物品。'); else if (r.deleted) setDetailError('这件物品已移入最近删除。'); } }
    catch (e) { if (ticket === detailTicket.current) { setSelected(null); setDetailError(errorMessage(e)); } }
    finally { if (ticket === detailTicket.current) setDetailLoading(false); }
  }
  async function openEditor(record: AssetRecord | null, resume = false) {
    if (!page || !eventsReady || draft || trashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (taxonomyGuard || taxonomy.loading || taxonomy.loadError || !taxonomy.snapshot || taxonomy.snapshot.generation !== page.generation) { setSection('settings'); setNotice('请先保存或取消分类草稿，并完成分类资料读取。'); return; }
    if (trashRecovery) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    if (record?.deleted) { setSection('trash'); return; }
    if (recovered && !resume) { setNotice('还有一份未保存的草稿，请先恢复处理。'); return; }
    opener.current = document.activeElement as HTMLElement;
    if (!detailId) listScroll.current = collectionRef.current?.scrollTop ?? 0;
    try {
      await invoke('set_editing', { editing: true });
      const fields = record ? fieldsOf(record) : { ...emptyFields };
      const next = resume && recovered ? recovered : { fields, original: { ...fields }, classification: { ...(record?.classification ?? { category_id: null, channel_id: null }) }, originalClassification: { ...(record?.classification ?? { category_id: null, channel_id: null }) }, photos: record?.photos ?? [], cover: record?.cover_id ?? null, originalMedia: { photos: record?.photos ?? [], cover: record?.cover_id ?? null }, photoError: '', generation: page.generation, id: record?.asset.id ?? null, revision: record?.asset.revision ?? null, pending: null };
      setSection('assets'); setCloseIntent(null); setDraft(next);
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeEditor(intent: CloseIntent) {
    localStorage.removeItem(draftKey); setRecovered(null); setDraft(null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : newRef.current)?.focus());
  }
  function saved(record: AssetRecord) {
    setDraft(null); setRecovered(null); setCloseIntent(null); setSelected(record); setDetailId(record.asset.id);
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('资料已保存。'); void refresh(); void taxonomy.reload().catch(() => {});
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  function back() {
    setSection('assets'); setDetailId(null);
    if (selected && !page?.items.some(r => r.asset.id === selected.asset.id)) setNotice('刚才的物品不在当前结果页中。筛选和搜索已保留，可清除条件重新查找。');
    requestAnimationFrame(() => { (document.getElementById('asset-' + selected?.asset.id) || searchRef.current)?.focus({ preventScroll: true }); if (collectionRef.current) collectionRef.current.scrollTop = listScroll.current; });
  }
  async function openTrash(record: AssetRecord, generation: string, deleted: boolean, resume?: TrashAction) {
    if (!eventsReady || draft || trashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (taxonomyGuard) { setSection('settings'); setNotice('请先保存或取消分类草稿，并核对待确认操作。'); return; }
    if (recovered) { setNotice('请先处理未保存的编辑草稿，再删除或恢复。'); return; }
    if (trashRecovery && !resume) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true }); setCloseIntent(null);
      setTrashAction(resume || { record, pending: false, input: { request_id: crypto.randomUUID(), generation, asset_id: record.asset.id, expected_revision: record.asset.revision, deleted } });
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeTrash(intent: CloseIntent) {
    await invoke('set_editing', { editing: taxonomyGuard });
    setTrashAction(null); setTrashRecovery(storedTrash()); setCloseIntent(null);
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : newRef.current)?.focus());
  }
  function trashDone(record: AssetRecord) {
    void closeTrash('form').catch(e => setNotice(errorMessage(e)));
    ++detailTicket.current; setDetailLoading(false); setDetailError('');
    setTrashVersion(v => v + 1); setTrashRecovery(null);
    if (record.deleted) {
      setSelected(null); setDetailId(null); setSection('assets');
      setNotice('物品已在最近删除中，资料和图片仍保留。');
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSelected(record); setDetailId(record.asset.id); setSection('assets');
      setNotice('物品已恢复到我的物品，原档案保持完整。');
    }
    void refresh(); void taxonomy.reload().catch(() => {});
  }
  async function openLifecycle(record: AssetRecord, action: LifecycleAction, resume?: LifecycleDraft) {
    if (!page || !eventsReady || draft || trashAction || lifecycleDraft || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (recovered || trashRecovery || (lifecycleRecovery && !resume) || taxonomyGuard) { setNotice('请先处理已有草稿或待确认操作，再变更状态。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true });
      const next = resume ?? { record, generation: page.generation, action, original: { ...action }, pending: null };
      localStorage.setItem(lifecycleKey, JSON.stringify(next));
      setCloseIntent(null); setLifecycleDraft(next);
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeLifecycle(intent: CloseIntent) {
    localStorage.removeItem(lifecycleKey); setLifecycleDraft(null); setLifecycleRecovery(null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  }
  function lifecycleSaved(record: AssetRecord) {
    setLifecycleDraft(null); setLifecycleRecovery(null); setCloseIntent(null);
    ++detailTicket.current; setDetailLoading(false); setDetailError('');
    setSelected(record); setDetailId(record.asset.id); setSection('assets');
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('状态记录已保存，原档案和持有资料保持完整。'); void refresh(); setTrashVersion(v => v + 1);
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  async function openSale(record: AssetRecord, mode: SaleDraft['mode'], resume?: SaleDraft) {
    if (!page || !eventsReady || draft || trashAction || lifecycleDraft || saleDraft || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (recovered || trashRecovery || lifecycleRecovery || (saleRecovery && !resume) || taxonomyGuard) { setNotice('请先处理已有草稿或待确认操作，再处理售出。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true });
      const fields = saleFields(record, today);
      const next = resume ?? { record, generation: page.generation, mode, fields, original: { ...fields }, pending: null };
      localStorage.setItem(saleKey, JSON.stringify(next));
      setCloseIntent(null); setSaleDraft(next);
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeSale(intent: CloseIntent) {
    localStorage.removeItem(saleKey); setSaleDraft(null); setSaleRecovery(null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  }
  function saleSaved(record: AssetRecord) {
    setSaleDraft(null); setSaleRecovery(null); setCloseIntent(null);
    ++detailTicket.current; setDetailLoading(false); setDetailError('');
    setSelected(record); setDetailId(record.asset.id); setSection('assets');
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('售出操作已保存，原档案和图片保持完整。'); void refresh(); setTrashVersion(v => v + 1);
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  async function openMaintenance(record: AssetRecord, id?: string, resume?: MaintenanceState) {
    if (maintenanceOpening.current || !page || !eventsReady || draft || trashAction || lifecycleDraft || saleDraft || maintenanceDraft || warrantyDraft || warrantyRecovery || taxonomyGuard) return;
    if (recovered || trashRecovery || lifecycleRecovery || saleRecovery || (maintenanceRecovery && !resume) || warrantyDraft || warrantyRecovery) { setNotice('请先处理已有草稿或待确认操作，再记录维护。'); return; }
    maintenanceOpening.current = true;
    opener.current = document.activeElement as HTMLElement;
    try {
      const fields = maintenanceFields(record, id);
      const photos = id ? record.maintenances.find(item => item.id === id)?.photos ?? [] : [];
      const saved = resume ?? { record, generation: page.generation, maintenance_id: id, fields, original: { ...fields, photo_ids: [...fields.photo_ids] }, photos, pending: null };
      const current = await invoke<{ generation: string }>('taxonomy_snapshot');
      const result = await recoverMaintenance(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
      if (result.kind === 'saved') { localStorage.removeItem(maintenanceKey); maintenanceSaved(result.record); return; }
      localStorage.setItem(maintenanceKey, JSON.stringify(result.state));
      await invoke('set_editing', { editing: true });
      setCloseIntent(null); setMaintenanceDraft(result);
    }
    catch (e) { setNotice(errorMessage(e)); }
    finally { maintenanceOpening.current = false; }
  }
  async function closeMaintenance(intent: CloseIntent, keepDraft = false) {
    if (!keepDraft) localStorage.removeItem(maintenanceKey);
    setMaintenanceDraft(null); setMaintenanceRecovery(keepDraft ? storedMaintenance() : null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  }
  function maintenanceSaved(record: AssetRecord) {
    setMaintenanceDraft(null); setMaintenanceRecovery(null); setCloseIntent(null);
    ++detailTicket.current; setDetailLoading(false); setDetailError('');
    setSelected(record); setDetailId(record.asset.id); setSection('assets');
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('维护记录已保存，并已计入成本摘要。'); void refresh(); setTrashVersion(v => v + 1);
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  const warrantyOpening = useRef(false);
  async function openWarranty(record: AssetRecord, id?: string, resume?: WarrantyState) {
    if (warrantyOpening.current || !page || !eventsReady || draft || trashAction || lifecycleDraft || saleDraft || maintenanceDraft || maintenanceRecovery || warrantyDraft || taxonomyGuard) return;
    if (recovered || trashRecovery || lifecycleRecovery || saleRecovery || maintenanceDraft || maintenanceRecovery || (warrantyRecovery && !resume)) { setNotice('请先处理已有草稿或待确认操作，再添加保障。'); return; }
    warrantyOpening.current = true;
    opener.current = document.activeElement as HTMLElement;
    try {
      const fields = warrantyFields(record, id);
      const photos = id ? record.warranties?.find(item => item.id === id)?.photos ?? [] : [];
      const saved = resume ?? { record, generation: page.generation, warranty_id: id, fields, original: { ...fields, photo_ids: [...fields.photo_ids] }, photos, pending: null };
      const current = await invoke<{ generation: string }>('taxonomy_snapshot');
      const result = await recoverWarranty(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
      if (result.kind === 'saved') { localStorage.removeItem(warrantyKey); warrantySaved(result.record); return; }
      localStorage.setItem(warrantyKey, JSON.stringify(result.state));
      await invoke('set_editing', { editing: true });
      setCloseIntent(null); setWarrantyDraft(result);
    }
    catch (e) { setNotice(errorMessage(e)); }
    finally { warrantyOpening.current = false; }
  }
  async function closeWarranty(intent: CloseIntent, keepDraft = false) {
    if (!keepDraft) localStorage.removeItem(warrantyKey);
    setWarrantyDraft(null); setWarrantyRecovery(keepDraft ? storedWarranty() : null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  }
  function warrantySaved(record: AssetRecord) {
    setWarrantyDraft(null); setWarrantyRecovery(null); setCloseIntent(null);
    ++detailTicket.current; setDetailLoading(false); setDetailError('');
    setSelected(record); setDetailId(record.asset.id); setSection('assets');
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('保障记录已保存，持有状态与成本保持不变。'); void refresh(); setTrashVersion(v => v + 1);
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  const active = selected && !selected.deleted ? selected : null;
  const filtered = !!query.search || query.filter !== 'all' || (query.category?.mode ?? 'all') !== 'all' || (query.warranty ?? 'all') !== 'all';
  const statusItems = [ ['all', '全部资产', 'items'], ['active', '使用中', 'circle'], ['retired', '已退役', 'archive'], ['sold', '已售出', 'arrow'] ] as const;
  const collectionTitle = statusItems.find(([key]) => key === query.filter)?.[1] ?? '全部资产';
  function browseStatus(filter: string) { setSection('assets'); setDetailId(null); adjust({ filter }); }
  function identity(record: AssetRecord) { return <><Cover record={record} generation={page?.generation || ''} taxonomy={taxonomy.snapshot}/><span className="identity"><strong>{record.asset.name}</strong><small>{taxonomy.snapshot?.categories.find(c => c.id === record.classification?.category_id)?.name || '未分类'}</small></span></>; }
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Icon name="overview"/></span><div><strong>物志</strong><small>POSSIO</small></div></div>
      <nav aria-label="主导航"><button disabled title="总览将在后续阶段开放"><Icon name="overview"/><span>总览</span></button><p className="nav-caption">我的物品</p>
        {statusItems.map(([filter, label, icon]) => <button key={filter} className={section === 'assets' && query.filter === filter ? 'nav-active' : ''} aria-current={section === 'assets' && query.filter === filter ? 'page' : undefined} onClick={() => browseStatus(filter)}><Icon name={icon}/><span>{label}</span></button>)}
        <p className="nav-caption">记录与回顾</p><button disabled title="心愿清单将在后续阶段开放"><Icon name="heart"/><span>心愿清单</span></button><button disabled title="全局时间轴将在后续阶段开放"><Icon name="clock"/><span>时间轴</span></button><button disabled title="统计将在后续阶段开放"><Icon name="chart"/><span>统计</span></button>
      </nav><div className="sidebar-bottom"><nav aria-label="资料管理"><button className={section === 'materials' ? 'nav-active' : ''} aria-current={section === 'materials' ? 'page' : undefined} onClick={() => setSection('materials')}><Icon name="image"/><span>素材库</span></button><button className={section === 'trash' ? 'nav-active' : ''} onClick={() => setSection('trash')}><Icon name="trash"/><span>最近删除</span></button><button className={section === 'settings' ? 'nav-active' : ''} onClick={() => { setSection('settings'); void taxonomy.reload().catch(() => {}); }}><Icon name="settings"/><span>设置</span></button></nav><p className="local-status"><span className="local-dot"/>本地档案 · 仅保存在这台 Mac</p></div></aside>
    <main ref={mainRef} className={section === 'assets' && !detailId ? 'browse-main' : undefined}><div className="app-topbar"><span className="breadcrumb"><Icon name="items"/>我的物品 <span>／</span> {section === 'materials' ? '素材库' : section === 'trash' ? '最近删除' : section === 'settings' ? '设置' : detailId ? '物品详情' : collectionTitle}</span><div className="topbar-actions"><label className="search"><Icon name="search"/><input ref={searchRef} aria-label="搜索物品" placeholder="搜索物品" value={query.search} maxLength={200} onChange={e => { setSection('assets'); setDetailId(null); adjust({ search: e.target.value }); }}/><kbd>⌘F</kbd></label><button ref={newRef} className="primary" disabled={!page || !eventsReady || !!trashRecovery} onClick={() => void openEditor(null)}><Icon name="plus"/>新增资产</button></div></div>
      {!detailId || section !== 'assets' ? <header className="page-header"><div><h1>{section === 'materials' ? '素材库' : section === 'trash' ? '最近删除' : section === 'settings' ? '设置' : collectionTitle}</h1><p className="page-description">{section === 'materials' ? '新增资产时可以直接选用的图片。' : section === 'trash' ? '暂时收起的物品，随时可以找回。' : section === 'settings' ? '让这本档案用起来更顺手。' : '物品的来历、成本与每次变化，都在这里。'}</p></div><span className="header-note"><strong>我的资产档案</strong>截至 {today.replaceAll('-', ' / ')}</span></header> : null}
      {saleRecovery && !saleDraft && <div className="notice">有一份售出草稿或待确认操作。<button onClick={() => void openSale(saleRecovery.record, saleRecovery.mode, saleRecovery)}>恢复售出草稿</button></div>}
      {maintenanceRecovery && !maintenanceDraft && <div className="notice">有一份维护草稿或待确认操作。<button onClick={() => void openMaintenance(maintenanceRecovery.record, maintenanceRecovery.maintenance_id, maintenanceRecovery)}>恢复维护草稿</button></div>}
      {warrantyRecovery && !warrantyDraft && <div className="notice">有一份保障草稿或待确认操作。<button onClick={() => void openWarranty(warrantyRecovery.record, warrantyRecovery.warranty_id, warrantyRecovery)}>恢复保障草稿</button></div>}
      {lifecycleRecovery && !lifecycleDraft && <div className="notice">有一份状态草稿或待确认操作。<button onClick={() => void openLifecycle(lifecycleRecovery.record, lifecycleRecovery.action, lifecycleRecovery)}>恢复状态草稿</button></div>}
      {recovered && !draft && <div className="notice">有一份未保存或待确认的草稿。<button onClick={() => void openEditor(null, true)}>恢复草稿</button></div>}
      {trashRecovery && !trashAction && <div className="notice">有一次删除或恢复的结果待确认。<button onClick={() => void openTrash(trashRecovery.record, trashRecovery.input.generation, trashRecovery.input.deleted, trashRecovery)}>核对上次操作</button></div>}
      <section hidden={section !== 'settings'} className="settings-section"><section className="card appearance-settings"><h2>外观</h2><label className="theme">主题<select aria-label="外观" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></section><TaxonomyManager snapshot={taxonomy.snapshot} loading={taxonomy.loading} loadError={taxonomy.loadError} onReload={taxonomy.reload} onCommand={taxonomy.command} onDirtyChange={setTaxonomyDirty} validateName={(kind, name, id) => validateTaxonomyName(taxonomy.snapshot?.[kind === 'category' ? 'categories' : 'channels'] ?? [], kind, name, id)}/><section className="card"><h2>资料管理</h2><p className="muted">误删的物品可以找回，不会自动永久清空。</p><button onClick={() => setSection('trash')}>打开最近删除</button></section></section>
      {section === 'materials' && <MaterialLibrary generation={page?.generation || ''} onNotice={setNotice}/>}
      {section === 'trash' && <TrashPanel version={trashVersion} onRestore={(r, generation) => void openTrash(r, generation, false)}/>}
      {notice && <div className="status-line" role="status">{notice}{section === 'assets' && notice.includes('最近删除') && <button onClick={() => setSection('trash')}>前往最近删除</button>}{section === 'assets' && !detailId && filtered && <button onClick={() => adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' })}>清除条件</button>}</div>}
      <section hidden={section !== 'assets' || !!detailId} className="browse">
        {!loading && !loadError && page && page.total > 0 && <AssetOverview page={page} filtered={filtered}/>}
        <div className="browser-columns"><div className="collection" ref={collectionRef}>
          <div className="collection-toolbar"><span className="collection-count">{loading ? '正在读取…' : loadError ? '读取失败' : `${page?.total ?? 0} 件物品`}</span><div className="view-controls"><div className="segmented"><button aria-label="列表视图" title="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list"/></button><button aria-label="网格视图" title="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Icon name="grid"/></button></div></div></div>
          <details className="collection-options"><summary>筛选与排序{filtered ? ' · 已应用条件' : ''}</summary><div className="filter-controls"><label>资料<select aria-label="筛选资料" value={query.filter} onChange={e => adjust({ filter: e.target.value })}><option value="all">全部物品</option><option value="held">当前持有</option><option value="active">使用中</option><option value="retired">已退役</option><option value="sold">已售出</option><option value="missing_price">金额待补充</option><option value="missing_date">日期待补充</option></select></label><label>保障<select aria-label="筛选保障" value={query.warranty ?? 'all'} onChange={e => adjust({ warranty: e.target.value })}><option value="all">全部</option><option value="covered">有有效保障</option><option value="expiring">即将到期</option><option value="lapsed">有记录，当前无有效保障</option><option value="none">无保障记录</option></select></label><label>排序<select aria-label="排序方式" value={query.sort} onChange={e => adjust({ sort: e.target.value })}><option value="created">建档时间</option><option value="name">名称</option><option value="price">购入金额</option><option value="date">购入日期</option></select></label><button aria-label={query.descending ? '切换为升序' : '切换为降序'} onClick={() => adjust({ descending: !query.descending })}>{query.descending ? '↓' : '↑'}</button>{filtered && <button onClick={() => adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' })}>清除条件</button>}</div><CategoryFilter id="asset-category-filter" entries={taxonomy.snapshot?.categories ?? []} value={query.category ?? { mode: 'all' }} onChange={category => adjust({ category })} disabled={taxonomy.loading || !taxonomy.snapshot}/></details>
        {loadError ? <div className="empty error" role="alert"><h2>资料加载失败</h2><p>{loadError}</p><button onClick={() => void refresh()}>重新读取</button></div> : loading ? <p className="loading" role="status">正在读取本地资料…</p> : page && !page.items.length ? <div className="empty"><span className="empty-mark">▧</span><h2>{filtered ? '没有找到匹配的物品' : '从第一件物品开始'}</h2><p>{filtered ? '试试其他关键词，或清除当前条件。' : '先记下名字，价格、日期和故事都可以慢慢补。'}</p><button className="primary" onClick={() => filtered ? adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' }) : void openEditor(null)}>{filtered ? '清除条件' : '记录第一件物品'}</button></div> : <><div className={'items ' + view} aria-label="物品列表">
          {view === 'list' && <div className="list-head"><span>物品</span><span className="purchase-date">购入日期</span><button className="sort-price" onClick={() => adjust({ sort: 'price', descending: query.sort === 'price' ? !query.descending : true })} aria-label="按购入金额排序">购入金额 <Icon name="sort"/></button><span>状态</span></div>}
          {page?.items.map(record => <button key={record.asset.id} id={'asset-' + record.asset.id} className={'asset-row ' + (active?.asset.id === record.asset.id ? 'selected' : '')} aria-label={'查看 ' + record.asset.name} aria-pressed={active?.asset.id === record.asset.id} onClick={() => void select(record.asset.id)} onDoubleClick={() => void select(record.asset.id, true)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void select(record.asset.id, true); } }}><span className="asset-name">{identity(record)}</span><span className="muted purchase-date">{record.asset.purchase_date || '待补充'}</span><span className="amount">{money(record.asset.price_cents)}</span><span className="pill" data-state={record.lifecycle?.state ?? 'active'}>{stateLabel(record)}</span></button>)}
        </div><div className="collection-caption">{page?.total} 件物品<span>双击或按回车，打开完整档案</span></div><div className="pagination" hidden={!query.offset && (!page || page.total <= 100)}><button disabled={!query.offset} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - 100) }))}>上一页</button><span>第 {Math.floor(query.offset / 100) + 1} 页</span><button disabled={!page || query.offset + 100 >= page.total} onClick={() => setQuery(q => ({ ...q, offset: q.offset + 100 }))}>下一页</button></div></>}
        </div><aside className="summary" aria-label="资产摘要">{detailLoading ? <p role="status">正在读取档案…</p> : detailError ? <div role="alert"><p>{detailError}</p><button onClick={() => { setDetailError(''); setSelected(null); }}>关闭提示</button></div> : active ? <><div className="panel-top"><span>物品摘要</span><button aria-label="收起资产摘要" onClick={() => setSelected(null)}>×</button></div><div className="summary-cover"><Cover record={active} generation={page?.generation || ''} taxonomy={taxonomy.snapshot} large/></div><h2>{active.asset.name}</h2><p className="muted">{[active.details.brand, active.details.model].filter(Boolean).join(' · ') || '资料可以慢慢补全'} · <span className="pill" data-state={active.lifecycle?.state ?? 'active'}>{stateLabel(active)}</span></p><AssetFacts record={active} today={today} taxonomy={taxonomy.snapshot} compact/><button className="full-width" onClick={() => void select(active.asset.id, true)}>打开完整档案</button><button className="full-width" onClick={() => void openEditor(active)}>编辑资料 <kbd>⌘E</kbd></button></> : <div className="summary-empty"><span>←</span><p>选一件物品<br/>看看它的持有记录</p></div>}</aside>
        </div>
      </section>
      {section === 'assets' && detailId && <section className="detail"><button className="back" onClick={back}>← 返回物品列表</button>{detailLoading ? <p role="status">正在读取档案…</p> : detailError || !active ? <div className="empty" role="alert"><h2>{detailError || '找不到这件物品'}</h2>{selected?.deleted && <button onClick={() => setSection('trash')}>前往最近删除</button>}<button onClick={() => void select(detailId, true)}>重新读取</button></div> : <AssetDetail onMaintenance={id => void openMaintenance(active, id)} onWarranty={id => void openWarranty(active, id)} onSale={mode => void openSale(active, mode)} onLifecycle={action => void openLifecycle(active, action)} taxonomy={taxonomy.snapshot} record={active} generation={page?.generation || ''} today={today} onEdit={() => void openEditor(active)} onDelete={() => page && void openTrash(active, page.generation, true)}/> }</section>}
    </main>{maintenanceDraft && <MaintenanceEditor initial={maintenanceDraft} today={today} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={(intent, keepDraft) => { void closeMaintenance(intent, keepDraft).catch(e => setNotice(errorMessage(e))); }} onSaved={maintenanceSaved}/>} {warrantyDraft && <WarrantyEditor initial={warrantyDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={(intent, keepDraft) => { void closeWarranty(intent, keepDraft).catch(e => setNotice(errorMessage(e))); }} onSaved={warrantySaved}/>} {saleDraft && <SaleEditor initial={saleDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeSale(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={saleSaved}/>} {lifecycleDraft && <LifecycleEditor initial={lifecycleDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeLifecycle(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={lifecycleSaved}/>} {closeIntent && !draft && !trashAction && !lifecycleDraft && !saleDraft && !maintenanceDraft && !warrantyDraft && taxonomyGuard && <TaxonomyCloseNotice onKeep={() => { setCloseIntent(null); setSection('settings'); }}/>}{trashAction && <TrashDialog initial={trashAction} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeTrash(intent).catch(e => setNotice(errorMessage(e))); }} onDone={trashDone}/>} {draft && <AssetEditor taxonomy={taxonomy.snapshot} initial={draft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeEditor(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={saved}/>}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
