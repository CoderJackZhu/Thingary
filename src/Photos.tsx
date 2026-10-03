import { CloseButton } from './CloseButton';
import { materialArt } from './materials';
import type { TaxonomySnapshot } from './taxonomy';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { errorMessage } from './asset';
import type { AssetRecord, Photo } from './asset';
export function PhotoView({ photo, generation, version = 0, compact = false, onMissing }: { photo: Photo; generation: string; version?: number; compact?: boolean; onMissing?: (missing: boolean) => void }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('');
  const [repairVersion, setRepairVersion] = useState(0);
  useEffect(() => { const refresh = () => setRepairVersion(v => v + 1); window.addEventListener('thingary-photo-repaired', refresh); return () => window.removeEventListener('thingary-photo-repaired', refresh); }, []);
  useEffect(() => {
    let live = true, url = ''; setSrc(''); setError(''); onMissing?.(false);
    void invoke<ArrayBuffer>('photo_preview', { id: photo.id, generation }).then(bytes => {
      if (live) { url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); setSrc(url); }
    }).catch(e => { if (live) { setError(errorMessage(e)); onMissing?.(true); } });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [photo.id, generation, version, repairVersion]);
  return src ? <img className="photo-image" src={src} alt={photo.name}/> : <span className="photo-placeholder" role={error ? 'status' : undefined} title={error || '正在读取图片'}>{error ? (compact ? '图片缺失' : error) : '读取中…'}</span>;
}
export function Cover({ record, generation, large = false, taxonomy }: { record: AssetRecord; generation: string; large?: boolean; taxonomy?: TaxonomySnapshot | null }) {
  const photo = record.photos.find(p => p.id === record.cover_id);
  return <span className={'object-mark ' + (large ? 'large' : '')}>{photo ? <PhotoView photo={photo} generation={generation} compact/> : <img className="category-art" src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(materialArt('icon-box'))} alt="默认箱子图标"/>}</span>;
}
export function PhotoPreview({ photo, generation, onClose }: { photo: Photo; generation: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [missing, setMissing] = useState(false), [version, setVersion] = useState(0), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  async function repair() {
    if (busy) return; setBusy(true); setNotice('');
    try { const selected = await invoke<Photo | null>('pick_photo', { generation, repair: photo.id }); if (selected) { setVersion(v => v + 1); window.dispatchEvent(new Event('thingary-photo-repaired')); setNotice('原图已修复。'); } }
    catch (e) { setNotice(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="photo-preview" aria-labelledby="preview-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><header><h2 id="preview-title">{photo.name}</h2><CloseButton aria-label="关闭预览" disabled={busy} onClick={onClose} autoFocus/></header><PhotoView photo={photo} generation={generation} version={version} onMissing={setMissing}/><p className="muted small">{missing ? '档案资料仍保留。请选择同一张原文件修复图片。' : '此处显示适合窗口的预览，原图保留在本机。'}</p>{missing && <button disabled={busy} onClick={() => void repair()}>重新选择原图修复</button>}{notice && <p role="status">{notice}</p>}</dialog>;
}
export function Gallery({ record, generation, showHeading = true }: { record: AssetRecord; generation: string; showHeading?: boolean }) {
  const [preview, setPreview] = useState<Photo | null>(null), [version, setVersion] = useState(0);
  if (!record.photos.length) return <p className="muted small">还没有图片，可在“编辑资料”中添加。</p>;
  return <section className="photo-section" aria-label="物品图片">{showHeading && <h3>图片 <small>{record.photos.length}</small></h3>}<div className="photo-strip">{record.photos.map(photo => <button className="photo-tile" key={photo.id} aria-label={'预览 ' + photo.name} onClick={() => setPreview(photo)}><PhotoView photo={photo} generation={generation} version={version}/><span className="photo-name">{record.cover_id === photo.id ? '封面 · ' : ''}{photo.name}</span></button>)}</div>{preview && <PhotoPreview photo={preview} generation={generation} onClose={() => { setPreview(null); setVersion(v => v + 1); }}/>}</section>;
}
