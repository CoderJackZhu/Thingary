import type { Draft } from './AssetEditor';

export function initialSupplementalOpen(draft: Pick<Draft, 'id' | 'fields' | 'classification' | 'options' | 'hasSupplemental'>) {
  if (!draft.id) return false;
  const p = draft.options?.preferences;
  return !!draft.hasSupplemental
    || ['brand', 'model', 'serial_number'].some(key => !!draft.fields[key as keyof typeof draft.fields])
    || !!draft.classification?.category_id || !!draft.classification?.channel_id
    || !!p && (!!p.label_id || p.cost_mode === 'per_use' || p.use_count !== 0 || p.goal.mode !== 'none' || p.pinned || Object.values(p.exclude).some(Boolean))
    || !!draft.options?.warranty || !!draft.options?.retired_date || !!draft.options?.sale;
}

export function supplementalField(key: string) {
  return ['brand', 'model', 'serial_number'].includes(key);
}
