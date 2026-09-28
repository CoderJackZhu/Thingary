import { CloseButton } from './CloseButton';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type Photo } from './asset';
import { Icon } from './AssetViews';
import { PhotoView } from './Photos';
import { MaterialThumb } from './MaterialLibrary';
import { filterMaterials, materialArt, materialCategories, materialOf, readRecentMaterials, rememberMaterial, type MaterialEntry, type MaterialSource } from './materials';
import './icon-picker.css';

export type IconChoice = { kind: 'default' } | { kind: 'material'; entry: MaterialEntry } | { kind: 'photo'; photo: Photo };
export function DefaultAssetIcon() { return <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt="默认箱子图标"/>; }
export function IconPicker({ generation, photos, cover, onClose, onUse }: { generation: string; photos: Photo[]; cover: string | null; onClose: () => void; onUse: (choice: IconChoice) => Promise<void> }) {
  const dialog = useRef<HTMLElement>(null);
  const lock = useRef(false);
  const [source, setSource] = useState<MaterialSource>('icon');
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<MaterialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const current = photos.find(p => p.id === cover);
  const [choice, setChoice] = useState<IconChoice>(current ? { kind: 'photo', photo: current } : { kind: 'default' });
  const [recent] = useState(() => readRecentMaterials(localStorage, generation));
  const [reload, setReload] = useState(0);
  useEffect(() => { dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); }, []);
  useEffect(() => {
    let live = true; setLoading(true); setLoadError('');
    void invoke<MaterialEntry[]>('list_materials').then(list => { if (live) setEntries(list); }).catch(e => { if (live) setLoadError(errorMessage(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reload]);
  async function importFile(file?: File) {
    if (!file || lock.current) return;
    if (file.size > 20 * 1024 * 1024) { setError('请选择不超过 20 MiB 的图片。'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      const photo = await invoke<Photo>('import_photo_bytes', { generation, name: file.name || '粘贴的图片.png', bytes: Array.from(new Uint8Array(await file.arrayBuffer())) });
      await onUse({kind:'photo',photo}); onClose();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function chooseFile() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const photo = await invoke<Photo | null>('pick_photo', { generation, repair: null }); if (photo) {await onUse({kind:'photo',photo});onClose();} }
    catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function apply(next:IconChoice) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await onUse(next);
      if (next.kind === 'material') { try { rememberMaterial(localStorage, generation, next.entry.id); } catch { /* A recent choice is optional; saving the asset is independent. */ } }
      onClose();
    } catch (e) { setError(errorMessage(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  const visible = filterMaterials(entries, source, category, search, recent);
  const ownPhotos = source === 'custom' ? photos.filter(p => p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : [];
  const imported = choice.kind === 'photo' && !photos.some(p => p.id === choice.photo.id) ? choice.photo : null;
  const label = choice.kind === 'default' ? '默认箱子' : choice.kind === 'material' ? choice.entry.name : choice.photo.name;
  function preview() {
    if (choice.kind === 'default') return <DefaultAssetIcon/>;
    return choice.kind === 'photo' ? <PhotoView photo={choice.photo} generation={generation}/> : choice.entry.builtin ? <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt(choice.entry.id))} alt={choice.entry.name}/> : <MaterialThumb id={choice.entry.id} generation={generation} alt={choice.entry.name}/>;
  }
  return <section ref={dialog} className={'icon-picker embedded' + (dragging ? ' is-dragging' : '')} aria-labelledby="icon-picker-title" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!lock.current) onClose(); } }} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void importFile(e.dataTransfer.files[0]); }} onPaste={e => { const file = e.clipboardData.files[0]; if (file) { e.preventDefault(); void importFile(file); } }}>
    <header className="picker-header"><div><h2 id="icon-picker-title">选择物品图标</h2><p>给它一个一眼就能认出的样子</p></div><CloseButton aria-label="关闭图标选择器" disabled={busy} onClick={onClose}/></header>
    <div className="picker-sources" role="group" aria-label="图片来源">{([['icon','图标','grid'],['dimensional','立体图标','items'],['recent','最近','clock'],['custom','我的图片','image']] as const).map(([id,name,icon]) => <button type="button" key={id} aria-pressed={source === id} disabled={busy} onClick={() => { setSource(id); setCategory('全部'); setSearch(''); }}><Icon name={icon}/>{name}</button>)}</div>
    <div className="picker-filters"><label className="picker-search"><Icon name="search"/><input autoFocus aria-label="搜索图标" placeholder={source === 'custom' ? '搜索我的图片' : '搜索图标，如手机、笔记本、耳机'} value={search} disabled={busy} onChange={e => setSearch(e.target.value)}/>{search && <button type="button" aria-label="清除图标搜索" onClick={() => setSearch('')}><Icon name="close"/></button>}</label>{source !== 'custom' && <div className="picker-categories" role="group" aria-label="图标分类">{materialCategories.map(name => <button type="button" key={name} aria-pressed={category === name} disabled={busy} onClick={() => setCategory(name)}>{name}</button>)}</div>}</div>
    <div className="picker-results">
      {source === 'custom' && <div className="picker-upload"><button type="button" disabled={busy} onClick={() => void chooseFile()}><Icon name="plus"/>从 Mac 选择图片</button><p>也可拖入或粘贴一张图片 · JPEG、PNG、HEIC、WebP · 20 MiB</p></div>}
      {loadError && <p role="alert" className="picker-error">{loadError} <button type="button" disabled={busy} onClick={() => setReload(n => n + 1)}>重新读取素材</button></p>}
      {loading ? <p role="status" className="picker-empty">正在读取素材…</p> : <div className="picker-grid">
        {source === 'icon' && category === '全部' && !search && <button type="button" className="picker-tile" aria-label="选择默认箱子图标" aria-pressed={choice.kind === 'default'} disabled={busy} onClick={() => void apply({kind:'default'})}><DefaultAssetIcon/><span>默认图标</span><i aria-hidden="true">✓</i></button>}
        {visible.filter(e => e.id !== 'icon-box' || category !== '全部' || !!search).map(entry => <div className="picker-cell" key={entry.id} data-selected={(entry.id === 'icon-box' ? choice.kind === 'default' : choice.kind === 'material' && choice.entry.id === entry.id)}>
          {entry.builtin ? <button type="button" className="picker-tile" aria-label={'选择图标：' + entry.name} aria-pressed={(entry.id === 'icon-box' ? choice.kind === 'default' : choice.kind === 'material' && choice.entry.id === entry.id)} disabled={busy} onClick={() => void apply(entry.id === 'icon-box' ? {kind:'default'} : {kind:'material',entry})}><img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt(entry.id))} alt=""/><span>{entry.name}</span><i aria-hidden="true">✓</i></button> : <><MaterialThumb id={entry.id} generation={generation} alt={'选择图片：' + entry.name} disabled={busy} onSelect={() => void apply({kind:'material',entry})}/><span>{entry.name}</span></>}
        </div>)}
        {[...(imported && source === 'custom' ? [imported] : []), ...ownPhotos].map(photo => <button type="button" key={photo.id} className="picker-tile" aria-label={'选择档案图片：' + photo.name} aria-pressed={choice.kind === 'photo' && choice.photo.id === photo.id} disabled={busy} onClick={() => void apply({kind:'photo',photo})}><PhotoView photo={photo} generation={generation}/><span>{photo.name}</span><i aria-hidden="true">✓</i></button>)}
      </div>}
      {!loading && !loadError && !visible.length && !ownPhotos.length && !(imported && source === 'custom') && <p className="picker-empty">{search ? '没有匹配的图标，换个关键词试试。' : source === 'recent' ? '使用过的素材会出现在这里。' : source === 'custom' ? '你上传到素材库的图片和当前档案图片会出现在这里。' : '这个分类暂时没有素材。'}</p>}
    </div>
    {error && <p role="alert" className="picker-error">{error}。当前选择和表单输入已保留，可重试。</p>}
    <footer className="picker-footer"><span className="muted small">{busy?'正在使用图标…':'点击即可使用'}</span><button type="button" disabled={busy} onClick={onClose}>返回</button></footer>
  </section>;
}
