import { invoke } from '@tauri-apps/api/core';
import type { Account, Draft, Summary } from '../wealth';
export type MobileData = { accounts: Account[]; summary: Summary; draft: Draft };
export async function readMobile(today: string): Promise<MobileData> {
  const [summary, accounts, draft] = await Promise.all([
    invoke<Summary>('wealth_summary'), invoke<Account[]>('wealth_accounts'), invoke<Draft>('wealth_snapshot_draft', { date: today }),
  ]);
  if (summary.generation !== draft.generation || draft.date !== today) throw new Error('账户资料已变化，请重新读取。');
  return { summary, accounts, draft };
}
