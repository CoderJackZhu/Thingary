import {clearUnsubmittedEditors} from './editor-session';
import {persistSubmission} from './editor-session';
import {NotificationNotice} from './NotificationNotice';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AssetEditor, draftKey } from './AssetEditor';
import type { Draft, CloseIntent } from './AssetEditor';
import { emptyFields, errorMessage, fieldsOf, localDay, money } from './asset';
import type { AssetRecord, Page, Photo, Query } from './asset';
import { TrashPanel, TrashDialog, storedTrash, RecordTrashDialog, storedRecordTrash, recordKindLabel } from './Trash';
import type { TrashAction, RecordTrashAction, RecordKind, TrashEntry } from './Trash';
import { SaleEditor } from './SaleEditor';
import { MaintenanceEditor } from './MaintenanceEditor';
import { maintenanceDraft as maintenanceFields, maintenanceKey, recoverMaintenance, refreshCostsForNewDay, storedMaintenance } from './maintenance';
import type { MaintenanceState, MaintenanceSession } from './maintenance';
import { WarrantyEditor } from './WarrantyEditor';
import { StoredDraftClose } from './StoredDraftClose';
import { storedWarranty, warrantyDraft as warrantyFields, warrantyKey, recoverWarranty, warrantyKinds } from './warranty';
import { UndoBar, offerUndo, useRestored } from './undo';
import { undoTarget } from './undo-shortcut';
import { BatchPanel, BatchDialog, batchVerb } from './Batch';
import type { BatchKind, BatchInput } from './Batch';
import { nextSelection } from './batch-select';
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
import { WishlistPanel } from './WishlistPanel';
import { SourceTimelinePage } from './Timeline';
import type { ScrollRestore } from './Timeline';
import { defaultTimeline, sourcePage, validReturn } from './source';
import type { ReturnContext, SourceFocus, SourceTarget, TimelineSelection } from './source';
import { OverviewPage } from './Overview';
import type { ReviewPage } from './review';
import { StatsPage } from './Stats';
import { WealthPage } from './WealthPage';
import { ExpensesPage } from './ExpensesPage';
import { RecurringPage } from './RecurringPage';
import { VirtualPage } from './VirtualPage';
import { DataManagement } from './DataManagement';
import { DemoSettings } from './DemoSettings';
import { initialSection, newAssetKey, pendingGenerations, resetKey, sectionKey } from './library-mode';
import type { DemoStatus, Section } from './library-mode';
import type { WishlistItem, WishlistQuery } from './wishlist';
import { storedWishlistChange, storedWishlistDraft, wishlistAbandonKey } from './wishlist';
import './taxonomy.css';
import './style.css';
import './app-layout.css';
import './desktop-polish.css';
const defaultQuery: Query = { search: '', filter: 'all', category: { mode: 'all' }, sort: 'created', descending: true, offset: 0, warranty: 'all' };
clearUnsubmittedEditors(localStorage);
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
  return <dialog ref={dialog} className="editor" aria-labelledby="taxonomy-close-heading" onCancel={e => { e.preventDefault(); onKeep(); }}><h2 id="taxonomy-close-heading">分类资料尚未处理完</h2><p>当前操作尚未完成，请返回设置核对保存结果。</p><button autoFocus onClick={onKeep}>返回设置继续处理</button></dialog>;
}
function App({ initialDemo }: { initialDemo: DemoStatus }) {
  const [demoStatus, setDemoStatus] = useState<DemoStatus>(initialDemo);
  const [featureEditing, setFeatureEditing] = useState(false), [dataBusy, setDataBusy] = useState(false), [modeBusy, setModeBusy] = useState(false);
  const [section, setSection] = useState<Section>(() => localStorage.getItem(resetKey) ? 'settings' : initialSection(sessionStorage));
  const [wishFocus, setWishFocus] = useState<Pick<WishlistQuery, 'search' | 'filter'> | null>(null);
  const [wishlistEditing, setWishlistEditing] = useState(() => !!storedWishlistDraft(localStorage) || !!storedWishlistChange(localStorage, wishlistAbandonKey));
  const [trashAction, setTrashAction] = useState<TrashAction | null>(null);
  const [trashRecovery, setTrashRecovery] = useState<TrashAction | null>(storedTrash);
  const [recordTrashAction, setRecordTrashAction] = useState<RecordTrashAction | null>(null);
  const [recordTrashRecovery, setRecordTrashRecovery] = useState<RecordTrashAction | null>(storedRecordTrash);
  const [lifecycleDraft, setLifecycleDraft] = useState<LifecycleDraft | null>(null);
  const [saleDraft, setSaleDraft] = useState<SaleDraft | null>(null);
  const [maintenanceDraft, setMaintenanceDraft] = useState<MaintenanceSession | null>(null);
  const [maintenanceRecovery, setMaintenanceRecovery] = useState<MaintenanceState | null>(storedMaintenance);
  const [warrantyDraft, setWarrantyDraft] = useState<WarrantySession | null>(null);
  const [warrantyRecovery, setWarrantyRecovery] = useState<WarrantyState | null>(storedWarranty);
  const [saleRecovery, setSaleRecovery] = useState<SaleDraft | null>(storedSale);
  const [lifecycleRecovery, setLifecycleRecovery] = useState<LifecycleDraft | null>(storedLifecycle);
  const [trashVersion, setTrashVersion] = useState(0);
  const [deleteAfterEdit, setDeleteAfterEdit] = useState<string | null>(null);
  // D19: multi-selection, its range anchor, the “选择” mode and the open batch table.
  const [multi, setMulti] = useState<string[]>([]), [anchor, setAnchor] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false), [batch, setBatch] = useState<BatchKind | null>(null), [batchVersion, setBatchVersion] = useState(0);
  const selectAllRef = useRef<() => void>(() => {});
  const [recordDeleteAfterEdit, setRecordDeleteAfterEdit] = useState<{ kind: RecordKind; id: string; assetId: string } | null>(null);
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
  const [reviewYear, setReviewYear] = useState<number | null>(() => Number(localDay().slice(0, 4)));
  // Q03 source navigation: one focus at a time, its return context, and the
  // timeline selection that survives a source roundtrip.
  const [sourceFocus, setSourceFocus] = useState<SourceFocus | null>(null);
  const sourceToken = useRef(0);
  const [returnContext, setReturnContext] = useState<ReturnContext | null>(null);
  const [pendingReturn, setPendingReturn] = useState<ReturnContext | null>(null);
  const [timelineSelection, setTimelineSelection] = useState<TimelineSelection>(defaultTimeline);
  const [expensesYear, setExpensesYear] = useState<number | null | undefined>(undefined);
  const loadedDay = useRef(today);
  const maintenanceOpening = useRef(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('possio.theme') || 'system');
  const [eventsReady, setEventsReady] = useState(false);
  const menuAction = useRef<(action: string) => void>(() => {});
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const queryTicket = useRef(0), detailTicket = useRef(0), focusDetail = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null), collectionRef = useRef<HTMLDivElement>(null), listScroll = useRef(0);
  const [taxonomyDirty, setTaxonomyDirty] = useState(false);
  const taxonomy = useTaxonomy(() => { void refresh(); if (selected) void select(selected.asset.id); setTrashVersion(v => v + 1); });
  async function changeDemoMode(demo: boolean, reset = false, thenNewAsset = false) {
    if (modeBusy) return;
    if (modeBlocked || pendingGenerations(localStorage).length || document.querySelector('dialog[open]')) {
      setNotice('请先完成当前编辑或核对保存结果，再切换或重置样例。'); return;
    }
    if (!reset && localStorage.getItem(resetKey)) { setNotice('请在设置中先核对样例重置结果。'); return; }
    setModeBusy(true);
    try {
      if (reset) {
        const requestId = localStorage.getItem(resetKey) || crypto.randomUUID();
        localStorage.setItem(resetKey, requestId);
        await invoke('reset_demo', { requestId });
        localStorage.removeItem(resetKey);
      } else await invoke('switch_demo', { demo });
      sessionStorage.setItem(sectionKey, section);
      if (thenNewAsset) sessionStorage.setItem(newAssetKey, '1');
      location.reload();
    } catch (e) { setModeBusy(false); setNotice(errorMessage(e)); }
  }
  const taxonomyGuard = taxonomyDirty || taxonomy.busy || taxonomy.blocked;
  useEffect(() => { void invoke('set_editing', { editing: wishlistEditing || !!draft || !!trashAction || !!trashRecovery || !!recordTrashAction || !!recordTrashRecovery || !!lifecycleDraft || !!lifecycleRecovery || !!saleDraft || !!saleRecovery || !!maintenanceDraft || !!maintenanceRecovery || !!warrantyDraft || !!warrantyRecovery || taxonomyGuard }).catch(e => setNotice(errorMessage(e))); }, [wishlistEditing, draft, trashAction, trashRecovery, recordTrashAction, recordTrashRecovery, lifecycleDraft, lifecycleRecovery, saleDraft, saleRecovery, maintenanceDraft, maintenanceRecovery, warrantyDraft, warrantyRecovery, taxonomyGuard]);
  const modeBlocked = featureEditing || dataBusy || wishlistEditing || !!draft || !!recovered || !!trashAction || !!trashRecovery || !!recordTrashAction || !!recordTrashRecovery || !!lifecycleDraft || !!lifecycleRecovery || !!saleDraft || !!saleRecovery || !!maintenanceDraft || !!maintenanceRecovery || !!warrantyDraft || !!warrantyRecovery || taxonomyGuard;
  useEffect(() => { void invoke('set_library_busy', { busy: modeBlocked }).catch(e => setNotice(errorMessage(e))); }, [modeBlocked]);
  useEffect(() => {
    if (!modeBlocked) void invoke<DemoStatus>('demo_status').then(setDemoStatus).catch(e => setNotice(errorMessage(e)));
  }, [modeBlocked]);
  async function refresh(q = query) {
    const ticket = ++queryTicket.current; setLoading(true); setLoadError('');
    try { const result = await invoke<Page>('list_assets', { query: q }); if (ticket === queryTicket.current) { setPage(result); setToday(result.today); if (q.offset > 0 && !result.items.length) setQuery({ ...q, offset: Math.max(0, Math.ceil(result.total / 100) * 100 - 100) }); } }
    catch (e) { if (ticket === queryTicket.current) setLoadError(errorMessage(e)); }
    finally { if (ticket === queryTicket.current) setLoading(false); }
  }
  useEffect(() => { void refresh(query); }, [query]);
  // Opening the full record moves focus to its heading once it has loaded, like closing an editor does.
  useEffect(() => {
    if (!focusDetail.current || detailLoading || !detailId) return;
    focusDetail.current = false;
    document.getElementById('detail-heading')?.focus();
  }, [detailLoading, detailId, selected]);
  // The target page shows its own failure message; the App only clears the focus.
  const onSourceDone = () => setSourceFocus(null);
  function beginReturn() {
    if (!page) return;
    setReturnContext({ section, generation: page.generation, scroll: mainRef.current?.scrollTop ?? 0, reviewYear, timeline: timelineSelection });
  }
  /** Open a record from a stable target: validate first, then let the target
   * page locate it by ID. A failed source refreshes and explains; it never
   * lands on a same-named record or a fabricated new one. */
  function openSource(target: SourceTarget) {
    if (!page) return;
    beginReturn();
    // Synchronous like the other kinds: read_asset's own ticket drops a late
    // answer, and its not-found/deleted states explain an invalid source.
    if (target.kind === 'asset') { setDetailId(null); setSection('assets'); void select(target.id, true); return; }
    // A stale name search from an earlier asset→wish link must not filter the list behind the source.
    if (target.kind === 'wish') setWishFocus(null);
    setSourceFocus({ target, generation: page.generation, token: ++sourceToken.current });
    setDetailId(null);
    setSection(sourcePage(target));
  }
  /** Module links from the review keep its year and view; returning restores them. */
  function navigateFromReview(target: ReviewPage) {
    beginReturn();
    if (target === 'assets') adjust({ filter: 'all', search: '' });
    if (target === 'timeline') setTimelineSelection(s => ({ ...s, year: reviewYear }));
    if (target === 'expenses') setExpensesYear(reviewYear);
    setSection(target); setDetailId(null);
  }
  // An unconsumed focus is dropped when its page is left, so a later visit
  // never re-opens an editor the user already navigated away from.
  useEffect(() => {
    if (!sourceFocus || section === sourcePage(sourceFocus.target)) return;
    setSourceFocus(null);
  }, [section, sourceFocus]);
  // Returning to the originating section restores its year/filter state; the
  // scroll follows once that page has rendered real data (restoreScroll).
  useEffect(() => {
    if (!page || !returnContext || section !== returnContext.section) return;
    const context = validReturn(returnContext, page.generation);
    setReturnContext(null);
    if (!context) return;
    if (context.section === 'overview') setReviewYear(context.reviewYear);
    if (context.section === 'timeline') setTimelineSelection(context.timeline);
    setPendingReturn(context);
  }, [section, returnContext, page]);
  // The carried year is consumed by the expenses page's mount; clear it so a
  // later unrelated visit falls back to the default current year.
  useEffect(() => { if (section === 'expenses') setExpensesYear(undefined); }, [section]);
  const scrollRestore = (forSection: Section): ScrollRestore => pendingReturn && pendingReturn.section === forSection && section === forSection
    ? { top: pendingReturn.scroll, done: () => { if (mainRef.current) mainRef.current.scrollTop = pendingReturn.scroll; setPendingReturn(null); } }
    : null;
  useEffect(() => {
    if (demoStatus.active || !page || !eventsReady || taxonomy.snapshot?.generation !== page.generation || !sessionStorage.getItem(newAssetKey)) return;
    sessionStorage.removeItem(newAssetKey); setNotice('样例中不能新增资产，已回到我的资料。');
    void openEditor(null);
  }, [page, eventsReady, taxonomy.snapshot, demoStatus.active]);
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
    if (wishlistEditing || draft || trashAction || recordTrashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (action === 'new-asset') void openEditor(null);
    if (action === 'find-asset') { setSection('assets'); setDetailId(null); requestAnimationFrame(() => searchRef.current?.focus()); }
    if (action === 'edit-asset' && section === 'assets' && selected && !selected.deleted) void openEditor(selected);
    if (action === 'open-settings' && !trashRecovery && !recordTrashRecovery) { setSection('settings'); setDetailId(null); void taxonomy.reload().catch(() => {}); }
  };
  function adjust(part: Partial<Query>) {
    if (part.search !== undefined || part.filter !== undefined || part.category !== undefined || part.warranty !== undefined) {
      // Changing what the list shows clears a multi-selection (D19).
      setMulti([]); setAnchor(null);
    }
    if (part.search !== undefined || part.filter !== undefined || part.category !== undefined) {
      // A result-scope change must also invalidate any in-flight summary read.
      ++detailTicket.current; setSelected(null); setDetailError(''); setDetailLoading(false);
    }
    setQuery(q => ({ ...q, ...part, offset: 0 }));
  }
  async function select(id: string, full = false) {
    if (wishlistEditing) return;
    const ticket = ++detailTicket.current; setDetailLoading(true); setDetailError('');
    if (full) { focusDetail.current = true; if (!detailId) listScroll.current = collectionRef.current?.scrollTop ?? 0; setDetailId(id); requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }); }
    try { const r = await invoke<AssetRecord | null>('read_asset', { id }); if (ticket === detailTicket.current) { setSelected(r); if (!r) setDetailError('找不到这件物品。'); else if (r.deleted) setDetailError('这件物品已移入最近删除。'); } }
    catch (e) { if (ticket === detailTicket.current) { setSelected(null); setDetailError(errorMessage(e)); } }
    finally { if (ticket === detailTicket.current) setDetailLoading(false); }
  }
  async function openEditor(record: AssetRecord | null, resume = false, wish?: WishlistItem) {
    if ((wishlistEditing && !wish) || !demoStatus || !page || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (taxonomyGuard || taxonomy.loading || taxonomy.loadError || !taxonomy.snapshot || taxonomy.snapshot.generation !== page.generation) { setSection('settings'); setNotice('请先核对分类操作结果，并完成分类资料读取。'); return; }
    if (trashRecovery || recordTrashRecovery) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    if (record?.deleted) { setSection('trash'); return; }
    if (demoStatus.active && wish) { setNotice('样例中不能实现心愿：实现会新增一件资产。请回到我的资料后记录。'); return; }
    if (demoStatus.active && !record) { void changeDemoMode(false, false, true); return; }
    if (recovered && !resume) { setNotice('还有一次保存结果待确认，请先核对。'); return; }
    opener.current = document.activeElement as HTMLElement;
    if (!detailId) listScroll.current = collectionRef.current?.scrollTop ?? 0;
    try {
      await invoke('set_editing', { editing: true });
      const fields = record ? fieldsOf(record) : { ...emptyFields, name: wish?.fields.name ?? '', date: localDay() };
      const classification = record?.classification ?? { category_id: wish?.fields.category_id ?? null, channel_id: null };
      let photos = record?.photos ?? [], coverNotice = '';
      if (wish?.cover) {
        try { photos = [await invoke<Photo>('stage_wishlist_cover', { wishlistId: wish.id, generation: page.generation })]; }
        catch (e) { coverNotice = '心愿封面暂无法带入（' + errorMessage(e) + '），可不带封面继续，之后再补图。'; }
      }
      const cover = record?.cover_id ?? photos[0]?.id ?? null;
      const conversion = wish ? { wishlist_id: wish.id, expected_revision: wish.revision, wish_name: wish.fields.name, estimated_price_cents: wish.fields.estimated_price_cents, cover_notice: coverNotice } : undefined;
      const next = resume && recovered ? recovered : { options:record?.preferences?{preferences:record.preferences}:undefined, originalOptions:record?.preferences?{preferences:record.preferences}:undefined, conversion, fields, original: { ...fields }, classification: { ...classification }, originalClassification: { ...classification }, photos, cover, originalMedia: { photos, cover }, photoError: '', generation: page.generation, id: record?.asset.id ?? null, revision: record?.asset.revision ?? null, pending: null };
      if (!next.conversion) setSection('assets');
      setCloseIntent(null); setDraft(next);
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeEditor(intent: CloseIntent) {
    localStorage.removeItem(draftKey); setRecovered(null); setDraft(null); setCloseIntent(null);
    await invoke('set_editing', { editing: taxonomyGuard });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : newRef.current)?.focus());
  }
  function saved(record: AssetRecord) {
    void invoke<DemoStatus>('demo_status').then(setDemoStatus).catch(e => setNotice(errorMessage(e)));
    setDraft(null); setRecovered(null); setCloseIntent(null); setSelected(record); setDetailId(record.asset.id); setSection('assets');
    void invoke('set_editing', { editing: taxonomyGuard }).catch(e => setNotice(errorMessage(e)));
    setNotice('资料已保存。'); void refresh(); void taxonomy.reload().catch(() => {});
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  function back() {
    if (wishlistEditing) return;
    setSection('assets'); setDetailId(null);
    if (selected && !page?.items.some(r => r.asset.id === selected.asset.id)) setNotice('刚才的物品不在当前结果页中。筛选和搜索已保留，可清除条件重新查找。');
    requestAnimationFrame(() => { (document.getElementById('asset-' + selected?.asset.id) || searchRef.current)?.focus({ preventScroll: true }); if (collectionRef.current) collectionRef.current.scrollTop = listScroll.current; });
  }
  async function openTrash(record: AssetRecord, generation: string, deleted: boolean, resume?: TrashAction) {
    if (wishlistEditing || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (taxonomyGuard) { setSection('settings'); setNotice('请先核对分类操作结果。'); return; }
    if (recovered) { setNotice('请先核对上次保存结果，再删除或恢复。'); return; }
    if (trashRecovery && !resume) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    if (recordTrashRecovery) { setNotice('请先核对上次维护或保障删除的结果。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true }); setCloseIntent(null);
      setTrashAction(resume || { record, pending: false, input: { request_id: crypto.randomUUID(), generation, asset_id: record.asset.id, expected_revision: record.asset.revision, deleted } });
    } catch (e) { setNotice(errorMessage(e)); }
  }
  useEffect(() => {
    if (!deleteAfterEdit || draft || !page) return;
    const id = deleteAfterEdit, generation = page.generation; setDeleteAfterEdit(null);
    void invoke<AssetRecord | null>('read_asset', { id }).then(r => r && !r.deleted ? openTrash(r, generation, true) : setNotice('这件物品已不在我的物品中。')).catch(e => setNotice(errorMessage(e)));
  }, [deleteAfterEdit, draft]);
  useEffect(() => {
    if (!recordDeleteAfterEdit || maintenanceDraft || warrantyDraft || !page) return;
    const { kind, id, assetId } = recordDeleteAfterEdit, generation = page.generation; setRecordDeleteAfterEdit(null);
    void invoke<AssetRecord | null>('read_asset', { id: assetId }).then(r => {
      if (!r || r.deleted) { setNotice('所属物品已不在我的物品中。'); return; }
      const title = kind === 'maintenance'
        ? r.maintenances.find(m => m.id === id)?.fields.title || '维护记录'
        : (() => { const w = (r.warranties ?? []).find(x => x.id === id); return w ? `${warrantyKinds.find(([k]) => k === w.fields.kind)?.[1] ?? '保障'}${w.fields.provider ? ' · ' + w.fields.provider : ''}` : '保障记录'; })();
      return openRecordTrash(kind, id, assetId, title, r.asset.name, generation, r.asset.revision, true);
    }).catch(e => setNotice(errorMessage(e)));
  }, [recordDeleteAfterEdit, maintenanceDraft, warrantyDraft]);
  useRestored(() => { setNotice(''); setTrashVersion(v => v + 1); setBatchVersion(v => v + 1); void refresh(); if (detailId) void select(detailId, true); });
  function clearSelection() { setMulti([]); setAnchor(null); setSelecting(false); }
  function rowClick(e: { metaKey: boolean; shiftKey: boolean }, id: string) {
    if (!e.metaKey && !e.shiftKey && !selecting) { setMulti([]); setAnchor(id); void select(id); return; }
    const next = nextSelection(multi, anchor, id, page?.items.map(r => r.asset.id) ?? [], { meta: e.metaKey, shift: e.shiftKey, toggle: selecting }, active?.asset.id ?? null);
    setAnchor(next.anchor);
    if (next.ids.length === 1 && !selecting) { setMulti([]); void select(next.ids[0]); return; }
    setMulti(next.ids);
  }
  function batchDone(input: BatchInput, changed: number) {
    setBatch(null); setBatchVersion(v => v + 1); setTrashVersion(v => v + 1); void refresh();
    if (input.action === 'delete') { clearSelection(); setSelected(null); }
    const done = input.action === 'delete' ? `已删除 ${changed} 件，可从“最近删除”逐件恢复。` : `已${batchVerb[input.action]} ${changed} 件。`;
    setNotice(done);
    offerUndo(done, async () => {
      const out = await invoke<{ changed: number; skipped: number }>('batch_undo', { input: { request_id: crypto.randomUUID(), generation: input.generation, batch_request_id: input.request_id } });
      return out.skipped ? `已撤销 ${out.changed} 件；${out.skipped} 件之后被改过，保持不变。` : `已撤销 ${out.changed} 件。`;
    });
  }
  selectAllRef.current = () => {
    if (section !== 'assets' || detailId || !page) return;
    void invoke<string[]>('asset_ids', { query }).then(ids => { setMulti(ids); setAnchor(null); if (ids.length === 1) void select(ids[0]); }).catch(e => setNotice(errorMessage(e)));
  };
  useEffect(() => {
    // ⌘A arrives from the native 全选 item: text fields keep selecting text.
    const off = listen<string>('asset-action', event => {
      if (event.payload !== 'select-all') return;
      if (undoTarget(document.activeElement, false, false) === 'text') { document.execCommand('selectAll'); return; }
      if (!document.querySelector('dialog[open]')) selectAllRef.current();
    });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { setMulti([]); setSelecting(false); } };
    window.addEventListener('keydown', esc);
    return () => { void off.then(stop => stop()); window.removeEventListener('keydown', esc); };
  }, []);
  useEffect(() => { if (section !== 'assets' || detailId) clearSelection(); }, [section, detailId]);
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
      const generation = trashAction?.input.generation ?? page?.generation ?? '';
      offerUndo(`已删除「${record.asset.name}」。`, async () => { await invoke<AssetRecord>('change_trash', { input: { request_id: crypto.randomUUID(), generation, asset_id: record.asset.id, expected_revision: record.asset.revision, deleted: false } }); });
      requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setSelected(record); setDetailId(record.asset.id); setSection('assets');
      setNotice('物品已恢复到我的物品，原档案保持完整。');
    }
    void refresh(); void taxonomy.reload().catch(() => {});
  }
  async function openRecordTrash(kind: RecordKind, recordId: string, assetId: string, title: string, assetName: string, generation: string, revision: number, deleted: boolean, resume?: RecordTrashAction) {
    if (wishlistEditing || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || lifecycleRecovery || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (taxonomyGuard) { setSection('settings'); setNotice('请先核对分类操作结果。'); return; }
    if (recovered || trashRecovery || (recordTrashRecovery && !resume)) { setNotice('请先处理待确认操作，再删除或恢复记录。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true }); setCloseIntent(null);
      setRecordTrashAction(resume || { pending: false, input: { request_id: crypto.randomUUID(), generation, asset_id: assetId, record_id: recordId, kind, expected_revision: revision, deleted }, meta: { title, assetName } });
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeRecordTrash(intent: CloseIntent) {
    await invoke('set_editing', { editing: taxonomyGuard });
    setRecordTrashAction(null); setRecordTrashRecovery(storedRecordTrash()); setCloseIntent(null);
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : newRef.current)?.focus());
  }
  function recordTrashDone(record: AssetRecord, input: RecordTrashAction['input']) {
    void closeRecordTrash('form').catch(e => setNotice(errorMessage(e)));
    setTrashVersion(v => v + 1); setRecordTrashRecovery(null);
    if (selected?.asset.id === input.asset_id) setSelected(record);
    void refresh();
    if (input.deleted) {
      setNotice(`${recordKindLabel[input.kind]}已移入最近删除，统计与摘要已更新。`);
      offerUndo(`已删除${recordKindLabel[input.kind]}。`, async () => { await invoke<AssetRecord>('change_record_trash', { input: { ...input, request_id: crypto.randomUUID(), expected_revision: record.asset.revision, deleted: false } }); });
      if (detailId === input.asset_id) void select(input.asset_id);
    } else {
      setNotice(`${recordKindLabel[input.kind]}已恢复，重新计入详情与摘要。`);
      if (detailId === input.asset_id) void select(input.asset_id, true);
    }
  }
  async function openLifecycle(record: AssetRecord, action: LifecycleAction, resume?: LifecycleDraft) {
    if (wishlistEditing || !page || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || saleDraft || saleRecovery || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (recovered || trashRecovery || recordTrashRecovery || (lifecycleRecovery && !resume) || taxonomyGuard) { setNotice('请先处理待确认操作，再变更状态。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true });
      const next = resume ?? { record, generation: page.generation, action, original: { ...action }, pending: null };
      persistSubmission(lifecycleKey, next);
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
    if (wishlistEditing || !page || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || saleDraft || maintenanceDraft || maintenanceRecovery || warrantyDraft || warrantyRecovery) return;
    if (recovered || trashRecovery || recordTrashRecovery || lifecycleRecovery || (saleRecovery && !resume) || taxonomyGuard) { setNotice('请先处理待确认操作，再处理售出。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true });
      const fields = saleFields(record, today);
      const next = resume ?? { record, generation: page.generation, mode, fields, original: { ...fields }, pending: null };
      persistSubmission(saleKey, next);
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
    if (wishlistEditing || maintenanceOpening.current || !page || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || saleDraft || maintenanceDraft || warrantyDraft || warrantyRecovery || taxonomyGuard) return;
    if (recovered || trashRecovery || recordTrashRecovery || lifecycleRecovery || saleRecovery || (maintenanceRecovery && !resume) || warrantyDraft || warrantyRecovery) { setNotice('请先处理待确认操作，再记录维护。'); return; }
    maintenanceOpening.current = true;
    opener.current = document.activeElement as HTMLElement;
    try {
      const fields = maintenanceFields(record, id);
      const photos = id ? record.maintenances.find(item => item.id === id)?.photos ?? [] : [];
      const saved = resume ?? { record, generation: page.generation, maintenance_id: id, fields, original: { ...fields, photo_ids: [...fields.photo_ids] }, photos, pending: null };
      const current = await invoke<{ generation: string }>('taxonomy_snapshot');
      const result = await recoverMaintenance(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
      if (result.kind === 'saved') { localStorage.removeItem(maintenanceKey); maintenanceSaved(result.record); return; }
      persistSubmission(maintenanceKey, result.state);
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
    if (wishlistEditing || warrantyOpening.current || !page || !eventsReady || draft || trashAction || recordTrashAction || lifecycleDraft || saleDraft || maintenanceDraft || maintenanceRecovery || warrantyDraft || taxonomyGuard) return;
    if (recovered || trashRecovery || recordTrashRecovery || lifecycleRecovery || saleRecovery || maintenanceDraft || maintenanceRecovery || (warrantyRecovery && !resume)) { setNotice('请先处理待确认操作，再添加保障。'); return; }
    warrantyOpening.current = true;
    opener.current = document.activeElement as HTMLElement;
    try {
      const fields = warrantyFields(record, id);
      const photos = id ? record.warranties?.find(item => item.id === id)?.photos ?? [] : [];
      const saved = resume ?? { record, generation: page.generation, warranty_id: id, fields, original: { ...fields, photo_ids: [...fields.photo_ids] }, photos, pending: null };
      const current = await invoke<{ generation: string }>('taxonomy_snapshot');
      const result = await recoverWarranty(saved, current.generation, id => invoke<AssetRecord | null>('read_asset', { id }), (request, generation) => invoke<AssetRecord | null>('saved_request', { request, generation }));
      if (result.kind === 'saved') { localStorage.removeItem(warrantyKey); warrantySaved(result.record); return; }
      persistSubmission(warrantyKey, result.state);
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
  const storedDraftClosing = closeIntent && !wishlistEditing && !draft && !trashAction && !recordTrashAction && !lifecycleDraft && !saleDraft && !maintenanceDraft && !warrantyDraft && !taxonomyGuard && (trashRecovery || recordTrashRecovery || lifecycleRecovery || saleRecovery || maintenanceRecovery || warrantyRecovery);
  const filtered = !!query.search || query.filter !== 'all' || (query.category?.mode ?? 'all') !== 'all' || (query.warranty ?? 'all') !== 'all';
  const statusItems = [ ['all', '全部资产', 'items', 'all'], ['active', '使用中', 'circle', 'all'], ['held', '保障中', 'shield', 'covered'], ['retired', '已退役', 'archive', 'all'], ['sold', '已售出', 'arrow', 'all'] ] as const;
  const statusKey = (query.warranty ?? 'all') + query.filter;
  const collectionTitle = statusItems.find(([f, , , w]) => w + f === statusKey)?.[1] ?? '全部资产';
  function browseStatus(filter: string, warranty: string) { if (wishlistEditing) return; setSection('assets'); setDetailId(null); adjust({ filter, warranty }); }
  function identity(record: AssetRecord) { return <><Cover record={record} generation={page?.generation || ''} taxonomy={taxonomy.snapshot}/><span className="identity"><strong>{record.asset.name}</strong><small>{taxonomy.snapshot?.categories.find(c => c.id === record.classification?.category_id)?.name || '未分类'}</small></span></>; }
  return <div className="shell">{!demoStatus.active && <NotificationNotice/>}{storedDraftClosing && <StoredDraftClose intent={closeIntent!} onKeep={() => setCloseIntent(null)} pendingOnly={!!(trashRecovery || recordTrashRecovery) && !(lifecycleRecovery || saleRecovery || maintenanceRecovery || warrantyRecovery)}/>}<aside className="sidebar"><div className="brand"><span className="brand-mark"><Icon name="overview"/></span><div><strong>物志</strong><small>POSSIO</small></div></div>
      <nav aria-label="主导航"><button className={section === 'overview' ? 'nav-active' : ''} aria-current={section === 'overview' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('overview'); setDetailId(null); }}><Icon name="overview"/><span>总览</span></button><p className="nav-caption">我的物品</p>
        {statusItems.map(([filter, label, icon, warranty]) => <button key={label} className={section === 'assets' && statusKey === warranty + filter ? 'nav-active' : ''} aria-current={section === 'assets' && statusKey === warranty + filter ? 'page' : undefined} disabled={wishlistEditing} onClick={() => browseStatus(filter, warranty)}><Icon name={icon}/><span>{label}</span></button>)}
        <p className="nav-caption">记录与回顾</p><button className={section === 'wishlist' ? 'nav-active' : ''} aria-current={section === 'wishlist' ? 'page' : undefined} onClick={() => { setWishFocus(null); setSection('wishlist'); setDetailId(null); }}><Icon name="heart"/><span>心愿清单</span></button><button className={section === 'timeline' ? 'nav-active' : ''} aria-current={section === 'timeline' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('timeline'); setDetailId(null); }}><Icon name="clock"/><span>时间轴</span></button><button className={section === 'stats' ? 'nav-active' : ''} aria-current={section === 'stats' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('stats'); setDetailId(null); }}><Icon name="chart"/><span>统计</span></button>
        <p className="nav-caption">财富</p><button className={section === 'wealth' ? 'nav-active' : ''} aria-current={section === 'wealth' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('wealth'); setDetailId(null); }}><Icon name="wallet"/><span>账户与盘点</span></button><button className={section === 'expenses' ? 'nav-active' : ''} aria-current={section === 'expenses' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('expenses'); setDetailId(null); }}><Icon name="receipt"/><span>重要支出</span></button><button className={section === 'recurring' ? 'nav-active' : ''} aria-current={section === 'recurring' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('recurring'); setDetailId(null); }}><Icon name="repeat"/><span>周期费用</span></button><button className={section === 'virtual' ? 'nav-active' : ''} aria-current={section === 'virtual' ? 'page' : undefined} disabled={wishlistEditing} onClick={() => { setSection('virtual'); setDetailId(null); }}><Icon name="cloud"/><span>虚拟资产</span></button>
      </nav><div className="sidebar-bottom"><nav aria-label="资料管理"><button className={section === 'materials' ? 'nav-active' : ''} aria-current={section === 'materials' ? 'page' : undefined} disabled={wishlistEditing || !!(trashRecovery || recordTrashRecovery)} onClick={() => setSection('materials')}><Icon name="image"/><span>素材库</span></button><button className={section === 'trash' ? 'nav-active' : ''} disabled={wishlistEditing} onClick={() => setSection('trash')}><Icon name="trash"/><span>最近删除</span></button><button className={section === 'settings' ? 'nav-active' : ''} disabled={wishlistEditing || !!(trashRecovery || recordTrashRecovery)} onClick={() => { setSection('settings'); void taxonomy.reload().catch(() => {}); }}><Icon name="settings"/><span>设置</span></button></nav><div className="theme-switch" data-mode={theme} role="group" aria-label="切换外观"><button type="button" aria-label="浅色模式" title="浅色模式" aria-pressed={theme==='light'} onClick={() => setTheme('light')}><Icon name="sun"/></button><button type="button" aria-label="深色模式" title="深色模式" aria-pressed={theme==='dark'} onClick={() => setTheme('dark')}><Icon name="moon"/></button><button type="button" aria-label="跟随系统" title="跟随系统" aria-pressed={theme==='system'} onClick={() => setTheme('system')}><Icon name="system"/></button></div><p className="local-status" title="本地档案 · 仅保存在这台 Mac"><span className="local-dot"/>本地档案 · 仅本机</p></div></aside>
    <main ref={mainRef} className={section === 'assets' && !detailId ? 'browse-main' : undefined}><div className="app-topbar"><span className="breadcrumb"><Icon name={section === 'overview' ? 'overview' : section === 'stats' ? 'chart' : section === 'wealth' ? 'wallet' : section === 'expenses' ? 'receipt' : section === 'recurring' ? 'repeat' : section === 'virtual' ? 'cloud' : section === 'wishlist' ? 'heart' : section === 'timeline' ? 'clock' : 'items'}/>{section === 'overview' ? '物志' : section === 'stats' ? '记录与回顾' : section === 'wealth' || section === 'expenses' || section === 'recurring' || section === 'virtual' ? '财富' : section === 'wishlist' ? '心愿清单' : section === 'timeline' ? '记录与回顾' : '我的物品'} <span>／</span> {section === 'overview' ? '总览' : section === 'stats' ? '统计' : section === 'wealth' ? '账户与盘点' : section === 'expenses' ? '重要支出' : section === 'recurring' ? '周期费用' : section === 'virtual' ? '虚拟资产' : section === 'wishlist' ? '购买前记录' : section === 'timeline' ? '时间轴' : section === 'materials' ? '素材库' : section === 'trash' ? '最近删除' : section === 'settings' ? '设置' : detailId ? '物品详情' : collectionTitle}</span>{section !== 'wishlist' && <div className="topbar-actions"><label className="search"><Icon name="search"/><input ref={searchRef} aria-label="搜索物品" placeholder="搜索物品" value={query.search} maxLength={200} disabled={wishlistEditing} onChange={e => { setSection('assets'); setDetailId(null); adjust({ search: e.target.value }); }}/><kbd>⌘F</kbd></label><button ref={newRef} className="primary" disabled={wishlistEditing || !page || !eventsReady || !!trashRecovery || !!recordTrashRecovery} onClick={() => void openEditor(null)}><Icon name="plus"/><span>新增资产</span><kbd>⌘N</kbd></button></div>}</div>
      {(demoStatus.active || !demoStatus.started) && demoStatus.available && <div className="demo-banner" role="status"><strong>{demoStatus.active ? '样例体验' : '我的资料'}</strong><span>{demoStatus.active ? '正在使用独立虚构资料。编辑、删除和付款只留在样例中，不发送系统通知；样例不接受新增资产（含实现心愿），新增资产会回到我的资料。' : '从任意模块开始记录；保存第一条资料后，下次直接进入这里。'}</span><button type="button" disabled={modeBusy || modeBlocked || !!localStorage.getItem(resetKey)} onClick={() => void changeDemoMode(!demoStatus.active)}>{demoStatus.active ? demoStatus.started ? '返回我的资料' : '开始记录我的资料' : '查看样例'}</button></div>}
      {modeBusy && <p className="notice" role="status">正在准备资料，请稍候…</p>}

      {!detailId || section !== 'assets' ? <header className="page-header"><div><h1>{section === 'overview' ? '总览' : section === 'stats' ? '统计' : section === 'wealth' ? '账户与盘点' : section === 'expenses' ? '重要支出' : section === 'recurring' ? '周期费用' : section === 'virtual' ? '虚拟资产' : section === 'wishlist' ? '心愿清单' : section === 'timeline' ? '时间轴' : section === 'materials' ? '素材库' : section === 'trash' ? '最近删除' : section === 'settings' ? '设置' : collectionTitle}</h1><p className="page-description">{section === 'overview' ? '持有多少、花了多少，以及最近发生了什么。' : section === 'stats' ? '从分类、状态、持有周期和售出回收，看清物品的变化。' : section === 'wealth' ? '定期核对各平台的余额与欠款，积累自己的净资产曲线。' : section === 'expenses' ? '回顾大额消费：物品购入与维护自动汇总，没有对应物品的花费单独记一笔。' : section === 'recurring' ? '房租、订阅、保险等定期付的钱：看清固定负担，逐期确认实际付款。' : section === 'virtual' ? '买断的软件、注册的域名和订阅的服务：什么时候到期，一共花了多少。' : section === 'wishlist' ? '把想要的物品先记下来；实现后会同步加入资产档案。' : section === 'timeline' ? '这些年，物品与心愿都经历了什么。' : section === 'materials' ? '新增资产时可以直接选用的图片。' : section === 'trash' ? '暂时收起的物品，随时可以找回。' : section === 'settings' ? '让这本档案用起来更顺手。' : '物品的来历、成本与每次变化，都在这里。'}</p></div><span className="header-note"><strong>{section === 'wishlist' ? '购买前记录' : section === 'wealth' || section === 'expenses' || section === 'recurring' || section === 'virtual' ? '我的财富记录' : '我的资产档案'}</strong>截至 {today.replaceAll('-', ' / ')}</span></header> : null}
      {wishlistEditing && section !== 'wishlist' && <div className="notice">有一次心愿保存结果待确认，请先处理。<button onClick={() => { setSection('wishlist'); setDetailId(null); }}>前往心愿清单</button></div>}
      {saleRecovery && !saleDraft && <div className="notice">有一次售出操作结果待确认。<button disabled={wishlistEditing} onClick={() => void openSale(saleRecovery.record, saleRecovery.mode, saleRecovery)}>核对售出结果</button></div>}
      {maintenanceRecovery && !maintenanceDraft && <div className="notice">有一次维护操作结果待确认。<button disabled={wishlistEditing} onClick={() => void openMaintenance(maintenanceRecovery.record, maintenanceRecovery.maintenance_id, maintenanceRecovery)}>核对维护结果</button></div>}
      {warrantyRecovery && !warrantyDraft && <div className="notice">有一次保障操作结果待确认。<button disabled={wishlistEditing} onClick={() => void openWarranty(warrantyRecovery.record, warrantyRecovery.warranty_id, warrantyRecovery)}>核对保障结果</button></div>}
      {lifecycleRecovery && !lifecycleDraft && <div className="notice">有一次状态操作结果待确认。<button disabled={wishlistEditing} onClick={() => void openLifecycle(lifecycleRecovery.record, lifecycleRecovery.action, lifecycleRecovery)}>核对状态结果</button></div>}
      {recovered && !draft && <div className="notice">有一次保存结果待确认。<button disabled={wishlistEditing} onClick={() => void openEditor(null, true)}>核对保存结果</button></div>}
      {trashRecovery && !trashAction && <div className="notice">有一次删除或恢复的结果待确认。<button disabled={wishlistEditing} onClick={() => void openTrash(trashRecovery.record, trashRecovery.input.generation, trashRecovery.input.deleted, trashRecovery)}>核对上次操作</button></div>}
      {recordTrashRecovery && !recordTrashAction && <div className="notice">有一次维护或保障删除/恢复的结果待确认。<button disabled={wishlistEditing} onClick={() => void openRecordTrash(recordTrashRecovery.input.kind, recordTrashRecovery.input.record_id, recordTrashRecovery.input.asset_id, recordTrashRecovery.meta.title, recordTrashRecovery.meta.assetName, recordTrashRecovery.input.generation, recordTrashRecovery.input.expected_revision, recordTrashRecovery.input.deleted, recordTrashRecovery)}>核对上次操作</button></div>}
      {section === 'settings' && <section className="settings-section"><TaxonomyManager snapshot={taxonomy.snapshot} loading={taxonomy.loading} loadError={taxonomy.loadError} onReload={taxonomy.reload} onCommand={taxonomy.command} onDirtyChange={setTaxonomyDirty} validateName={(kind, name, id) => validateTaxonomyName(taxonomy.snapshot?.[kind === 'category' ? 'categories' : 'channels'] ?? [], kind, name, id)}/><div className="settings-data-column">{demoStatus.available && <DemoSettings status={demoStatus} blocked={modeBusy || modeBlocked} onSwitch={() => void changeDemoMode(!demoStatus.active)} onReset={() => void changeDemoMode(true, true)}/>}<DataManagement onBusyChange={setDataBusy} generation={page?.generation ?? null} demo={!!demoStatus?.active} blocked={wishlistEditing || taxonomyGuard || !!draft || !!(trashRecovery || recordTrashRecovery)} onTrash={() => setSection('trash')}/></div></section>}
      {section === 'materials' && <MaterialLibrary onBusyChange={setDataBusy} generation={page?.generation || ''} onNotice={setNotice}/>}
      {section === 'wealth' && <WealthPage today={today} onEditingChange={setFeatureEditing} source={sourceFocus} onSourceDone={onSourceDone}/>}
      {section === 'recurring' && <RecurringPage today={today} onEditingChange={setFeatureEditing} source={sourceFocus} onSourceDone={onSourceDone}/>}
      {section === 'virtual' && <VirtualPage today={today} onEditingChange={setFeatureEditing} source={sourceFocus} onSourceDone={onSourceDone}/>}
      {section === 'expenses' && <ExpensesPage onEditingChange={setFeatureEditing} today={today} initialYear={expensesYear} onOpenAsset={id => { setSection('assets'); void select(id, true); }} source={sourceFocus} onSourceDone={onSourceDone}/>}
      {section === 'stats' && <StatsPage onOpenAsset={id => { setSection('assets'); void select(id, true); }}/>}
      {section === 'overview' && !modeBusy && page && <OverviewPage key={page.generation} generation={page.generation} today={today} version={page} year={reviewYear} onYear={setReviewYear} onNavigate={navigateFromReview} onOpenSource={openSource} restoreScroll={scrollRestore('overview')} onBrowse={() => { setSection('assets'); setDetailId(null); adjust({ filter: 'all', search: '' }); }}/>}
      {section === 'timeline' && <SourceTimelinePage selection={timelineSelection} onSelection={setTimelineSelection} version={page ?? undefined} onOpenSource={openSource} restoreScroll={scrollRestore('timeline')}/>}
      {section === 'wishlist' && <WishlistPanel
        taxonomy={taxonomy.snapshot}
        closeIntent={closeIntent}
        onKeepClose={() => setCloseIntent(null)}
        onFinishClose={intent => { setCloseIntent(null); void invoke('finish_close', { quit: intent === 'quit' }); }}
        onEditingChange={setWishlistEditing}
        focus={wishFocus}
        onConvert={item => void openEditor(null, false, item)}
        onOpenAsset={id => { setSection('assets'); void select(id, true); }}
        onOpenTrash={() => setSection('trash')}
        source={sourceFocus}
        onSourceDone={onSourceDone}
      />}
      {section === 'trash' && <TrashPanel version={trashVersion} onRestoreAsset={(id, generation) => void (async () => {
        try {
          const record = await invoke<AssetRecord | null>('read_asset', { id });
          if (!record) { setNotice('找不到这件物品，请重新读取最近删除。'); return; }
          void openTrash(record, generation, false);
        } catch (e) { setNotice(errorMessage(e)); }
      })()} onRestoreRecord={(entry: TrashEntry, generation) => {
        if ((entry.kind !== 'maintenance' && entry.kind !== 'warranty') || !entry.asset_id) return;
        const title = entry.title || (entry.kind === 'maintenance' ? '维护记录' : '保障记录');
        void openRecordTrash(entry.kind, entry.id, entry.asset_id, title, entry.asset_name ?? '', generation, entry.asset_revision, false);
      }}/>}
      {notice && <div className="status-line" role="status">{notice}{section === 'assets' && notice.includes('最近删除') && <button onClick={() => setSection('trash')}>前往最近删除</button>}{section === 'assets' && !detailId && filtered && <button onClick={() => adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' })}>清除条件</button>}</div>}
      <section hidden={section !== 'assets' || !!detailId} className="browse">
        {!loading && !loadError && page && page.total > 0 && <AssetOverview page={page} filtered={filtered}/>}
        <div className="browser-columns"><div className="collection" ref={collectionRef}>
          <div className="collection-toolbar"><span className="collection-count">{loading ? '正在读取…' : loadError ? '读取失败' : `${page?.total ?? 0} 件物品${multi.length ? ` · 已选 ${multi.length} 件` : ''}`}</span><div className="view-controls">{selecting && !!page?.total && <button className="batch-select-all" onClick={() => multi.length === page.total ? setMulti([]) : selectAllRef.current?.()}>{multi.length === page.total ? '取消全选' : '全选'}</button>}<div className="segmented"><button aria-label={selecting ? '完成选择' : '选择多件'} title={selecting ? '完成选择' : '选择多件'} aria-pressed={selecting} onClick={() => { if (selecting) clearSelection(); else { setSelecting(true); setMulti(active ? [active.asset.id] : []); } }}><Icon name="select"/></button></div><div className="segmented"><button aria-label="列表视图" title="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list"/></button><button aria-label="网格视图" title="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Icon name="grid"/></button></div></div></div>
          <details className="collection-options"><summary>筛选与排序{filtered ? ' · 已应用条件' : ''}</summary><div className="filter-controls"><label>资料<select aria-label="筛选资料" value={query.filter} onChange={e => adjust({ filter: e.target.value })}><option value="all">全部物品</option><option value="held">当前持有</option><option value="active">使用中</option><option value="retired">已退役</option><option value="sold">已售出</option><option value="missing_price">金额待补充</option><option value="missing_date">日期待补充</option></select></label><label>保障<select aria-label="筛选保障" value={query.warranty ?? 'all'} onChange={e => adjust({ warranty: e.target.value })}><option value="all">全部</option><option value="covered">有有效保障</option><option value="expiring">即将到期</option><option value="lapsed">有记录，当前无有效保障</option><option value="none">无保障记录</option></select></label><label>排序<select aria-label="排序方式" value={query.sort} onChange={e => adjust({ sort: e.target.value })}><option value="created">建档时间</option><option value="name">名称</option><option value="price">购入金额</option><option value="date">购入日期</option></select></label><button aria-label={query.descending ? '切换为升序' : '切换为降序'} onClick={() => adjust({ descending: !query.descending })}>{query.descending ? '↓' : '↑'}</button>{filtered && <button onClick={() => adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' })}>清除条件</button>}</div><CategoryFilter id="asset-category-filter" entries={taxonomy.snapshot?.categories ?? []} value={query.category ?? { mode: 'all' }} onChange={category => adjust({ category })} disabled={taxonomy.loading || !taxonomy.snapshot}/></details>
        {loadError ? <div className="empty error" role="alert"><h2>资料加载失败</h2><p>{loadError}</p><button onClick={() => void refresh()}>重新读取</button></div> : loading ? <p className="loading" role="status">正在读取本地资料…</p> : page && !page.items.length ? <div className="empty"><span className="empty-mark">▧</span><h2>{filtered ? '没有找到匹配的物品' : '从第一件物品开始'}</h2><p>{filtered ? '试试其他关键词，或清除当前条件。' : '先记下名字，价格、日期和故事都可以慢慢补。'}</p><button className="primary" onClick={() => filtered ? adjust({ search: '', filter: 'all', category: { mode: 'all' }, warranty: 'all' }) : void openEditor(null)}>{filtered ? '清除条件' : '记录第一件物品'}</button></div> : <><div className={'items ' + view} aria-label="物品列表">
          {view === 'list' && <div className="list-head"><span>物品</span><span className="purchase-date">购入日期</span><button className="sort-price" onClick={() => adjust({ sort: 'price', descending: query.sort === 'price' ? !query.descending : true })} aria-label="按购入金额排序">购入金额 <Icon name="sort"/></button><span>状态</span></div>}
          {page?.items.map(record => <button key={record.asset.id} id={'asset-' + record.asset.id} className={'asset-row ' + ((multi.length ? multi.includes(record.asset.id) : active?.asset.id === record.asset.id) ? 'selected' : '')} aria-label={'查看 ' + record.asset.name} aria-pressed={multi.length ? multi.includes(record.asset.id) : active?.asset.id === record.asset.id} disabled={wishlistEditing} onClick={e => rowClick(e, record.asset.id)} onDoubleClick={e => { if (!e.metaKey && !e.shiftKey && !selecting) void select(record.asset.id, true); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void select(record.asset.id, true); } }}><span className="asset-name">{selecting && <span className="batch-check" aria-hidden="true">{multi.includes(record.asset.id) && <svg viewBox="0 0 16 16"><path d="M4.5 8.3 7 10.7l4.6-5"/></svg>}</span>}{identity(record)}</span><span className="muted purchase-date">{record.asset.purchase_date || '待补充'}</span><span className="amount">{money(record.asset.price_cents)}</span><span className="pill" data-state={record.lifecycle?.state ?? 'active'}>{stateLabel(record)}</span></button>)}
        </div><div className="collection-caption">{page?.total} 件物品<span>双击或按回车，打开完整档案</span></div><div className="pagination" hidden={!query.offset && (!page || page.total <= 100)}><button disabled={!query.offset} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - 100) }))}>上一页</button><span>第 {Math.floor(query.offset / 100) + 1} 页</span><button disabled={!page || query.offset + 100 >= page.total} onClick={() => setQuery(q => ({ ...q, offset: q.offset + 100 }))}>下一页</button></div></>}
        </div><aside className="summary" aria-label="资产摘要">{multi.length >= 2 || (selecting && multi.length >= 1) ? <BatchPanel ids={multi} version={batchVersion} onClear={clearSelection} onOpen={setBatch}/> : detailLoading ? <p role="status">正在读取档案…</p> : detailError ? <div role="alert"><p>{detailError}</p><button onClick={() => { setDetailError(''); setSelected(null); }}>关闭提示</button></div> : active ? <><div className="summary-body"><div className="panel-top"><span>物品摘要</span><button aria-label="收起资产摘要" onClick={() => setSelected(null)}>×</button></div><div className="summary-cover"><Cover record={active} generation={page?.generation || ''} taxonomy={taxonomy.snapshot} large/></div><h2>{active.asset.name}</h2><p className="muted">{[active.details.brand, active.details.model].filter(Boolean).join(' · ') || '资料可以慢慢补全'} · <span className="pill" data-state={active.lifecycle?.state ?? 'active'}>{stateLabel(active)}</span></p><AssetFacts record={active} today={today} taxonomy={taxonomy.snapshot} compact/></div><div className="summary-actions"><button className="full-width" onClick={() => void select(active.asset.id, true)}>打开完整档案</button><button className="full-width" onClick={() => void openEditor(active)}>编辑资料 <kbd>⌘E</kbd></button></div></> : <div className="summary-empty"><span>←</span><p>选一件物品<br/>看看它的持有记录</p></div>}</aside>
        </div>
      </section>
      {section === 'assets' && detailId && <section className="detail"><button className="back" disabled={wishlistEditing} onClick={back}>← 返回物品列表</button>{detailLoading ? <p role="status">正在读取档案…</p> : detailError || !active ? <div className="empty" role="alert"><h2>{detailError || '找不到这件物品'}</h2>{selected?.deleted && <button disabled={wishlistEditing} onClick={() => setSection('trash')}>前往最近删除</button>}<button disabled={wishlistEditing} onClick={() => void select(detailId, true)}>重新读取</button></div> : <AssetDetail onOpenWish={() => { setWishFocus(active.origin_wishlist ? { search: active.origin_wishlist.name, filter: 'achieved' } : null); setSection('wishlist'); setDetailId(null); }} onMaintenance={id => void openMaintenance(active, id)} onWarranty={id => void openWarranty(active, id)} onSale={mode => void openSale(active, mode)} onLifecycle={action => void openLifecycle(active, action)} taxonomy={taxonomy.snapshot} record={active} generation={page?.generation || ''} today={today} onEdit={() => void openEditor(active)}/> }</section>}
    </main>{maintenanceDraft && <MaintenanceEditor initial={maintenanceDraft} today={today} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={(intent, keepDraft) => { void closeMaintenance(intent, keepDraft).catch(e => setNotice(errorMessage(e))); }} onSaved={maintenanceSaved} onDelete={id => { const assetId = maintenanceDraft.state.record.asset.id; void closeMaintenance('form').then(() => setRecordDeleteAfterEdit({ kind: 'maintenance', id, assetId })).catch(e => setNotice(errorMessage(e))); }}/>} {warrantyDraft && <WarrantyEditor initial={warrantyDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={(intent, keepDraft) => { void closeWarranty(intent, keepDraft).catch(e => setNotice(errorMessage(e))); }} onSaved={warrantySaved} onDelete={id => { const assetId = warrantyDraft.state.record.asset.id; void closeWarranty('form').then(() => setRecordDeleteAfterEdit({ kind: 'warranty', id, assetId })).catch(e => setNotice(errorMessage(e))); }}/>} {saleDraft && <SaleEditor initial={saleDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeSale(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={saleSaved}/>} {lifecycleDraft && <LifecycleEditor initial={lifecycleDraft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeLifecycle(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={lifecycleSaved}/>} {closeIntent && !draft && !trashAction && !recordTrashAction && !lifecycleDraft && !saleDraft && !maintenanceDraft && !warrantyDraft && taxonomyGuard && <TaxonomyCloseNotice onKeep={() => { setCloseIntent(null); setSection('settings'); }}/>}{trashAction && <TrashDialog initial={trashAction} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeTrash(intent).catch(e => setNotice(errorMessage(e))); }} onDone={trashDone}/>}{recordTrashAction && <RecordTrashDialog initial={recordTrashAction} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeRecordTrash(intent).catch(e => setNotice(errorMessage(e))); }} onDone={recordTrashDone}/>} {draft && <AssetEditor taxonomy={taxonomy.snapshot} initial={draft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeEditor(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={saved} onDelete={() => { const id = draft.id; void closeEditor('form').then(() => setDeleteAfterEdit(id)).catch(e => setNotice(errorMessage(e))); }}/>}{batch && page && <BatchDialog kind={batch} ids={multi} generation={page.generation} today={today} onClose={() => setBatch(null)} onDone={batchDone}/>}<UndoBar/></div>;
}
const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const generations = pendingGenerations(localStorage);
    if (generations.length > 1) throw new Error('发现属于不同资料的待核对请求，请保留资料并联系支持处理。');
    const status = await invoke<DemoStatus>('demo_status', { pendingGeneration: generations[0] ?? null });
    localStorage.removeItem('possio.first-real-asset.v1');
    root.render(<App initialDemo={status}/>);
  } catch (e) {
    root.render(<div className="empty" role="alert"><h2>资料暂未准备好</h2><p>{errorMessage(e)}</p><button onClick={() => void start()}>重新读取</button></div>);
  }
}
void start();
