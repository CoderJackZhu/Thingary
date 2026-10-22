import { reasonLabel, statusLabel } from '../../investment-review/model.ts';
import type { InvestmentReviewResultV1 } from '../../investment-review/model.ts';

export const investmentStatusLabel = (status: InvestmentReviewResultV1['status']): string => statusLabel[status];
export const reasonText = (code: string): string => reasonLabel[code] ?? code;
