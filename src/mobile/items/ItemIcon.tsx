import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage, type Photo } from '../../asset';
import { materialArt, materialCategories, filterMaterials, readRecentMaterials, rememberMaterial, type MaterialEntry, type MaterialSource } from '../../materials';
import { PhotoView } from '../../Photos';
import { useNav } from '../nav-context';
import { useSession } from '../session';
import type { PageProps } from '../routes';
import { Button, ChipRow, EmptyState, ErrorState, Loading, Notice, SegmentedControl, TextField } from '../ui';
import { getIconSession } from './edit-model';
import './icon.css';
import { t } from '../../i18n.ts';
function MaterialImage({ entry, generation }: { entry: MaterialEntry; generation: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (entry.builtin) return;
    let live = true, url = '';
    invoke<ArrayBuffer>('material_preview', { id: entry.id, generation }).then(bytes => { if (live) { url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); setSrc(url); } }).catch(() => {});
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [entry.id, generation]);
  return entry.builtin ? <img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt(entry.id))} alt=""/> : src ? <img src={src} alt=""/> : <span>{t('图片')}</span>;
}

export default function ItemIcon({ params }: PageProps) {
  const nav = useNav(), session = useSession(), channel = getIconSession(String(params.channel ?? ''));
  const [source, setSource] = useState<MaterialSource>('icon'), [category, setCategory] = useState(t('全部')), [search, setSearch] = useState('');
  const [entries, setEntries] = useState<MaterialEntry[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const camera = useRef<HTMLInputElement>(null), album = useRef<HTMLInputElement>(null), lock = useRef(false);
  const [chosen,setChosen]=useState(false);
  useEffect(()=>{if(chosen&&!session.navBlocked)nav.pop();},[chosen,session.navBlocked]);
  const generation = channel?.generation ?? session.data?.summary.generation ?? '';
  const recent = readRecentMaterials(localStorage, generation);
  useEffect(() => { let live = true; setLoading(true); setError(''); invoke<MaterialEntry[]>('list_materials').then(next => { if (live) setEntries(next); }).catch(cause => { if (live) setError(errorMessage(cause)); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [retry]);
  async function choose(entry: MaterialEntry | null, photo?: Photo) {
    if (!channel || lock.current || session.navBlocked) return;
    lock.current = true; setBusy(true); session.setBusy(true); setError('');
    try {
      const next = photo ?? (entry ? await invoke<Photo>('prepare_material', { input: { id: entry.id, generation } }) : null);
      channel.choose(next, !!entry); if (entry) { try { rememberMaterial(localStorage, generation, entry.id); } catch { /* recent choices are optional */ } }
      setChosen(true);
    } catch (cause) { setError(errorMessage(cause)); } finally { lock.current = false; setBusy(false); session.setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file || !channel || lock.current) return;
    if (file.size > 20 * 1024 * 1024) { setError(t('请选择不超过 20 MiB 的图片。')); return; }
    lock.current = true; setBusy(true); session.setBusy(true); setError('');
    try { const photo = await invoke<Photo>('import_photo_bytes', { generation, name: file.name || t('拍摄的图片.jpg'), bytes: Array.from(new Uint8Array(await file.arrayBuffer())) }); channel.choose(photo, true); setChosen(true); }
    catch (cause) { setError(errorMessage(cause)); } finally { lock.current = false; setBusy(false); session.setBusy(false); }
  }
  const visible = filterMaterials(entries, source, category, search, recent), own = source === 'custom' ? channel?.photos.filter(photo => photo.name.includes(search.trim())) ?? [] : [];
  return <div className="m-item-icon">
    {!channel && <Notice>{t('请从新增或编辑物品进入，所选图标随物品一起保存。')}</Notice>}
    <SegmentedControl label={t('素材类型')} items={[{ id: 'icon', label: t('图标') }, { id: 'dimensional', label: t('立体图标') }, { id: 'recent', label: t('最近使用') }, { id: 'custom', label: t('我的图片') }]} value={source} onChange={value => { setSource(value); setCategory(t('全部')); }}/>
    <TextField label={t('搜索图标')} value={search} onChange={setSearch} placeholder={t('例如相机、镜头')}/>
    {source !== 'custom' && <ChipRow label={t('图标分类')} items={materialCategories.map(id => ({ id, label: id }))} value={category} onChange={setCategory}/>}
    {error && <ErrorState message={error} onRetry={() => setRetry(value => value + 1)}/>}
    {loading ? <Loading/> : <div className="m-item-icon-grid">
      {source === 'icon' && category === '全部' && !search && <button disabled={busy || !channel} onClick={() => void choose(null)} aria-label={t('选择默认图标')}><img src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt=""/><span>{t('默认图标')}</span></button>}
      {visible.map(entry => <button key={entry.id} disabled={busy || !channel} onClick={() => void choose(entry)} aria-label={t('选择图标：') + entry.name}><MaterialImage entry={entry} generation={generation}/><span>{entry.name}</span></button>)}
      {own.map(photo => <button key={photo.id} disabled={busy} aria-label={t('选择档案图片：') + photo.name} onClick={() => void choose(null, photo)}><PhotoView photo={photo} generation={generation}/><span>{photo.name}</span></button>)}
    </div>}
    {!loading && !visible.length && !own.length && source !== 'icon' && <EmptyState title={t('没有匹配的素材')} message={source === 'recent' ? t('使用过的素材会出现在这里。') : t('换个关键词，或从相册添加图片。')}/>}
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>
    <input ref={album} type="file" accept="image/*" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ''; }}/>
    <div className="m-item-icon-actions"><Button disabled={busy || !channel} onClick={() => camera.current?.click()}>{t('拍照')}</Button><Button disabled={busy || !channel} onClick={() => album.current?.click()}>{t('从相册选')}</Button></div>
  </div>;
}
