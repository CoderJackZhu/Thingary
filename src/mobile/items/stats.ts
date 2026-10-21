import type { OverviewData } from '../../Overview';
import type { ResaleRate } from '../../resale';

// Read DTOs of the same commands used by Stats.tsx. Calculations stay in Rust.
export type StatsPeriod = 'all' | 'week' | 'month' | 'quarter' | 'year';
export type Granularity = 'month' | 'quarter' | 'year';
export type HoldingScope = 'held' | 'history';
export type StatsCategory = { id: string | null; name: string; count: number; known_cents: string; unknown_price_count: number };
export type StatsSnapshot = { period: StatsPeriod; start: string | null; end: string; total: number; active: number; retired: number; sold: number; known_cents: string; unknown_price_count: number; sale_proceeds_cents: string; sold_purchase_cents: string; sold_unknown_price_count: number; sold_zero_price_count: number; categories: StatsCategory[] };
export type Bucket = { key: string; start: string; end: string; count: number; known_cents: string; unknown_price_count: number; cumulative_cents: string };
export type Trend = { generation: string; today: string; granularity: Granularity; buckets: Bucket[]; known_cents: string; unknown_price_count: number; unknown_date_count: number; unknown_date_known_cents: string };
export type Ranked = { id: string; name: string; state: string; held_days: number; cost_cents: string; daily_cents: string };
export type Holding = { scope: HoldingScope; groups: { key: string; label: string; count: number }[]; dated_count: number; unknown_date_count: number; average_days: number | null; median_days: number | null; longest: Ranked | null; held_ranking: Ranked[]; sold_ranking: Ranked[]; excluded: { id: string; name: string; reason: string }[] };
export type Statistics = { overview: OverviewData; snapshot: StatsSnapshot; trend: Trend; holding: Holding; resale: ResaleRate };
export type StatsInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
/** Display a server-provided numerator/denominator in the desktop one-decimal format. */
export const percentage = (part: number, total: number) => total > 0 ? `${(part / total * 100).toFixed(1)}%` : '未知';

/** Guard commands without their own generation using bracketing reads, as a single page read. */
export async function readStatistics(call: StatsInvoke, options: { period: StatsPeriod; granularity: Granularity; scope: HoldingScope; today: string; generation?: string }): Promise<Statistics> {
  const before = await call<OverviewData>('overview', { scope: 'held' });
  if (before.today !== options.today || (options.generation && before.generation !== options.generation)) throw new Error('物品资料已变化，请重新读取。');
  const [snapshot, trend, holding, resale] = await Promise.all([
    call<StatsSnapshot>('stats_snapshot', { period: options.period }),
    call<Trend>('purchase_trend', { granularity: options.granularity }),
    call<Holding>('holding', { scope: options.scope }),
    call<ResaleRate>('resale_rate'),
  ]);
  const after = await call<OverviewData>('overview', { scope: 'held' });
  if (after.generation !== before.generation || after.today !== before.today || trend.generation !== before.generation || trend.today !== options.today || snapshot.end !== options.today || snapshot.period !== options.period || trend.granularity !== options.granularity || holding.scope !== options.scope) throw new Error('物品资料已变化，请重新读取。');
  return { overview: after, snapshot, trend, holding, resale };
}
