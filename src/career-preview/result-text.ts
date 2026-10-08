import type { CareerEvaluation, CareerRequirement } from '../plan-career-contract.ts';
import type { CareerComparison } from '../plan-career-compare.ts';
export const money = (cents: string | number) => `¥${(Number(cents)/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const difference = (label: string, cents: string) => Number(cents) === 0 ? `${label}不变` : `${label}${Number(cents) > 0 ? '增加' : '减少'} ${money(Math.abs(Number(cents)))}`;
export function comparisonText(result: CareerComparison) {
  if (result.change.kind === 'recovery') {
    const missingAmount = [result.baseline, result.alternative].some(x => x.prediction.status === 'blocked' && x.prediction.issues.some(i => i.field === 'recovery.monthly_cents'));
    return {
      headline: result.goal_assets_delta_cents !== null ? difference('目标时点资产', result.goal_assets_delta_cents) : missingAmount ? '先填两组“每月能攒多少”，再比较目标资金' : '条件尚未齐全，暂不计算目标资金差额',
      detail: '目标和预算没变，所以“每月至少要攒多少”不变；改变你估计的每月能攒多少，会影响目标时的资金。',
    };
  }
  return { headline: result.requirement_delta_cents !== null ? difference('每月至少要攒的钱', result.requirement_delta_cents) : '部分条件待确认，暂不计算需求差额。', detail: null };
}
export function requirementText(value: CareerRequirement): string {
  if (value.status === 'found') return `${money(value.monthly_cents)} / 月`;
  if (value.status === 'no_positive_contribution') return '无需新增正投入';
  if (value.status === 'search_not_found') return `月投入 ${money(value.search_limit_cents)} 的搜索范围内仍未满足`;
  return value.message;
}
export function resultText(result: CareerEvaluation) {
  const cash=result.cash, req=result.requirement, predicted=result.prediction;
  return {
    requirement: req.status === 'ready' ? requirementText(req.value) : req.issues.map(x=>x.message).join(' '),
    cash: cash.status === 'blocked' ? cash.issues.map(x=>x.message).join(' ') : cash.value.first_shortfall_month ? `${cash.value.first_shortfall_month} 首次资金不足` : '所检查空窗期间未出现资金不足',
    minimum: cash.status === 'ready' ? `${money(cash.value.minimum_cents)}${cash.value.first_shortfall_month ? '（截至首次不足）' : ''}` : '—',
    floor: cash.status === 'ready' && cash.value.floor_month ? `${cash.value.floor_month} 到达或低于底线` : '—',
    prediction: predicted.status === 'blocked' ? predicted.issues.map(x=>x.message).join(' ') : predicted.value.outcome.success ? '所设投入覆盖本次预算条件与终点' : '所设投入未覆盖本次预算条件或已知付款',
    cashRange: cash.status === 'ready' ? `${cash.value.from_month} 至 ${cash.value.until_month} 之前 · ${cash.value.budget_scope==='complete'?'完整开销':'仅必要开销'}` : '检查待补齐',
  };
}
