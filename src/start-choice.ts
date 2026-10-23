import { financeModulesReady, type FinanceModulesUpdate, type RuntimeModules } from './modules.ts';

export const startChoiceKey = 'thingary.start-choice.v1';
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
function dismissedGenerations(storage: ChoiceStorage): Record<string, true> {
  const value = storage.getItem(startChoiceKey);
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid start choice');
  return parsed as Record<string, true>;
}
export function startChoiceDismissed(storage: ChoiceStorage | null, generation: string | null) {
  if (!storage || !generation) return false;
  try { const saved = dismissedGenerations(storage); return Object.hasOwn(saved, generation) && saved[generation] === true; }
  catch { return false; }
}
export function dismissStartChoice(storage: ChoiceStorage | null, generation: string | null) {
  if (!storage || !generation) return false;
  try { storage.setItem(startChoiceKey, JSON.stringify({ ...dismissedGenerations(storage), [generation]: true })); return true; }
  catch { return false; }
}
export function starterModules(modules: RuntimeModules, loaded: boolean): FinanceModulesUpdate | null {
  if (!loaded || !financeModulesReady(modules)) return null;
  return { modules: { ...modules, recurring: false, virtual: false }, incomes: modules.incomes, movements: modules.movements };
}
export function persistOverviewChoice(storage: ChoiceStorage | null, choice: StartChoice) {
  try { storage?.setItem(overviewViewKey, choice); } catch { /* Keep the in-memory choice usable. */ }
}
