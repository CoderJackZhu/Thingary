// Independent test oracle. No application imports, compiled plan, ledger, or search solver.
// Default fixture: closed 2026-09 balance, 216 accumulation and 480 retirement months.
// Optional partial first month, dated loan, and explicit locked-pool release; no policy formula.
// All amounts are integer cents at the same purchasing-power date; intermediate balances retain precision.
export function referenceCareer({ start = 60_000_000, preMonths = 36, gap = 12, current = 1_500_000, recovery = 600_000,
  spend = 1_000_000, income = 0, gapInsurance = 0, gapIncluded = false, recoveryInsurance = 0, recoveryIncluded = false,
  lump = 0, benefit = 0, benefitMonths = 0, beforeRate = 0, afterRate = 0, inflation = 0,
  pension = 0, pensionStartsAfterRetirement = 156, pensionIndexed = true, floor = null,
  accumulationMonths = 216, retirementMonths = 480, firstFraction = 1, retirementSpend = 375_000,
  loanPayment = 0, loanMonths = 0, loanIncluded = false, unlock = null, lumps = [], retirementIncomes = null,
} = {}) {
  const growth = (1 + beforeRate) ** (1 / 12), retirementGrowth = (1 + afterRate) ** (1 / 12);
  const rows = []; let balance = start, minimum = Infinity, firstFailure = null, floorMonth = null;
  for (let m = 0; m < accumulationMonths; m++) {
    const isGap = m >= preMonths && m < preMonths + gap, isRecovery = m >= preMonths + gap;
    const fraction = m === 0 ? firstFraction : 1;
    const loan = m < loanMonths ? loanPayment : 0, reference = loanIncluded ? loanPayment : 0;
    const payment = (isGap ? spend - reference + (gapIncluded ? 0 : gapInsurance) : isRecovery ? recoveryInsurance : 0) * fraction + loan;
    const paid = balance - payment;
    if (paid < 0 && firstFailure === null) firstFailure = m;
    const received = isGap ? income
      : isRecovery ? recovery + (recoveryIncluded ? recoveryInsurance : 0) : current;
    const available = paid + (unlock?.month === m ? unlock.cents : 0);
    const end = (available > 0 ? available * growth ** fraction : available) + (received + (!isGap ? reference : 0)) * fraction + (m === preMonths ? lump : 0) + (isGap && m - preMonths < benefitMonths ? benefit : 0) + lumps.filter(x => x.month === m).reduce((sum, x) => sum + x.cents, 0);
    if (end < 0 && firstFailure === null) firstFailure = m;
    if (isGap) { minimum = Math.min(minimum, balance, paid, end); if (floor !== null && Math.min(balance, paid, end) <= floor && floorMonth === null) floorMonth = m; }
    rows.push({ m, start: balance, paid, received, end }); balance = end;
  }
  // Discount each known retirement month's net spending separately; no app pension formula.
  // Explicit test schedule uses months relative to the goal, including negative starts.
  const incomeAt = k => (retirementIncomes ?? [{ monthly: pension, start: pensionStartsAfterRetirement, end: null, indexed: pensionIndexed }])
    .filter(x => k >= x.start && (x.end === null || k < x.end))
    .reduce((sum, x) => sum + x.monthly / (x.indexed ? 1 : (1 + inflation) ** ((accumulationMonths - 1 + firstFraction + k) / 12)), 0);
  let required = 0;
  for (let k = retirementMonths - 1; k >= 0; k--) {
    const pensionIncome = incomeAt(k);
    // Work backwards to include the bridge to the release month; a later pool cannot finance earlier spending.
    required = Math.max(0, (required + retirementSpend - pensionIncome) / retirementGrowth - (unlock?.month === accumulationMonths + k ? unlock.cents : 0));
  }
  const retirementRows = []; let retiredBalance = balance;
  for (let k = 0; k < retirementMonths; k++) {
    const pensionIncome = incomeAt(k);
    const released = unlock?.month === accumulationMonths + k ? unlock.cents : 0;
    const available = Math.max(0, retiredBalance + released) * retirementGrowth + pensionIncome;
    const unfunded = Math.max(0, retirementSpend - available), end = Math.max(0, available - retirementSpend);
    retirementRows.push({ k, start: retiredBalance, released, end, unfunded }); retiredBalance = end;
  }
  return { rows, retirementRows, assets: balance, required, minimum, firstFailure, floorMonth, meets: firstFailure === null && floorMonth === null && balance >= required };
}

export function referenceMaxGap(options = {}) {
  let maximum = null;
  for (let gap = 0; gap < (options.accumulationMonths ?? 216) - (options.preMonths ?? 36); gap++) if (referenceCareer({ ...options, gap }).meets) maximum = gap;
  return maximum;
}
