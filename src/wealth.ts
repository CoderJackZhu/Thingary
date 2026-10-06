import { invoke } from '@tauri-apps/api/core';
import type { TopupSave, BalanceSave, ReminderSave } from './virtual';
import type { IncomeSave, Mark, ProfileSave } from './plan';
import { errorMessage, money } from './asset.ts';

export type Side = 'asset' | 'liability';
export type AccountFields = { name: string; institution: string; side: Side; kind: string; counted: boolean; opened_on: string; closed_on: string | null; notes: string };
export type Observation = { amount_cents: string; date: string };
export type Account = { id: string; fields: AccountFields; position: number; revision: number; latest: Observation | null };
export type EntryState = 'entered' | 'unchanged' | 'missing';
export type Entry = { account_id: string; state: EntryState; amount_cents: string | null; side: Side; kind: string; counted: boolean };
export type Snapshot = { id: string; date: string; notes: string; revision: number; entries: Entry[]; missing: string[] };
export type Draft = { generation: string; date: string; existing: Snapshot | null; rows: { account: Account; previous: Observation | null }[] };
export type Point = { snapshot_id: string; date: string; notes: string; assets_cents: string; liabilities_cents: string; net_cents: string; complete: boolean; missing: number; compared_to: string | null; scope_changed: boolean; change_cents: string | null; hpf_change_cents: string | null; change_rate_hundredths: number | null };
export type Share = { kind: string; amount_cents: string; share_hundredths: number | null };
export type Summary = { generation: string; points: Point[]; structure_date: string | null; structure: Share[]; liabilities: Share[] };
// U20 账户变化与盘点比较（产品设计 17.14）：一次比较的两个端点。
export type CompareCell = { state: string; amount_cents: string | null; counted: boolean | null };
export type CompareRow = { account_id: string; name: string; institution: string; side: Side; kind: string; from: CompareCell; to: CompareCell; change_cents: string | null; effect_cents: string | null; rate_hundredths: number | null; group: 'counted' | 'uncounted' | 'scope_changed'; tag: 'new' | 'closed' | null };
export type CompareEnd = { snapshot_id: string; date: string; notes: string; complete: boolean; missing: number };
export type StructurePair = { kind: string; from_cents: string | null; from_share: number | null; to_cents: string | null; to_share: number | null };
export type Compare = { generation: string; from: CompareEnd; to: CompareEnd; reconciled: boolean; net_change_cents: string | null; assets_change_cents: string | null; liabilities_change_cents: string | null; net_rate_hundredths: number | null; known_effect_cents: string; missing_names: string[]; rows: CompareRow[]; structure: StructurePair[] };
export type HistoryRow = { snapshot_id: string; date: string; state: string; amount_cents: string | null; counted: boolean; change_cents: string | null };
export type AccountHistory = { generation: string; account: Account; rows: HistoryRow[] };
export type AccountSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: AccountFields };
export type SnapshotSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; date: string; notes: string; entries: { account_id: string; state: EntryState; amount_cents: string | null }[] };
export type CheckInRow = { state: EntryState | null; cents: string; edited?: boolean };
/** Loaded unchanged rows keep history; explicitly reconfirmed rows carry the displayed amount. */
export function snapshotEntryInput(accountId: string, row: CheckInRow): SnapshotSave['entries'][number] {
  if (!row.state) throw new Error('请先处理这个账户。');
  return { account_id: accountId, state: row.state, amount_cents: row.state === 'entered' || (row.state === 'unchanged' && row.edited) ? row.cents : null };
}

export const assetKinds = [['cash', '现金与存款'], ['investment', '投资账户'], ['mixed', '混合投资'], ['fund', '基金'], ['bond', '债券'], ['housing_fund', '公积金'], ['other_asset', '其他资产']] as const;
export const liabilityKinds = [['credit_card', '信用卡'], ['loan', '贷款'], ['other_liability', '其他负债']] as const;
export const kindLabel = (kind: string) => [...assetKinds, ...liabilityKinds].find(([k]) => k === kind)?.[1] ?? kind;

