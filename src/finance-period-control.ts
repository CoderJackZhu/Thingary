import { normalizeFinancePeriod, type FinancePeriod } from './finance-contract.ts';
import { t } from './i18n.ts';
/** Editable period kinds; mirrors FinancePeriod without introducing new settlement semantics. */
export type FinancePeriodKind = 'all' | 'year' | 'month' | 'range';

/** Local draft: only complete, valid selections become a browsing period. */
export type FinancePeriodDraft = {
  kind: FinancePeriodKind;
  year: string;
  month: string;
  from: string;
  to: string;
  includeFrom: boolean;
};

export const FINANCE_PERIOD_KINDS: readonly { value: FinancePeriodKind; label: string }[] = [
  { value: 'all', label: t('全部') },
  { value: 'year', label: t('年度') },
  { value: 'month', label: t('月度') },
  { value: 'range', label: t('自选日期') },
];

export type FinancePeriodDraftResult =
  | { ok: true; value: FinancePeriod }
  | { ok: false; error: string };

/**
 * 首页总览的期间选择（近 30 天／近 6 个月／近 1 年／今年以来／全部／自定义）也用于区间回顾。
 * 除「全部」用契约允许的最早自然日表示无起始边界外，其余预设都是含端点的闭区间。
 */
export type ReviewPeriodPreset = '30d' | '6m' | '1y' | 'ytd' | 'all' | 'custom';

export const REVIEW_PERIOD_PRESETS: readonly { value: ReviewPeriodPreset; label: string }[] = [
  { value: '30d', label: t('近 30 天') },
  { value: '6m', label: t('近 6 个月') },
  { value: '1y', label: t('近 1 年') },
  { value: 'ytd', label: t('今年以来') },
  { value: 'all', label: t('全部') },
  { value: 'custom', label: t('自定义') },
];

export const DEFAULT_REVIEW_PRESET: Exclude<ReviewPeriodPreset, 'custom'> = '1y';

/** `today` 往前推 N 个日历月的同日；目标月没有该日时截到当月最后一天。 */
export function monthsBeforeDay(today: string, months: number): string {
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), day = Number(today.slice(8, 10));
  const index = year * 12 + (month - 1) - months, targetYear = Math.floor(index / 12), targetMonth = index % 12 + 1;
  if (targetYear < 1) return '0001-01-01';
  return `${pad(targetYear, 4)}-${pad(targetMonth, 2)}-${pad(Math.min(day, daysInMonth(targetYear, targetMonth)), 2)}`;
}

