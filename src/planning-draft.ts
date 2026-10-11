// Unsaved section overlays reuse the persisted shape; no IPC, receipts or revisions are written.
import { defaultRetire } from './plan.ts';
import { mergeDebtRepayments } from './plan-debt.ts';
import type { PlanningSources, ProfileUpdate, StoredProfile } from './plan.ts';
type SectionInput = ProfileUpdate extends infer T ? T extends ProfileUpdate ? Omit<T, 'request_id' | 'generation' | 'expected_revision'> : never : never;
export function overlayPlanningDrafts(sources: PlanningSources, drafts: SectionInput[]): PlanningSources {
  if (!drafts.length || sources.profile.status !== 'ready') return sources;
  const next = structuredClone(sources);
  if (next.profile.status !== 'ready') return next;
  const p: StoredProfile = next.profile.value.saved?.profile ?? { assumptions: { inflation_hundredths: 0 }, retire: structuredClone(defaultRetire) };
  const core = (basis: string) => p.retire.core ??= { contract_version: 1, monetary_basis_date: basis, fund_rules: [], releases: [], occurrences: [] };
  const apply = (input: SectionInput): void => {
    switch (input.section) {
      case 'setup':
        apply({ section: 'basic', fields: input.fields.basic });
        if (input.fields.budget) apply({ section: 'budget', fields: input.fields.budget });
        if (input.fields.funds) apply({ section: 'funds', fields: input.fields.funds });
        apply({ section: 'simplified', fields: input.fields.simplified });
        break;
      case 'basic': {
        const { inflation_hundredths, monetary_basis_date, ...retire } = input.fields;
        p.assumptions.inflation_hundredths = inflation_hundredths;
        core(monetary_basis_date); Object.assign(p.retire, retire); break;
      }
      case 'budget': Object.assign(p.retire, input.fields); break;
      case 'debt_repayments':
        if (p.retire.core) p.retire.core.debt_repayments = mergeDebtRepayments(p.retire.core.debt_repayments ?? [], input.fields.updates, input.fields.remove);
        break;
      case 'funds': {
        const { monetary_basis_date, ...fields } = input.fields;
        Object.assign(core(monetary_basis_date), fields); break;
      }
      case 'events':
        p.retire.life_events = input.fields.life_events;
        if (p.retire.core) Object.assign(p.retire.core, { occurrences: input.fields.occurrences });
        break;
      case 'simplified': p.retire.simplified = input.fields; break;
    }
  };
  drafts.forEach(apply);
  next.profile.value.saved = { profile: p, revision: next.profile.value.saved?.revision ?? 0, updated_at: sources.today };
  return next;
}
