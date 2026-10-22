import { holdingFact } from "./holdings.ts";
import { currencyCode, convertCurrency } from './currency.ts';
import type { CurrencyFact } from './currency.ts';
import { invoke } from '@tauri-apps/api/core';
import type { TopupSave, BalanceSave, ReminderSave } from './virtual';
import type { LinkCreateInput, LinkRestoreInput, LinkSaveInput, LinkTrashInput, MergeInput, ReconcileInput } from './link';
import type { IncomeSave, Mark, ProfileSave } from './plan';
import { errorMessage, money } from './asset.ts';

export type Side = 'asset' | 'liability';
export type AccountFields = { name: string; institution: string; side: Side; kind: string; counted: boolean; opened_on: string; closed_on: string | null; notes: string; purchase_cents?: string | null; purchased_on?: string | null; group_id?: string | null; currency?: string; holding_mode?: boolean; holding_unit?: string | null };
export type Observation = CurrencyFact & { amount_cents: string; date: string };
export type Account = { id: string; fields: AccountFields; position: number; revision: number; latest: Observation | null; last_entered_on?: string | null; has_entries?: boolean };
export type EntryState = 'entered' | 'unchanged' | 'missing';
export type Entry = CurrencyFact & { account_id: string; state: EntryState; amount_cents: string | null; side: Side; kind: string; counted: boolean };
export type Snapshot = { id: string; date: string; notes: string; revision: number; entries: Entry[]; missing: string[] };
export type Draft = { rate_suggestions?: Record<string,{rate:string;date:string}>; generation: string; date: string; existing: Snapshot | null; rows: { account: Account; previous: Observation | null }[] };
export type Point = { snapshot_id: string; date: string; notes: string; assets_cents: string; liabilities_cents: string; net_cents: string; liquid_cents: string | null; invested_cents: string | null; complete: boolean; has_unchanged?: boolean; missing: number; compared_to: string | null; scope_changed: boolean; change_cents: string | null; hpf_change_cents: string | null; market_change_cents?: string | null; change_rate_hundredths: number | null };
export type Share = { kind: string; amount_cents: string; share_hundredths: number | null };
export type Summary = { generation: string; points: Point[]; structure_date: string | null; structure_entries?: Entry[]; latest_entries?: Entry[]; structure: Share[]; liabilities: Share[] };
// U20 账户变化与盘点比较（产品设计 17.14）：一次比较的两个端点。
export type CompareCell = { state: string; amount_cents: string | null; counted: boolean | null };
export type CompareRow = { account_id: string; name: string; institution: string; side: Side; kind: string; from: CompareCell; to: CompareCell; change_cents: string | null; effect_cents: string | null; rate_hundredths: number | null; group: 'counted' | 'uncounted' | 'scope_changed'; tag: 'new' | 'closed' | null };
export type CompareEnd = { snapshot_id: string; date: string; notes: string; complete: boolean; missing: number };
export type StructurePair = { kind: string; from_cents: string | null; from_share: number | null; to_cents: string | null; to_share: number | null };
export type Compare = { generation: string; from: CompareEnd; to: CompareEnd; reconciled: boolean; net_change_cents: string | null; assets_change_cents: string | null; liabilities_change_cents: string | null; net_rate_hundredths: number | null; known_effect_cents: string; missing_names: string[]; rows: CompareRow[]; structure: StructurePair[] };
export type HistoryRow = CurrencyFact & { snapshot_id: string; date: string; state: string; amount_cents: string | null; counted: boolean; change_cents: string | null };
export type AccountHistory = { generation: string; account: Account; rows: HistoryRow[] };
export type AccountSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; fields: AccountFields };
export type SnapshotSave = { request_id: string; generation: string; id: string | null; expected_revision: number | null; date: string; notes: string; entries: (CurrencyFact & { account_id: string; state: EntryState; amount_cents: string | null })[]; close_accounts?: { account_id: string; expected_revision: number }[] };
/** An account can be closed from a check-in only on a day after it opened, and only when that day's check-in holds no row for it yet. */
export function canCloseInCheckIn(draft: Draft, account: Account): boolean {
  return !account.fields.closed_on && account.fields.opened_on < draft.date && !draft.existing?.entries.some(e => e.account_id === account.id);
}
/** Rows marked 已注销 are left out of the entries; the backend closes them at the check-in date in the same save. */
export function applyClosing(input: SnapshotSave, accounts: Account[], closing: ReadonlySet<string>): SnapshotSave {
  if (!closing.size) return input;
  const close_accounts = accounts.filter(a => closing.has(a.id)).map(a => ({ account_id: a.id, expected_revision: a.revision }));
  return { ...input, entries: input.entries.filter(e => !closing.has(e.account_id)), close_accounts };
}
export type CheckInRow = { state: EntryState | null; cents: string; edited?: boolean; quantity_e8?: string | null; unit_price_e6?: string | null; original_minor?: string | null; fx_rate_micro?: string | null };
/** Loaded unchanged rows keep history; explicitly reconfirmed rows carry the displayed amount. */
export function snapshotEntryInput(accountId: string, row: CheckInRow): SnapshotSave['entries'][number] {
  if (!row.state) throw new Error('请先处理这个账户。');
  return { account_id: accountId, state: row.state, amount_cents: row.state === 'entered' || (row.state === 'unchanged' && row.edited) ? row.cents : null, ...(row.state !== 'missing' && row.quantity_e8 != null ? {quantity_e8:row.quantity_e8,unit_price_e6:row.unit_price_e6} : {}), ...(row.state !== 'missing' && row.original_minor != null ? { original_minor: row.original_minor, fx_rate_micro: row.fx_rate_micro } : {}) };
}

