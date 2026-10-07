// Seam for the shared capability producer. The UI never computes requirement/prediction itself:
// the native-contract owner binds one provider (the browser preview binds a fixture selector).
import { buildBasicCapabilities } from './plan-basic.ts';
import { overlayPlanningDrafts } from './planning-draft.ts';
import type { BasicCapabilities, PlanningSources } from './plan.ts';
import type { SectionInput } from './planning-basic-data.ts';

/** `drafts` are unsaved section updates applied in memory only (setup preview); `contribution` is an unsaved trial amount in integer cents. */
export type CapabilityOptions = { contribution: string | null; drafts: SectionInput[] };
export type CapabilityProvider = (sources: PlanningSources, options: CapabilityOptions) => BasicCapabilities;
let bound: CapabilityProvider | null = (sources, options) => buildBasicCapabilities(overlayPlanningDrafts(sources, options.drafts), options.contribution === null ? undefined : options.contribution);
export const bindCapabilityProvider = (provider: CapabilityProvider | null) => { bound = provider; };
export type CapabilityResult = { status: 'unbound' } | { status: 'error'; message: string } | { status: 'ready'; caps: BasicCapabilities };
export function readCapabilities(sources: PlanningSources, options: Partial<CapabilityOptions> = {}): CapabilityResult {
  if (!bound) return { status: 'unbound' };
  try { return { status: 'ready', caps: bound(sources, { contribution: options.contribution ?? null, drafts: options.drafts ?? [] }) }; }
  catch (e) { return { status: 'error', message: e instanceof Error ? e.message : String(e) }; }
}
