// In-memory preview adapter only. Native costs continue to come from Rust.
import type { AssetRecord } from './asset.ts';
import { localDay } from './asset.ts';
import { settlement } from './sales.ts';
export function previewRecord(source: AssetRecord, today = localDay()): AssetRecord {
  const record = structuredClone(source);
  const unknown = record.maintenances.filter(m => m.fields.cost_cents === null).length;
  const known = record.maintenances.reduce((sum, m) => sum + BigInt(m.fields.cost_cents ?? '0'), 0n);
  const total = record.asset.price_cents === null || unknown ? null : (BigInt(record.asset.price_cents) + known).toString();
  record.costs = { ...record.costs, known_maintenance_cents: known.toString(), unknown_maintenance_count: unknown, total_investment_cents: total };
  const result = settlement(record, record.sale?.fields ?? {date: today, price_cents: '0', platform: '', buyer: '', notes: ''});
  record.costs = { ...record.costs, held_days: result.days, daily_cents: result.daily, sale_proceeds_cents: record.sale?.fields.price_cents ?? null, net_cost_cents: record.sale ? result.net : null };
  return record;
}
