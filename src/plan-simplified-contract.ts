/** Sole public DTO/type entry for simplified planning v1. No policy inputs. */
import type { BasicFields, BudgetFields, FundsFields, BasicCapabilities } from './plan-basic-contract.ts';
export type Month = string;
export type DateOnly = string;
export type Cents = string;
export type TimeInputV1 = { reference: null | { month: Month; age_months: number }; target_month: Month | null; horizon_month: Month | null };
export type FutureIncomeV1 = {
  id: string; name: string; role: 'pension' | 'other'; included: boolean;
  monthly_cents: Cents | null; start_month: Month | null; end_month: Month | null;
  basis: 'reference_month' | 'start_month'; basis_month: Month | null;
  growth: 'fixed_nominal' | 'constant_purchasing_power';
  source: string | null; source_checked_on: DateOnly | null; notes: string;
};
export type SimplifiedPlanningFieldsV1 = { contract_version: 1; time: TimeInputV1; income_mode: 'unconfirmed' | 'excluded' | 'manual'; future_incomes: FutureIncomeV1[] };
export type FieldIssueV1 = { path: string; code: string; message: string };
export type SaveContextV1 = { request_id: string; generation: string; expected_revision: number | null };
export type SaveOutcomeV1 = { status: 'saved'; revision: number } | { status: 'rejected'; issues: FieldIssueV1[] } | { status: 'unresolved'; request_id: string };
export type ResetReasonV1 = 'time_unconfirmed' | 'income_unconfirmed' | 'funds_unconfirmed';
export type SimplifiedPlanningReadV1 = {
  generation: string; revision: number | null; fields: SimplifiedPlanningFieldsV1;
  reset_reasons: ResetReasonV1[]; capabilities: BasicCapabilities | null;
};
/** Other three questions and this partition are committed by one existing profile transaction. */
export type SimplifiedPlanningSetupV1 = { fields: SimplifiedPlanningFieldsV1; setup: { basic: BasicFields; budget: BudgetFields | null; funds: FundsFields | null } };
export type SimplifiedPlanningPortV1 = {
  read: () => Promise<SimplifiedPlanningReadV1>;
  save: (fields: SimplifiedPlanningFieldsV1, context: SaveContextV1) => Promise<SaveOutcomeV1>;
  saveSetup: (setup: SimplifiedPlanningSetupV1, context: SaveContextV1) => Promise<SaveOutcomeV1>;
  resolve: (context: SaveContextV1) => Promise<SaveOutcomeV1>;
};
export type SimplifiedPlanningEditorPropsV1 = {
  initial: SimplifiedPlanningFieldsV1; issues: FieldIssueV1[]; busy: boolean; unresolved: boolean;
  onDraftChange: (fields: SimplifiedPlanningFieldsV1) => void;
  onSubmit: (fields: SimplifiedPlanningFieldsV1) => void; onCancel: () => void; onOpenOfficial: () => void;
};
