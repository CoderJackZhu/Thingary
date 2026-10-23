import type { Point } from './wealth';
import { changeText, rateText } from './wealth';
import { t } from './i18n.ts';
export function changeLine(p: Point) {
  if (!p.compared_to) return t('第一份完整盘点');
  if (p.change_cents === null) return t('账户范围变化，暂不可比');
  return t('较上次 {v1}{v2}', { v1: changeText(p.change_cents), v2: p.change_rate_hundredths === null ? '' : `（${rateText(p.change_rate_hundredths)}）` });
}
