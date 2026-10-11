// Facts from recorded income and inventory history. Pure helpers; nothing is saved here.
import type { PlanReview } from './plan.ts';

export const HISTORY_MIN_INTERVALS = 3;
export const SAVING_BASIS_CAVEAT = '估计存下只看现金、存款和负债：转进投资账户的钱会让它偏低、花销偏高；收入没记全会让花销偏低。';

/** `saving`/`spend` count cash and debt only; `market` is the investment accounts' monthly change (transfers and gains mixed), shown beside them and never added. */
export type History = { saving: string | null; spend: string | null; market: string | null; count: number; spend_count: number; reason: string };
/** Median of the usual (complete, income-recorded, not one-off, last 12 months) intervals. Fewer than 3 gives nothing, never 0. */
export function historyHints(review: PlanReview | null | undefined): History {
  const s = review?.stats;
  if (!s) return { saving: null, spend: null, market: null, count: 0, spend_count: 0, reason: '还没有可用的盘点历史。' };
  if (s.count < HISTORY_MIN_INTERVALS || s.median_monthly_saving_cents == null) return { saving: null, spend: null, market: null, count: s.count, spend_count: s.spend_count ?? s.count, reason: s.count === 0 ? '还没有可比较的盘点区间（需要完整盘点，且区间内有收入记录）。' : `可比较的盘点区间只有 ${s.count} 个，至少需要 ${HISTORY_MIN_INTERVALS} 个。` };
  const spend = (s.spend_count ?? s.count) >= HISTORY_MIN_INTERVALS ? s.median_monthly_cash_spend_cents ?? s.median_monthly_spend_cents ?? null : null, market = s.median_monthly_market_change_cents ?? null;
  return { saving: s.median_monthly_cash_saving_cents ?? s.median_monthly_saving_cents, spend: spend !== null && BigInt(spend) > 0n ? spend : null, market: market !== null && BigInt(market) !== 0n ? market : null, count: s.count, spend_count: s.spend_count ?? s.count, reason: '' };
}

/** "到账 − 开销": both numbers are cents strings from the person; the difference may be negative. */
export const savingFromFlow = (income: string, spend: string): string | null => (income === '' || spend === '' ? null : String(BigInt(income) - BigInt(spend)));
