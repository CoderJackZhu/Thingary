// Unsaved section overlays reuse the persisted shape; no IPC, receipts or revisions are written.
import { defaultRetire } from './plan.ts';
import { noOverrides } from './plan-params.ts';
import type { PlanningSources, ProfileUpdate, StoredProfile } from './plan.ts';
type SectionInput = ProfileUpdate extends infer T ? T extends ProfileUpdate ? Omit<T, 'request_id' | 'generation' | 'expected_revision'> : never : never;
export function overlayPlanningDrafts(sources: PlanningSources, drafts: SectionInput[]): PlanningSources {
  if (!drafts.length || sources.profile.status !== 'ready') return sources;
  const next = structuredClone(sources);
  if (next.profile.status !== 'ready') return next;
  const p: StoredProfile = next.profile.value.saved?.profile ?? {
    birth_month: null, worker: null, region: null, paid_months: null, account_balance_cents: null,
    base_cents: null, past_index_hundredths: null, flex_months: null, personal_pension_annual_cents: null,
    marginal_tax_hundredths: null, assumptions: { inflation_hundredths: 0, wage_growth_hundredths: 0, pp_return_hundredths: 0 },
    overrides: { ...noOverrides }, retire: structuredClone({ ...defaultRetire, target_age: null }),
  };
  const core = (basis: string) => p.retire.core ??= { contract_version: 1, monetary_basis_date: basis, fund_rules: [], hpf_monthly_cents: null, personal_pension_account_id: null, personal_pension_balance_confirmed: false, occurrences: [] };
  const apply = (input: SectionInput): void => {
    switch (input.section) {
      case 'setup':
        apply({ section: 'basic', fields: input.fields.basic });
        if (input.fields.budget) apply({ section: 'budget', fields: input.fields.budget });
        if (input.fields.funds) apply({ section: 'funds', fields: input.fields.funds });
        if (input.fields.pension) apply({ section: 'pension', fields: input.fields.pension });
        break;
      case 'basic': {
        const { birth_month, inflation_hundredths, monetary_basis_date, confirm_legacy_replacement: _confirm, ...retire } = input.fields;
        p.birth_month = birth_month; p.assumptions.inflation_hundredths = inflation_hundredths;
        core(monetary_basis_date); Object.assign(p.retire, retire); break;
      }
      case 'budget': Object.assign(p.retire, input.fields); break;
      case 'funds': {
        const { monetary_basis_date, ...fields } = input.fields;
        Object.assign(core(monetary_basis_date), fields); break;
      }
      case 'events':
        p.retire.life_events = input.fields.life_events;
        if (p.retire.core) Object.assign(p.retire.core, { occurrences: input.fields.occurrences });
        break;
      case 'pension': {
        const { wage_growth_hundredths, pp_return_hundredths, ...fields } = input.fields;
        Object.assign(p, fields); Object.assign(p.assumptions, { wage_growth_hundredths, pp_return_hundredths }); break;
      }
    }
  };
  drafts.forEach(apply);
  next.profile.value.saved = { profile: p, revision: next.profile.value.saved?.revision ?? 0, updated_at: sources.today };
  return next;
}
