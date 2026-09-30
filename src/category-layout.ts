// U18 分类栏布局的纯函数：给定容器宽与真实测得的胶囊宽，算出可见前缀。
// 先为「更多分类」预留空间；选中但放不进前缀的分类在更多按钮前占一位且不重复；
// 连「全部分类＋未分类＋更多分类」都放不下时整栏收敛为单个选择按钮。
// 布局决策只依赖这些输入：同输入必给出同排布，不记录常用分类。
export interface CategoryLayoutPlan {
  compact: boolean;
  /** 可见的具体分类（保持既有顺序，不含选中回显位）。 */
  visibleIds: string[];
  showMore: boolean;
  /** 选中分类是否需要额外的外显位（不在 visibleIds 中时为 true）。 */
  selectedPinned: boolean;
}
export function planCategoryLayout(
  width: number,
  fixed: { all: number; none: number; more: number },
  entries: readonly { id: string; width: number }[],
  selectedId: string | null,
  gap = 6,
  /** 错误态等场景会在未溢出时也渲染「更多分类」触发钮：跳过全容早退，
   * 把触发钮宽度计入预算（第二轮复审 P3-4）。 */
  reserveMore = false,
): CategoryLayoutPlan {
  const prefix = (budget: number, skip: string | null) => {
    const ids: string[] = [];
    for (const entry of entries) {
      if (entry.id === skip) continue;
      if (budget - (entry.width + gap) < 0) break;
      budget -= entry.width + gap;
      ids.push(entry.id);
    }
    return ids;
  };
  // 优先：全部胶囊＋两个固定项能完整容纳时直接展示，不出「更多分类」。
  const total = fixed.all + gap + fixed.none + entries.reduce((sum, entry) => sum + entry.width + gap, 0);
  if (!reserveMore && total <= width) return { compact: false, visibleIds: entries.map(entry => entry.id), showMore: false, selectedPinned: false };
  // 连「全部分类＋未分类＋更多分类」都放不下：整栏收敛为单个选择按钮。
  const fixedRow = fixed.all + gap + fixed.none + gap + fixed.more;
  if (fixedRow > width) return { compact: true, visibleIds: [], showMore: false, selectedPinned: false };
  const budget = width - fixedRow;
  const direct = prefix(budget, null);
  const selected = selectedId ? entries.find(entry => entry.id === selectedId) ?? null : null;
  if (!selected || direct.includes(selected.id)) return { compact: false, visibleIds: direct, showMore: direct.length < entries.length, selectedPinned: false };
  // 选中项放不进前缀：为它预留一个外显位后重排其余项；
  // 预留后仍容不下选中项时按设计收敛为选择按钮（长选中名不得推出容器）。
  const pinnedBudget = budget - (selected.width + gap);
  if (pinnedBudget < 0) return { compact: true, visibleIds: [], showMore: false, selectedPinned: false };
  const pinned = prefix(pinnedBudget, selected.id);
  return { compact: false, visibleIds: pinned, showMore: true, selectedPinned: true };
}
