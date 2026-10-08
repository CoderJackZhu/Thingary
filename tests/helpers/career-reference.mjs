// Independent test oracle. No application imports, compiled plan, ledger, or search solver.
// Scope: closed 2026-09 starting balance; 216 months to age 50; 480 retirement months.
// All amounts are integer cents at the same purchasing-power date; intermediate balances retain precision.
export function referenceCareer({ start = 60_000_000, preMonths = 36, gap = 12, current = 1_500_000, recovery = 600_000,
  spend = 1_000_000, income = 0, gapInsurance = 0, gapIncluded = false, recoveryInsurance = 0, recoveryIncluded = false,
  lump = 0, benefit = 0, benefitMonths = 0, beforeRate = 0, afterRate = 0, inflation = 0,
  pension = 0, pensionStartsAfterRetirement = 156, pensionIndexed = true, floor = null,
} = {}) {
  const growth = (1 + beforeRate) ** (1 / 12), retirementGrowth = (1 + afterRate) ** (1 / 12);
  const rows = []; let balance = start, minimum = Infinity, firstFailure = null, floorMonth = null;
  for (let m = 0; m < 216; m++) {
    const isGap = m >= preMonths && m < preMonths + gap, isRecovery = m >= preMonths + gap;
    const payment = isGap ? spend + (gapIncluded ? 0 : gapInsurance) : isRecovery ? recoveryInsurance : 0;
    const paid = balance - payment;
    if (paid < 0 && firstFailure === null) firstFailure = m;
    const received = isGap ? income + (m - preMonths < benefitMonths ? benefit : 0)
      : isRecovery ? recovery + (recoveryIncluded ? recoveryInsurance : 0) : current;
    const end = (paid > 0 ? paid * growth : paid) + received + (m === preMonths ? lump : 0);
    if (end < 0 && firstFailure === null) firstFailure = m;
    if (isGap) { minimum = Math.min(minimum, balance, paid, end); if (floor !== null && Math.min(balance, paid, end) <= floor && floorMonth === null) floorMonth = m; }
    rows.push({ m, start: balance, paid, received, end }); balance = end;
  }
  // Discount each known retirement month's net spending separately; no app pension formula.
  let required = 0;
  for (let k = 0; k < 480; k++) {
    const pensionIncome = k >= pensionStartsAfterRetirement ? pension / (pensionIndexed ? 1 : (1 + inflation) ** ((216 + k) / 12)) : 0;
    required += (375_000 - pensionIncome) / retirementGrowth ** (k + 1);
  }
  return { rows, assets: balance, required, minimum, firstFailure, floorMonth, meets: firstFailure === null && floorMonth === null && balance >= required };
}

export function referenceMaxGap(options = {}) {
  let maximum = null;
  for (let gap = 0; gap < 216 - (options.preMonths ?? 36); gap++) if (referenceCareer({ ...options, gap }).meets) maximum = gap;
  return maximum;
}
