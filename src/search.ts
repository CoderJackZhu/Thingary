import type { SourceTarget } from './source';

/** 九类结果，顺序即后端固定类型顺序（§6.2）。 */
export type SearchKind = 'asset' | 'wish' | 'account' | 'snapshot' | 'expense' | 'plan' | 'payment' | 'virtual' | 'topup';
export const searchKindOrder: SearchKind[] = ['asset', 'wish', 'account', 'snapshot', 'expense', 'plan', 'payment', 'virtual', 'topup'];
export const searchKindLabel = (kind: string): string => ({ asset: '物品', wish: '心愿', account: '账户', snapshot: '盘点', expense: '重要支出', plan: '周期计划', payment: '周期付款记录', virtual: '虚拟资产', topup: '储值充值' } as Record<string, string>)[kind] ?? kind;
/** 类型 → 所属模块开关；物品为核心，始终可搜。 */
const kindModuleMap: Partial<Record<SearchKind, 'wishlist' | 'wealth' | 'expenses' | 'recurring' | 'virtual'>> = { wish: 'wishlist', account: 'wealth', snapshot: 'wealth', expense: 'expenses', plan: 'recurring', payment: 'recurring', virtual: 'virtual', topup: 'virtual' };
export const searchKindModule = (kind: SearchKind) => kindModuleMap[kind] ?? null;

export type SearchItem = { id: string; kind: SearchKind; title: string; date: string | null; status: string; matched_field: string; context: string; target: SourceTarget };
export type SearchResults = { generation: string; revision: string; keyword: string; type_filter: string; offset: number; limit: number; total: number; type_counts: [string, number][]; items: SearchItem[] };
export type SearchQuery = { keyword: string; type_filter: string; offset: number; limit: number; generation: string; revision?: string | null };
/** 面板内会话状态：再次打开保留关键词/类型/分页，不落盘（§6.1）。 */
export type SearchSession = { keyword: string; typeFilter: string; offset: number; scrollTop: number; revision: string | null; open: boolean };
export const emptySearchSession = (): SearchSession => ({ keyword: '', typeFilter: 'all', offset: 0, scrollTop: 0, revision: null, open: false });

export const searchPageSize = 30;

/** 面板可用的类型筛选：全部 + 已开启模块的类型，带计数。 */
export function searchFilterList(typeCounts: [string, number][] | null, modulesOn: (kind: SearchKind) => boolean): { value: string; label: string; count: number | null }[] {
  const list = [{ value: 'all', label: '全部', count: typeCounts ? typeCounts.reduce((t, [, n]) => t + n, 0) : null }];
  for (const kind of searchKindOrder) {
    if (kind !== 'asset' && !modulesOn(kind)) continue;
    const hit = typeCounts?.find(([k]) => k === kind);
    list.push({ value: kind, label: searchKindLabel(kind), count: hit ? hit[1] : null });
  }
  return list;
}

/** 空面板的搜索范围说明（§6.2）：覆盖字段与明确不覆盖的内容。 */
export const searchScopeText = '可搜索：物品（名称、品牌、型号、分类、标签、备注）；心愿（名称、分类、考虑理由、决定备注、相关链接）；账户（名称、类型、平台、备注）；盘点（日期、备注）；独立重要支出（名称、分类、备注、日期）；周期计划（名称、类别、备注）；周期付款记录（计划名、应付／实付日期、付款备注）；虚拟资产（名称、类型、标签、备注）；储值充值（档案名、充值日期、备注）。不搜索：附件内容、OCR、序列号、保障／维护子记录、退款子记录、储值余额核对历史、未确认付款候选、自动费用估算，也不做模糊或拼音检索。';

/** 输入停止约 200ms 后查询；中文组合输入结束后再查询（§6.1）。 */
export const searchDebounceMs = 200;