export const assetKinds = [['cash', '现金与存款'], ['investment', '投资账户'], ['mixed', '混合投资'], ['fund', '基金'], ['bond', '债券'], ['housing_fund', '公积金'], ['property', '房产'], ['pension', '个人养老金'], ['insurance', '保险现金价值'], ['precious_metal', '黄金与贵金属'], ['receivable', '应收款'], ['vehicle', '车辆'], ['other_asset', '其他资产']] as const;
export const liabilityKinds = [['credit_card', '信用卡'], ['loan', '贷款'], ['other_liability', '其他负债']] as const;
/** New accounts use the category suggestion until the user chooses a scope explicitly. */
export const defaultAccountCounted = (kind: string): boolean => kind !== 'property' && kind !== 'insurance' && kind !== 'vehicle';
export function selectAccountKind(fields: AccountFields, kind: string, explicitCounted: boolean | null): AccountFields {
  return { ...fields, kind, side: liabilityKinds.some(([k]) => k === kind) ? 'liability' : 'asset', counted: kind === 'property' ? false : explicitCounted ?? defaultAccountCounted(kind) };
}
export function accountKindHint(kind: string): string | undefined {
  if (kind === 'property') return '房产仅单独记录当前估值，不计入金融净资产；有效期间仍需在每次完整盘点确认金额。房贷仍独立记录，金融净资产不代表包含房产的家庭总资产。';
  if (kind === 'insurance') return '记录当前现金价值，不是累计保费或保额。默认不计入；开启后仍不代表可用于退休规划。';
  if (kind === 'pension') return '记录个人养老金账户当前余额，不推算未来领取额。默认计入不代表已确认可用于规划。';
  if (kind === 'precious_metal') return '记录用户确认的人民币估值，不自动查询行情。默认计入不代表已确认可用于规划。';
  if (kind === 'receivable') return '借给别人、还没收回的钱。对方还钱后把余额改小，全部收回后可以停用这个账户。默认计入不代表可用于规划。';
  if (kind === 'vehicle') return '记录车辆当前估值。车辆不是金融资产，默认不计入金融净资产，可以手动开启。';
  return undefined;
}
export const kindLabel = (kind: string) => [...assetKinds, ...liabilityKinds].find(([k]) => k === kind)?.[1] ?? kind;

/** Signed amount: `money` already renders a negative with a real minus sign and no line break after it. */
export const signedMoney = money;
export function changeText(cents: string) { return cents.startsWith('-') ? money(cents) : '+' + money(cents); }
/** 与上次比较的显示值：明确的零是持平，区别于未知与没有上期数据。 */
export function comparisonText(changeCents: string | null | undefined, comparedTo: string | null | undefined): string {
  if (!comparedTo) return '—';
  if (changeCents === '0') return '持平';
  return changeCents ? changeText(changeCents) : '—';
}
/** Enter 跳到下一金额字段：输入法组合期间保持原始行为，Tab 等其他键不处理。 */
export function enterJumpsAmount(key: string, composing: boolean, targetIsInput: boolean): boolean {
  return key === 'Enter' && !composing && targetIsInput;
}
export type CheckInField = { id: string; name: string; currency: string; holding_mode: boolean };
export type CheckInRowState = { state: string | null; cents: string; original_minor?: string | null; quantity_e8?: string | null; unit_price_e6?: string | null };
/** 定位未填的候选顺序：共享汇率在前，随后按表格行的金额／份额／单价。
 * 非法但非空的输入在行状态里 cents／数量为空，同样算待处理。 */
