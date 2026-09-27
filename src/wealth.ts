import { invoke } from '@tauri-apps/api/core';
import { errorMessage, money } from './asset';

export type Side = 'asset' | 'liability';
export type AccountFields = { name: string; institution: string; side: Side; kind: string; counted: boolean; opened_on: string; closed_on: string | null; notes: string };
export type Observation = { amount_cents: string; date: string };
export type Account = { id: string; fields: AccountFields; position: number; revision: number; latest: Observation | null };
export type EntryState = 'entered' | 'unchanged' | 'missing';
export type Entry = { account_id: string; state: EntryState; amount_cents: string | null; side: Side; kind: string; counted: boolean };
export type Snapshot = { id: string; date: string; notes: string; revision: number; entries: Entry[]; missing: string[] };
export type Draft = { generation: string; date: string; existing: Snapshot | null; rows: { account: Account; previous: Observation | null }[] };
export type Point = { snapshot_id: string; date: string; assets_cents: string; liabilities_cents: string; net_cents: string; complete: boolean; missing: number; compared_to: string | null; scope_changed: boolean; change_cents: string | null; change_rate_hundredths: number | null };
export type Share = { kind: string; amount_cents: string; share_hundredths: number | null };
export type Summary = { generation: string; points: Point[]; structure_date: string | null; structure: Share[]; liabilities: Share[] };
export type AccountSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: AccountFields };
export type SnapshotSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; date: string; notes: string; entries: { account_id: string; state: EntryState; amount_cents: string | null }[] };

export const assetKinds = [['cash', '现金与存款'], ['investment', '投资账户'], ['mixed', '混合投资'], ['fund', '基金'], ['bond', '债券'], ['housing_fund', '公积金'], ['other_asset', '其他资产']] as const;
export const liabilityKinds = [['credit_card', '信用卡'], ['loan', '贷款'], ['other_liability', '其他负债']] as const;
export const kindLabel = (kind: string) => [...assetKinds, ...liabilityKinds].find(([k]) => k === kind)?.[1] ?? kind;

/** Signed amount: negative net worth shows a real minus sign. */
export function signedMoney(cents: string) { return cents.startsWith('-') ? '−' + money(cents.slice(1)) : money(cents); }
export function changeText(cents: string) { return cents.startsWith('-') ? signedMoney(cents) : '+' + money(cents); }
export function rateText(hundredths: number) { return `${hundredths < 0 ? '−' : '+'}${(Math.abs(hundredths) / 100).toFixed(2)}%`; }

// Only a submitted request whose reply was lost is kept; unsubmitted input is not.
export const pendingKey = 'possio.wealth-pending.v1';
export type Pending = { command: 'wealth_account_save' | 'wealth_snapshot_save'; input: AccountSave | SnapshotSave; label: string };
export function storedPending(): Pending | null {
  try { const p = JSON.parse(localStorage.getItem(pendingKey) || 'null'); if (p && typeof p.command === 'string' && typeof p.input?.request_id === 'string') return p; } catch { /* unreadable receipt is ignored */ }
  return null;
}
const clearPending = () => { try { localStorage.removeItem(pendingKey); } catch { /* nothing to clear */ } };
const code = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';

/** Unresolved means the request may or may not have committed; it stays stored. */
export class Unresolved extends Error {}

/**
 * Sends a write once. If the reply is lost, the stored request is checked by
 * its id; a committed one is re-sent unchanged, which returns the original result.
 */
export async function submit<T>(pending: Pending): Promise<T> {
  try { localStorage.setItem(pendingKey, JSON.stringify(pending)); }
  catch { throw new Error('无法记录本次请求，尚未提交，请检查可用空间后重试。'); }
  try { const result = await invoke<T>(pending.command, { input: pending.input }); clearPending(); return result; }
  catch (e) {
    const outcome = await resolvePending(pending).catch(() => 'unknown' as const);
    if (outcome === 'saved') return invoke<T>(pending.command, { input: pending.input });
    if (outcome === 'unknown') throw new Unresolved(errorMessage(e) + ' 暂时无法确认是否已保存，原请求已保留，可稍后在财富页核对。');
    throw e;
  }
}

/** Every settled outcome clears the receipt; a thrown error keeps it for a later check. */
export async function resolvePending(pending: Pending): Promise<'saved' | 'unsaved' | 'stale'> {
  try {
    const id = await invoke<string | null>('wealth_request_result', { request: pending.input.request_id, generation: pending.input.generation });
    if (id) { clearPending(); return 'saved'; }
    clearPending(); return 'unsaved';
  } catch (e) {
    if (code(e) === 'STALE_DATASET') { clearPending(); return 'stale'; }
    throw e;
  }
}

/** Form-side totals preview only; saved figures always come from wealth_summary. */
export function previewTotals(rows: { side: Side; counted: boolean; cents: string | null }[]) {
  let assets = 0n, liabilities = 0n, missing = 0;
  for (const r of rows) {
    if (r.cents === null) { missing++; continue; }
    if (!r.counted) continue;
    if (r.side === 'asset') assets += BigInt(r.cents); else liabilities += BigInt(r.cents);
  }
  return { assets: assets.toString(), liabilities: liabilities.toString(), net: (assets - liabilities).toString(), missing };
}
