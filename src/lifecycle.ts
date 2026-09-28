import type { AssetRecord } from './asset';
export type LifecycleState = 'active' | 'retired' | 'sold';
export type LifecycleKind = 'retire' | 'activate';
export type LifecycleEvent = { id: string; sequence: number; kind: LifecycleKind; date: string; notes: string };
export type Lifecycle = { state: LifecycleState; events: LifecycleEvent[] };
export type LifecycleAction = { type: 'append'; kind: LifecycleKind; date: string; notes: string } | { type: 'correct_date'; event_id: string; date: string };
export type LifecycleChange = { request_id: string; generation: string; asset_id: string; expected_revision: number; action: LifecycleAction | { type: 'revoke'; event_id: string } };
/** `revoke` turns a date correction into removing that mistaken event (D18). */
export type LifecycleDraft = { record: AssetRecord; generation: string; action: LifecycleAction; original: LifecycleAction; pending: LifecycleChange | null; revoke?: boolean };
export const lifecycleKey = 'possio.lifecycle-draft.v1';
export function stateLabel(record: AssetRecord) { return { active: '使用中', retired: '已退役', sold: '已售出' }[record.lifecycle?.state ?? 'active']; }
export function kindLabel(kind: LifecycleKind) { return kind === 'retire' ? '退役' : '重新启用'; }
export function lifecycleError(record: AssetRecord, action: LifecycleAction, today: string): string {
  const day = action.date;
  const parsed = new Date(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '1900-01-01' || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return '请填写有效动作日期，格式为 YYYY-MM-DD。';
  if (day > today) return '动作日期不能晚于今天。';
  if (record.asset.purchase_date && day < record.asset.purchase_date) return '动作日期不能早于购入日期。';
  if (record.deleted) return '物品已移入最近删除，请先恢复物品。';
  const life = record.lifecycle ?? { state: 'active', events: [] };
  if (life.state === 'sold' && action.type === 'append') return '已售出物品须先处理售出记录；真实购回需要另建档案。';
  if (action.type === 'append') {
    if (action.kind !== (life.state === 'active' ? 'retire' : 'activate')) return '当前状态已变化，请重新读取后选择适用动作。';
    if ([...action.notes].length > 10000 || action.notes.includes('\0')) return '备注最多 10000 字，且不能含空字符。';
    const last = life.events.at(-1);
    if (last && day < last.date) return `动作日期不能早于前一次${kindLabel(last.kind)}（${last.date}）。`;
  } else {
    if (record.sale && day > record.sale.fields.date) return '状态日期不能晚于有效售出日期，请先更正售出记录。';
    const index = life.events.findIndex(e => e.id === action.event_id);
    if (index < 0) return '找不到这条状态记录，请重新读取。';
    const before = life.events[index - 1], after = life.events[index + 1];
    if (before && day < before.date) return `日期不能早于相邻${kindLabel(before.kind)}（${before.date}）。`;
    if (after && day > after.date) return `日期不能晚于相邻${kindLabel(after.kind)}（${after.date}）；同日保留原动作顺序。`;
  }
  return '';
}
/** Only the latest event, and never under an effective sale, can be revoked. */
export function revokeError(record: AssetRecord, eventId: string): string {
  if (record.sale) return '这件物品已售出。请先撤销误记售出，再撤销更早的状态记录。';
  if (record.lifecycle?.events.at(-1)?.id !== eventId) return '只能撤销最近一条状态记录，请先撤销之后的记录。';
  return '';
}
/** State the asset returns to once its latest event is revoked. */
export function stateBeforeLatest(record: AssetRecord) {
  return record.lifecycle?.events.at(-2)?.kind === 'retire' ? '已退役' : '使用中';
}
export function storedLifecycle(): LifecycleDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(lifecycleKey) || 'null');
    if (typeof d?.record?.asset?.id === 'string' && typeof d?.generation === 'string' && typeof d.action?.date === 'string' && ['append','correct_date'].includes(d.action.type) && d.original && (!d.pending || (d.pending.asset_id === d.record.asset.id && typeof d.pending.request_id === 'string'))) return d;
  } catch { /* Broken reminder does not prevent reading the library. */ }
  return null;
}