export function checkInUnfilledLabels(fields: CheckInField[], rates: Record<string, string>, rows: Record<string, CheckInRowState | undefined>): string[] {
  return checkInUnfilledTargets(fields, rates, rows).map(target => target.label);
}
export function checkInUnfilledTargets(fields: CheckInField[], rates: Record<string, string>, rows: Record<string, CheckInRowState | undefined>): { key: string; label: string }[] {
  const targets: { key: string; label: string }[] = [];
  const foreign = new Set(fields.map(f => f.currency).filter(c => c && c !== 'CNY'));
  for (const code of foreign) if (!/^\d+$/.test(rates[code] ?? '') || BigInt(rates[code]) <= 0n) targets.push({ key: `rate:${code}`, label: `${code} 汇率` });
  for (const field of fields) {
    const row = rows[field.id];
    if (field.holding_mode) {
      if (!row?.quantity_e8) targets.push({ key: `quantity:${field.id}`, label: `${field.name} 份额` });
      if (!row?.unit_price_e6) targets.push({ key: `price:${field.id}`, label: `${field.name} 单价` });
    } else if (field.currency === 'CNY') {
      if (!row?.state || row.state === 'missing' || row.cents === '') targets.push({ key: `amount:${field.id}`, label: `${field.name} 本次金额` });
    } else if (!row?.state || row.state === 'missing' || !row.original_minor) {
      targets.push({ key: `amount:${field.id}`, label: `${field.name} 原币金额` });
    }
  }
  return targets;
}
/** 从当前焦点之后找下一处，末尾回到首处；没有任何缺项时不动焦点。 */
export function nextUnfilledLabel(labels: string[], activeLabel: string | null): string | null {
  if (!labels.length) return null;
  const index = activeLabel ? labels.indexOf(activeLabel) : -1;
  return labels[(index + 1) % labels.length];
}
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
type FeaturePending = { command: 'account_group_save' | 'account_group_delete' | 'account_groups_reorder' | 'savings_goals_save' | 'savings_goals_trash' | 'movement_save' | 'movement_trash' | 'followup_review_save' | 'followup_review_trash' | 'plan_assumptions_save' | 'investment_review_save' | 'investment_review_trash' | 'financial_import_commit' | 'wealth_account_save' | 'wealth_quick_update' | 'wealth_snapshot_save' | 'wealth_trash' | 'expense_save' | 'plan_income_save' | 'plan_baseline_mark' | 'plan_profile_save' | 'plan_profile_update' | 'recurring_resume' | 'recurring_cancel_resumption' | 'recurring_plan_save' | 'recurring_payment_save' | 'virtual_save' | 'recurring_payment_range_save' | 'virtual_topup_save' | 'virtual_balance_save' | 'virtual_reminder_save' | 'link_save' | 'link_create' | 'link_trash' | 'link_restore' | 'link_reconcile' | 'link_merge' | 'purge_trash'; input: import('./recurring').ResumeSave | import('./recurring').CancelResumptionSave | (import('./planning-followup-contract.ts').FollowupWriteContext & ({ id: string | null; fields: import('./planning-followup-contract.ts').MovementFieldsV1 } | { id: string; deleted: boolean } | { pair: import('./planning-followup-contract.ts').ReviewPairV1; draft: import('./planning-followup-contract.ts').ReviewDraftV1; basis_key: string })) | (import('./planning-followup-contract.ts').FollowupWriteContext & { values: import('./planning-followup-contract.ts').AssumptionValuesV1; confirm: boolean }) | InvestmentReviewSave | InvestmentReviewTrash | import('./plan.ts').ProfileUpdate | PurgeInput | import('./account-groups').GroupSave | import('./account-groups').GroupDelete | import('./account-groups').GroupReorder | AccountSave | QuickUpdate | SnapshotSave | TrashChange | IncomeSave | Mark | ProfileSave | TopupSave | BalanceSave | ReminderSave | LinkSaveInput | LinkCreateInput | LinkTrashInput | LinkRestoreInput | ReconcileInput | MergeInput | { request_id: string; generation: string }; label: string };
/** Catalog requests share the durable guard, but use their original receipt store. */
type CatalogCommand = 'change_lifecycle' | 'change_sale' | 'change_maintenance' | 'change_warranty' | 'change_trash' | 'change_record_trash';
type CatalogInput = import('./lifecycle').LifecycleChange | import('./sales').SaleChange | import('./maintenance').MaintenanceChange | import('./warranty').WarrantyChange | import('./Trash').TrashChange | import('./unified-trash').RecordTrashChange;
type AssetSavePending = { command: 'save_asset'; input: import('./asset').SaveAsset; label: string };
type StoredAssetPending = { command: 'save_asset'; input: import('./asset').SaveAsset & { request_id: string; generation: string }; label: string };
export type Pending = { command: FeaturePending['command'] | CatalogCommand | 'save_asset' | 'batch_change'; input: FeaturePending['input'] | StoredAssetPending['input'] | CatalogInput | import('./Batch').BatchInput; label: string };
const catalogCommands: readonly string[] = ['save_asset', 'change_lifecycle', 'change_sale', 'change_maintenance', 'change_warranty', 'change_trash', 'change_record_trash'];
function submittedInput(pending: Pending) {
  if (pending.command !== 'save_asset' || !('base' in pending.input)) return pending.input;
  const { request_id: _request, generation: _generation, ...input } = pending.input;
  return input;
}
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
export async function submit<T>(request: Pending | AssetSavePending): Promise<T> {
  let pending: Pending;
  if (request.command === 'save_asset' && 'base' in request.input) {
    pending = { ...request, input: { ...request.input, request_id: request.input.base.request_id, generation: request.input.base.generation } };
  } else {
    if (!('request_id' in request.input)) throw new Error('请求身份无效，尚未提交。');
    pending = { ...request, input: request.input };
  }
  const existing = storedPending();
  if (existing && JSON.stringify(existing) !== JSON.stringify(pending)) {
    throw new Unresolved('还有一个提交结果待核对，原请求已保留；请先核对后再保存。');
  }
  try { localStorage.setItem(pendingKey, JSON.stringify(pending)); }
  catch { throw new Error('无法记录本次请求，尚未提交，请检查可用空间后重试。'); }
  try { const result = await invoke<T>(pending.command, { input: submittedInput(pending) }); clearPending(); return result; }
  catch (e) {
    const outcome = await resolvePending(pending).catch(() => 'unknown' as const);
    if (outcome === 'saved') {
      // Keep the exact receipt until the replay reply is obtained as well.
      localStorage.setItem(pendingKey, JSON.stringify(pending));
      try { const result = await invoke<T>(pending.command, { input: submittedInput(pending) }); clearPending(); return result; }
      catch { throw new Unresolved('已确认保存，但暂时无法读取回执；原请求已保留，请继续核对。'); }
    }
    if (outcome === 'unknown') throw new Unresolved(errorMessage(e) + ' 暂时无法确认是否已保存，原请求已保留，请在当前页面核对。');
    throw e;
  }
}

