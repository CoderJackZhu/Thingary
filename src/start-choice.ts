import { financeModulesReady, type FinanceModulesUpdate, type RuntimeModules } from './modules.ts';

// The old, dataset-scoped card dismissal remains readable for existing users.
export const startChoiceKey = 'thingary.start-choice.v1';
export const welcomeKey = 'thingary.welcome.v1';
export const overviewViewKey = 'thingary.overview-view.v1';
export type StartChoice = 'physical' | 'combined';
export type OverviewViewChoice = { generation: string; view: StartChoice; version: number };
export type UsageSelection = { money: boolean; physical: boolean; planning: boolean };
export type WelcomeState = 'completed' | 'skipped' | null;
type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function choiceStorage(): ChoiceStorage | null { try { return localStorage; } catch { return null; } }
export function welcomeState(storage: ChoiceStorage | null): WelcomeState {
  try {
    const value = storage?.getItem(welcomeKey);
    if (value === 'completed' || value === 'skipped') return value;
    const legacy = JSON.parse(storage?.getItem(startChoiceKey) ?? 'null');
    return legacy && !Array.isArray(legacy) && typeof legacy === 'object' && Object.values(legacy).some(v => v === true) ? 'skipped' : null;
  } catch { return null; }
}
export function rememberWelcome(storage: ChoiceStorage | null, value: Exclude<WelcomeState, null>): boolean {
  try { if (!storage) return false; storage.setItem(welcomeKey, value); return true; } catch { return false; }
}
export function selectedUsage(modules: RuntimeModules): UsageSelection {
  return { physical: modules.physical !== false || modules.wishlist, money: modules.wealth || modules.incomes || modules.movements || modules.expenses || modules.recurring || modules.virtual, planning: modules.planning };
}
export function usageCount(selection: UsageSelection): number { return Object.values(selection).filter(Boolean).length; }
/** Explicit selections affect entry visibility, never stored facts. A purpose that stays selected keeps its item switches; a newly selected one starts fully on. */
export function usageModules(modules: RuntimeModules, loaded: boolean, selection: UsageSelection, firstUse: boolean): FinanceModulesUpdate | null {
  if (!loaded || !financeModulesReady(modules) || !usageCount(selection)) return null;
  const current = selectedUsage(modules);
  const physical = firstUse || !current.physical ? null : modules;
  const money = firstUse || !current.money ? null : modules;
  const keepPhysicalExtras = selection.physical;
  const keepMoneyExtras = selection.money;
  return {
    modules: { ...modules, physical: selection.physical && (physical?.physical ?? true), wealth: selection.money && (money?.wealth ?? true), planning: selection.planning,
      wishlist: keepPhysicalExtras && (physical?.wishlist ?? true), stats: keepPhysicalExtras && (physical?.stats ?? true),
      timeline: firstUse || modules.timeline, expenses: keepMoneyExtras && (money?.expenses ?? true),
      recurring: keepMoneyExtras && (money?.recurring ?? true), virtual: keepMoneyExtras && (money?.virtual ?? true) },
    incomes: keepMoneyExtras && (money?.incomes ?? true), movements: keepMoneyExtras && (money?.movements ?? true),
  };
}
export function persistOverviewChoice(storage: ChoiceStorage | null, choice: StartChoice) {
  try { storage?.setItem(overviewViewKey, choice); } catch { /* Keep the in-memory choice usable. */ }
}
export function usageOverview(selection: UsageSelection): StartChoice { return selection.physical && !selection.money && !selection.planning ? 'physical' : 'combined'; }
