export type Asset = { id: string; name: string; price_cents: string | null; purchase_date: string | null; revision: number };
export type Details = { brand: string; model: string; serial_number: string; notes: string };
export type AssetRecord = { asset: Asset; details: Details; created_at: string | null; updated_at: string | null; deleted: boolean; deleted_at: string | null };
export type SaveAsset = { base: { request_id: string; generation: string; asset_id: string | null; expected_revision: number | null; name: string; price_cents: string | null; purchase_date: string | null }; details: Details };
export type Query = { search: string; filter: string; sort: string; descending: boolean; offset: number };
export type Page = { generation: string; items: AssetRecord[]; total: number; today: string };
export type Fields = Details & { name: string; price: string; date: string };
export const emptyFields: Fields = { name: '', price: '', date: '', brand: '', model: '', serial_number: '', notes: '' };
export function money(cents: string | null) { return cents === null ? '待补充' : `¥${(Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
export function inputMoney(value: string): string | null {
  if (!value.trim()) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim())) throw new Error('请输入非负金额，最多两位小数，最高 999,999,999.99 元。');
  const [whole, fraction = ''] = value.trim().split('.');
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}
export function localDay() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function validate(fields: Fields, today: string): Partial<Record<keyof Fields, string>> {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!fields.name.trim() || [...fields.name.trim()].length > 200) errors.name = '请填写名称，最多 200 字。';
  try { inputMoney(fields.price); } catch (e) { errors.price = (e as Error).message; }
  if (fields.date) {
    const parsed = new Date(fields.date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== fields.date || fields.date < '1900-01-01') errors.date = '请输入有效日期，格式为 YYYY-MM-DD。';
    else if (fields.date > today) errors.date = '购入日期不能晚于今天；计划购买的物品请后续记入心愿。';
  }
  for (const key of ['brand', 'model', 'serial_number', 'notes'] as const) if ([...fields[key]].length > (key === 'notes' ? 10000 : 200) || fields[key].includes('\0')) errors[key] = key === 'notes' ? '备注最多 10000 字，且不能含空字符。' : '最多 200 字，且不能含空字符。';
  return errors;
}
export function fieldsOf(record: AssetRecord): Fields {
  return { ...record.details, name: record.asset.name, price: record.asset.price_cents === null ? '' : (Number(record.asset.price_cents) / 100).toFixed(2), date: record.asset.purchase_date ?? '' };
}
export function costs(asset: Asset, today: string) {
  const days = asset.purchase_date ? Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(asset.purchase_date + 'T00:00:00Z')) / 86400000) + 1 : null;
  const daily = days && days > 0 && asset.price_cents !== null ? ((BigInt(asset.price_cents) + BigInt(Math.floor(days / 2))) / BigInt(days)).toString() : null;
  return { days, daily };
}
export function errorMessage(e: unknown) { return typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : '操作未完成，请重试。'; }
