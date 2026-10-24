// Display formatting shared by every phone page, so dates, money and "unknown" read the same everywhere.
// Pure functions; business values still come from src/asset.ts (`yuan` is reused, not reimplemented).
import { localDay, unitMoney as unitMoneyShared, yuan } from '../asset.ts';
import { forecastMoney } from '../plan-format.ts';
import { currentLang, numberLocale, t } from '../i18n.ts';
/** 事实未知（金额、日期）。 */
export const UNKNOWN = t('未知');
/** 可选项没有设置（标签、备注、品牌……）。 */
export const NOT_SET = t('未设置');
/** 列表里什么都没有。 */
export const NONE = t('暂无');

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
  if (currentLang() === 'en') {
    const value = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) return date;
    return value.toLocaleDateString(numberLocale(), { month: 'short', day: 'numeric', ...(year === today.slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
  }
  const base = t('{v1}月{v2}日', { v1: Number(month), v2: Number(day) });
  return year === today.slice(0, 4) ? base : t('{v1}年{base}', { v1: Number(year), base });
}

/** `2026-10` 或 `2026-10-21` 的月份标题：「10月」，不是今年时「2025年10月」。 */
export function monthLabel(month: string, today: string = localDay()): string {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) return month;
  if (currentLang() === 'en') {
    const value = new Date(`${match[1]}-${match[2]}-01T00:00:00Z`);
    if (!Number.isFinite(value.getTime())) return month;
    return value.toLocaleDateString(numberLocale(), { month: 'short', ...(match[1] === today.slice(0, 4) ? {} : { year: 'numeric' }), timeZone: 'UTC' });
  }
  const base = t('{v1}月', { v1: Number(match[2]) });
  return match[1] === today.slice(0, 4) ? base : t('{v1}年{base}', { v1: Number(match[1]), base });
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

/**
 * 电脑端函数拼好的句子里的 `YYYY-MM-DD` 改成列表写法（「10月21日」），其余文字不动。
 * 只用在列表、标题、提示句；详情字段和表单里的日期保持原样。
 */
export function localizeDates(text: string, today: string = localDay()): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, day => dayLabel(day, today));
}

/** 规划预测金额（电脑端 forecastMoney 会取整）：未填写显示「未知」，其余沿用电脑端取整规则。 */
export function forecastMoneyText(cents: string | number | null): string {
  return cents === null || (typeof cents === 'string' && cents.trim() === '') ? UNKNOWN : forecastMoney(cents);
}
