// 心愿详情「对规划的影响」一行的读取与计算，逻辑与桌面 WishPlanLine 的 effect 相同（桌面组件被测试锁定，未改动）。规划关闭、资料未保存或来源不全时返回 null。
import { money } from './asset.ts';
import { loadPlanContext, wishLike } from './plan-data.ts';
import { buildRetireCalc } from './plan-retire-calc.ts';
import { classifyWishes, impactOf, impactSentence, isReady } from './plan-wishes.ts';
import { needsContribution, SAVE_CONTRIBUTION_HINT } from './planning-basic-view.ts';
import type { PlanningAnnotation } from './plan.ts';
import type { WishlistItem } from './wishlist.ts';
import { t } from './i18n.ts';
export type WishPlanLineResult = { text: string; annotations: PlanningAnnotation[] };

export async function loadWishPlanLine(item: WishlistItem, today: string): Promise<WishPlanLineResult | null> {
  const ctx = await loadPlanContext();
  if (!ctx.sources.modules.planning || !ctx.profile.saved) return null;
  const [spend] = classifyWishes([wishLike(item)], today);
  if (!spend || spend.status === 'no_price') return null;
  if (spend.status === 'expired') return { text: t('计划日期已过，规划没有计入这笔支出；更新计划日期后会重新估算。'), annotations: [] };
  const calc = buildRetireCalc(ctx.profile.saved, ctx.snapshot, ctx.review, ctx.incomes, today, ctx.sources);
  if (ctx.profile.saved.profile.retire.basic && calc.capabilities && needsContribution(calc.capabilities)) return { text: SAVE_CONTRIBUTION_HINT + t('：在目标详情里填写预计每月投入。'), annotations: [] };
  if (!isReady(calc)) return null;
  const sentence = impactSentence(spend, impactOf(calc, [spend]), calc.r.emergency_months, c => money(String(Math.round(c))));
  return { text: sentence, annotations: [...(calc.annotations ?? [])] };
}
