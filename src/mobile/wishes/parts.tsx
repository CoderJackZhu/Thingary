import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from '../../asset';
import type { Photo } from '../../asset';
import { filterMaterials, materialArt, materialCategories, readRecentMaterials, rememberMaterial } from '../../materials';
import type { MaterialEntry, MaterialSource } from '../../materials';
import { PhotoView } from '../../Photos';
import { Button, ChipRow, Icon, Loading, Notice, Sheet } from '../ui';
import { useSession } from '../session';
import { loadTaxonomy, opWish, resolveOp, searchAssets, storedOps } from './service';
import type { Candidate, Op, Settled, Taxonomy } from './service';
import { assetStateText } from './model';
import type { Tone } from './model';
import './wishes.css';

const boxArt = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'));
/** 心愿图标：封面图片或默认箱子，只作装饰，名称由旁边的文字给出。 */
export function WishIcon({ photo, generation, large }: { photo: Photo | null; generation: string | null; large?: boolean }) {
  return <span className={`w-icon${large ? ' w-icon-lg' : ''}`} aria-hidden="true">{photo && generation ? <PhotoView photo={photo} generation={generation} compact/> : <img src={boxArt} alt=""/>}</span>;
}
export function StatePill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`w-pill${tone === 'accent' ? '' : ` w-pill-${tone}`}`}>{children}</span>;
}

