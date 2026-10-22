import { emptyFields, fieldsOf, priceCents, priceOrigin, validate, type AssetRecord, type Classification, type Fields, type Photo, type SaveAsset } from '../../asset.ts';
import { defaultPreferences, type AssetOptions } from '../../preferences.ts';
import { readDefaultCurrency } from '../../currency-picker.ts';

export type ItemDraft = { fields: Fields; options: AssetOptions; classification: Classification; photos: Photo[]; cover: string | null; transientCover?: string; warrantyEndEdited?: boolean; id: string | null; revision: number | null };
export function itemDraft(record: AssetRecord | null): ItemDraft {
  return { fields: record ? fieldsOf(record) : { ...emptyFields, currency: readDefaultCurrency(), fx: '' }, options: { preferences: record?.preferences ?? defaultPreferences() }, classification: record?.classification ?? { category_id: null, channel_id: null }, photos: record?.photos ?? [], cover: record?.cover_id ?? null, id: record?.asset.id ?? null, revision: record?.asset.revision ?? null };
}
export function itemSaveInput(draft: ItemDraft, generation: string, today: string, requestId: string): SaveAsset {
  const issues = validate(draft.fields, today);
  if (Object.keys(issues).length) throw new Error(Object.values(issues).join(' '));
  const { name, date, price: _price, currency: _currency, fx: _fx, ...details } = draft.fields;
  return { options: draft.options, classification: draft.classification, base: { request_id: requestId, generation, asset_id: draft.id, expected_revision: draft.revision, name, price_cents: priceCents(draft.fields), purchase_date: date || null }, details, photos: { ids: draft.photos.map(photo => photo.id), cover_id: draft.cover } };
}

/** The foreign-currency record to save after the CNY price, or null (clears it). */
export const itemPriceOrigin = (draft: ItemDraft) => priceOrigin(draft.fields);

/** A picker communicates with its mounted editor in memory; closing the editor discards this channel. */
export type IconSession = { generation: string; photos: Photo[]; cover: string | null; choose: (photo: Photo | null, prepared: boolean) => void };
const iconSessions = new Map<string, IconSession>();
export const setIconSession = (key: string, session: IconSession) => { iconSessions.set(key, session); };
export const getIconSession = (key: string) => iconSessions.get(key);
export const clearIconSession = (key: string) => { iconSessions.delete(key); };
