// U17 · 标签投入分析：类型与纯展示辅助（搜索匹配、占比、分段）。
// 数据来自 tag_investment_view（Rust 全量聚合）；本模块只做展示计算，
// 金额不求和、不浮点累加，占比用 BigInt 精确整数比（ADR-001 25.5）。
import { errorMessage, money } from './asset.ts';

export type TagScope = 'all' | 'held';

/** 分析子视图的会话内状态（组件与 App 共享；切库/离开物品区即失效）。 */
export type AnalysisViewState = {
  labelId: string;
  labelName: string;
  scope: TagScope;
  search: string;
  shown: number;
  listScroll: number;
  viewScroll: number;
  /** 从详情返回时待恢复焦点的物品行；组件消费后由 App 清空。 */
  focusAsset: string | null;
};
export type TagLabelInfo = { id: string; name: string; inactive: boolean };
export type TagInvestmentCounts = { matched: number; included: number; excluded: number; active: number; retired: number; sold: number };
export type TagInvestmentTotals = {
  known_purchase_cents: string;
  known_maintenance_cents: string;
  known_investment_cents: string;
  sale_proceeds_cents: string;
  known_net_cents: string;
  complete_investment_cents: string | null;
  complete_net_cents: string | null;
  has_known_purchase: boolean;
  has_known_maintenance_record: boolean;
  has_known_investment: boolean;
  missing_purchase_count: number;
  missing_maintenance_count: number;
  incomplete_asset_count: number;
};
export type TagInvestmentItem = {
  id: string;
  name: string;
  category_name: string;
  lifecycle_state: string;
  brand: string;
  model: string;
  serial_number: string;
  notes: string;
  purchase_cents: string | null;
  known_maintenance_cents: string;
  known_maintenance_record_count: number;
  missing_maintenance_count: number;
  known_investment_cents: string;
  complete_investment_cents: string | null;
  has_known_investment: boolean;
  sale_proceeds_cents: string;
  incomplete: boolean;
};
export type TagInvestmentView = {
  generation: string;
  today: string;
  label: TagLabelInfo;
  scope: TagScope;
  counts: TagInvestmentCounts;
  totals: TagInvestmentTotals;
  items: TagInvestmentItem[];
};

export const TAG_PAGE_SIZE = 100;

/** 搜索沿用物品列表匹配习惯：名称、品牌、型号、分类、备注、序列号；
 *  只过滤明细，不改汇总、分母与后端顺序。 */
export function itemMatches(item: TagInvestmentItem, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.brand, item.model, item.category_name, item.notes, item.serial_number]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

/** 明细分段：先对全部 items 搜索，再取前 shown 件；汇总与分母不受影响。 */
export function visibleItems(view: TagInvestmentView, search: string, shown: number): { rows: TagInvestmentItem[]; matched: number } {
  const rows = search.trim() ? view.items.filter(i => itemMatches(i, search)) : view.items;
  return { rows: rows.slice(0, Math.max(TAG_PAGE_SIZE, shown)), matched: rows.length };
}

/** 占比文字：完整且 T>0 才计算；t>0 且 1000×t<T 显示 <0.1%；
 *  其余按 1000×t/T 四舍五入到十分之一百分点（BigInt 半进位）。 */
export function percentText(totalsCents: string, itemCents: string): string | null {
  const t = BigInt(totalsCents);
  if (t <= 0n) return null;
  const v = BigInt(itemCents);
  if (v <= 0n) return '0.0%';
  if (1000n * v < t) return '<0.1%';
  // 半进位：(2000·t + T) / (2T)，BigInt 除法向下取整。
  const tenths = (2000n * v + t) / (2n * t);
  return `${tenths / 10n}.${tenths % 10n}%`;
}

/** 比例条宽度（%）：仅显示投影，0–100；无正占比时不画。 */
export function percentBar(totalsCents: string, itemCents: string): number | null {
  const t = BigInt(totalsCents);
  const v = BigInt(itemCents);
  if (t <= 0n || v <= 0n) return null;
  return Math.min(100, Number((v * 10000n) / t) / 100);
}

/** 从详情返回时恢复显示条数：总数减少时取合法上限（至少首段）。 */
export function restoredShown(saved: number, matched: number): number {
  if (matched <= TAG_PAGE_SIZE) return TAG_PAGE_SIZE;
  return Math.min(Math.max(TAG_PAGE_SIZE, saved), Math.ceil(matched / TAG_PAGE_SIZE) * TAG_PAGE_SIZE);
}

