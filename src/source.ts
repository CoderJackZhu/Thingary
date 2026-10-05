import type { Section } from './library-mode';
import { errorMessage } from './asset.ts';
export type SourceTarget = { kind: 'asset' | 'wish' | 'snapshot' | 'expense' | 'virtual' | 'plan' | 'account'; id: string } | { kind: 'payment'; id: string; plan_id: string } | { kind: 'topup'; id: string; asset_id: string };
export type SourceFocus = { target: SourceTarget; generation: string; token: number };
export type SourceProps = { source?: SourceFocus | null; onSourceDone?: (message?: string) => void };
/** Resolvers re-read by stable ID, then check alive() before applying any state. */
export type SourceResolver = (target: SourceTarget, alive: () => boolean) => Promise<boolean> | boolean;
export type TimelineSelection = { filter: string; domain: string; year: number | null };
export const defaultTimeline: TimelineSelection = { filter: 'all', domain: 'all', year: null };
export const sourcePage = (target: SourceTarget): Section => ({ asset: 'assets', wish: 'wishlist', snapshot: 'wealth', expense: 'expenses', payment: 'recurring', plan: 'recurring', virtual: 'virtual', topup: 'virtual', account: 'wealth' } as const)[target.kind];
export type ReturnContext = { section: Section; generation: string; scroll: number; reviewYear: number | null; timeline: TimelineSelection };
export const validReturn = (context: ReturnContext | null, generation: string) => context?.generation === generation ? context : null;
export const missingSource = '这条来源记录已删除或失效，请返回后重新读取。';

export type SourceOutcome = { state: 'applied' } | { state: 'late' } | { state: 'failed'; message: string };
/**
 * Shared orchestration for opening a stable-ID source: validate against the
 * active dataset, then resolve. Dependencies are injected so the races below
 * stay testable outside a DOM: a stale token or a superseding open must never
 * apply resolver state, and a failed validation must never resolve.
 */
export async function openSourceRequest(
  source: SourceFocus,
  generation: string,
  validate: (target: SourceTarget, generation: string) => Promise<unknown>,
  resolve: SourceResolver,
  alive: () => boolean,
): Promise<SourceOutcome> {
  if (source.generation !== generation) return { state: 'failed', message: missingSource };
  try { await validate(source.target, generation); }
  catch (e) { return { state: 'failed', message: errorMessage(e) }; }
  if (!alive()) return { state: 'late' };
  try {
    const found = await resolve(source.target, alive);
    if (!alive()) return { state: 'late' };
    return found ? { state: 'applied' } : { state: 'failed', message: missingSource };
  }
  catch (e) { return { state: 'failed', message: errorMessage(e) }; }
}
