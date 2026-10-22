/** Native followup seam. Every write uses the existing pending request engine. */
import { invoke } from '@tauri-apps/api/core';
import type { PlanningFollowupPortV1, FollowupRead, FollowupWriteResult, FollowupWriteContext, AssumptionReadV1, AssumptionValuesV1 } from './planning-followup-contract.ts';
import { submit, storedPending, clearPending, Unresolved, code } from './wealth.ts';
import type { Pending } from './wealth.ts';
import { errorMessage } from './asset.ts';
import { t } from './i18n.ts';
const issue = (c: string, message: string): FollowupWriteResult => ({ status: 'rejected', issues: [{ path: '', code: c.toLowerCase(), message }] });
async function read<T>(command: string, args: Record<string, unknown>): Promise<FollowupRead<T>> {
  try { return { status: 'ready', value: await invoke<T>(command, args) }; }
  catch (e) { return code(e) === 'MODULE_DISABLED' ? { status: 'disabled', message: errorMessage(e) } : { status: 'error', code: code(e) || 'READ_ERROR', message: errorMessage(e) }; }
}
async function write(pending: Pending, request: FollowupWriteContext): Promise<FollowupWriteResult> {
  const old = storedPending();
  if (old && JSON.stringify(old) !== JSON.stringify(pending)) return issue('pending_request', '还有一个提交结果待核对，请先核对原请求。');
  try {
    const result = await submit<{ id?: string; revision: number }>(pending);
    return { status: 'saved', id: result.id ?? 'profile', revision: result.revision };
  } catch (e) { return e instanceof Unresolved ? { status: 'unresolved', request_id: request.request_id } : issue(code(e) || 'save_failed', errorMessage(e)); }
}
export function nativePlanningFollowupPortV1(): PlanningFollowupPortV1 {
  return {
    readAssumptions: generation => read<AssumptionReadV1>('plan_assumptions_read', { generation }),
    saveAssumptions: (values: AssumptionValuesV1, confirm, context) => write({ command: 'plan_assumptions_save', input: { ...context, values, confirm }, label: t('规划假设') }, context),
    listAccounts: generation => read('movement_accounts', { generation }),
    listMovements: (query, generation) => read('movement_list', { query, generation }),
    listSources: (query, generation) => read('movement_sources', { query, generation }),
    saveMovement: (id, fields, context) => write({ command: 'movement_save', input: { ...context, id, fields }, label: t('资金流动') }, context),
    setMovementDeleted: (id, deleted, context) => write({ command: 'movement_trash', input: { ...context, id, deleted }, label: t('资金流动删除恢复') }, context),
    readReview: (pair, generation) => read('followup_review_read', { pair, generation }),
    listReviews: generation => read('followup_review_list', { generation }),
    previewReview: (pair, draft, generation) => read('followup_review_preview', { pair, draft, generation }),
    saveReview: (pair, draft, basis_key, context) => write({ command: 'followup_review_save', input: { ...context, pair, draft, basis_key }, label: t('投资区间来源核对') }, context),
    setReviewDeleted: (id, deleted, context) => write({ command: 'followup_review_trash', input: { ...context, id, deleted }, label: t('投资区间删除恢复') }, context),
    resolve: async context => {
      const pending = storedPending();
      if (!pending || !['plan_assumptions_save', 'movement_save', 'movement_trash', 'followup_review_save', 'followup_review_trash'].includes(pending.command) || pending.input.request_id !== context.request_id || pending.input.generation !== context.generation) return issue('receipt_mismatch', '请核对原请求与资料库身份。');
      try {
        const result = await invoke<{ id: string; revision: number } | null>('followup_receipt', { request: context.request_id, generation: context.generation });
        if (result === null) { clearPending(); return issue('not_committed', '原请求未保存。'); }
        if (!result.id || !Number.isInteger(result.revision) || result.revision < 1) throw new Error(t('无法核对已保存资料'));
        clearPending(); return { status: 'saved', ...result };
      } catch { return { status: 'unresolved', request_id: context.request_id }; }
    },
  };
}
