// U19 售出保值率：类型、百分比格式，以及浏览器预览用的同规则计算。原生数据来自 Rust `resale_rate`。
import type { AssetRecord } from './asset.ts';

export type ResaleRow = { id: string; name: string; purchase_cents: string; sale_cents: string; gain_cents: string; rate_hundredths: number; sold_date: string };
export type ResaleExcluded = { id: string; name: string; reason: string };
export type ResaleRate = {
  included_count: number; total_purchase_cents: string; total_sale_cents: string; total_gain_cents: string;
  average_rate_hundredths: number | null; weighted_rate_hundredths: number | null;
  rows: ResaleRow[]; excluded: ResaleExcluded[];
};

/** 保值率不是变化量，不带 +；负值不会出现，仍保留真实负号。 */
export function percentText(hundredths: number) { return `${hundredths < 0 ? '−' : ''}${(Math.abs(hundredths) / 100).toFixed(2)}%`; }

/** 百分之一个百分点，四舍五入（半数进位），与 Rust 一致。 */
const hundredths = (sale: bigint, purchase: bigint) => Number((sale * 20000n + purchase) / (purchase * 2n));

/** 与 Rust `Store::resale_rate` 同一规则：已售出、未删除、未设不计入统计，购入价已知且大于 0 才可计算。 */
export function previewResaleRate(records: AssetRecord[]): ResaleRate {
  const rows: ResaleRow[] = [], excluded: ResaleExcluded[] = [];
  let purchaseTotal = 0n, saleTotal = 0n;
  for (const r of records) {
    if (r.deleted || r.preferences?.exclude.statistics || r.lifecycle?.state !== 'sold' || !r.sale) continue;
    const price = r.asset.price_cents;
    if (price === null || BigInt(price) === 0n) { excluded.push({ id: r.asset.id, name: r.asset.name, reason: price === null ? '购入金额未知' : '购入价为 ¥0，不计算' }); continue; }
    const p = BigInt(price), s = BigInt(r.sale.fields.price_cents);
    purchaseTotal += p; saleTotal += s;
    rows.push({ id: r.asset.id, name: r.asset.name, purchase_cents: p.toString(), sale_cents: s.toString(), gain_cents: (s - p).toString(), rate_hundredths: hundredths(s, p), sold_date: r.sale.fields.date });
  }
  // 精确比值从高到低：a/b > c/d ⇔ a·d > c·b；同值按 ID。
  rows.sort((x, y) => {
    const l = BigInt(y.sale_cents) * BigInt(x.purchase_cents), rr = BigInt(x.sale_cents) * BigInt(y.purchase_cents);
    return l < rr ? -1 : l > rr ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  const n = rows.length;
  const mean = n ? rows.reduce((sum, row) => sum + Number(row.sale_cents) * 10000 / Number(row.purchase_cents), 0) / n : null;
  return {
    included_count: n, total_purchase_cents: purchaseTotal.toString(), total_sale_cents: saleTotal.toString(), total_gain_cents: (saleTotal - purchaseTotal).toString(),
    average_rate_hundredths: mean === null ? null : Math.round(mean),
    weighted_rate_hundredths: n ? hundredths(saleTotal, purchaseTotal) : null,
    rows, excluded,
  };
}
