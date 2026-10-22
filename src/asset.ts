import { t, numberLocale } from './i18n.ts';
import { convertCurrency, currencyAmount, currencyCode, currencyDecimals, decimalUnits, parseDecimal, rateLabel } from './currency.ts';
import { t as tr } from './i18n.ts';
export type Asset = { id: string; name: string; price_cents: string | null; purchase_date: string | null; revision: number };
export type Details = { brand: string; model: string; serial_number: string; notes: string };
export type Photo = { id: string; name: string };
export type Selection = { ids: string[]; cover_id: string | null };
export type Classification = { category_id: string | null; channel_id: string | null };
export type WishlistOrigin = { id: string; name: string; estimated_price_cents: string | null; created_at: string; achieved_at: string };
export type PriceOrigin = { currency: string; original_minor: string; fx_rate_micro: string };
export type AssetRecord = {price_origin?: PriceOrigin | null; label_name?:string|null; preferences?: import("./preferences").AssetPreferences; per_use_cents?:string|null; origin_wishlist?: WishlistOrigin | null; sale?: import("./sales").Sale | null; maintenances: import("./maintenance").Maintenance[]; warranties: import("./warranty").Warranty[]; warranty_summary: import("./warranty").WarrantySummary; costs: import("./maintenance").CostSummary; lifecycle?: import("./lifecycle").Lifecycle; classification?: Classification; asset: Asset; details: Details; created_at: string | null; updated_at: string | null; deleted: boolean; deleted_at: string | null; photos: Photo[]; cover_id: string | null };
export type SaveAsset = { options?: import("./preferences").AssetOptions; base: { request_id: string; generation: string; asset_id: string | null; expected_revision: number | null; name: string; price_cents: string | null; purchase_date: string | null }; details: Details; photos?: Selection; classification?: Classification };
export type Query = { category?: import("./taxonomy").CategoryFilterValue; search: string; filter: string; sort: string; descending: boolean; offset: number; warranty?: string; label?: string | null };
export type Page = { generation: string; items: AssetRecord[]; total: number; today: string };
/** `price` is in the unit `currency` (CNY when unset); a foreign price also needs `fx`, the CNY value of 1 unit as decimal text. */
export type Fields = Details & { name: string; price: string; date: string; currency?: string; fx?: string };
export const emptyFields: Fields = { name: '', price: '', date: '', brand: '', model: '', serial_number: '', notes: '' };
// U16-D2：整数元不显示角分；单位成本（日均、每次）用 unitMoney，始终两位。只改显示。
export function yuan(cents: string, always = false) { const n = Number(cents); return `${n < 0 ? '−\u2060' : ''}¥${(Math.abs(n) / 100).toLocaleString(numberLocale(), { minimumFractionDigits: always || n % 100 !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`; }
export function money(cents: string | null) { return cents === null ? tr('待补充') : yuan(cents); }
export function unitMoney(cents: string | null) { return cents === null ? tr('待补充') : yuan(cents, true); }
export function inputMoney(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim())) throw new Error(t('请输入非负金额，最多两位小数，最高 999,999,999.99 元。'));
  const [whole, fraction = ''] = value.trim().split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
