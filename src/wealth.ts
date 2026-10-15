import { invoke } from '@tauri-apps/api/core';
import type { TopupSave, BalanceSave, ReminderSave } from './virtual';
import type { LinkCreateInput, LinkRestoreInput, LinkSaveInput, LinkTrashInput, MergeInput, ReconcileInput } from './link';
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
export type Point = { snapshot_id: string; date: string; notes: string; assets_cents: string; liabilities_cents: string; net_cents: string; complete: boolean; missing: number; compared_to: string | null; scope_changed: boolean; change_cents: string | null; hpf_change_cents: string | null; market_change_cents?: string | null; change_rate_hundredths: number | null };
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

export const assetKinds = [['cash', '现金与存款'], ['investment', '投资账户'], ['mixed', '混合投资'], ['fund', '基金'], ['bond', '债券'], ['housing_fund', '公积金'], ['other_asset', '其他资产'], ['property', '房产'], ['pension', '个人养老金'], ['insurance', '保险现金价值'], ['precious_metal', '黄金与贵金属']] as const;
export const liabilityKinds = [['credit_card', '信用卡'], ['loan', '贷款'], ['other_liability', '其他负债']] as const;
/** New accounts use the category suggestion until the user chooses a scope explicitly. */
export const defaultAccountCounted = (kind: string): boolean => kind !== 'property' && kind !== 'insurance';
export function selectAccountKind(fields: AccountFields, kind: string, explicitCounted: boolean | null): AccountFields {
  return { ...fields, kind, side: liabilityKinds.some(([k]) => k === kind) ? 'liability' : 'asset', counted: kind === 'property' ? false : explicitCounted ?? defaultAccountCounted(kind) };
}
export function accountKindHint(kind: string): string | undefined {
  if (kind === 'property') return '房产仅单独记录当前估值，不计入金融净资产；有效期间仍需在每次完整盘点确认金额。房贷仍独立记录，金融净资产不代表包含房产的家庭总资产。';
  if (kind === 'insurance') return '记录当前现金价值，不是累计保费或保额。默认不计入；开启后仍不代表可用于退休规划。';
  if (kind === 'pension') return '记录个人养老金账户当前余额，不推算未来领取额。默认计入不代表已确认可用于规划。';
  if (kind === 'precious_metal') return '记录用户确认的人民币估值，不自动查询行情。默认计入不代表已确认可用于规划。';
  return undefined;
}
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
export type PurgeInput = { request_id: string; generation: string; kind: string | null; id: string; preview?: string };
export type Pending = { command: 'savings_goals_save' | 'savings_goals_trash' | 'movement_save' | 'movement_trash' | 'followup_review_save' | 'followup_review_trash' | 'plan_assumptions_save' | 'investment_review_save' | 'investment_review_trash' | 'financial_import_commit' | 'wealth_account_save' | 'wealth_snapshot_save' | 'wealth_trash' | 'expense_save' | 'plan_income_save' | 'plan_baseline_mark' | 'plan_profile_save' | 'plan_profile_update' | 'recurring_plan_save' | 'recurring_payment_save' | 'virtual_save' | 'recurring_payment_range_save' | 'virtual_topup_save' | 'virtual_balance_save' | 'virtual_reminder_save' | 'link_save' | 'link_create' | 'link_trash' | 'link_restore' | 'link_reconcile' | 'link_merge' | 'purge_trash'; input: (import('./planning-followup-contract.ts').FollowupWriteContext & ({ id: string | null; fields: import('./planning-followup-contract.ts').MovementFieldsV1 } | { id: string; deleted: boolean } | { pair: import('./planning-followup-contract.ts').ReviewPairV1; draft: import('./planning-followup-contract.ts').ReviewDraftV1; basis_key: string })) | (import('./planning-followup-contract.ts').FollowupWriteContext & { values: import('./planning-followup-contract.ts').AssumptionValuesV1; confirm: boolean }) | InvestmentReviewSave | InvestmentReviewTrash | import('./plan.ts').ProfileUpdate | PurgeInput | AccountSave | SnapshotSave | TrashChange | IncomeSave | Mark | ProfileSave | TopupSave | BalanceSave | ReminderSave | LinkSaveInput | LinkCreateInput | LinkTrashInput | LinkRestoreInput | ReconcileInput | MergeInput | { request_id: string; generation: string }; label: string };
export function storedPending(): Pending | null {
  try { const p = JSON.parse(localStorage.getItem(pendingKey) || 'null'); if (p && typeof p.command === 'string' && typeof p.input?.request_id === 'string') return p; } catch { /* unreadable receipt is ignored */ }
  return null;
}
export const clearPending = () => { try { localStorage.removeItem(pendingKey); } catch { /* nothing to clear */ } };
/** Tauri errors surface as `{code, message}`; the code drives fallback flows. */
export const code = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';

