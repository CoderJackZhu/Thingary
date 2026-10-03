import type { MaterialEntry } from './materials.ts';
export const uploadKey = 'thingary.material-upload.v1';
export type PendingUpload = { request: string; generation: string };
export function pendingUpload(storage: Pick<Storage, 'getItem'>): PendingUpload | null {
  const raw = storage.getItem(uploadKey);
  if (!raw) return null;
  const p = JSON.parse(raw);
  if (typeof p.request !== 'string' || typeof p.generation !== 'string') throw new Error('素材上传记录无法读取');
  return p;
}
// Callers persist the operation before opening a picker. A failed upload may
// already have committed; never infer absence from a rejected IPC response.
export async function uploadAndResolve(
  pending: PendingUpload,
  send: (p: PendingUpload) => Promise<MaterialEntry>,
  lookup: (p: PendingUpload) => Promise<MaterialEntry | null>,
): Promise<MaterialEntry | null> {
  try { return await send(pending); }
  catch { return await lookup(pending); }
}
