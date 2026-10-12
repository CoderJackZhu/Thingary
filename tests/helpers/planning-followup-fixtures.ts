/** Fictional shared contract examples, not a native driver or production defaults. */
import type { AssumptionReadV1, FollowupRead, FollowupWriteResult, MovementRecordV1, ReviewDraftV1, ReviewPreviewV1 } from '../../src/planning-followup-contract.ts';
export const assumptionFixtures = {
  fresh: { generation: 'fixture-generation', revision: null, values: { real_return_before_hundredths: 0, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 }, confirmation: 'unconfirmed', confirmed_values: null },
  reviewed: { generation: 'fixture-generation', revision: 2, values: { real_return_before_hundredths: 100, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 }, confirmation: 'confirmed', confirmed_values: { real_return_before_hundredths: 100, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 } },
} satisfies Record<string, AssumptionReadV1>;
export const movementFixture = {
  id: 'fixture-transfer', revision: 1, deleted: false,
  fields: { date: '2026-10-15', amount_cents: '800000', from: { kind: 'account', account_id: 'fixture-investment' }, to: { kind: 'account', account_id: 'fixture-cash' }, purpose: 'own_transfer', source: null, notes: '虚构：取回资金，是否消费未记录' },
  source_status: 'unlinked',
} satisfies MovementRecordV1;
export const reviewDraftFixtures = {
  manualUnknown: { selection: { mode: 'manual', inflow_cents: null, outflow_cents: null }, confirmed_complete: false, unsupported_movements: false, notes: '' },
  movementsUnconfirmed: { selection: { mode: 'movements' }, confirmed_complete: false, unsupported_movements: false, notes: '' },
  movementsConfirmed: { selection: { mode: 'movements' }, confirmed_complete: true, unsupported_movements: false, notes: '虚构：已核对全部流动' },
} satisfies Record<string, ReviewDraftV1>;
export const readyReviewFixture: ReviewPreviewV1 = {
  generation: 'fixture-generation', pair: { from_snapshot_id: 'fixture-start', to_snapshot_id: 'fixture-end' }, review_id: null, revision: null,
  input: {
    contract_version: 1,
    from: { snapshot_id: 'fixture-start', revision: 1, date: '2026-09-30', members: [{ account_id: 'fixture-investment', kind: 'investment', counted: true, amount_cents: '10000000' }] },
    to: { snapshot_id: 'fixture-end', revision: 1, date: '2026-10-31', members: [{ account_id: 'fixture-investment', kind: 'investment', counted: true, amount_cents: '9700000' }] },
    flow: null, overlapping_active_flow_ids: [],
  },
  result: { status: 'ready', value: { opening_cents: '10000000', closing_cents: '9700000', change_cents: '-300000', inflow_cents: '0', outflow_cents: '800000', profit_cents: '500000' } },
  saved_mode: null, selected: { mode: 'movements' }, previous_totals: null,
  selected_totals: { inflow_cents: '0', outflow_cents: '800000' }, difference: { inflow_cents: null, outflow_cents: null },
  movement_count: 1, confirmation: 'unconfirmed', reasons: [], basis_key: 'fixture-only-not-a-real-domain-key',
};
/** This is a draft preview: input.flow=null means no persisted review; result is not a saved result. */
export const reviewReadFixtures = {
  candidate: { status: 'ready', value: readyReviewFixture },
  needsReview: { status: 'ready', value: { ...readyReviewFixture, confirmation: 'needs_review', result: { status: 'needs_review', change_cents: '-300000', reasons: ['stale_movements'] }, reasons: [{ path: 'movements', code: 'stale_movements', message: '虚构：流动已更正，请重新核对' }] } },
  error: { status: 'error', code: 'READ_ERROR', message: '虚构：读取失败' },
  disabled: { status: 'disabled', message: '虚构：模块已关闭' },
} satisfies Record<string, FollowupRead<ReviewPreviewV1>>;
export const writeFixtures = {
  saved: { status: 'saved', id: 'fixture-transfer', revision: 2 },
  conflict: { status: 'rejected', issues: [{ path: '', code: 'revision_conflict', message: '虚构：记录已变化，请重新读取' }] },
  unresolved: { status: 'unresolved', request_id: 'fixture-original-request' },
} satisfies Record<string, FollowupWriteResult>;
