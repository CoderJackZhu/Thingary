import { useEffect } from 'react';
import type { Photo } from '../../asset';
import { PhotoView } from '../../Photos';
import { Icon } from '../ui';
import { Glyph } from './glyphs';
import './photos.css';
import { t } from '../../i18n.ts';
/** Full-screen photo viewer shared by the item form and the item detail. `onRemove` adds a 删除 action (form only). */
export function PhotoViewer({ photo, generation, onClose, onRemove }: { photo: Photo; generation: string; onClose: () => void; onRemove?: () => void }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return <div className="mi-viewer" role="dialog" aria-modal="true" aria-label={'查看图片 ' + photo.name}>
    <div className="mi-viewer-bar"><button type="button" className="mi-viewer-button" aria-label={t('关闭图片')} onClick={onClose}><Icon name="close" size={22}/></button><span className="mi-viewer-name">{photo.name}</span>{onRemove ? <button type="button" className="mi-viewer-button mi-viewer-remove" onClick={onRemove}><Glyph name="trash" size={18}/>{t('删除')}</button> : <span/>}</div>
    <div className="mi-viewer-stage" onClick={onClose}><PhotoView photo={photo} generation={generation}/></div>
  </div>;
}

/** Row of photo thumbnails with an optional dashed 添加图片 tile at the end. */
export function PhotoThumbs({ photos, generation, onOpen, onAdd, addDisabled }: { photos: Photo[]; generation: string; onOpen: (photo: Photo) => void; onAdd?: () => void; addDisabled?: boolean }) {
  if (!photos.length && !onAdd) return null;
  return <div className="mi-thumbs" aria-label={t('图片附件')}>
    {photos.map(photo => <button key={photo.id} type="button" className="mi-thumb" aria-label={'查看图片 ' + photo.name} onClick={() => onOpen(photo)}><PhotoView photo={photo} generation={generation} compact/></button>)}
    {onAdd && <button type="button" className="mi-thumb mi-thumb-add" aria-label={t('添加图片')} disabled={addDisabled} onClick={onAdd}><Glyph name="imagePlus" size={26} strokeWidth={1.6}/></button>}
  </div>;
}
