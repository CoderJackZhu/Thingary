import { invoke } from '@tauri-apps/api/core';
import { clearPending, code, pendingKey, storedPending, Unresolved } from './wealth.ts';
import { errorMessage } from './asset.ts';
import type { SavingsSave, SavingsTrash } from './savings-goals.ts';
import { t } from './i18n.ts';
/** Retain only receipt identity. A lost reply is checked read-only, never replayed. */
export async function writeSavingsGoal(command: 'savings_goals_save' | 'savings_goals_trash', input: SavingsSave | SavingsTrash, label: string, send: typeof invoke = invoke): Promise<void> {
  if (storedPending()) throw new Unresolved(t('请先核对上次保存结果。'));
  try { localStorage.setItem(pendingKey, JSON.stringify({ command, input: { request_id: input.request_id, generation: input.generation }, label })); }
  catch { throw new Error(t('无法保留本次回执标识，尚未提交。')); }
  try { await send(command, { input }); clearPending(); }
  catch (error) {
    try {
      const result = await send<string | null>('wealth_request_result', { request: input.request_id, generation: input.generation });
      clearPending();
      if (result) return;
    } catch (verification) {
      if (code(verification) === 'STALE_DATASET') throw new Unresolved(t('资料库已切换，原请求标识仍保留，请回到原资料核对。'));
      throw new Unresolved(errorMessage(error) + t(' 结果待确认，原请求标识已保留。'));
    }
    throw error;
  }
}
