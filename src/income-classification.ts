import type { IncomeCategory, IncomeFields } from './plan.ts';

export const incomeCategories: Record<IncomeCategory, string> = {
  unclassified: '未分类', non_investment: '工作及其他非投资收入', interest: '利息',
  cash_dividend: '现金分红', other_investment: '其他投资现金收入',
};
export const isInvestmentIncome = (f: Pick<IncomeFields, 'category'>) =>
  f.category === 'interest' || f.category === 'cash_dividend' || f.category === 'other_investment';

/** A category change never silently deletes a previously entered factual deposit. */
export function classifyIncome(f: IncomeFields, category: IncomeCategory): IncomeFields {
  return { ...f, category, destination: isInvestmentIncome({ category }) ? f.destination ?? 'unknown' : null,
    receiving_account_id: isInvestmentIncome({ category }) ? f.receiving_account_id ?? null : null };
}

export function incomeClassificationIssue(f: IncomeFields): string | null {
  if (!isInvestmentIncome(f)) return null;
  if (f.destination === 'transferred' && f.source_account_id && f.source_account_id === f.receiving_account_id)
    return '转到其他账户时，接收账户不能与来源账户相同。';
  return null;
}

export function incomeCategoryTotals(rows: { fields: IncomeFields }[]): { category: IncomeCategory; cents: string; count: number }[] {
  return (Object.keys(incomeCategories) as IncomeCategory[]).map(category => {
    const selected = rows.filter(r => (r.fields.category ?? 'unclassified') === category);
    return { category, cents: selected.reduce((sum, r) => sum + BigInt(r.fields.net_cents), 0n).toString(), count: selected.length };
  }).filter(r => r.count > 0);
}