/** 分类、渠道与当前资料库 generation；读不到时 error 有文字，调用方不应保存。 */
export function useTaxonomy(): { data: Taxonomy | null; error: string; retry: () => void } {
  const [data, setData] = useState<Taxonomy | null>(null), [error, setError] = useState(''), [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true; setError('');
    loadTaxonomy().then(next => { if (live) setData(next); }).catch(cause => { if (live) setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [tick]);
  return { data, error, retry: () => setTick(n => n + 1) };
}

/** 页面里保留的未确认回执：核对前可选只显示某一条心愿的。核对期间暂停切页。 */
export function useReceipts(generation: string | null, onSettled: (outcome: Settled) => void, wishId?: string | null) {
  const session = useSession();
  const [ops, setOps] = useState<Op[]>(() => storedOps()), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const refresh = () => setOps(storedOps());
  const shown = wishId === undefined ? ops : ops.filter(op => opWish(op) === wishId);
  async function resolve(op: Op) {
    if (busy) return;
    setBusy(true); session.setBusy(true); setNotice('');
    try {
      const outcome = await resolveOp(op, generation);
      setNotice(outcome.status === 'saved' ? `已确认「${op.label}」已保存。` : outcome.status === 'unsaved' ? `已确认「${op.label}」没有保存，请重新操作。` : outcome.status === 'stale' ? '资料库已切换，上次请求不属于当前资料，已放弃。' : outcome.message);
      if (outcome.status !== 'unknown') onSettled(outcome);
    } finally { setBusy(false); session.setBusy(false); refresh(); }
  }
  return { ops: shown, all: ops, busy, notice, setNotice, refresh, resolve };
}
/** 「保存结果未确定」卡片：原请求已保留，只读核对后才能继续。 */
export function ReceiptCards({ ops, busy, notice, onResolve }: { ops: Op[]; busy: boolean; notice: string; onResolve: (op: Op) => void }) {
  return <>
    {ops.map(op => <section key={op.kind + (op.kind === 'purchase' ? op.input.base.request_id : op.input.request_id)} className="m-card m-card-warn w-notice-card" role="status">
      <p><strong>「{op.label}」的保存结果待确认。</strong>原请求已保留，核对前暂不能继续这项操作。</p>
      <Button variant="primary" disabled={busy} onClick={() => onResolve(op)}>{busy ? '正在核对…' : '核对结果'}</Button>
    </section>)}
    {notice && <Notice tone="positive">{notice}</Notice>}
  </>;
}

/** 搜索在册物品并选择一件（关联已有物品、考虑替换的物品共用）。server 端分页，加载更多续读。 */
export function CandidateSheet({ title, intro, legacyId = null, confirmLabel, busy, error, onPick, onClose }: {
  title: string; intro: string; legacyId?: string | null; confirmLabel?: string; busy?: boolean; error?: string;
  onPick: (candidate: Candidate) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(''), [items, setItems] = useState<Candidate[] | null>(null), [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false), [failure, setFailure] = useState(''), [retry, setRetry] = useState(0), [selected, setSelected] = useState<Candidate | null>(null);
  const run = useRef(0);
  useEffect(() => {
    const ticket = ++run.current;
    setItems(null); setNext(null); setFailure(''); setLoading(true);
    const timer = setTimeout(() => {
      searchAssets(legacyId, query).then(page => { if (ticket === run.current) { setItems(page.items); setNext(page.nextOffset); } })
        .catch(cause => { if (ticket === run.current) { setItems([]); setFailure(errorMessage(cause)); } })
        .finally(() => { if (ticket === run.current) setLoading(false); });
    }, query ? 250 : 0);
    return () => { clearTimeout(timer); run.current++; };
  }, [query, retry, legacyId]);
  async function more() {
    if (loading || next === null) return;
    const ticket = run.current; setLoading(true); setFailure('');
    try { const page = await searchAssets(null, query, next); if (ticket !== run.current) return; setItems(old => [...(old ?? []), ...page.items.filter(c => !old?.some(o => o.id === c.id))]); setNext(page.nextOffset); }
    catch (cause) { if (ticket === run.current) setFailure(errorMessage(cause)); }
    finally { if (ticket === run.current) setLoading(false); }
  }
  const choose = (candidate: Candidate) => { if (confirmLabel) setSelected(candidate); else onPick(candidate); };
  return <Sheet title={title} onClose={onClose} doneLabel="取消">
    <div className="w-sheet-stack">
      <p>{intro}</p>
      <label className="w-search"><Icon name="search" size={18}/><input aria-label="搜索物品" placeholder="输入名称搜索" value={query} maxLength={200} disabled={busy} onChange={event => setQuery(event.target.value)}/></label>
      {(failure || error) && <Notice tone="danger">{failure || error}</Notice>}
      {items === null ? <Loading label="正在读取物品…"/> : <ul className="w-cand">{items.map(c => <li key={c.id}><button type="button" disabled={busy} aria-pressed={selected?.id === c.id} onClick={() => choose(c)}>
        <strong>{c.name}</strong>{c.own && <small>本心愿旧版生成的档案</small>}<small>{c.purchase_date ?? '购入日期未知'} · {assetStateText(c.state)} · {c.id.length > 8 ? c.id.slice(0, 8) + '…' : c.id}</small></button></li>)}</ul>}
      {items?.length === 0 && !failure && !loading && <p role="status">没有匹配的物品，可换个关键词。</p>}
      {next !== null && <Button disabled={loading || busy} onClick={() => void more()}>{loading ? '正在读取…' : '加载更多'}</Button>}
      {failure && <Button disabled={loading} onClick={() => { if (next !== null) void more(); else setRetry(n => n + 1); }}>重试读取</Button>}
      {confirmLabel && <Button variant="primary" block disabled={!selected || busy} onClick={() => selected && onPick(selected)}>{busy ? '正在保存…' : selected ? `${confirmLabel}「${selected.name}」` : confirmLabel}</Button>}
    </div>
  </Sheet>;
}

export type IconChoice = { kind: 'default' } | { kind: 'material'; entry: MaterialEntry } | { kind: 'photo'; photo: Photo };
const sources: { id: MaterialSource; label: string }[] = [{ id: 'icon', label: '图标' }, { id: 'dimensional', label: '立体图标' }, { id: 'recent', label: '最近' }, { id: 'custom', label: '我的图片' }];
/** 图标与素材：复用 materials.ts 的图标库，选择结果由 onUse 准备成封面（与电脑端一致）。 */
export function IconSheet({ generation, photos, cover, onUse, onClose }: { generation: string; photos: Photo[]; cover: string | null; onUse: (choice: IconChoice) => Promise<void>; onClose: () => void }) {
  const [source, setSource] = useState<MaterialSource>('icon'), [category, setCategory] = useState('全部'), [search, setSearch] = useState('');
  const [entries, setEntries] = useState<MaterialEntry[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [recent] = useState(() => { try { return readRecentMaterials(localStorage, generation); } catch { return []; } });
  const lock = useRef(false);
  useEffect(() => {
    let live = true; setLoading(true); setLoadError('');
    invoke<MaterialEntry[]>('list_materials').then(list => { if (live) setEntries(list); }).catch(cause => { if (live) setLoadError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reload]);
  async function apply(choice: IconChoice) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await onUse(choice);
      if (choice.kind === 'material') { try { rememberMaterial(localStorage, generation, choice.entry.id); } catch { /* 最近使用只是便利，不影响保存 */ } }
      onClose();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function choosePhoto() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const photo = await invoke<Photo | null>('pick_photo', { generation, repair: null }); if (photo) { lock.current = false; await apply({ kind: 'photo', photo }); } }
    catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  const visible = filterMaterials(entries, source, category, search, recent).filter(entry => entry.id !== 'icon-box');
  const own = source === 'custom' ? photos.filter(p => p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  const defaultSelected = !cover;
  return <Sheet title="图标与素材" onClose={() => { if (!busy) onClose(); }} doneLabel="取消">
    <div className="w-sheet-stack">
      <p>给它一个一眼就能认出的样子；素材是示意图，不是实物照片。</p>
      <ChipRow label="图片来源" items={sources} value={source} onChange={id => { setSource(id as MaterialSource); setCategory('全部'); setSearch(''); }}/>
      <label className="w-search"><Icon name="search" size={18}/><input aria-label="搜索图标" placeholder={source === 'custom' ? '搜索我的图片' : '搜索图标，如手机、耳机'} value={search} disabled={busy} onChange={event => setSearch(event.target.value)}/></label>
      {(source === 'icon' || source === 'dimensional') && <ChipRow label="素材分类" items={materialCategories.map(name => ({ id: name, label: name }))} value={category} onChange={setCategory}/>}
      {error && <Notice tone="danger">{error}</Notice>}
      {loadError && <Notice tone="danger">{loadError}</Notice>}
      {loadError && <Button onClick={() => setReload(n => n + 1)}>重新读取素材</Button>}
      {source === 'custom' && <Button disabled={busy} onClick={() => void choosePhoto()}>从相册选择图片</Button>}
      {loading ? <Loading label="正在读取素材…"/> : <div className="w-materials">
        {source === 'icon' && category === '全部' && !search && <button type="button" className="w-material" aria-pressed={defaultSelected} aria-label="选择默认箱子图标" disabled={busy} onClick={() => void apply({ kind: 'default' })}><img src={boxArt} alt=""/><span>默认图标</span></button>}
        {visible.map(entry => <button type="button" key={entry.id} className="w-material" aria-label={'选择图标：' + entry.name} disabled={busy} onClick={() => void apply({ kind: 'material', entry })}>
          {entry.builtin ? <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt(entry.id))} alt=""/> : <PhotoView photo={{ id: entry.id, name: entry.name }} generation={generation} compact/>}<span>{entry.name}</span></button>)}
        {own.map(photo => <button type="button" key={photo.id} className="w-material" aria-pressed={cover === photo.id} aria-label={'选择档案图片：' + photo.name} disabled={busy} onClick={() => void apply({ kind: 'photo', photo })}><PhotoView photo={photo} generation={generation} compact/><span>{photo.name}</span></button>)}
      </div>}
      {!loading && !loadError && !visible.length && !own.length && <p role="status">{search ? '没有匹配的图标，换个关键词试试。' : source === 'recent' ? '使用过的素材会出现在这里。' : source === 'custom' ? '当前心愿的图片会出现在这里。' : '这个分类暂时没有素材。'}</p>}
    </div>
  </Sheet>;
}
