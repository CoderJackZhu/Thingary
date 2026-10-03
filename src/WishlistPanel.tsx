import { HeaderSlot } from './HeaderSlot';
import { useSource } from './useSource';
import type { SourceProps } from './source';
import { usePageBar } from './topbar';
import {persistSubmission} from './editor-session';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, localDay, money } from './asset';
import type { CloseIntent, } from './AssetEditor';
import type { Photo } from './asset';
import type { MaterialEntry } from './materials';
import type { TaxonomySnapshot } from './taxonomy';
import { CategorySelect } from './TaxonomyFields';
import { DateInput } from './DateInput';
import { WishlistEditor } from './WishEditor';
import { useRestored } from './undo';
import { WishDetail } from './WishDetail';
import { defaultWishPreferences, savingPercent } from './preferences';
import { PhotoPreview, PhotoView } from './Photos';
import { DefaultAssetIcon } from './IconPicker';
import { Icon } from './AssetViews';
import { emptyWishlistFields, storedWishlistChange, storedWishlistDraft, validateWishlist, wishlistAbandonKey, wishlistBlocksApp, wishlistChange, wishlistDraftKey } from './wishlist';
import type { WishlistChange, WishlistDraft, WishlistItem, WishlistPage, WishlistQuery } from './wishlist';

const initialQuery: WishlistQuery = { search: '', filter: 'all', sort: 'created', descending: true, offset: 0 };
const pageSize = 100;


