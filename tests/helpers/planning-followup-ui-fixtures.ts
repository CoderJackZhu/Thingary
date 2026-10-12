/** planning-followup-ui 的虚构夹具与脚本化内存端口：仅测试使用，不进入应用代码，也不是原生驱动。
 *  端口返回值全部来自共享契约夹具或本文件字面量；previewReview 只回显固定结果，不重算损益。 */
import type {
  AssumptionReadV1, FollowupRead, FollowupWriteResult, MovementAccountV1, MovementFieldsV1, MovementPageV1, MovementQueryV1,
  MovementRecordV1, MovementSourceOptionV1, PlanningFollowupPortV1, ReviewDraftV1, ReviewPairV1, ReviewPreviewV1, SourcePageV1, SourceQueryV1,
} from '../../src/planning-followup-contract.ts';
import { assumptionFixtures, readyReviewFixture, writeFixtures } from './planning-followup-fixtures.ts';

export const uiGeneration = 'ui-fixture-generation';
export const uiPair: ReviewPairV1 = { from_snapshot_id: 'ui-start', to_snapshot_id: 'ui-end' };
export const uiAccounts: MovementAccountV1[] = [
  { id: 'ui-inv', name: '虚构券商投资账户', kind: 'investment', selectable: true },
  { id: 'ui-cash', name: '虚构现金账户', kind: 'cash', selectable: true },
  { id: 'ui-old', name: '虚构停用账户', kind: 'mixed', selectable: false },
];
export const uiMovements: MovementRecordV1[] = [
  { id: 'ui-transfer', revision: 3, deleted: false, fields: { date: '2026-10-15', amount_cents: '800000', from: { kind: 'account', account_id: 'ui-inv' }, to: { kind: 'account', account_id: 'ui-cash' }, purpose: 'own_transfer', source: null, notes: '虚构：取回资金' }, source_status: 'unlinked' },
  { id: 'ui-living', revision: 1, deleted: false, fields: { date: '2026-10-20', amount_cents: '50000', from: { kind: 'account', account_id: 'ui-inv' }, to: { kind: 'external', label: '虚构房租' }, purpose: 'living_payment', source: null, notes: '' }, source_status: 'unlinked' },
  { id: 'ui-dividend', revision: 2, deleted: false, fields: { date: '2026-10-25', amount_cents: '30000', from: { kind: 'account', account_id: 'ui-inv' }, to: { kind: 'account', account_id: 'ui-cash' }, purpose: 'income_distribution', source: { kind: 'income', key: 'ui-income-key-1' }, notes: '' }, source_status: 'matched' },
  { id: 'ui-removed', revision: 1, deleted: true, fields: { date: '2026-09-30', amount_cents: '200000', from: { kind: 'account', account_id: 'ui-cash' }, to: { kind: 'account', account_id: 'ui-inv' }, purpose: 'own_transfer', source: null, notes: '' }, source_status: 'unlinked' },
];
export const uiSources: Record<'income' | 'expense', MovementSourceOptionV1[]> = {
  income: [
    { ref: { kind: 'income', key: 'ui-income-key-1' }, label: '虚构现金分红入账', date: '2026-10-25', amount_cents: '30000', available: true, unavailable_reason: null },
    { ref: { kind: 'income', key: 'ui-income-key-2' }, label: '虚构利息入账', date: '2026-10-05', amount_cents: '12000', available: false, unavailable_reason: '已关联其他资金流动' },
  ],
  expense: [{ ref: { kind: 'expense', key: 'ui-expense-key-1' }, label: '虚构年度保险费', date: '2026-10-12', amount_cents: '360000', available: true, unavailable_reason: null }],
};
export const uiAssumptionReads = {
  unconfirmed: { ...assumptionFixtures.fresh, generation: uiGeneration, revision: 1 },
  confirmed: { ...assumptionFixtures.reviewed, generation: uiGeneration },
  needsReview: { ...assumptionFixtures.reviewed, generation: uiGeneration, values: { real_return_before_hundredths: 150, real_return_after_hundredths: 0, inflation_hundredths: 200, volatility_hundredths: 500 }, confirmation: 'needs_review' },
} satisfies Record<string, AssumptionReadV1>;
export const uiManualDraft: ReviewDraftV1 = { selection: { mode: 'manual', inflow_cents: '1000000', outflow_cents: '800000' }, confirmed_complete: false, unsupported_movements: false, notes: '虚构：手填合计' };
export const uiMovementsDraft: ReviewDraftV1 = { selection: { mode: 'movements' }, confirmed_complete: false, unsupported_movements: false, notes: '' };