/** 未知提示句：购入未知件数、维护未知条数、排除件数与占比说明；
 *  全部为空时不显示。 */
export function missingNotice(totals: TagInvestmentTotals, excluded: number): string | null {
  const parts: string[] = [];
  if (totals.missing_purchase_count > 0) parts.push(`购入金额未知 ${totals.missing_purchase_count} 件`);
  if (totals.missing_maintenance_count > 0) parts.push(`维护费用未知 ${totals.missing_maintenance_count} 条`);
  if (excluded > 0) parts.push(`${excluded} 件已设为不计入统计`);
  if (!parts.length) return null;
  if (totals.complete_investment_cents === null) parts.push('补全金额后可查看占比');
  return parts.join(' · ') + '。';
}

/** 摘要行购入分项（R1 语义）：无已知购入 → 待补录；有缺失 → 标「已知」；
 *  完整 → 金额本身。空集合由空态分支处理，不进入这里。 */
export function purchaseSummaryText(totals: TagInvestmentTotals): string {
  if (!totals.has_known_purchase) return '待补录';
  const text = money(totals.known_purchase_cents);
  return totals.missing_purchase_count > 0 ? `已知 ${text}` : text;
}

/** 摘要行维护分项（R1 语义）：没有任何维护记录 → 确定的 ¥0；
 *  有未知但无已知记录 → 待补录（不得冒充零）；混合 → 已知金额；
 *  无缺失 → 金额本身。 */
export function maintenanceSummaryText(totals: TagInvestmentTotals): string {
  if (totals.has_known_maintenance_record) {
    const text = money(totals.known_maintenance_cents);
    return totals.missing_maintenance_count > 0 ? `已知 ${text}` : text;
  }
  return totals.missing_maintenance_count > 0 ? '待补录' : '¥0';
}

/** 明细维护单元格（宽表与窄窗副行共用，R1 三处一致）：
 *  无记录 → ¥0；只有未知 → 待补录；已知+未知 → 已知金额 · 待补录；
 *  完整 → 金额本身。 */
export function maintenanceCellText(item: TagInvestmentItem): string {
  const known = item.known_maintenance_record_count > 0;
  const missing = item.missing_maintenance_count > 0;
  if (!known && !missing) return '¥0';
  if (!known) return '待补录';
  if (missing) return `已知 ${money(item.known_maintenance_cents)} · 待补录`;
  return money(item.known_maintenance_cents);
}

/** 范围切换（R4）：保留关键词与列表上下文，明细分段重置回首段、滚动回顶。 */
export function analysisAfterScopeChange(state: AnalysisViewState, scope: TagScope): AnalysisViewState {
  return { ...state, scope, shown: TAG_PAGE_SIZE };
}

export type LabelOption = { id: string; name: string; text: string; inactive: boolean };

/** 筛选标签下拉选项（R2）：停用标签保留可选并标注状态，保证分析入口可达
 *  （D23：停用不丢失回顾能力）；新增表单的可选范围由保存校验独立约束。 */
export function labelFilterOptions(tags: { id: string; name: string; enabled: boolean }[]): LabelOption[] {
  return tags.map(tag => ({
    id: tag.id,
    name: tag.name,
    inactive: !tag.enabled,
    text: tag.enabled ? tag.name : `${tag.name}（已停用）`,
  }));
}

export type RequestOutcome =
  | { state: 'applied'; view: TagInvestmentView }
  | { state: 'late' }
  | { state: 'failed'; message: string };
/** 带票据的读取编排（模式同 source.ts openSourceRequest）：响应成功与失败
 *  都先经 alive() 校验；晚到的旧结果原样丢弃，不覆盖新页或已离开的视图。 */
export async function requestTagView(
  send: (labelId: string, scope: TagScope) => Promise<TagInvestmentView>,
  alive: () => boolean,
  labelId: string,
  scope: TagScope,
): Promise<RequestOutcome> {
  try {
    const view = await send(labelId, scope);
    if (!alive()) return { state: 'late' };
    return { state: 'applied', view };
  } catch (e) {
    if (!alive()) return { state: 'late' };
    return { state: 'failed', message: errorMessage(e) };
  }
}
