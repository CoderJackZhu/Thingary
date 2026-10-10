// Defaults drawn from facts the person already has (盘点, 收入记录, 社保资料). Pure helpers; nothing is saved here.
import { hasPensionProfile } from './plan.ts';
import type { PlanReview, ProfileState } from './plan.ts';
import type { Draft } from './planning-basic-forms.ts';

type Saved = ProfileState['saved'];
export const HISTORY_MIN_INTERVALS = 3;
export const HISTORY_CAVEAT = '只算现金与存款，不含投资账户的变化；转进投资账户的钱会让它偏低';
export const SPEND_CAVEAT = '由收入减去现金变化推算：转进投资账户的钱会让它偏高，收入没记全会让它偏低';

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

const addMonths = (ym: string, n: number) => { const i = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n; return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`; };

/** The future pension-contribution plan, as one question: pay until retirement / stop paying / (existing explicit months). */
export type PcPlan = '' | 'until' | 'stop' | 'custom';
export function pcPlanOf(start: string, stop: string, birth: string, target: string): PcPlan {
  if (start === '' && stop === '') return '';
  if (start !== '' && start === stop) return 'stop';
  return birth !== '' && target !== '' && stop === addMonths(birth.slice(0, 7), Number(target) * 12) ? 'until' : 'custom';
}
/** Start/stop/base the draft stands for. Unknown stays null; saved months are kept so re-saving other sections never shifts them. */
export function pcValues(d: Draft, today: string): { start: string | null; stop: string | null; base: string | null } {
  const now = today.slice(0, 7), raw = { start: d.pcStart || null, stop: d.pcStop || null, base: d.pcBase || null };
  if (d.pcPlan === 'stop') { const m = d.pcStart !== '' && d.pcStart === d.pcStop ? d.pcStart : now; return { start: m, stop: m, base: raw.base ?? (d.pension.base || '0') }; }
  if (d.pcPlan !== 'until') return raw;
  const target = /^\d{4}-\d{2}/.test(d.birth) && /^\d+$/.test(d.target) ? addMonths(d.birth.slice(0, 7), Number(d.target) * 12) : null;
  if (target === null) return { start: null, stop: null, base: raw.base ?? (d.pension.base || null) };
  const start = d.pcStart || now;
  return { start: start > target ? target : start, stop: target, base: raw.base ?? (d.pension.base || null) };
}

/** Preselect what the existing facts already imply, only for a plan that has never been set up in the basic way. */
export function withDefaults(d: Draft, saved: Saved): Draft {
  if (saved?.profile.retire.basic) return d;
  const incomeMode = d.incomeMode !== '' ? d.incomeMode : saved && hasPensionProfile(saved.profile) ? 'employee' : 'excluded';
  return { ...d, incomeMode, pcPlan: d.pcPlan !== '' ? d.pcPlan : incomeMode === 'employee' ? 'until' : '' };
}