/** 虚构候选预览：result 固定沿用共享夹具（余额 −300000、损益 +5000）；selected_totals 只回显草稿数字。 */
export function uiPreviewOf(draft: ReviewDraftV1, over: Partial<ReviewPreviewV1> = {}): ReviewPreviewV1 {
  return {
    ...readyReviewFixture, generation: uiGeneration, pair: uiPair, review_id: 'ui-review', revision: 4,
    saved_mode: 'manual', selected: draft.selection,
    selected_totals: draft.selection.mode === 'manual'
      ? { inflow_cents: draft.selection.inflow_cents, outflow_cents: draft.selection.outflow_cents }
      : { inflow_cents: '1000000', outflow_cents: '850000' },
    previous_totals: null, difference: { inflow_cents: null, outflow_cents: null },
    movement_count: draft.selection.mode === 'movements' ? 2 : 0,
    confirmation: 'unconfirmed', reasons: [], basis_key: 'ui-fixture-basis-key', ...over,
  };
}

export type RecordedCall = { method: string; args: unknown[] };
export type FollowupScript = {
  assumptionRead?: FollowupRead<AssumptionReadV1>;
  assumptionWrite?: FollowupWriteResult;
  accountsRead?: FollowupRead<{ generation: string; accounts: MovementAccountV1[] }>;
  movementsRead?: FollowupRead<MovementPageV1>;
  sourcesRead?: FollowupRead<SourcePageV1>;
  movementWrite?: FollowupWriteResult;
  reviewRead?: FollowupRead<{ draft: ReviewDraftV1; preview: ReviewPreviewV1 }>;
  previewResult?: FollowupRead<ReviewPreviewV1> | ((draft: ReviewDraftV1) => FollowupRead<ReviewPreviewV1>);
  reviewWrite?: FollowupWriteResult;
  resolveResult?: FollowupWriteResult;
};
/** 记录全部调用并按脚本返回的虚构端口；默认值保持可保存的“正常”路径。 */
export function scriptedFollowupPort(script: FollowupScript = {}) {
  const calls: RecordedCall[] = [];
  const saved = (id: string, revision: number): FollowupWriteResult => ({ status: 'saved', id, revision });
  const port: PlanningFollowupPortV1 = {
    async readAssumptions(generation) { calls.push({ method: 'readAssumptions', args: [generation] }); return script.assumptionRead ?? { status: 'ready', value: uiAssumptionReads.unconfirmed }; },
    async saveAssumptions(values, confirm, context) { calls.push({ method: 'saveAssumptions', args: [structuredClone(values), confirm, structuredClone(context)] }); return script.assumptionWrite ?? saved('ui-assumptions', 3); },
    async listAccounts(generation) { calls.push({ method: 'listAccounts', args: [generation] }); return script.accountsRead ?? { status: 'ready', value: { generation: uiGeneration, accounts: uiAccounts } }; },
    async listMovements(query: MovementQueryV1, generation) { calls.push({ method: 'listMovements', args: [structuredClone(query), generation] }); return script.movementsRead ?? { status: 'ready', value: { generation: uiGeneration, records: uiMovements.filter(m => query.deleted === 'all' || !m.deleted), next_cursor: null } }; },
    async listSources(query: SourceQueryV1, generation) { calls.push({ method: 'listSources', args: [structuredClone(query), generation] }); return script.sourcesRead ?? { status: 'ready', value: { generation: uiGeneration, options: uiSources[query.kind], next_cursor: null } }; },
    async saveMovement(id, fields: MovementFieldsV1, context) { calls.push({ method: 'saveMovement', args: [id, structuredClone(fields), structuredClone(context)] }); return script.movementWrite ?? saved(id ?? 'ui-new-movement', 1); },
    async setMovementDeleted(id, deleted, context) { calls.push({ method: 'setMovementDeleted', args: [id, deleted, structuredClone(context)] }); return script.movementWrite ?? saved(id, 2); },
    async readReview(pair, generation) { calls.push({ method: 'readReview', args: [structuredClone(pair), generation] }); return script.reviewRead ?? { status: 'ready', value: { draft: uiManualDraft, preview: uiPreviewOf(uiManualDraft) } }; },
    async listReviews(generation) { calls.push({ method: 'listReviews', args: [generation] }); return { status: 'ready', value: { generation: uiGeneration, records: [] } }; },
    async setReviewDeleted(id, deleted, context) { calls.push({ method: 'setReviewDeleted', args: [id, deleted, structuredClone(context)] }); return script.reviewWrite ?? saved(id, 5); },
    async previewReview(pair, draft: ReviewDraftV1, generation) { calls.push({ method: 'previewReview', args: [structuredClone(pair), structuredClone(draft), generation] }); const r = script.previewResult; const value = typeof r === 'function' ? r(draft) : r; return value ?? { status: 'ready', value: uiPreviewOf(draft) }; },
    async saveReview(pair, draft, basis_key, context) { calls.push({ method: 'saveReview', args: [structuredClone(pair), structuredClone(draft), basis_key, structuredClone(context)] }); return script.reviewWrite ?? writeFixtures.saved; },
    async resolve(context) { calls.push({ method: 'resolve', args: [structuredClone(context)] }); return script.resolveResult ?? writeFixtures.saved; },
  };
  return { port, calls };
}
