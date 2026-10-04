import { unitMoney } from './asset';
import { Info } from './FormControls';

export type DailyCostSummary = { known_cents: string | null; included_count: number; unknown_count: number; per_use_count: number; excluded_count: number };
export function DailyCostMetric({ summary }: { summary: DailyCostSummary }) {
  const notes = [`已计入 ${summary.included_count} 件`];
  if (summary.unknown_count) notes.push(`${summary.unknown_count} 件资料不全`);
  if (summary.per_use_count) notes.push(`${summary.per_use_count} 件按次计费`);
  if (summary.excluded_count) notes.push(`${summary.excluded_count} 件已排除`);
  return <div className="daily-cost-metric" role="group" aria-label="物品日均成本">
    <span className="ui-label">物品日均成本<Info text="当前持有物品（使用中＋已退役）各自的日均成本之和：每件（购入价＋维护费）÷持有天数，四舍五入到分后相加。已售出、已删除、按次计费与设为不计入日均的物品不参与；资料不全不当作零。总金额和统计页的排除选项不影响日均。此数值是持有成本的摊算，不是每天实际支出，不含金融账户、订阅或房租。"/></span>
    <span className="ui-value">{summary.known_cents === null ? '—' : unitMoney(summary.known_cents)}<small>/天</small></span>
    <span className="ui-note">{notes.join(' · ')}{summary.unknown_count > 0 && summary.included_count > 0 ? ' · 仅已知部分' : ''}</span>
  </div>;
}
