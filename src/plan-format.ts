import { money } from './asset.ts';
import { t } from './i18n.ts';
/** Display only. Inputs, persistence and comparisons must keep their original cents. */
export function forecastMoney(cents: string | number | null): string {
  if (cents === null || typeof cents === 'string' && cents.trim() === '') return t('待补充');
  const value = Number(cents);
  if (!Number.isFinite(value)) return t('暂不可计算');
  const absolute = Math.abs(value);
  if (absolute === 0) return money('0');
  if (absolute < 100) return value < 0 ? t('负值（不足 ¥1）') : t('不足 ¥1');
  const step = absolute < 10_000 ? 100 : 10_000;
  const rounded = Math.round(absolute / step) * step;
  return money(String(value < 0 ? -rounded : rounded));
}
