import { invoke } from '@tauri-apps/api/core';
import type { SimplifiedPlanningPortV1, SimplifiedPlanningFieldsV1, SimplifiedPlanningSetupV1, SaveContextV1, SaveOutcomeV1 } from './plan-simplified-contract.ts';
import { validateSimplifiedPlanningV1 } from './plan-simplified.ts';
/** Inject an actual transaction/receipt driver. Missing drivers throw; no default saved result. */
export function createSimplifiedPlanningPortV1(driver: SimplifiedPlanningPortV1): SimplifiedPlanningPortV1 {
  const save = async (fields: SimplifiedPlanningFieldsV1, context: SaveContextV1, setup?: SimplifiedPlanningSetupV1): Promise<SaveOutcomeV1> => {
    const issues = validateSimplifiedPlanningV1(fields);
    if (issues.length) return { status: 'rejected', issues };
    return setup ? driver.saveSetup(setup, context) : driver.save(fields, context);
  };
  return { read: () => driver.read(), save: (f, c) => save(f, c), saveSetup: (s, c) => save(s.fields, c, s), resolve: c => driver.resolve(c) };
}

import { readPlanningSources, savePlanningSection } from './planning-service.ts';
import type { PlanningModules } from './planning-service.ts';
import { Unresolved, storedPending, clearPending, code } from './wealth.ts';
import { buildBasicCapabilities } from './plan-basic.ts';
import { simplifiedEmpty } from './plan-simplified.ts';
import type { PlanningSources, ProfileUpdate } from './plan-basic-contract.ts';
import type { SimplifiedPlanningReadV1, ResetReasonV1 } from './plan-simplified-contract.ts';
/** Native source adapter. Read errors are thrown, never represented as an empty plan. */
export function simplifiedReadFromSourcesV1(s: PlanningSources): SimplifiedPlanningReadV1 {
  if (!s.modules.planning) throw new Error('规划模块已关闭');
  if (s.profile.status === 'error') throw new Error(s.profile.value.message);
  if (s.profile.value.generation !== s.generation) throw new Error('资料库身份已变化，请重新读取');
  const saved = s.profile.value.saved, fields = saved?.profile.retire.simplified ?? simplifiedEmpty();
  const reset_reasons: ResetReasonV1[] = [];
  if (fields.time.target_month === null || fields.time.horizon_month === null) reset_reasons.push('time_unconfirmed');
  if (fields.income_mode === 'unconfirmed') reset_reasons.push('income_unconfirmed');
  const capabilities = saved ? buildBasicCapabilities(s) : null;
  if (!saved?.profile.retire.basic || (capabilities?.funds.status === 'blocked' && capabilities.funds.missing.some(m=>m.kind==='fact'||m.kind==='assumption'))) reset_reasons.push('funds_unconfirmed');
  return { generation: s.generation, revision: saved?.revision ?? null, fields, reset_reasons, capabilities };
}
/** Actual native driver uses the existing atomic update, generation, revision and persisted receipt. */
export function nativeSimplifiedPlanningPortV1(modules: () => PlanningModules): SimplifiedPlanningPortV1 {
  const read = async () => simplifiedReadFromSourcesV1(await readPlanningSources(modules()));
  const write = async (input: ProfileUpdate): Promise<SaveOutcomeV1> => {
    const pending = storedPending();
    if (pending && JSON.stringify(pending) !== JSON.stringify({ command: 'plan_profile_update', input, label: '规划分区' })) {
      return { status: 'rejected', issues: [{ path: '', code: 'pending_request', message: '还有一个提交结果待核对，原请求已保留；本次尚未提交。' }] };
    }
    try { const result = await savePlanningSection(input); return { status: 'saved', revision: result.revision }; }
    catch (e) {
      if (e instanceof Unresolved) return { status: 'unresolved', request_id: storedPending()?.input.request_id ?? input.request_id };
      return { status: 'rejected', issues: [{ path: '', code: code(e) || 'save_failed', message: e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String(e.message) : String(e) }] };
    }
  };
  return createSimplifiedPlanningPortV1({
    read,
    save: (fields, context) => write({ ...context, section: 'simplified', fields }),
    saveSetup: (draft, context) => write({ ...context, section: 'setup', fields: { ...draft.setup, simplified: draft.fields } }),
    resolve: async context => {
      const pending = storedPending();
      if (!pending || pending.command !== 'plan_profile_update' || pending.input.request_id !== context.request_id || pending.input.generation !== context.generation) return { status: 'rejected', issues: [{ path: '', code: 'receipt_mismatch', message: '请核对原请求与资料库身份' }] };
      return resolveSimplifiedReceiptV1(context, {
        lookup: () => invoke<string | null>('wealth_request_result', { request: context.request_id, generation: context.generation }),
        read, clear: clearPending,
      });
    },
  });
}

/** A saved receipt is retained while the updated sources cannot be read. No replay or new request ID. */
export async function resolveSimplifiedReceiptV1(context: SaveContextV1, driver: { lookup: () => Promise<string | null>; read: () => Promise<SimplifiedPlanningReadV1>; clear: () => void }): Promise<SaveOutcomeV1> {
  try {
    const id = await driver.lookup();
    if (id === null) { driver.clear(); return { status: 'rejected', issues: [{ path: '', code: 'not_committed', message: '原请求未保存' }] }; }
    if (id !== 'profile') throw new Error('回执结果不匹配');
    const result = await driver.read();
    if (result.generation !== context.generation || result.revision === null) throw new Error('已保存但资料无法核对');
    driver.clear(); return { status: 'saved', revision: result.revision };
  } catch { return { status: 'unresolved', request_id: context.request_id }; }
}
