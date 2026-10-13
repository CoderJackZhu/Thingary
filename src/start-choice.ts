import { financeModulesReady, type FinanceModulesUpdate, type RuntimeModules } from './modules.ts';

export const startChoiceKey = 'thingary.start-choice.v1';
export const overviewViewKey = 'thingary.overview-view.v1';
export type StartChoice = 'physical' | 'combined';
export type OverviewViewChoice = { generation: string; view: StartChoice; version: number };
type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function choiceStorage(): ChoiceStorage | null { try { return localStorage; } catch { return null; } }
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
