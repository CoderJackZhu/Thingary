import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AssetEditor, draftKey } from './AssetEditor';
import type { Draft, CloseIntent } from './AssetEditor';
import { costs, emptyFields, errorMessage, fieldsOf, localDay, money } from './asset';
import type { AssetRecord, Page, Query } from './asset';
import { TrashPanel, TrashDialog, storedTrash } from './Trash';
import type { TrashAction } from './Trash';
import { Cover, Gallery } from './Photos';
import './style.css';
const defaultQuery: Query = { search: '', filter: 'all', sort: 'created', descending: true, offset: 0 };
function storedDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
    if (d && typeof d.generation === 'string' && Object.keys(emptyFields).every(k => typeof d.fields?.[k] === 'string' && typeof d.original?.[k] === 'string')) return d;
  } catch { /* Invalid local draft must not prevent the library from loading. */ }
  return null;
}
function timestamp(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN') : '旧记录未提供'; }
function App() {
  const [section, setSection] = useState<'assets' | 'trash' | 'settings'>('assets');
  const [trashAction, setTrashAction] = useState<TrashAction | null>(null);
  const [trashRecovery, setTrashRecovery] = useState<TrashAction | null>(storedTrash);
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
  const [theme, setTheme] = useState(() => localStorage.getItem('possio.theme') || 'system');
  const [eventsReady, setEventsReady] = useState(false);
  const menuAction = useRef<(action: string) => void>(() => {});
  const searchRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const queryTicket = useRef(0), detailTicket = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null), listScroll = useRef(0);
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
    document.documentElement.dataset.theme = theme; localStorage.setItem('possio.theme', theme);
    void invoke('set_appearance', { appearance: theme }).catch(e => setNotice(errorMessage(e)));
  }, [theme]);
  menuAction.current = action => {
    if (draft || trashAction) return;
    if (action === 'new-asset') void openEditor(null);
    if (action === 'find-asset') { setSection('assets'); setDetailId(null); requestAnimationFrame(() => searchRef.current?.focus()); }
    if (action === 'edit-asset' && section === 'assets' && selected && !selected.deleted) void openEditor(selected);
  };
  function adjust(part: Partial<Query>) { setQuery(q => ({ ...q, ...part, offset: 0 })); }
  async function select(id: string, full = false) {
    const ticket = ++detailTicket.current; setDetailLoading(true); setDetailError('');
    if (full) { if (!detailId) listScroll.current = mainRef.current?.scrollTop ?? 0; setDetailId(id); requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }); }
    try { const r = await invoke<AssetRecord | null>('read_asset', { id }); if (ticket === detailTicket.current) { setSelected(r); if (!r) setDetailError('找不到这件物品。'); else if (r.deleted) setDetailError('这件物品已移入最近删除。'); } }
    catch (e) { if (ticket === detailTicket.current) { setSelected(null); setDetailError(errorMessage(e)); } }
    finally { if (ticket === detailTicket.current) setDetailLoading(false); }
  }
  async function openEditor(record: AssetRecord | null, resume = false) {
    if (!page || !eventsReady || draft || trashAction) return;
    if (trashRecovery) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    if (record?.deleted) { setSection('trash'); return; }
    if (recovered && !resume) { setNotice('还有一份未保存的草稿，请先恢复处理。'); return; }
    opener.current = document.activeElement as HTMLElement;
    if (!detailId) listScroll.current = mainRef.current?.scrollTop ?? 0;
    try {
      await invoke('set_editing', { editing: true });
      const fields = record ? fieldsOf(record) : { ...emptyFields };
      const next = resume && recovered ? recovered : { fields, original: { ...fields }, photos: record?.photos ?? [], cover: record?.cover_id ?? null, originalMedia: { photos: record?.photos ?? [], cover: record?.cover_id ?? null }, photoError: '', generation: page.generation, id: record?.asset.id ?? null, revision: record?.asset.revision ?? null, pending: null };
      setSection('assets'); setCloseIntent(null); setDraft(next);
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeEditor(intent: CloseIntent) {
    localStorage.removeItem(draftKey); setRecovered(null); setDraft(null); setCloseIntent(null);
    await invoke('set_editing', { editing: false });
    if (intent !== 'form') await invoke('finish_close', { quit: intent === 'quit' });
    else requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : newRef.current)?.focus());
  }
  function saved(record: AssetRecord) {
    setDraft(null); setRecovered(null); setCloseIntent(null); setSelected(record); setDetailId(record.asset.id);
    void invoke('set_editing', { editing: false }).catch(e => setNotice(errorMessage(e)));
    setNotice('资料已保存。'); void refresh();
    requestAnimationFrame(() => document.getElementById('detail-heading')?.focus());
  }
  function back() {
    setSection('assets'); setDetailId(null);
    if (selected && !page?.items.some(r => r.asset.id === selected.asset.id)) setNotice('刚才的物品不在当前结果页中。筛选和搜索已保留，可清除条件重新查找。');
    requestAnimationFrame(() => { (document.getElementById('asset-' + selected?.asset.id) || searchRef.current)?.focus({ preventScroll: true }); if (mainRef.current) mainRef.current.scrollTop = listScroll.current; });
  }
  async function openTrash(record: AssetRecord, generation: string, deleted: boolean, resume?: TrashAction) {
    if (!eventsReady || draft || trashAction) return;
    if (recovered) { setNotice('请先处理未保存的编辑草稿，再删除或恢复。'); return; }
    if (trashRecovery && !resume) { setNotice('请先核对上次删除或恢复的结果。'); return; }
    opener.current = document.activeElement as HTMLElement;
    try {
      await invoke('set_editing', { editing: true }); setCloseIntent(null);
      setTrashAction(resume || { record, pending: false, input: { request_id: crypto.randomUUID(), generation, asset_id: record.asset.id, expected_revision: record.asset.revision, deleted } });
    } catch (e) { setNotice(errorMessage(e)); }
  }
  async function closeTrash(intent: CloseIntent) {
    await invoke('set_editing', { editing: false });
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
    void refresh();
  }
  const active = selected && !selected.deleted ? selected : null;
  const metric = active ? costs(active.asset, today) : null;
  const filtered = !!query.search || query.filter !== 'all';
  function identity(record: AssetRecord) { return <><Cover record={record} generation={page?.generation || ''}/><span className="identity"><strong>{record.asset.name}</strong><small>{[record.details.brand, record.details.model].filter(Boolean).join(' · ') || '未分类'}</small></span></>; }
  function recordFacts(record: AssetRecord, compact = false) {
    const c = costs(record.asset, today);
    return <><div className="metrics"><div><small>购入金额</small><strong>{money(record.asset.price_cents)}</strong></div><div><small>日均持有成本</small><strong>{money(c.daily)}</strong></div></div>
      {c.daily === null && <p className="muted small">补全购入金额和日期后，即可计算日均持有成本。</p>}
      <dl className="facts"><dt>购入日期</dt><dd>{record.asset.purchase_date || '待补充'}</dd><dt>持有天数</dt><dd>{c.days === null ? '待补充' : `${c.days} 天`}</dd><dt>分类</dt><dd>未分类</dd>{!compact && <><dt>品牌</dt><dd>{record.details.brand || '待补充'}</dd><dt>型号</dt><dd>{record.details.model || '待补充'}</dd><dt>序列号</dt><dd>{record.details.serial_number || '待补充'}</dd><dt>建档时间</dt><dd>{timestamp(record.created_at)}</dd><dt>修改时间</dt><dd>{timestamp(record.updated_at)}</dd></>}</dl></>;
  }
  return <div className="shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">物</span><div><strong>物志</strong><small>每件物品，都有来处</small></div></div><nav><button className={section === 'assets' ? 'nav-active' : ''} onClick={back}>▦ <span>我的物品</span></button><button className={section === 'trash' ? 'nav-active' : ''} onClick={() => setSection('trash')}>最近删除</button><button className={section === 'settings' ? 'nav-active' : ''} onClick={() => setSection('settings')}>设置</button></nav><div className="sidebar-bottom"><span className="local-dot"/>资料保存在这台 Mac<br/><small>开发预览 · 请先用样例体验</small><label className="theme">外观<select aria-label="外观" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label></div></aside>
    <main ref={mainRef}><header className="page-header"><div><p className="eyebrow">个人持物档案</p><h1>{section === 'trash' ? '最近删除' : section === 'settings' ? '设置' : detailId ? '物品档案' : '我的物品'}</h1></div><button ref={newRef} className="primary" disabled={!page || !eventsReady || !!trashRecovery} onClick={() => void openEditor(null)}>＋ 新增物品 <kbd>⌘N</kbd></button></header>
      {recovered && !draft && <div className="notice">有一份未保存或待确认的草稿。<button onClick={() => void openEditor(null, true)}>恢复草稿</button></div>}
      {trashRecovery && !trashAction && <div className="notice">有一次删除或恢复的结果待确认。<button onClick={() => void openTrash(trashRecovery.record, trashRecovery.input.generation, trashRecovery.input.deleted, trashRecovery)}>核对上次操作</button></div>}
      {section === 'settings' && <section className="card"><h2>资料管理</h2><p className="muted">误删的物品可以找回，不会自动永久清空。</p><button onClick={() => setSection('trash')}>打开最近删除</button></section>}
      {section === 'trash' && <TrashPanel version={trashVersion} onRestore={(r, generation) => void openTrash(r, generation, false)}/>}
      {notice && <div className="status-line" role="status">{notice}{section === 'assets' && <button onClick={() => setSection('trash')}>前往最近删除</button>}{section === 'assets' && !detailId && filtered && <button onClick={() => adjust({ search: '', filter: 'all' })}>清除条件</button>}</div>}
      <section hidden={section !== 'assets' || !!detailId} className="browse">
        <div className="toolbar"><label className="search"><span aria-hidden="true">⌕</span><input ref={searchRef} aria-label="搜索物品" placeholder="搜索名称、品牌或备注" value={query.search} maxLength={200} onChange={e => adjust({ search: e.target.value })}/><kbd>⌘F</kbd></label><select aria-label="筛选资料" value={query.filter} onChange={e => adjust({ filter: e.target.value })}><option value="all">全部物品</option><option value="missing_price">金额待补充</option><option value="missing_date">日期待补充</option></select><select aria-label="排序方式" value={query.sort} onChange={e => adjust({ sort: e.target.value })}><option value="created">建档时间</option><option value="name">名称</option><option value="price">购入金额</option><option value="date">购入日期</option></select><button aria-label={query.descending ? '切换为升序' : '切换为降序'} onClick={() => adjust({ descending: !query.descending })}>{query.descending ? '↓' : '↑'}</button><div className="segmented"><button aria-pressed={view === 'list'} onClick={() => setView('list')}>列表</button><button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>网格</button></div></div>
        {loadError ? <div className="empty error" role="alert"><h2>资料加载失败</h2><p>{loadError}</p><button onClick={() => void refresh()}>重新读取</button></div> : loading ? <p className="loading" role="status">正在读取本地资料…</p> : page && !page.items.length ? <div className="empty"><span className="empty-mark">▧</span><h2>{filtered ? '没有找到匹配的物品' : '从第一件物品开始'}</h2><p>{filtered ? '试试其他关键词，或清除当前条件。' : '先记下名字，价格、日期和故事都可以慢慢补。'}</p><button className="primary" onClick={() => filtered ? adjust({ search: '', filter: 'all' }) : void openEditor(null)}>{filtered ? '清除条件' : '记录第一件物品'}</button></div> : <div className="browser-columns"><div className="collection"><div className="collection-caption">{page?.total} 件物品<span>未知金额与日期始终排在最后</span></div><div className={'items ' + view} aria-label="物品列表">
          {view === 'list' && <div className="list-head"><span>物品</span><span>购入金额</span><span>购入日期</span><span>状态</span></div>}
          {page?.items.map(record => <button key={record.asset.id} id={'asset-' + record.asset.id} className={'asset-row ' + (active?.asset.id === record.asset.id ? 'selected' : '')} aria-label={'查看 ' + record.asset.name} aria-pressed={active?.asset.id === record.asset.id} onClick={() => void select(record.asset.id)} onDoubleClick={() => void select(record.asset.id, true)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void select(record.asset.id, true); } }}><span className="asset-name">{identity(record)}</span><span className="amount">{money(record.asset.price_cents)}</span><span className="muted">{record.asset.purchase_date || '待补充'}</span><span className="pill">活跃</span></button>)}
        </div><div className="pagination"><button disabled={!query.offset} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - 100) }))}>上一页</button><span>第 {Math.floor(query.offset / 100) + 1} 页</span><button disabled={!page || query.offset + 100 >= page.total} onClick={() => setQuery(q => ({ ...q, offset: q.offset + 100 }))}>下一页</button></div></div>
          <aside className="summary">{detailLoading ? <p role="status">正在读取档案…</p> : detailError ? <div role="alert"><p>{detailError}</p><button onClick={() => { setDetailError(''); setSelected(null); }}>关闭提示</button></div> : active ? <><div className="summary-title"><Cover record={active} generation={page?.generation || ''} large/><span className="pill">活跃</span></div><h2>{active.asset.name}</h2><p className="muted">{[active.details.brand, active.details.model].filter(Boolean).join(' · ') || '资料可以慢慢补全'}</p>{recordFacts(active, true)}<button className="primary full-width" onClick={() => void select(active.asset.id, true)}>打开完整档案</button><button className="full-width" onClick={() => void openEditor(active)}>编辑资料 <kbd>⌘E</kbd></button></> : <div className="summary-empty"><span>←</span><p>选一件物品<br/>看看它的持有记录</p></div>}</aside>
        </div>}
      </section>
      {section === 'assets' && detailId && <section className="detail"><button className="back" onClick={back}>← 返回物品列表</button>{detailLoading ? <p role="status">正在读取档案…</p> : detailError || !active ? <div className="empty" role="alert"><h2>{detailError || '找不到这件物品'}</h2>{selected?.deleted && <button onClick={() => setSection('trash')}>前往最近删除</button>}<button onClick={() => void select(detailId, true)}>重新读取</button></div> : <><header className="detail-title"><div className="asset-name"><Cover record={active} generation={page?.generation || ''} large/><div><span className="pill">活跃</span><h2 id="detail-heading" tabIndex={-1}>{active.asset.name}</h2><p className="muted">{active.details.model || '未分类'}</p></div></div><button onClick={() => void openEditor(active)}>编辑资料 <kbd>⌘E</kbd></button></header><Gallery record={active} generation={page?.generation || ''}/><div className="detail-columns"><article className="card"><h3>持有与购买</h3>{recordFacts(active)}<p className="muted small">日均按包含购入当天的自然日计算。{metric?.days ? `当前已持有 ${metric.days} 天。` : ''}</p></article><article className="card"><h3>备注</h3><p className="notes">{active.details.notes || '还没有备注。记下购买的缘由，或使用中的小细节。'}</p><div className="record-meta"><small>档案编号</small><code>{active.asset.id}</code><small>保存版本 {active.asset.revision}</small></div><button className="danger full-width" onClick={() => page && void openTrash(active, page.generation, true)}>删除物品…</button></article></div></> }</section>}
    </main>{trashAction && <TrashDialog initial={trashAction} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeTrash(intent).catch(e => setNotice(errorMessage(e))); }} onDone={trashDone}/>} {draft && <AssetEditor initial={draft} closeIntent={closeIntent} onKeep={() => setCloseIntent(null)} onClose={intent => { void closeEditor(intent).catch(e => setNotice(errorMessage(e))); }} onSaved={saved}/>}</div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