export function WishlistPanel({ taxonomy, closeIntent, onKeepClose, onFinishClose, onEditingChange, onConvert, onOpenAsset, onOpenTrash, focus, search, onSearch, autoNew, onAutoNewDone, source, onSourceDone }: SourceProps & { onConvert: (item: WishlistItem) => void; onOpenAsset: (id: string) => void; onOpenTrash: () => void; focus?: Pick<WishlistQuery, 'search' | 'filter'> | null; search: string; onSearch: (value: string) => void; autoNew?: boolean; onAutoNewDone?: () => void; taxonomy: TaxonomySnapshot | null; closeIntent: CloseIntent | null; onKeepClose: () => void; onFinishClose: (intent: CloseIntent) => void; onEditingChange: (editing: boolean) => void }) {
  const [query, setQuery] = useState<WishlistQuery>(() => ({ ...initialQuery, search: focus?.search ?? search, filter: focus?.filter ?? 'all' })), [page, setPage] = useState<WishlistPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [view, setView] = useState<'list' | 'grid'>('grid'), [editor, setEditor] = useState<WishlistDraft | null>(null), [recovered, setRecovered] = useState<WishlistDraft | null>(() => storedWishlistDraft(localStorage)), [abandon, setAbandon] = useState<WishlistItem | null>(null), [abandonRecovery, setAbandonRecovery] = useState<WishlistChange | null>(() => storedWishlistChange(localStorage, wishlistAbandonKey)), [resolvingAbandon, setResolvingAbandon] = useState(false), [preview, setPreview] = useState<Photo | null>(null), [notice, setNotice] = useState(''), [detail,setDetail]=useState<WishlistItem|null>(null), [detailBusy,setDetailBusy]=useState(false), [ongoing,setOngoing]=useState<number|null>(null);
  // The topbar owns the search box. On mount, publish the effective initial
  // query (which may come from an origin-wish focus); afterwards follow the
  // topbar's word into this list's query.
  const published = useRef(false);
  useEffect(() => {
    if (!published.current) { published.current = true; onSearch(query.search); return; }
    setQuery(q => (q.search === search ? q : { ...q, search, offset: 0 }));
  }, [search]);
  const sourceError = useSource({source,onSourceDone}, page?.generation, async (target, alive) => {
    if (target.kind !== 'wish') return false;
    if (recovered || abandonRecovery) throw new Error('请先核对上次保存结果，再打开来源心愿。');
    // Stable-ID read: same-named or off-page wishes open by identity, not search.
    const item = await invoke<WishlistItem | null>('read_wishlist', {id:target.id});
    if (!alive()) return false;
    if (!item) return false;
    setDetail(item); return true;
  });
  useEffect(() => { if (sourceError) void reload(); }, [sourceError]);
  const queryTicket = useRef(0);
  async function reload(q = query) {
    const ticket = ++queryTicket.current;
    setLoading(true); setError('');
    try {
      const [result, totals] = await Promise.all([invoke<WishlistPage>('list_wishlist', { query: q }), invoke<WishlistPage>('list_wishlist', {query:{...initialQuery,filter:'ongoing'}})]);
      if (ticket !== queryTicket.current) return;
      setOngoing(totals.total);
      if (q.offset > 0 && !result.items.length && result.total > 0) {
        setQuery({ ...q, offset: Math.floor((result.total - 1) / pageSize) * pageSize });
      } else setPage(result);
    } catch (e) { if (ticket === queryTicket.current) setError(errorMessage(e)); }
    finally { if (ticket === queryTicket.current) setLoading(false); }
  }
  useEffect(() => { void reload(query); }, [query]);
  useRestored(() => void reload());
  useEffect(()=>{if(!page)return;try{const pending=JSON.parse(localStorage.getItem('possio.savings-pending.v1')||'null');if(!pending)return;if(pending.generation!==page.generation){localStorage.removeItem('possio.savings-pending.v1');return;}void invoke<WishlistItem|null>('read_wishlist',{id:pending.id}).then(item=>{if(item)setDetail(item)}).catch(e=>setNotice(errorMessage(e)))}catch{}},[page?.generation]);
  useEffect(() => { onEditingChange(detailBusy || wishlistBlocksApp({ editor, recovered, abandon, abandonRecovery })); }, [detailBusy,editor, recovered, abandon, abandonRecovery, onEditingChange]);
  useEffect(() => { if (page && recovered && recovered.generation !== page.generation) { localStorage.removeItem(wishlistDraftKey); setRecovered(null); setNotice('资料已切换，旧心愿保存请求未恢复。'); } }, [page, recovered]);
  useEffect(() => { if (page && abandonRecovery) void resolveAbandon(); }, [page, abandonRecovery]);
  useEffect(() => { if (closeIntent && !editor && (abandon || recovered || abandonRecovery)) { setNotice('请先核对心愿保存结果，再关闭。'); onKeepClose(); } }, [closeIntent, editor, abandon, recovered, abandonRecovery, onKeepClose]);
  function adjust(part: Partial<WishlistQuery>) { setQuery(q => ({ ...q, ...part, offset: 0 })); }
  function openEditor(resume = false) { if (!page || !taxonomy || detailBusy || editor || abandon || abandonRecovery || (recovered && !resume)) return; const next = resume && recovered ? recovered : { generation: page.generation, fields: { ...emptyWishlistFields }, cover: null, photoError: '', pending: null }; persistSubmission(wishlistDraftKey, next); setEditor(next); }
  const canNew = detailBusy || !page || !taxonomy || !!editor || !!abandon || !!recovered || !!abandonRecovery;
  usePageBar('wishlist', {
    primary: { label: '新增心愿', plus: true, disabled: canNew, run: () => openEditor(false) },
    newRecord: { label: '新增心愿', disabled: canNew, run: () => openEditor(false) },
    search: { key: 'wishlist', placeholder: '搜索心愿' },
  });
  // The 新增记录 menu lands here with the same single new-record entry.
  const consumedAutoNew = useRef(false);
  useEffect(() => {
    if (!autoNew || consumedAutoNew.current || !page || !taxonomy) return;
    consumedAutoNew.current = true;
    onAutoNewDone?.();
    openEditor(false);
  }, [autoNew, page, taxonomy]);
  function closeEditor(intent: CloseIntent, keep: boolean) { if (!keep) localStorage.removeItem(wishlistDraftKey); setEditor(null); setRecovered(keep ? storedWishlistDraft(localStorage) : null); if (intent !== 'form') onFinishClose(intent); }
  async function resolveAbandon() { if (!abandonRecovery || !page || resolvingAbandon) return; if (abandonRecovery.generation !== page.generation) { localStorage.removeItem(wishlistAbandonKey); setAbandonRecovery(null); setNotice('资料已切换，旧放弃请求不会作用于当前资料。'); return; } setResolvingAbandon(true); try { const item = await invoke<WishlistItem | null>('saved_wishlist_request', { input: abandonRecovery }); localStorage.removeItem(wishlistAbandonKey); setAbandonRecovery(null); setNotice(item ? `已确认「${item.fields.name}」保留在已放弃历史。` : '已确认上次放弃未提交，心愿保持不变。'); void reload(); } catch (e) { setNotice(errorMessage(e) + ' 原请求仍保留，请点击“再次核对”。'); } finally { setResolvingAbandon(false); } }
  async function abandonWish() {
    if (!abandon || !page || resolvingAbandon) return;
    const input: WishlistChange = { request_id: crypto.randomUUID(), generation: page.generation, expected_revision: abandon.revision, action: { type: 'abandon', wishlist_id: abandon.id } };
    localStorage.setItem(wishlistAbandonKey, JSON.stringify(input)); setResolvingAbandon(true);
    try { await invoke('change_wishlist', { input }); localStorage.removeItem(wishlistAbandonKey); setAbandon(null); setDetail(null); void reload(); }
    catch (e) { setNotice(errorMessage(e)); setAbandon(null); setAbandonRecovery(input); }
    finally { setResolvingAbandon(false); }
  }
  const filtered = !!query.search || query.filter !== 'all';
  return <section className={"wishlist-section"+(detail?" has-inspector":"")} aria-label="心愿清单">{sourceError && <p role="alert" className="notice">{sourceError}</p>}{recovered && !editor && <div className="notice">有一笔心愿保存结果待确认。<button onClick={() => openEditor(true)}>核对保存结果</button></div>}{abandonRecovery && <div className="notice">上次放弃操作的结果待确认。<button disabled={resolvingAbandon || !page} onClick={() => void resolveAbandon()}>{resolvingAbandon ? '正在核对…' : '再次核对'}</button></div>}{notice && <div className="status-line" role="status">{notice}</div>}<HeaderSlot target="page-header-meta">{page&&<>进行中 {ongoing??'—'} · 预计 {money(page.ongoing_known_cents)}{page.ongoing_unknown_count>0&&`（${page.ongoing_unknown_count} 条价格未知）`}</>}</HeaderSlot><div className="wishlist-toolbar"><div className="wish-status-tabs" role="group" aria-label="心愿状态">{([['all','全部'],['ongoing','进行中'],['achieved','已实现'],['abandoned','已放弃']] as const).map(([filter,label])=><button key={filter} type="button" aria-pressed={query.filter===filter} onClick={()=>adjust({filter})}>{label}</button>)}</div><label>排序<select aria-label="心愿排序" value={query.sort} onChange={e => { const sort = e.target.value as WishlistQuery['sort']; adjust({ sort, descending: sort === 'priority' || sort === 'target' ? false : true }); }}><option value="created">最近加入</option><option value="price">预计价格</option><option value="target">目标日期</option></select></label><button aria-label={query.descending ? '切换为升序' : '切换为降序'} onClick={() => adjust({ descending: !query.descending })}>{query.descending ? '↓' : '↑'}</button><div className="segmented"><button aria-label="列表视图" title="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list"/></button><button aria-label="网格视图" title="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Icon name="grid"/></button></div></div>
    {error ? <div className="empty error" role="alert"><h2>心愿读取失败</h2><p>{error}</p><button onClick={() => void reload()}>重新读取</button></div> : loading ? <p role="status" className="loading">正在读取心愿…</p> : !page?.items.length ? <div className="empty"><span className="empty-mark">♡</span><h2>{filtered ? '当前条件下没有找到记录' : '记下第一件想要的物品'}</h2><p>{query.filter === 'achieved' ? '实现的心愿会保留在这里。' : '计划和价格都可以留空，之后再决定。'}</p>{filtered ? <button onClick={() => { setQuery(initialQuery); onSearch(''); }}>清除搜索</button> : <button className="primary" onClick={() => openEditor(false)}>新增心愿</button>}</div> : <><div className="wish-browser"><div className={'wishlist-items ' + view}>{page.items.map(item => <button type="button" className="wishlist-card ui-card" key={item.id} disabled={detailBusy} aria-pressed={detail?.id===item.id} aria-label={'查看心愿：'+item.fields.name} onClick={()=>setDetail(item)}><span className="wishlist-cover">{item.cover?<PhotoView photo={item.cover} generation={page.generation}/>:<DefaultAssetIcon/>}</span><span className="wishlist-card-body"><strong className="wishlist-name">{item.fields.name}</strong><span className="wish-row-meta">{taxonomy?.categories.find(c=>c.id===item.fields.category_id)?.name||'全部'} · {item.status==='achieved'?'已实现':item.status==='abandoned'?'已放弃':'进行中'}{item.preferences?.pinned?' · 置顶':''}</span></span><span className="wish-row-price">{money(item.fields.estimated_price_cents)}</span><span className="wish-row-date">{item.preferences?.added_date??localDay(new Date(item.created_at))}</span>{item.preferences?.mode==='savings'?<span className="wish-progress"><span className="saving-bar" role="img" aria-label={'攒钱进度 '+(savingPercent(item.preferences.saved_cents,item.fields.estimated_price_cents)??'待设价格')}><span style={{width:(savingPercent(item.preferences.saved_cents,item.fields.estimated_price_cents)??0)+'%'}}/></span><small>已攒 {money(item.preferences.saved_cents)}</small></span>:<span className="wish-progress muted">{item.fields.target_date||'目标日期待补充'}</span>}</button>)}</div></div><div className="collection-caption">{page.total} 条心愿<span>未设置的价格与日期始终排在已知值之后</span></div><div className="pagination" hidden={page.total <= pageSize}><button disabled={loading || query.offset === 0} onClick={() => setQuery(q => ({ ...q, offset: Math.max(0, q.offset - pageSize) }))}>上一页</button><span>第 {Math.floor(query.offset / pageSize) + 1} / {Math.ceil(page.total / pageSize)} 页</span><button disabled={loading || query.offset + pageSize >= page.total} onClick={() => setQuery(q => ({ ...q, offset: q.offset + pageSize }))}>下一页</button></div></>}
    {detail&&page&&<WishDetail key={detail.id} onBusyChange={setDetailBusy} onAbandon={item=>setAbandon(item)} onDeleted={()=>{setDetail(null);void reload()}} onOpenAsset={onOpenAsset} onOpenTrash={onOpenTrash} taxonomy={taxonomy} closeIntent={closeIntent} onKeepClose={onKeepClose} onFinishClose={onFinishClose} initial={detail} generation={page.generation} onClose={()=>setDetail(null)} onChange={item=>{if(detail.status==='ongoing'&&item.status==='achieved')setNotice(`「${item.fields.name}」已攒够，进度达到 100%，并已加入全部物品。`);setDetail(item);void reload()}} onEdit={item=>{const next:WishlistDraft={generation:page.generation,item,fields:{...item.fields,estimated_price:item.fields.estimated_price_cents===null?'':String(Number(item.fields.estimated_price_cents)/100),target_date:item.fields.target_date||''},preferences:item.preferences??defaultWishPreferences(),photos:item.photos??(item.cover?[item.cover]:[]),cover:item.cover,photoError:'',pending:null};persistSubmission(wishlistDraftKey, next);setDetail(null);setEditor(next)}} onConvert={item=>{setDetail(null);onEditingChange(false);setTimeout(()=>onConvert(item),0)}}/>}
    {abandon && <div className="notice" role="alert">放弃「{abandon.fields.name}」？记录将保留在已放弃历史。<button disabled={resolvingAbandon} onClick={()=>void abandonWish()}>确认放弃</button><button disabled={resolvingAbandon} onClick={()=>setAbandon(null)}>取消</button></div>}
    {preview && page && <PhotoPreview photo={preview} generation={page.generation} onClose={() => setPreview(null)}/>} {editor && taxonomy && <WishlistEditor initial={editor} taxonomy={taxonomy} closeIntent={closeIntent} onKeep={onKeepClose} onClose={closeEditor} onDeleted={item => { localStorage.removeItem(wishlistDraftKey); setEditor(null); setRecovered(null); setDetail(null); setNotice(`心愿「${item.fields.name}」已移入最近删除${item.converted_asset ? '，实现的物品仍在我的物品中' : ''}。`); void reload(); }} onSaved={item => { localStorage.removeItem(wishlistDraftKey); setEditor(null); setRecovered(null); setNotice(item.status==='achieved'?`心愿「${item.fields.name}」已实现，并已加入全部物品。`:`已保存心愿「${item.fields.name}」。`); void reload(); }}/>}</section>;
}
