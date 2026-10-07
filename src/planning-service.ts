import { invoke } from '@tauri-apps/api/core';
import { submit, resolvePending } from './wealth.ts';
import type { ProfileState, ProfileUpdate, PlanningSources } from './plan.ts';
import { requestGate } from './review.ts';

export type PlanningModules = { planning: boolean; wealth: boolean };
export const readPlanningSources = (modules: PlanningModules): Promise<PlanningSources> => invoke('planning_sources', { planningEnabled: modules.planning, wealthEnabled: modules.wealth });
/** Reuse the persisted pending receipt: an unknown commit never becomes a new request. */
export const savePlanningSection = (input: ProfileUpdate): Promise<NonNullable<ProfileState['saved']>> => submit({ command: 'plan_profile_update', input, label: '规划分区' });
export const resolvePlanningSection = (input: ProfileUpdate) => resolvePending({ command: 'plan_profile_update', input, label: '规划分区' });
/** Every refresh/module/library change drops all old sources, including hidden wealth. No cross-call cache. */
export function planningReadSession(read: (modules: PlanningModules) => Promise<PlanningSources> = readPlanningSources) {
  const gate = requestGate();
  return {
    invalidate: gate.invalidate,
    async load(generation: string, modules: PlanningModules): Promise<PlanningSources | null> {
      const ticket = gate.next();
      const result = await read({ ...modules });
      return gate.accepts(ticket, generation, result.generation) && result.modules.planning === modules.planning && result.modules.wealth === modules.wealth ? result : null;
    },
  };
}