/** The CNY cents this price means: plain yuan for CNY, otherwise the original amount converted at the typed rate. */
export function priceCents(f: Pick<Fields, 'price' | 'currency' | 'fx'>): string | null {
  const code = currencyCode(f.currency);
  if (code === 'CNY') return inputMoney(f.price);
  const text = f.price.trim();
  if (!text) return null;
  const places = currencyDecimals(code);
  if (!new RegExp(`^\\d{1,12}${places ? `(\\.\\d{1,${places}})?` : ''}$`).test(text)) throw new Error(places ? t('请输入非负金额，最多 {places} 位小数。', { places }) : t('这个币种不支持小数，请填写整数。'));
  const rate = (f.fx ?? '').trim();
  if (!rate) throw new Error(t('请填写汇率：1 {code} 折合多少人民币。', { code }));
  const micro = parseDecimal(rate, 6);
  if (micro === '0') throw new Error(t('汇率须大于 0。'));
  return convertCurrency(code, parseDecimal(text, places), micro);
}
/** The foreign-currency record to keep beside the CNY price, or null for a CNY or unknown price. */
export function priceOrigin(f: Pick<Fields, 'price' | 'currency' | 'fx'>): PriceOrigin | null {
  const code = currencyCode(f.currency);
  if (code === 'CNY' || !f.price.trim()) return null;
  return { currency: code, original_minor: parseDecimal(f.price.trim(), currencyDecimals(code)), fx_rate_micro: parseDecimal((f.fx ?? '').trim(), 6) };
}
/** "1,299.00 USD · 汇率 7.1234" for an item bought in a foreign currency, else null. */
export function originText(record: Pick<AssetRecord, 'price_origin'>): string | null {
  const o = record.price_origin;
  return o ? t('{amount} · 汇率 {rate}', { amount: currencyAmount(o.currency, o.original_minor), rate: rateLabel(o.fx_rate_micro) }) : null;
}
export function localDay(now = new Date()) { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function validate(fields: Fields, today: string): Partial<Record<keyof Fields, string>> {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!fields.name.trim() || [...fields.name.trim()].length > 200) errors.name = tr('请填写名称，最多 200 字。');
  try { priceCents(fields); } catch (e) { errors.price = (e as Error).message; }
  if (fields.date) {
    const parsed = new Date(fields.date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fields.date || fields.date < '1900-01-01') errors.date = tr('请输入有效日期，格式为 YYYY-MM-DD。');
    else if (fields.date > today) errors.date = tr('购入日期不能晚于今天；计划购买的物品请后续记入心愿。');
  }
  for (const key of ['brand', 'model', 'serial_number', 'notes'] as const) if ([...fields[key]].length > (key === 'notes' ? 10000 : 200) || fields[key].includes('\0')) errors[key] = key === 'notes' ? tr('备注最多 10000 字，且不能含空字符。') : tr('最多 200 字，且不能含空字符。');
  return errors;
}
export function fieldsOf(record: AssetRecord): Fields {
  const o = record.price_origin;
  if (o) return { ...record.details, name: record.asset.name, price: decimalUnits(o.original_minor, currencyDecimals(o.currency)), currency: o.currency, fx: decimalUnits(o.fx_rate_micro, 6).replace(/\.?0+$/, ''), date: record.asset.purchase_date ?? '' };
  return { ...record.details, name: record.asset.name, price: record.asset.price_cents === null ? '' : (Number(record.asset.price_cents) / 100).toFixed(2), currency: 'CNY', fx: '', date: record.asset.purchase_date ?? '' };
}
export function costs(asset: Asset, today: string) {
  const days = asset.purchase_date ? Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(asset.purchase_date + 'T00:00:00Z')) / 86400000) + 1 : null;
  const daily = days && days > 0 && asset.price_cents !== null ? ((BigInt(asset.price_cents) + BigInt(Math.floor(days / 2))) / BigInt(days)).toString() : null;
  return { days, daily };
}
/** Rust 的固定错误文字在英文表里有译文（见 scripts/i18n-keys.mjs）；带动态内容的错误仍显示中文。 */
export function errorMessage(e: unknown) { return typeof e === 'object' && e !== null && 'message' in e ? t(String(e.message)) : t('操作未完成，请重试。'); }
/** 攒钱保存失败的提示：样例里这笔会让心愿达到目标而自动实现，但样例不能新增物品，单独说明原因与出路。 */
export function savingsErrorNotice(e: unknown) {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : '';
  return code === 'SAMPLE_NO_NEW_ASSET' ? tr('这笔金额会让心愿达到目标并自动实现，但样例里不能新增物品，所以没有保存。想体验实现心愿，请先点顶部「开始记录我的资料」。') : errorMessage(e);
}
