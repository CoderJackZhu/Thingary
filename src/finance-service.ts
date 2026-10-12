import { invoke } from '@tauri-apps/api/core';
import { normalizeFinancePeriod } from './finance-contract.ts';
import type { FinancePeriod, FinanceSourceState } from './finance-contract.ts';
import type { RuntimeModules } from './modules.ts';
import type { Account, Summary } from './wealth.ts';
import type { Income, PlanReview } from './plan.ts';
import type { ExpenseView } from './expenses.ts';

/** Native availability: no numeric fallback for missing, disabled or failed facts. */
export type FinanceRead<T> =
  | { status: 'ready'; value: T }
  | { status: 'disabled'; reason: string }
  | { status: 'error'; code: string; message: string };
export type AssetInterval = {
  snapshot_id: string; from: string; to: string; days: number;
  status: 'ok' | 'scope_changed';
  delta_nw_cents: string | null; hpf_change_cents: string | null; market_change_cents: string | null;
};
export type AssetReview = { generation: string; intervals: AssetInterval[]; incomplete_count: number };
export type FinanceSources = {
  generation: string; write_version: number; today: string;
  period: FinancePeriod; modules: RuntimeModules;
  wealth: FinanceRead<Summary>; accounts: FinanceRead<Account[]>; incomes: FinanceRead<Income[]>;
  expenses: FinanceRead<ExpenseView & { period: FinancePeriod }>;
  asset_review: FinanceRead<AssetReview>; history: FinanceRead<PlanReview>;
};
export const readFinanceSources = (period: FinancePeriod): Promise<FinanceSources> => invoke('finance_sources', { period });

/** Ready views retain metadata unless the consumer explicitly chooses emptiness. */
export function toFinanceSourceState<T>(source: FinanceRead<T>, emptyPredicate?: (value: T) => boolean): FinanceSourceState<T> {
  switch (source.status) {
    case 'ready': return emptyPredicate?.(source.value) ? { status: 'empty' } : { status: 'ready', value: source.value };
    case 'disabled': return { status: 'disabled', reason: source.reason };
    case 'error': return { status: 'error', message: source.message };
  }
}
function periodKey(period: FinancePeriod): string {
  return JSON.stringify([period.kind, normalizeFinancePeriod(period)]);
}
function modulesKey(modules: RuntimeModules): string {
  return JSON.stringify([
    modules.wishlist, modules.timeline, modules.stats, modules.wealth, modules.expenses,
    modules.recurring, modules.virtual, modules.planning, modules.incomes, modules.movements,
    modules.finance_status, modules.finance_revision,
  ]);
}
/** Invalidate on library/restore/module changes, even when switches later return. */
export function financeReadSession(read: (period: FinancePeriod) => Promise<FinanceSources> = readFinanceSources) {
  let sequence = 0;
  return {
    invalidate() { ++sequence; },
    async load(generation: string, period: FinancePeriod, modules: RuntimeModules): Promise<FinanceSources | null> {
      const expectedPeriod = periodKey(period);
      const expectedModules = modulesKey(modules);
      const ticket = ++sequence;
      // Copy the request before awaiting; mutation of UI state cannot change its scope.
      try {
        const result = await read({ ...period });
        return ticket === sequence && result.generation === generation && periodKey(result.period) === expectedPeriod && modulesKey(result.modules) === expectedModules ? result : null;
      } catch (error) {
        if (ticket !== sequence) return null;
        throw error;
      }
    },
  };
}
