/** Natural-day periods shared by finance records and review navigation. */
export type FinancePeriod =
  | { kind: 'all' }
  | { kind: 'year'; year: number }
  | { kind: 'month'; month: string }
  | { kind: 'range'; from: string; to: string; includeFrom: boolean };

export type FinanceDateRange = { from: string; to: string; includeFrom: boolean };

function validYear(year: number): void {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError('Invalid finance year');
}

function monthDays(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validMonth(value: string): { year: number; month: number } {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw new RangeError('Invalid finance month');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  validYear(year);
  if (month < 1 || month > 12) throw new RangeError('Invalid finance month');
  return { year, month };
}

function validDate(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Invalid finance date');
  const { year, month } = validMonth(value.slice(0, 7));
  const day = Number(value.slice(8, 10));
  if (day < 1 || day > monthDays(year, month)) throw new RangeError('Invalid finance date');
}

/** Invalid or empty ranges throw; all has no boundary, rather than a synthetic one. */
export function normalizeFinancePeriod(period: FinancePeriod): FinanceDateRange | null {
  switch (period.kind) {
    case 'all': return null;
    case 'year': {
      validYear(period.year);
      const year = String(period.year).padStart(4, '0');
      return { from: `${year}-01-01`, to: `${year}-12-31`, includeFrom: true };
    }
    case 'month': {
      const { year, month } = validMonth(period.month);
      return { from: `${period.month}-01`, to: `${period.month}-${monthDays(year, month)}`, includeFrom: true };
    }
    case 'range': {
      validDate(period.from);
      validDate(period.to);
      if (typeof period.includeFrom !== 'boolean' || period.from > period.to || (!period.includeFrom && period.from === period.to)) {
        throw new RangeError('Invalid finance range');
      }
      return { from: period.from, to: period.to, includeFrom: period.includeFrom };
    }
  }
}

export function financePeriodContains(period: FinancePeriod, date: string | null): boolean {
  if (date === null) return false;
  validDate(date);
  const range = normalizeFinancePeriod(period);
  return range === null || ((range.includeFrom ? date >= range.from : date > range.from) && date <= range.to);
}

/** Review includes the closing day and excludes the opening snapshot day. */
export function reviewRecordsPeriod(from: string, to: string): FinancePeriod {
  const period: FinancePeriod = { kind: 'range', from, to, includeFrom: false };
  normalizeFinancePeriod(period);
  return period;
}

export type FinanceModuleInput = {
  wealth: boolean;
  expenses: boolean;
  planning: boolean;
  incomes?: boolean;
  movements?: boolean;
};

export type FinanceCapabilities = {
  accounts: boolean;
  incomeRecords: boolean;
  expenseRecords: boolean;
  movementRecords: boolean;
  review: boolean;
  goals: boolean;
  manualInvestmentReview: boolean;
  movementInvestmentReview: boolean;
};

/** Transitional defaults only: the persistence owner must pass explicit values after inheritance. */
export function financeCapabilities(input: FinanceModuleInput): FinanceCapabilities {
  const movements = (input.movements ?? input.planning) && input.wealth;
  return {
    accounts: input.wealth,
    incomeRecords: input.incomes ?? input.planning,
    expenseRecords: input.expenses,
    movementRecords: movements,
    review: input.wealth,
    goals: input.planning,
    manualInvestmentReview: input.wealth,
    movementInvestmentReview: movements,
  };
}

/** Source availability stays separate from amounts and completeness confirmation. */
export type FinanceSourceState<T> =
  | { status: 'ready'; value: T }
  | { status: 'empty' }
  | { status: 'partial'; value: T; knownCount: number; unknownCount: number }
  | { status: 'disabled'; reason: string }
  | { status: 'error'; message: string };
