import { normalizeFinancePeriod, type FinancePeriod } from './finance-contract.ts';

/** Editable period kinds; mirrors FinancePeriod without introducing new settlement semantics. */
export type FinancePeriodKind = 'all' | 'year' | 'month' | 'range';

/** Local-only draft: nothing here reaches onChange until「应用期间」validates it. */
export type FinancePeriodDraft = {
  kind: FinancePeriodKind;
  year: string;
  month: string;
  from: string;
  to: string;
  includeFrom: boolean;
};

export const FINANCE_PERIOD_KINDS: readonly { value: FinancePeriodKind; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'year', label: '年度' },
  { value: 'month', label: '月度' },
  { value: 'range', label: '自选日期' },
];

export type FinancePeriodDraftResult =
  | { ok: true; value: FinancePeriod }
  | { ok: false; error: string };

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
