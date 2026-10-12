/** Prepared UI/domain contract v1. Types only; no native implementation or runtime entry. */
import type { InvestmentReviewInputV1, InvestmentReviewResultV1 } from './investment-review/model.ts';
export type FollowupIssue = { path: string; code: string; message: string };
export type FollowupRead<T> =
  | { status: 'ready'; value: T }
  | { status: 'disabled'; message: string }
  | { status: 'error'; code: string; message: string };
export type FollowupWriteContext = { generation: string; request_id: string; expected_revision: number | null };
export type FollowupWriteResult =
  | { status: 'saved'; id: string; revision: number }
  | { status: 'rejected'; issues: FollowupIssue[] }
  | { status: 'unresolved'; request_id: string };
export type AssumptionValuesV1 = {
  real_return_before_hundredths: number; real_return_after_hundredths: number;
  inflation_hundredths: number; volatility_hundredths: number;
};
export type AssumptionReadV1 = {
  generation: string; revision: number | null; values: AssumptionValuesV1;
  confirmation: 'unconfirmed' | 'confirmed' | 'needs_review';
  confirmed_values: AssumptionValuesV1 | null;
};
export type MovementEndpointV1 =
  | { kind: 'account'; account_id: string }
  | { kind: 'external'; label: string };
/** Opaque key is supplied by the domain source picker, never composed from display text. */
export type MovementSourceV1 = { kind: 'income' | 'expense'; key: string };
export type MovementPurposeV1 = 'own_transfer' | 'external_funding' | 'living_payment' | 'income_distribution' | 'investment_cost';
export type MovementFieldsV1 = {
  date: string; amount_cents: string; from: MovementEndpointV1; to: MovementEndpointV1;
  purpose: MovementPurposeV1; source: MovementSourceV1 | null; notes: string;
};
export type MovementRecordV1 = {
  id: string; revision: number; deleted: boolean; fields: MovementFieldsV1;
  source_status: 'unlinked' | 'matched' | 'needs_review' | 'deleted' | 'disabled';
};
export type MovementAccountV1 = { id: string; name: string; kind: string; selectable: boolean };
export type MovementSourceOptionV1 = {
  ref: MovementSourceV1; label: string; date: string; amount_cents: string;
  available: boolean; unavailable_reason: string | null;
};
export type MovementQueryV1 = {
  from_date: string | null; to_date: string | null; account_id: string | null;
  deleted: 'active' | 'deleted' | 'all'; cursor: string | null;
};
export type MovementPageV1 = {
  generation: string; records: MovementRecordV1[]; next_cursor: string | null;
};
export type SourceQueryV1 = { kind: 'income' | 'expense'; text: string; cursor: string | null; movement_id: string | null };
export type SourcePageV1 = { generation: string; options: MovementSourceOptionV1[]; next_cursor: string | null };
export type ReviewPairV1 = { from_snapshot_id: string; to_snapshot_id: string };
export type ReviewSelectionV1 =
  | { mode: 'manual'; inflow_cents: string | null; outflow_cents: string | null }
  | { mode: 'movements' };
export type ReviewDraftV1 = {
  selection: ReviewSelectionV1; confirmed_complete: boolean; unsupported_movements: boolean; notes: string;
};
export type ReviewTotalsV1 = { inflow_cents: string | null; outflow_cents: string | null };
export type ReviewPreviewV1 = {
  generation: string; pair: ReviewPairV1; review_id: string | null; revision: number | null;
  input: InvestmentReviewInputV1; result: InvestmentReviewResultV1;
  saved_mode: 'manual' | 'movements' | null; selected: ReviewSelectionV1;
  previous_totals: ReviewTotalsV1 | null; selected_totals: ReviewTotalsV1 | null;
  /** Signed cents, selected minus previous; null where either side is unknown. */
  difference: ReviewTotalsV1; movement_count: number | null;
  confirmation: 'unconfirmed' | 'confirmed' | 'needs_review' | 'unavailable';
  reasons: FollowupIssue[];
  /** Opaque, binds endpoints, relevant movements, links, mode and submitted draft. */
  basis_key: string;
};
export type ReviewRecordV1 = {
  id: string; revision: number; deleted: boolean; pair: ReviewPairV1;
  from_date: string; to_date: string; mode: 'manual' | 'movements';
  confirmation: 'unconfirmed' | 'confirmed' | 'needs_review';
};
/** Adapt these methods to existing transactions/receipts, do not introduce a second write engine. */
export interface PlanningFollowupPortV1 {
  readAssumptions(generation: string): Promise<FollowupRead<AssumptionReadV1>>;
  saveAssumptions(values: AssumptionValuesV1, confirm: boolean, context: FollowupWriteContext): Promise<FollowupWriteResult>;
  listAccounts(generation: string): Promise<FollowupRead<{ generation: string; accounts: MovementAccountV1[] }>>;
  listMovements(query: MovementQueryV1, generation: string): Promise<FollowupRead<MovementPageV1>>;
  listSources(query: SourceQueryV1, generation: string): Promise<FollowupRead<SourcePageV1>>;
  saveMovement(id: string | null, fields: MovementFieldsV1, context: FollowupWriteContext): Promise<FollowupWriteResult>;
  setMovementDeleted(id: string, deleted: boolean, context: FollowupWriteContext): Promise<FollowupWriteResult>;
  readReview(pair: ReviewPairV1, generation: string): Promise<FollowupRead<{ draft: ReviewDraftV1; preview: ReviewPreviewV1 }>>;
  listReviews(generation: string): Promise<FollowupRead<{ generation: string; records: ReviewRecordV1[] }>>;
  setReviewDeleted(id: string, deleted: boolean, context: FollowupWriteContext): Promise<FollowupWriteResult>;
  previewReview(pair: ReviewPairV1, draft: ReviewDraftV1, generation: string): Promise<FollowupRead<ReviewPreviewV1>>;
  saveReview(pair: ReviewPairV1, draft: ReviewDraftV1, basis_key: string, context: FollowupWriteContext): Promise<FollowupWriteResult>;
  resolve(context: { generation: string; request_id: string }): Promise<FollowupWriteResult>;
}
