import type { Photo } from './asset.ts';
// Only discard a cover staged by this still-unsaved picker session. Saved
// photos and explicitly added attachments remain available in the archive.
export function replaceDraftCover(photos: Photo[], transientCover: string | undefined, photo: Photo | null, newlyPrepared: boolean) {
  const next = photos.filter(p => p.id !== transientCover || p.id === photo?.id);
  if (photo && !next.some(p => p.id === photo.id)) next.push(photo);
  if (next.length > 20) throw new Error('这件物品已有 20 张图片，请先移除一张附件后再选择新图片。');
  return { photos: next, cover: photo?.id ?? null, transientCover: photo && (newlyPrepared || photo.id === transientCover) ? photo.id : undefined };
}