/** Unresolved means the request may or may not have committed; it stays stored. */
export class Unresolved extends Error {}

/**
 * Sends a write once. If the reply is lost, the stored request is checked by
 * its id; a committed one is re-sent unchanged, which returns the original result.
 */
export async function submit<T>(pending: Pending): Promise<T> {
  const existing = storedPending();
  if (existing && JSON.stringify(existing) !== JSON.stringify(pending)) {
    throw new Unresolved('还有一个提交结果待核对，原请求已保留；请先核对后再保存。');
  }
  try { localStorage.setItem(pendingKey, JSON.stringify(pending)); }
  catch { throw new Error('无法记录本次请求，尚未提交，请检查可用空间后重试。'); }
  try { const result = await invoke<T>(pending.command, { input: pending.input }); clearPending(); return result; }
  catch (e) {
    const outcome = await resolvePending(pending).catch(() => 'unknown' as const);
    if (outcome === 'saved') {
      // Keep the exact receipt until the replay reply is obtained as well.
      localStorage.setItem(pendingKey, JSON.stringify(pending));
      try { const result = await invoke<T>(pending.command, { input: pending.input }); clearPending(); return result; }
      catch { throw new Unresolved('已确认保存，但暂时无法读取回执；原请求已保留，请继续核对。'); }
    }
    if (outcome === 'unknown') throw new Unresolved(errorMessage(e) + ' 暂时无法确认是否已保存，原请求已保留，请在当前页面核对。');
    throw e;
  }
}

/** Every settled outcome clears the receipt; a thrown error keeps it for a later check. */
export async function resolvePending(pending: Pending): Promise<'saved' | 'unsaved' | 'stale'> {
  try {
    const id = await invoke<string | null>('wealth_request_result', { request: pending.input.request_id, generation: pending.input.generation });
    if (id) {
      if (pending.command === 'plan_assumptions_save' || pending.command === 'plan_profile_save' || pending.command === 'plan_profile_update') {
        if (id !== 'profile') throw new Unresolved('规划回执结果不匹配；原请求已保留。');
        // A receipt confirms a commit, but the current profile may still be
        // unreadable or belong to a newly selected library. Never replay legacy input.
        const state = await invoke<import('./plan.ts').ProfileState>('plan_profile');
        if (state.generation !== pending.input.generation || !state.saved) {
          throw new Unresolved('已保存但当前规划资料无法核对；原请求已保留。');
        }
      }
      clearPending(); return 'saved';
    }
    clearPending(); return 'unsaved';
  } catch (e) {
    if (code(e) === 'STALE_DATASET') { if (['savings_goals_save', 'savings_goals_trash', 'movement_save', 'movement_trash', 'followup_review_save', 'followup_review_trash'].includes(pending.command) || pending.command === 'plan_assumptions_save' || pending.command === 'plan_income_save' || pending.command === 'investment_review_save' || pending.command === 'investment_review_trash' || pending.command === 'financial_import_commit' || pending.command === 'plan_profile_update' || pending.command === 'plan_profile_save') throw new Unresolved('资料库已切换；原请求元数据仍保留，请回到原资料库核对。'); clearPending(); return 'stale'; }
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

/** Native investment review contract. Endpoint keys are opaque domain values. */
export type InvestmentReviewRecord = { flow: import('./investment-review/model.ts').InvestmentFlowV1; deleted: boolean };
export type InvestmentReviewRead = {
  generation: string;
  input: import('./investment-review/model.ts').InvestmentReviewInputV1;
  result: import('./investment-review/model.ts').InvestmentReviewResultV1;
  from_value_key: string; to_value_key: string;
  records: InvestmentReviewRecord[];
};
export type InvestmentReviewSave = {
  request_id: string; generation: string; id: string | null; expected_revision: number | null;
  from_snapshot_id: string; to_snapshot_id: string; from_value_key: string; to_value_key: string;
  fields: ReturnType<typeof import('./investment-review/model.ts').draftToFlowPatch>;
};
export type InvestmentReviewTrash = { request_id: string; generation: string; id: string; expected_revision: number; deleted: boolean };
export const readInvestmentReview = (generation: string, fromSnapshotId: string, toSnapshotId: string) => invoke<InvestmentReviewRead>('investment_review_read', { generation, fromSnapshotId, toSnapshotId });
export const listInvestmentReviews = (generation: string) => invoke<{ generation: string; records: InvestmentReviewRecord[] }>('investment_review_list', { generation });
export const saveInvestmentReview = (input: InvestmentReviewSave) => submit<import('./investment-review/model.ts').InvestmentFlowV1>({ command: 'investment_review_save', input, label: '投资资金流动核对' });
export const trashInvestmentReview = (input: InvestmentReviewTrash) => submit<void>({ command: 'investment_review_trash', input, label: input.deleted ? '删除投资核对' : '恢复投资核对' });
