import { normalizeFinancePeriod } from './finance-contract.ts';
import type { FinanceCapabilities, FinancePeriod } from './finance-contract.ts';

export type FinanceRecordTab = 'income' | 'expenses' | 'movements';
export type FinanceSnapshotPair = { fromSnapshotId: string; toSnapshotId: string };
export type FinanceRoute =
  | {
    page: 'records';
    tab: FinanceRecordTab;
    period?: FinancePeriod;
    source?: { kind: 'income' | 'expense' | 'movement'; id: string };
    movementAccountIds?: string[];
  }
  | {
    page: 'review';
    view: 'period' | 'compare';
    pair?: FinanceSnapshotPair;
    toSnapshotId?: string;
    investmentAccountIds?: string[];
  }
  | { page: 'goals' }
  | { page: 'data-management'; importKind?: 'items' | 'finance' };

export function availableFinanceRecordTabs(capabilities: FinanceCapabilities): FinanceRecordTab[] {
  const tabs: FinanceRecordTab[] = [];
  if (capabilities.incomeRecords) tabs.push('income');
  if (capabilities.expenseRecords) tabs.push('expenses');
  if (capabilities.movementRecords) tabs.push('movements');
  return tabs;
}

/** Session preference fallback only; explicit source routes must use financeRouteAvailable. */
export function defaultFinanceRecordTab(capabilities: FinanceCapabilities, preferred?: FinanceRecordTab): FinanceRecordTab | null {
  const tabs = availableFinanceRecordTabs(capabilities);
  return preferred !== undefined && tabs.includes(preferred) ? preferred : tabs[0] ?? null;
}

/** This is a page capability check, not authorization to resolve a source or import data. */
export function financeRouteAvailable(route: FinanceRoute, capabilities: FinanceCapabilities): boolean {
  switch (route.page) {
    case 'records': return availableFinanceRecordTabs(capabilities).includes(route.tab);
    case 'review': return capabilities.review;
    case 'goals': return capabilities.goals;
    case 'data-management': return true;
  }
}

export type LegacyFinanceIntent =
  | { kind: 'expenses'; year?: number | null }
  | { kind: 'planning-income' }
  | { kind: 'planning-review'; toSnapshotId?: string }
  | { kind: 'wealth-changes'; pair?: FinanceSnapshotPair }
  | { kind: 'financial-import' }
  | { kind: 'item-import' }
  | { kind: 'export' }
  | { kind: 'goals' };

export function legacyFinanceRoute(intent: LegacyFinanceIntent): FinanceRoute {
  switch (intent.kind) {
    case 'expenses': {
      const period: FinancePeriod = intent.year == null ? { kind: 'all' } : { kind: 'year', year: intent.year };
      normalizeFinancePeriod(period);
      return { page: 'records', tab: 'expenses', period };
    }
    case 'planning-income': return { page: 'records', tab: 'income' };
    case 'planning-review': return {
      page: 'review', view: 'period',
      ...(intent.toSnapshotId !== undefined ? { toSnapshotId: intent.toSnapshotId } : {}),
    };
    case 'wealth-changes': return {
      page: 'review', view: 'compare',
      ...(intent.pair !== undefined ? { pair: intent.pair } : {}),
    };
    case 'financial-import': return { page: 'data-management', importKind: 'finance' };
    case 'item-import': return { page: 'data-management', importKind: 'items' };
    case 'export': return { page: 'data-management' };
    case 'goals': return { page: 'goals' };
  }
}

export type FinanceReturnContext = {
  generation: string;
  route: FinanceRoute;
  scroll: number;
  search?: string;
  sort?: string;
  expandedIds?: string[];
  accountView?: 'active' | 'closed' | 'all';
};

export function validFinanceReturn(
  context: FinanceReturnContext | null,
  currentGeneration: string,
  capabilities: FinanceCapabilities,
): FinanceReturnContext | null {
  return context?.generation === currentGeneration && financeRouteAvailable(context.route, capabilities) ? context : null;
}

/** Explicit stable-ID sources select their owner tab while preserving the browsing period. */
export function financeSourceRoute(
  target: { kind: string; id: string },
  current?: Extract<FinanceRoute, { page: 'records' }>,
): Extract<FinanceRoute, { page: 'records' }> | null {
  const tab = target.kind === 'income' ? 'income' : target.kind === 'expense' ? 'expenses' : target.kind === 'movement' ? 'movements' : null;
  if (!tab) return null;
  return { ...current, page: 'records', tab, source: { kind: target.kind as 'income' | 'expense' | 'movement', id: target.id } };
}
