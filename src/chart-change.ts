import type { Point } from './wealth';
import { changeText, rateText } from './wealth';

export function changeLine(p: Point) {
  if (!p.compared_to) return '第一份完整盘点';
  if (p.change_cents === null) return '账户范围变化，暂不可比';
  return `较上次 ${changeText(p.change_cents)}${p.change_rate_hundredths === null ? '' : `（${rateText(p.change_rate_hundredths)}）`}`;
}

