// 财富页趋势图的数据：一次只画一条线（净资产／资产／负债），只画完整盘点。
import type { Point } from '../../wealth.ts';
import { moneyText } from '../format.ts';
import { t } from '../../i18n.ts';
export type TrendKind = 'net' | 'assets' | 'liabilities';
export const trendKinds: { id: TrendKind; label: string }[] = [{ id: 'net', label: t('净资产') }, { id: 'assets', label: t('资产') }, { id: 'liabilities', label: t('负债') }];
const field = { net: 'net_cents', assets: 'assets_cents', liabilities: 'liabilities_cents' } as const;
const num = (value: string | null | undefined): number | null => value === null || value === undefined ? null : Number(value);

export function trendValues(points: Point[], kind: TrendKind): (number | null)[] {
  return points.map(point => point.complete ? num(point[field[kind]]) : null);
}
/** Scrub label: all three values of that date, or why the date has none. */
export function trendTip(point: Point, hidden: boolean): { title: string; rows: { name: string; value: string }[]; note?: string } {
  const show = (value: string | null | undefined) => hidden ? '******' : value === null || value === undefined ? t('未知') : moneyText(value);
  if (!point.complete) return { title: point.date, rows: [], note: t('缺 {missing} 个账户，金额未知，不画在曲线上', { missing: point.missing }) };
  return { title: point.date, rows: [{ name: t('净资产'), value: show(point.net_cents) }, { name: t('资产'), value: show(point.assets_cents) }, { name: t('负债'), value: show(point.liabilities_cents) }] };
}
export function trendSummary(points: Point[], kind: TrendKind, hidden: boolean): string {
  const done = points.filter(point => point.complete), name = trendKinds.find(k => k.id === kind)!.label;
  const last = done.at(-1), value = last ? num(last[field[kind]]) : null;
  return t('{name}趋势，{length} 次完整盘点{v3}{v4}；不完整盘点不画', { name, length: done.length, v3: last && !hidden ? `，最近一次 ${value === null ? '未知' : moneyText(value)}` : '', v4: hidden ? '，金额已隐藏' : '' });
}