/** `today` 往前推 N 个自然日；跨月按当月实际天数回退。 */
function daysBefore(today: string, days: number): string {
  let year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)), day = Number(today.slice(8, 10)) - days;
  while (day < 1) {
    if (--month < 1) { month = 12; if (--year < 1) return '0001-01-01'; }
    day += daysInMonth(year, month);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Browsing preset only: uses the existing inclusive Range wire contract. */
export function recentTwelveMonths(today: string): Extract<FinancePeriod, { kind: 'range' }> {
  normalizeFinancePeriod({ kind: 'range', from: today, to: today, includeFrom: true });
  return { kind: 'range', from: monthsBeforeDay(today, 12), to: today, includeFrom: true };
}

/** 预设映射为含端点的闭区间；「全部」用最早自然日表示无起点，终点仍取今天。 */
export function reviewPeriodRange(preset: Exclude<ReviewPeriodPreset, 'custom'>, today: string): Extract<FinancePeriod, { kind: 'range' }> {
  switch (preset) {
    case '30d': return { kind: 'range', from: daysBefore(today, 30), to: today, includeFrom: true };
    case '6m': return { kind: 'range', from: monthsBeforeDay(today, 6), to: today, includeFrom: true };
    case '1y': return recentTwelveMonths(today);
    case 'ytd': return { kind: 'range', from: `${today.slice(0, 4)}-01-01`, to: today, includeFrom: true };
    case 'all': return { kind: 'range', from: '0001-01-01', to: today, includeFrom: true };
  }
}

/** 区间回顾的五个滚动预设，供控件直接渲染；自定义单独作为一个期间类型。 */
export function reviewPeriodPresets(today: string): { id: Exclude<ReviewPeriodPreset, 'custom'>; label: string; period: FinancePeriod }[] {
  return REVIEW_PERIOD_PRESETS.filter((preset): preset is { value: Exclude<ReviewPeriodPreset, 'custom'>; label: string } => preset.value !== 'custom')
    .map(preset => ({ id: preset.value, label: preset.label, period: reviewPeriodRange(preset.value, today) }));
}

/** 已应用的期间若能对上某个预设就显示该预设，否则按自定义处理；不改变期间本身。 */
export function resolveReviewPreset(period: FinancePeriod, today: string): ReviewPeriodPreset {
  const match = reviewPeriodPresets(today).find(preset => preset.period.kind === 'range' && period.kind === 'range'
    && period.includeFrom && preset.period.from === period.from && preset.period.to === period.to);
  return match ? match.id : 'custom';
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const YEAR = /^\d{4}$/;

/** Natural-day month length; keeps the contract's leap rule without Date or UTC arithmetic. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** today is a natural day supplied by the caller; malformed input yields empty defaults, not a fabricated date. */
function dayPart(today: string): string {
  return DAY.test(today) ? today : '';
}

/** Initial all-draft: year, month and range defaults all come from today. */
export function initialFinancePeriodDraft(today: string): FinancePeriodDraft {
  const day = dayPart(today);
  return { kind: 'all', year: day.slice(0, 4), month: day.slice(0, 7), from: day, to: day, includeFrom: true };
}

/** Applied value resets the unapplied draft; the range boundary is carried over, not re-derived. */
export function draftFromFinancePeriod(period: FinancePeriod, today: string): FinancePeriodDraft {
  const draft = initialFinancePeriodDraft(today);
  switch (period.kind) {
    case 'all': return draft;
    case 'year': return { ...draft, kind: 'year', year: pad(period.year, 4) };
    case 'month': return { ...draft, kind: 'month', month: period.month };
    case 'range': return { ...draft, kind: 'range', from: period.from, to: period.to, includeFrom: period.includeFrom };
  }
}

/** Editing dates keeps the passed boundary; leaving range and returning restores the inclusive default. */
export function switchFinancePeriodKind(draft: FinancePeriodDraft, kind: FinancePeriodKind): FinancePeriodDraft {
  if (kind === draft.kind) return draft;
  return kind === 'range' ? { ...draft, kind, includeFrom: true } : { ...draft, kind };
}

/** Final guard reuses the contract validator so the control cannot invent a period the contract rejects. */
function guard(period: FinancePeriod): FinancePeriodDraftResult {
  try {
    normalizeFinancePeriod(period);
    return { ok: true, value: period };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'RangeError') return { ok: false, error: '期间无效，请检查填写的日期。' };
    throw error;
  }
}

function dateIssue(text: string): 'format' | 'field' | 'day' | '' {
  const match = DAY.exec(text);
  if (!match) return 'format';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return 'field';
  if (day < 1 || day > daysInMonth(year, month)) return 'day';
  return '';
}

function dateError(label: string, text: string): string {
  switch (dateIssue(text)) {
    case 'format': return `${label}格式应为 YYYY-MM-DD。`;
    case 'field': return `${label}的年份或月份无效，年份应在 0001–9999，月份应在 01–12。`;
    case 'day': return `${label}不存在，请检查该月天数。`;
    default: return '';
  }
}

/** Validates the draft into a contract period or a Chinese field message; invalid drafts never produce a value. */
export function financePeriodFromDraft(draft: FinancePeriodDraft): FinancePeriodDraftResult {
  switch (draft.kind) {
    case 'all':
      return guard({ kind: 'all' });
    case 'year': {
      const text = draft.year.trim();
      if (!YEAR.test(text) || Number(text) < 1) return { ok: false, error: '请输入 4 位年份（0001–9999）。' };
      return guard({ kind: 'year', year: Number(text) });
    }
    case 'month': {
      const text = draft.month.trim();
      if (!MONTH.test(text)) return { ok: false, error: '月份格式应为 YYYY-MM。' };
      const year = Number(text.slice(0, 4)), month = Number(text.slice(5, 7));
      if (year < 1 || month < 1 || month > 12) return { ok: false, error: '输入的月份无效，年份应在 0001–9999，月份应在 01–12。' };
      return guard({ kind: 'month', month: text });
    }
    case 'range': {
      const from = draft.from.trim(), to = draft.to.trim();
      if (!from || !to) return { ok: false, error: '请填写开始日期和结束日期。' };
      const fromError = dateError('开始日期', from);
      if (fromError) return { ok: false, error: fromError };
      const toError = dateError('结束日期', to);
      if (toError) return { ok: false, error: toError };
      if (from > to) return { ok: false, error: '开始日期不能晚于结束日期。' };
      if (!draft.includeFrom && from === to) return { ok: false, error: '不含起始日时，开始日期必须早于结束日期。' };
      return guard({ kind: 'range', from, to, includeFrom: draft.includeFrom });
    }
  }
}

/** Readable applied-period summary; all stays unbounded instead of showing a borrowed range. */
export function describeFinancePeriod(period: FinancePeriod): string {
  switch (period.kind) {
    case 'all': return '全部期间（不限定开始与结束）';
    case 'year': return `${pad(period.year, 4)} 年`;
    case 'month': return `${period.month.slice(0, 4)} 年 ${Number(period.month.slice(5, 7))} 月`;
    case 'range': return period.includeFrom
      ? `${period.from} 至 ${period.to}（含起始日，含结束日）`
      : `不含起始日，${period.from} 之后至 ${period.to}（含结束日）`;
  }
}
