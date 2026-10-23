// 心愿保存请求的构造：校验、偏好、图片和「考虑替换的物品」关系，与桌面 WishEditor.save 内联逻辑同一规则（桌面源码被测试按文本锁定，未改动）。
import { inputMoney, localDay } from './asset.ts';
import { defaultWishPreferences } from './preferences.ts';
import { validateWishlist } from './wishlist.ts';
import type { WishPlanSave, WishlistDraft, WishlistFields } from './wishlist.ts';
import { t } from './i18n.ts';
export type WishSaveErrors = Partial<Record<keyof WishlistFields, string>>;

/** 编辑中使用的偏好；新心愿的加入日期取今天。 */
export const draftPreferences = (draft: WishlistDraft) => draft.preferences ?? { ...defaultWishPreferences(), added_date: localDay() };
export const draftPhotos = (draft: WishlistDraft) => draft.photos ?? (draft.cover ? [draft.cover] : []);
/** 草稿里的替换物品：undefined 沿用心愿原关系，null 表示清除。 */
export const draftReplacementId = (draft: WishlistDraft): string | null => draft.replacementAssetId !== undefined ? draft.replacementAssetId : draft.item?.replacement_asset?.id ?? null;

/** 校验并构造 save_wish_plan 的输入；开启提醒必须有计划日期。已有 planPending 时原样沿用以便核对。 */
export function wishPlanSave(draft: WishlistDraft, requestId: string): { errors: WishSaveErrors; input: null } | { errors: WishSaveErrors; input: WishPlanSave } {
  const p = draftPreferences(draft);
  const errors = validateWishlist(draft.fields);
  if (p.reminder && !draft.fields.target_date) errors.target_date = t('开启提醒需要先选择计划日期。');
  if (Object.keys(errors).length) return { errors, input: null };
  if (draft.planPending) return { errors, input: draft.planPending };
  const { estimated_price: price, ...fields } = draft.fields;
  const input: WishPlanSave = {
    request_id: requestId, generation: draft.generation, id: draft.item?.id ?? null, expected_revision: draft.item?.revision ?? null,
    fields: { ...fields, estimated_price_cents: inputMoney(price), target_date: draft.fields.target_date || null },
    preferences: p, photos: { ids: draftPhotos(draft).map(photo => photo.id), cover_id: draft.cover?.id ?? null },
    replacement_asset_id: draftReplacementId(draft), ...(draft.replacementAssetId === null ? { clear_replacement: true } : {}),
  };
  return { errors, input };
}
