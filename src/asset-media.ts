import type { Photo } from './asset.ts';
import { t } from './i18n.ts';
/** Built-in materials are staged as named illustrations; user photos keep their own file name. */
export function isMaterialIllustration(photo: Pick<Photo, 'name'>) {
  const name = photo.name.toLocaleLowerCase();
  return photo.name.includes('示意图') || name.includes('illustration (not a real photo)');
}
// Only discard a cover staged by this still-unsaved picker session. Saved
// photos and explicitly added attachments remain available in the archive.
export function replaceDraftCover(photos: Photo[], transientCover: string | undefined, photo: Photo | null, newlyPrepared: boolean) {
  const next = photos.filter(p => p.id !== transientCover || p.id === photo?.id);
  if (photo && !next.some(p => p.id === photo.id)) next.push(photo);
  if (next.length > 20) throw new Error(t('这件物品已有 20 张图片，请先移除一张附件后再选择新图片。'));
  return { photos: next, cover: photo?.id ?? null, transientCover: photo && (newlyPrepared || photo.id === transientCover) ? photo.id : undefined };
}

/**
 * Choosing a new icon replaces the previous built-in illustration instead of
 * leaving it behind as an attachment. A real photo chosen as the old cover is
 * still an archive image, so it stays available under 备注.
 */
export function replaceDraftIcon(photos: Photo[], transientCover: string | undefined, currentCover: string | null, photo: Photo | null, newlyPrepared: boolean) {
  const previous = currentCover ? photos.find(item => item.id === currentCover) : undefined;
  const removePrevious = !!previous && previous.id !== photo?.id && isMaterialIllustration(previous);
  const next = photos.filter(item => item.id !== transientCover && !(removePrevious && item.id === previous.id));
  if (photo && !next.some(item => item.id === photo.id)) next.push(photo);
  if (next.length > 20) throw new Error(t('这件物品已有 20 张图片，请先移除一张附件后再选择新图片。'));
  return { photos: next, cover: photo?.id ?? null, transientCover: photo && (newlyPrepared || photo.id === transientCover) ? photo.id : undefined };
}
