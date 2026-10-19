import { financeModulesReady, type FinanceModulesUpdate, type RuntimeModules } from './modules.ts';

export const overviewViewKey = 'thingary.overview-view.v1';
export type StartChoice = 'physical' | 'combined';
export type OverviewViewChoice = { generation: string; view: StartChoice; version: number };
export type UsageSelection = { money: boolean; physical: boolean; planning: boolean };
type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function choiceStorage(): ChoiceStorage | null { try { return localStorage; } catch { return null; } }
export function selectedUsage(modules: RuntimeModules): UsageSelection {
  return { physical: modules.physical !== false || modules.wishlist, money: modules.wealth || modules.incomes || modules.movements || modules.expenses || modules.recurring || modules.virtual, planning: modules.planning };
}
export function usageCount(selection: UsageSelection): number { return Object.values(selection).filter(Boolean).length; }
/** Explicit selections affect entry visibility, never stored facts. A purpose that stays selected keeps its item switches; a newly selected one starts fully on. */
export function usageModules(modules: RuntimeModules, loaded: boolean, selection: UsageSelection): FinanceModulesUpdate | null {
  if (!loaded || !financeModulesReady(modules) || !usageCount(selection)) return null;
  const current = selectedUsage(modules);
  const physical = current.physical ? modules : null;
  const money = current.money ? modules : null;
  const keepPhysicalExtras = selection.physical;
  const keepMoneyExtras = selection.money;
  return {
    modules: { ...modules, physical: selection.physical && (physical?.physical ?? true), wealth: selection.money && (money?.wealth ?? true), planning: selection.planning,
      wishlist: keepPhysicalExtras && (physical?.wishlist ?? true), stats: keepPhysicalExtras && (physical?.stats ?? true),
      timeline: modules.timeline, expenses: keepMoneyExtras && (money?.expenses ?? true),
      recurring: keepMoneyExtras && (money?.recurring ?? true), virtual: keepMoneyExtras && (money?.virtual ?? true) },
    incomes: keepMoneyExtras && (money?.incomes ?? true), movements: keepMoneyExtras && (money?.movements ?? true),
  };
}