/** Signed amount: `money` already renders a negative with a real minus sign and no line break after it. */
export const signedMoney = money;
export function changeText(cents: string) { return cents.startsWith('-') ? money(cents) : '+' + money(cents); }
/** 备注摘要：约 40 字，有内容才显示；空备注返回 null。 */
export function noteSummary(notes: string): string | null {
  if (!notes.trim()) return null;
  const first = notes.split('\n', 1)[0].trim();
  return [...first].length > 40 ? [...first].slice(0, 40).join('') + '…' : first;
}
export function rateText(hundredths: number) { return `${hundredths < 0 ? '−' : '+'}${(Math.abs(hundredths) / 100).toFixed(2)}%`; }

// ---- U20 账户变化（产品设计 17.14，规则与 Rust 一致） ----------------------

/** 默认比较区间：概览「与上次比较」同一对日期；否则最后两次盘点。返回盘点 id。 */
export function defaultRange(points: Point[]): { from: string; to: string } | null {
  const lastComplete = [...points].reverse().find(p => p.complete);
  if (lastComplete?.compared_to) {
    const from = points.find(p => p.date === lastComplete.compared_to);
    if (from) return { from: from.snapshot_id, to: lastComplete.snapshot_id };
  }
  if (points.length >= 2) return { from: points[points.length - 2].snapshot_id, to: points[points.length - 1].snapshot_id };
  return null;
}

/** 只在前端排序：按影响＝对净资产影响绝对值降序、未知最后；按类型＝类型顺序再按账户位置。 */
export function sortRows(rows: CompareRow[], mode: 'impact' | 'kind'): CompareRow[] {
  const order = [...assetKinds, ...liabilityKinds];
  const kindRank = (r: CompareRow) => { const i = order.findIndex(([k]) => k === r.kind); return i === -1 ? order.length : i; };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    if (mode === 'impact') {
      const ax = a.row.effect_cents === null ? null : Math.abs(Number(a.row.effect_cents));
      const bx = b.row.effect_cents === null ? null : Math.abs(Number(b.row.effect_cents));
      if (ax === null || bx === null) return ax === bx ? a.index - b.index : ax === null ? 1 : -1;
      return bx - ax || a.index - b.index;
    }
    return kindRank(a.row) - kindRank(b.row) || a.index - b.index;
  }).map(x => x.row);
}

/** 端点金额格文案：未启用／已停用／未知是文字，负债写「欠」前缀（17.14.4.2）。 */
export function cellText(cell: CompareCell, side: Side): string {
  if (cell.state === 'not_open') return '未启用';
  if (cell.state === 'closed') return '已停用';
  if (cell.state === 'missing' || cell.amount_cents === null) return '未知';
  return side === 'liability' ? `欠 ${money(cell.amount_cents)}` : money(cell.amount_cents);
}

// Only a submitted request whose reply was lost is kept; unsubmitted input is not.
export const pendingKey = 'thingary.wealth-pending.v1';
export type TrashChange = { request_id: string; generation: string; kind: TrashKind; id: string; expected_revision: number; deleted: boolean };
export type TrashKind = 'snapshot' | 'account' | 'expense' | 'income' | 'plan' | 'payment' | 'wish' | 'virtual' | 'topup' | 'balance';
export type Pending = { command: 'wealth_account_save' | 'wealth_snapshot_save' | 'wealth_trash' | 'expense_save' | 'plan_income_save' | 'plan_baseline_mark' | 'plan_profile_save' | 'recurring_plan_save' | 'recurring_payment_save' | 'virtual_save' | 'recurring_payment_range_save' | 'virtual_topup_save' | 'virtual_balance_save' | 'virtual_reminder_save'; input: AccountSave | SnapshotSave | TrashChange | IncomeSave | Mark | ProfileSave | TopupSave | BalanceSave | ReminderSave | { request_id: string; generation: string }; label: string };
export function storedPending(): Pending | null {
  try { const p = JSON.parse(localStorage.getItem(pendingKey) || 'null'); if (p && typeof p.command === 'string' && typeof p.input?.request_id === 'string') return p; } catch { /* unreadable receipt is ignored */ }
  return null;
}
const clearPending = () => { try { localStorage.removeItem(pendingKey); } catch { /* nothing to clear */ } };
/** Tauri errors surface as `{code, message}`; the code drives fallback flows. */
export const code = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';

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
