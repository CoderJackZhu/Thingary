import type { Assumptions, Overrides } from './plan-params.ts';
import type { PlanningCore, Occurrence, FundRule } from './plan-core.ts';
import type { RetireInputs, StoredProfile, StoredSavingPhase, StoredSpendItem, StoredIncomeItem, StoredLifeEvent, ProfileState } from './plan.ts';
import type { Plan, Projection, Outcome } from './plan-ledger.ts';
import type { Read } from './review.ts';
import type { Snapshot, Account } from './wealth.ts';
import type { PlanReview, Income } from './plan.ts';

/** B is a closing date. Simulation replaces live funds; it never creates a snapshot. */
export type BasicStart = { kind: 'live' } | { kind: 'simulation'; id: string; available_cents: string | null; date: string | null; notes: string };
export type CostScope = { source_id: string; treatment: 'included' | 'extra' | 'excluded'; reference_cents: string | null };
export type IncomeSelection = { id: string; source_id: string; role: 'state_pension' | 'other' };
export type BasicInputs = {
  contract_version: 1;
  start: BasicStart;
  contribution: { id: string; monthly_cents: string | null };
  retirement_income: { mode: null | 'excluded' | 'manual' | 'beijing'; selected: IncomeSelection[] };
  /** Explicit half-open contribution months, independent of contribution amount/sign and retirement trigger. */
  pension_contributions: { start_month: string | null; stop_month: string | null; base_cents: string | null };
  contribution_costs: CostScope[];
  retirement_costs: CostScope[];
};
/** Original assumptions and stable references only; no occurrence, payment, debt or account copies. */
export type LegacyDefinition = {
  contract_version: 1; recorded_at: string; birth_month: string | null; monetary_basis_date: string | null;
  assumptions: Assumptions; spend_cents: string | null; target_age: number | null; horizon_age: number; mode: RetireInputs['mode'];
  real_return_before_hundredths: number; real_return_after_hundredths: number; volatility_hundredths: number; emergency_months: number;
  saving_phases: StoredSavingPhase[]; route_id: string | null; route_from_age: number; gap_share_hundredths: number; gap_keeps_paying: boolean;
  spend_items: StoredSpendItem[]; income_items: StoredIncomeItem[]; event_ids: string[]; costs: PlanningCore['costs'];
  keep_paying_until_age: number | null; keep_paying_monthly_cents: string; keep_paying_base_cents: string; rent_cents: string;
};
export type BasicFields = Pick<StoredProfile, 'birth_month'> & Pick<RetireInputs, 'spend_cents' | 'target_age' | 'horizon_age' | 'mode' | 'real_return_before_hundredths' | 'real_return_after_hundredths' | 'volatility_hundredths' | 'emergency_months'> & {
  inflation_hundredths: number; monetary_basis_date: string; basic: BasicInputs; confirm_legacy_replacement: boolean;
};
export type PensionFields = Pick<StoredProfile, 'birth_month' | 'worker' | 'region' | 'paid_months' | 'account_balance_cents' | 'base_cents' | 'past_index_hundredths' | 'flex_months' | 'personal_pension_annual_cents' | 'marginal_tax_hundredths'> & {
  wage_growth_hundredths: number; pp_return_hundredths: number; overrides: Overrides;
};
export type FundsFields = { monetary_basis_date: string; fund_rules: FundRule[]; hpf_monthly_cents: string | null; personal_pension_account_id: string | null; personal_pension_balance_confirmed: boolean };
export type EventsFields = { life_events: StoredLifeEvent[]; occurrences: Occurrence[]; costs: PlanningCore['costs'] };
export type BudgetFields = Pick<RetireInputs, 'spend_items' | 'income_items' | 'rent_cents' | 'keep_paying_until_age' | 'keep_paying_monthly_cents' | 'keep_paying_base_cents'>;
export type SetupFields = { basic: BasicFields; budget: BudgetFields | null; funds: FundsFields | null; pension: PensionFields | null };
export type ProfileUpdate = { request_id: string; generation: string; expected_revision: number | null } & (
  | { section: 'setup'; fields: SetupFields }
  | { section: 'basic'; fields: BasicFields }
  | { section: 'pension'; fields: PensionFields }
  | { section: 'funds'; fields: FundsFields }
  | { section: 'events'; fields: EventsFields }
  | { section: 'budget'; fields: BudgetFields }
);
export type CapabilityName = 'funds' | 'requirement' | 'prediction' | 'pension';
export type MissingCode = 'PROFILE_UNKNOWN' | 'BIRTH_UNKNOWN' | 'TARGET_UNKNOWN' | 'BUDGET_UNKNOWN' | 'START_UNKNOWN' | 'WEALTH_DISABLED' | 'SOURCE_ERROR' | 'SOURCE_STALE' | 'FUNDS_UNCONFIRMED' | 'OCCURRENCE_UNCONFIRMED' | 'COST_SCOPE_UNKNOWN' | 'COST_SCOPE_INVALID' | 'INCOME_MODE_UNKNOWN' | 'INCOME_SOURCE_UNKNOWN' | 'PENSION_FACTS_UNKNOWN' | 'PENSION_CONTRIBUTIONS_UNKNOWN' | 'POOL_UNCONFIRMED' | 'CONTRIBUTION_UNKNOWN' | 'HORIZON_INVALID';
export type PlanningMissing = { code: MissingCode; capability: CapabilityName; owner: 'basic' | 'pension' | 'funds' | 'events' | 'budget' | 'service'; field: string; message: string; kind: 'fact' | 'assumption' | 'read_error' | 'constraint' };
export type Capability<T> = { status: 'ready'; value: T } | { status: 'blocked'; missing: PlanningMissing[] };
export type RequirementResult = { before_hundredths: number; after_hundredths: number } & (
  | { status: 'found'; monthly_cents: string }
  | { status: 'no_positive_contribution'; monthly_cents: '0' }
  | { status: 'search_not_found'; search_limit_cents: string }
  | { status: 'payment_constraint'; message: string }
  | { status: 'not_applicable'; message: string }
  | { status: 'out_of_bounds'; message: string }
);
export type RequirementValue = { set: RequirementResult; lower: RequirementResult; target_month: string; horizon_month: string; budget_scope: 'complete' };
export type PredictionValue = { source: 'saved' | 'temporary'; contribution_cents: string; plan: Plan; plan0: Plan; projection: Projection; outcome: Outcome; terminal: 'surplus' | 'no_margin' | 'gap' };
export type PlanningContext = { generation: string; revision: number | null; today: string; model_version: 'basic-1' | 'legacy'; modules: { planning: boolean; wealth: boolean }; start: { kind: 'live'; snapshot_id: string | null; revision: number | null; date: string | null } | { kind: 'simulation'; id: string; date: string | null }; monetary_basis_date: string | null; source: 'saved' | 'temporary'; write_version: number };
export type BasicCapabilities = { context: PlanningContext; funds: Capability<{ available_cents: string; restricted_cents: string; debt_cents: string; date: string; kind: 'live' | 'simulation' }>; requirement: Capability<RequirementValue>; prediction: Capability<PredictionValue>; pension: Capability<{ included: boolean; start_month: string | null; monthly_cents: string | null }> };
/** One native read transaction; disabled sources are represented without opening wealth readers. */
export type PlanningSources = { generation: string; write_version: number; today: string; modules: { planning: boolean; wealth: boolean }; profile: Read<ProfileState>; snapshot: Read<Snapshot | null>; accounts: Read<Account[]>; review: Read<PlanReview>; incomes: Read<Income[]> };
