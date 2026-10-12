/** Native followup seam. Every write uses the existing pending request engine. */
import { invoke } from '@tauri-apps/api/core';
import type { PlanningFollowupPortV1, FollowupRead, FollowupWriteResult, FollowupWriteContext, AssumptionReadV1, AssumptionValuesV1 } from './planning-followup-contract.ts';
import { submit, storedPending, clearPending, Unresolved, code } from './wealth.ts';
import type { Pending } from './wealth.ts';
import { errorMessage } from './asset.ts';
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
const unavailableRead = async <T>(): Promise<FollowupRead<T>> => ({ status: 'error', code: 'PORT_NOT_READY', message: '资金流动端口尚未交付，请勿接入保存入口。' });
const unavailableWrite = async (): Promise<FollowupWriteResult> => issue('port_not_ready', '资金流动端口尚未交付。');
export function nativePlanningFollowupPortV1(): PlanningFollowupPortV1 {
  return {
    readAssumptions: generation => read<AssumptionReadV1>('plan_assumptions_read', { generation }),
    saveAssumptions: (values: AssumptionValuesV1, confirm, context) => write({ command: 'plan_assumptions_save', input: { ...context, values, confirm }, label: '规划假设' } as Pending, context),
    listAccounts: unavailableRead, listMovements: unavailableRead, listSources: unavailableRead,
    saveMovement: unavailableWrite, setMovementDeleted: unavailableWrite, readReview: unavailableRead, listReviews: unavailableRead,
    setReviewDeleted: unavailableWrite, previewReview: unavailableRead, saveReview: unavailableWrite,
    resolve: async context => {
      const pending = storedPending();
      if (!pending || pending.command !== 'plan_assumptions_save' || pending.input.request_id !== context.request_id || pending.input.generation !== context.generation) return issue('receipt_mismatch', '请核对原请求与资料库身份。');
      try {
        const id = await invoke<string | null>('wealth_request_result', { request: context.request_id, generation: context.generation });
        if (id === null) { clearPending(); return issue('not_committed', '原请求未保存。'); }
        const result = await read<AssumptionReadV1>('plan_assumptions_read', { generation: context.generation });
        if (id !== 'profile' || result.status !== 'ready' || result.value.revision === null || result.value.generation !== context.generation) throw new Error('无法核对已保存资料');
        clearPending(); return { status: 'saved', id, revision: result.value.revision };
      } catch { return { status: 'unresolved', request_id: context.request_id }; }
    },
  };
}