/** Every settled outcome clears the receipt; a thrown error keeps it for a later check. */
export async function resolvePending(pending: Pending): Promise<'saved' | 'unsaved' | 'stale'> {
  try {
    const identity = { request: pending.input.request_id, generation: pending.input.generation };
    const id = pending.command === 'change_record_trash'
      ? await invoke<import('./asset').AssetRecord | null>('saved_record_trash_request', { input: pending.input })
      : catalogCommands.includes(pending.command)
        ? await invoke<import('./asset').AssetRecord | null>('saved_request', identity)
        : await invoke<string | null>('wealth_request_result', identity);
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
    if (code(e) === 'STALE_DATASET') { if (catalogCommands.includes(pending.command) || pending.command === 'batch_change' || ['account_group_save', 'account_group_delete', 'account_groups_reorder', 'savings_goals_save', 'savings_goals_trash', 'movement_save', 'movement_trash', 'followup_review_save', 'followup_review_trash'].includes(pending.command) || pending.command === 'plan_assumptions_save' || pending.command === 'plan_income_save' || pending.command === 'investment_review_save' || pending.command === 'investment_review_trash' || pending.command === 'financial_import_commit' || pending.command === 'plan_profile_update' || pending.command === 'plan_profile_save') throw new Unresolved('资料库已切换；原请求元数据仍保留，请回到原资料库核对。'); clearPending(); return 'stale'; }
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


/** Quick updates replace balances; all arithmetic stays in integer cents. */
export type QuickChange = CurrencyFact & { account_id: string; amount_cents: string; expected_previous?: string | null; expected_original_minor?: string | null; expected_quantity_e8?: string | null };
export type QuickUpdate = { request_id: string; generation: string; date: string; note: string; changes: QuickChange[] };
export type QuickMode = 'balance' | 'delta' | 'transfer';
export function quickDateMin(points: Pick<Point, 'date'>[]): string {
  return points.reduce((latest, point) => point.date > latest ? point.date : latest, '1900-01-01');
}
/** Whether the account's active dates intersect the permitted quick-update dates. */
export function quickAvailable(account: Account, points: Pick<Point, 'date'>[], today: string): boolean {
  const first = [quickDateMin(points), account.fields.opened_on].sort().at(-1)!;
  return first <= today && (!account.fields.closed_on || first < account.fields.closed_on);
}
export function quickPrevious(draft: Draft, id: string): string | null {
  const recorded = draft.existing?.entries.find(e => e.account_id === id);
  return recorded ? recorded.amount_cents : draft.rows.find(r => r.account.id === id)?.previous?.amount_cents ?? null;
}
export function quickCounted(draft: Draft, id: string): boolean {
  const recorded = draft.existing?.entries.find(e => e.account_id === id);
  return recorded ? recorded.counted : draft.rows.find(r => r.account.id === id)?.account.fields.counted ?? false;
}
function quickAmount(value: string, signed = false): bigint {
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(value)) throw new Error('请填写金额。');
  const cents = BigInt(value);
  if (cents < -99999999999n || cents > 99999999999n) throw new Error('金额超出可记录范围。');
  return cents;
}
export function quickBalance(previous: string | null, delta: string): string {
  if (previous === null) throw new Error('还没有这个账户的金额，请用修改余额。');
  const next = quickAmount(previous) + quickAmount(delta, true);
  if (next < 0n) throw new Error('新的余额或欠款不能小于 0，请调整增减金额。');
  return quickAmount(next.toString()).toString();
}
export function quickDeltaLabel(side: Side): string {
  return side === 'liability' ? '增加欠款／减少欠款' : '增减金额';
}
export function quickTransferPairs(draft: Draft): { from: string; to: string }[] {
  const known = draft.rows.filter(r => !r.account.fields.holding_mode && quickPrevious(draft, r.account.id) !== null);
  return known.filter(r => r.account.fields.side === 'asset').flatMap(source => known
    .filter(target => target.account.id !== source.account.id && quickCounted(draft, source.account.id) === quickCounted(draft, target.account.id) && currencyCode(source.account.fields.currency) === currencyCode(target.account.fields.currency))
    .map(target => ({ from: source.account.id, to: target.account.id })));
}
export function quickTransfer(draft: Draft, from: string, to: string, amount: string): QuickChange[] {
  if (!quickTransferPairs(draft).some(pair => pair.from === from && pair.to === to)) throw new Error('请选择金额已知、计入范围相同的转出和转入账户。');
  const cents = quickAmount(amount);
  if (cents <= 0n) throw new Error('转账金额须大于 0。');
  const beforeFrom = quickPrevious(draft, from)!, beforeTo = quickPrevious(draft, to)!;
  const target = draft.rows.find(r => r.account.id === to)!.account;
  return [{ account_id: from, expected_previous: beforeFrom, amount_cents: quickBalance(beforeFrom, (-cents).toString()) },
    { account_id: to, expected_previous: beforeTo, amount_cents: quickBalance(beforeTo, (target.fields.side === 'liability' ? -cents : cents).toString()) }];
}
export function quickFact(draft: Draft, id: string): CurrencyFact | null {
  return draft.existing?.entries.find(e => e.account_id === id) ?? draft.rows.find(r => r.account.id === id)?.previous ?? null;
}
function foreignChange(draft: Draft, id: string, minor: string, rate: string, expected: boolean): QuickChange {
  const account = draft.rows.find(r => r.account.id === id)!.account, code = currencyCode(account.fields.currency), fact = quickFact(draft, id);
  if (!/^\d+$/.test(minor)) throw new Error('新的原币余额不能小于0。');
  return { account_id: id, amount_cents: convertCurrency(code, minor, rate), original_minor: minor, fx_rate_micro: rate, ...(expected ? { expected_previous: fact?.amount_cents, expected_original_minor: fact?.original_minor } : {}) };
}
export function quickChanges(draft: Draft, accountId: string, mode: QuickMode, value: string, from: string, to: string, rate = ''): QuickChange[] {
  const code = currencyCode(draft.rows.find(r => r.account.id === (mode === 'transfer' ? from : accountId))?.account.fields.currency);
  if (code !== 'CNY') {
    if (!draft.rows.some(r => r.account.id === accountId)) throw new Error('账户不在所选日期范围内。');
    if (mode === 'balance') return [foreignChange(draft, accountId, value, rate, false)];
    const previous = quickFact(draft, mode === 'transfer' ? from : accountId)?.original_minor;
    if (previous == null) throw new Error('没有已知原币金额，请用修改余额。');
    if (!/^-?\d+$/.test(value)) throw new Error('请填写原币金额。');
    if (mode === 'delta') return [foreignChange(draft, accountId, (BigInt(previous) + BigInt(value)).toString(), rate, true)];
    if (!quickTransferPairs(draft).some(p => p.from === from && p.to === to) || BigInt(value) <= 0n) throw new Error('请选择相同币种、计入范围的账户和正转账金额。');
    const target = draft.rows.find(r => r.account.id === to)!.account, before = quickFact(draft, to)?.original_minor;
    if (before == null) throw new Error('转入账户没有已知原币金额。');
    const result = [foreignChange(draft, from, (BigInt(previous) - BigInt(value)).toString(), rate, true), foreignChange(draft, to, (BigInt(before) + (target.fields.side === 'liability' ? -1n : 1n) * BigInt(value)).toString(), rate, true)];
    const effect = result.reduce((sum, c) => sum + (BigInt(c.amount_cents) - BigInt(c.expected_previous!)) * (draft.rows.find(r => r.account.id === c.account_id)!.account.fields.side === 'asset' ? 1n : -1n), 0n);
    if (effect !== 0n) throw new Error('折算或舍入使人民币变化无法抵消，请分别修改余额。');
    return result;
  }
  if (mode === 'transfer') return quickTransfer(draft, from, to, value);
  if (!draft.rows.some(row => row.account.id === accountId)) throw new Error('这个账户不在所选日期的盘点范围内。');
  return mode === 'balance' ? [{ account_id: accountId, amount_cents: quickAmount(value).toString() }]
    : [{ account_id: accountId, amount_cents: quickBalance(quickPrevious(draft, accountId), value), expected_previous: quickPrevious(draft, accountId) }];
}
export function accountUpdateAge(day: string | null | undefined, today: string): { text: string; old: boolean } {
  if (!day) return { text: '尚未填写金额', old: false };
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(day)) / 86400000));
  return { text: `${days} 天前更新`, old: days > 90 };
}

export type HoldingQuickMode = 'replace' | 'quantity' | 'price';
export function holdingQuickChange(draft: Draft, id: string, mode: HoldingQuickMode, quantity: string, price: string, rate: string): QuickChange {
  const account=draft.rows.find(r=>r.account.id===id)?.account;
  if(!account?.fields.holding_mode)throw new Error('账户不在所选日期的持仓范围内。');
  const prior=quickFact(draft,id);let next=quantity;
  if(mode!=='replace'){
    if(prior?.amount_cents==null||prior.quantity_e8==null)throw new Error('没有已知份额，请同时填写份额和单价。');
    if(mode==='price')next=prior.quantity_e8;
    else {if(!/^-?\d+$/.test(quantity))throw new Error('请填写份额变化。');next=(BigInt(prior.quantity_e8)+BigInt(quantity)).toString();}
  }
  const fact=holdingFact(currencyCode(account.fields.currency),next,price,rate);
  return {account_id:id,...fact,amount_cents:fact.amount_cents!,...(mode==='replace'?{}:{expected_previous:prior!.amount_cents,expected_quantity_e8:prior!.quantity_e8,...(currencyCode(account.fields.currency)==='CNY'?{}:{expected_original_minor:prior!.original_minor})})};
}
