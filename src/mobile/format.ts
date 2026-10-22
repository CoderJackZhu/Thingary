// Display formatting shared by every phone page, so dates, money and "unknown" read the same everywhere.
// Pure functions; business values still come from src/asset.ts (`yuan` is reused, not reimplemented).
import { localDay, unitMoney as unitMoneyShared, yuan } from '../asset.ts';

/** 事实未知（金额、日期）。 */
export const UNKNOWN = '未知';
/** 可选项没有设置（标签、备注、品牌……）。 */
export const NOT_SET = '未设置';
/** 列表里什么都没有。 */
export const NONE = '暂无';

const dayPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 表单与详情字段里的日期：`YYYY-MM-DD`；未知显示「未知」。 */
export function dateText(date: string | null | undefined): string {
  return date ? date : UNKNOWN;
}

/**
 * 列表、时间线、小节标题里的日期：「10月21日」，不是今年时带年份「2025年10月21日」。
 * 空值为「未知」；不是 `YYYY-MM-DD` 的文本原样返回，不猜测。
 */
export function dayLabel(date: string | null | undefined, today: string = localDay()): string {
  if (!date) return UNKNOWN;
  const match = dayPattern.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  const base = `${Number(month)}月${Number(day)}日`;
  return year === today.slice(0, 4) ? base : `${Number(year)}年${base}`;
}

/** `2026-10` 或 `2026-10-21` 的月份标题：「10月」，不是今年时「2025年10月」。 */
export function monthLabel(month: string, today: string = localDay()): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return month;
  const base = `${Number(match[2])}月`;
  return match[1] === today.slice(0, 4) ? base : `${Number(match[1])}年${base}`;
}

/** 金额到元，有分才显示两位小数；未知显示「未知」（不是 0）。 */
export function moneyText(cents: string | number | null | undefined): string {
  return cents === null || cents === undefined ? UNKNOWN : yuan(String(cents));
}

/** 单价（日均、单次）始终两位小数；未知显示「未知」。 */
export function unitMoneyText(cents: string | null | undefined): string {
  return cents === null || cents === undefined ? UNKNOWN : unitMoneyShared(cents);
}

/** 带符号的变化量：「+¥1,200」「−¥300」；不缩写成「万」。 */
export function signedMoneyText(cents: string | number): string {
  const n = Number(cents);
  return `${n > 0 ? '+' : ''}${yuan(String(cents))}`;
}

/** 可选文本字段：没填显示「未设置」。 */
export function optionalText(value: string | null | undefined): string {
  return value && value.trim() ? value : NOT_SET;
}
