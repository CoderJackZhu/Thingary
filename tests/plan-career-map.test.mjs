import test from 'node:test';
import assert from 'node:assert/strict';
import { careerSources, careerDraft } from '../src/career-preview/fixtures.ts';
import { windowMap, minWindow, maxGap, closeMonths, judge, delayTarget, ageMonthsAt, missingItems } from '../src/plan-career-map.ts';
import { evaluateCareerScenario } from '../src/plan-career.ts';

// Fictional fixture: 600k at 2026-09-30, +15k/month, goal 50 (2044-10) with 3750/month for 480 months = 1.8M, zero returns.
const direct = (l = '0') => { const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = l; return d; };

test('M01 minimum window matches the closed form: 600k + 15k*k >= 1.8M gives k = 80 contributions, so the window closes at 2033-06', () => {
  const x = minWindow(careerSources(), direct());
  assert.deepEqual(x, { status: 'found', months: 81, close_month: '2033-06' });
  const m = windowMap(careerSources(), direct(), ['2033-05', '2033-06', '2033-07'], ['0']);
  assert.deepEqual(m.rows[0].map(c => c.verdict), ['short', 'meets', 'meets']);
  assert.equal(m.rows[0][0].shortfall_cents, 1_500_000);
});

test('M02 the map is monotone in the close month when the current contribution beats the post-window one', () => {
  const s = careerSources(), closes = closeMonths(s, 12), m = windowMap(s, direct(), closes, ['-100000', '0', '500000']);
  assert.equal(closes[0], '2026-09');
  for (const row of m.rows) { const v = row.map(c => c.verdict); const first = v.indexOf('meets'); if (first >= 0) assert.ok(v.slice(first).every(x => x === 'meets'), v.join()); }
  // a larger post-window contribution can only help
  const need = row => row.findIndex(c => c.verdict === 'meets');
  assert.ok(need(m.rows[2]) <= need(m.rows[1]) && need(m.rows[1]) <= need(m.rows[0]));
});

test('M03 longest gap: with the required 4642.86/month after a 12 month gap, 12 months holds and 13 does not', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '464286';
  assert.deepEqual(maxGap(careerSources(), d), { status: 'found', months: 12, limit: 'goal' });
  d.gap_months = 13; assert.equal(judge(evaluateCareerScenario(careerSources(), d)).verdict, 'short');
});

test('M04 longest gap reports cash as the limit when funds run out first, and none when the gap is already too long', () => {
  const s = careerSources(); s.profile.value.saved.profile.retire.basic.start.available_cents = '1500000';
  const d = careerDraft(); d.transition_month = '2026-10'; d.recovery.monthly_cents = '100000000'; d.gap.spend_cents = '1000000';
  const x = maxGap(s, d); assert.equal(x.status, 'found'); assert.equal(x.limit, 'cash');
  const t = careerSources(); t.profile.value.saved.profile.retire.spend_cents = '5000000';
  const e = careerDraft(); e.recovery.monthly_cents = '0';
  assert.deepEqual(maxGap(t, e), { status: 'none', reason: 'goal' });
});

test('M05 undefined searches say so instead of guessing', () => {
  const d = direct(); d.recovery.monthly_cents = null; assert.equal(minWindow(careerSources(), d).status, 'blocked');
  assert.equal(minWindow(careerSources(), direct('1500000')).status, 'already_met');
  const e = direct(); e.recovery.monthly_cents = null; assert.equal(maxGap(careerSources(), e).status, 'blocked');
  const s = careerSources(); s.profile.value.saved.profile.retire.spend_cents = '5000000';
  assert.equal(minWindow(s, direct()).status, 'not_reachable');
});

test('M06 nothing is mutated', () => {
  const s = careerSources(), d = direct(), frozen = structuredClone({ s, d });
  minWindow(s, d); windowMap(s, d, ['2030-01'], ['0']); maxGap(s, careerDraft());
  assert.deepEqual({ s, d }, frozen);
});

test('M07 severance and a limited benefit enter the gap once: 120k lump -> need (1.8M-1.14M)/168; 5k x 6 -> (1.8M-1.05M)/168', () => {
  const need = d => { const x = evaluateCareerScenario(careerSources(), d); return { x, v: x.requirement.value.monthly_cents }; };
  const d = careerDraft(); assert.equal(need(d).v, '464286');
  d.gap.extra_income = { lump_cents: '12000000', benefit_monthly_cents: null, benefit_months: null };
  const a = need(d); assert.equal(a.v, '392858'); // the lump lands at month end, after the first start-of-month payment, so the low point moves to 1.14M - 10k
  assert.equal(a.x.cash.value.minimum_cents, '113000000');
  d.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: 6 };
  assert.equal(need(d).v, '446429');
  d.gap.extra_income.benefit_months = 13; assert.equal(evaluateCareerScenario(careerSources(), d).requirement.status, 'ready', 'benefit stops when the gap ends');
  d.gap.extra_income = { lump_cents: '-1', benefit_monthly_cents: null, benefit_months: null }; assert.equal(evaluateCareerScenario(careerSources(), d).requirement.status, 'blocked');
});


test('M10 a gap whose payment check cannot run is blocked, never a pass or a length limit', () => {
  const d = careerDraft(); d.recovery.monthly_cents = '464286';
  assert.equal(judge(evaluateCareerScenario(careerSources(), d)).verdict, 'meets');
  d.liquid_funds_confirmed = false;
  const j = judge(evaluateCareerScenario(careerSources(), d)); assert.equal(j.verdict, 'blocked'); assert.ok(j.issues.length);
  assert.equal(maxGap(careerSources(), d).status, 'blocked');
  const m = windowMap(careerSources(), { ...d, gap_months: 6 }, ['2029-10'], ['464286']); assert.equal(m.rows[0][0].verdict, 'blocked');
});

test('M11 a lump sum counts with or without a gap; benefit duration must be confirmed and zero gap has zero benefit', () => {
  const need = d => evaluateCareerScenario(careerSources(), d).requirement;
  const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = '0';
  assert.equal(need(d).value.monthly_cents, '366667');
  d.gap.extra_income = { lump_cents: '12000000', benefit_monthly_cents: null, benefit_months: null };
  assert.equal(need(d).value.monthly_cents, '300000', '120k over the 180 months after the change');
  d.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: null };
  assert.equal(need(d).status, 'blocked');
  d.gap.extra_income.benefit_months = 3; assert.equal(need(d).value.monthly_cents, '366667', 'zero gap receives no benefit');
  const e = careerDraft(); e.gap.extra_income = { lump_cents: null, benefit_monthly_cents: '500000', benefit_months: null };
  assert.equal(need(e).status, 'blocked', 'amount without months');
  e.gap.extra_income.benefit_months = 6; assert.equal(need(e).status, 'ready');
});

test('M13 when no pre-target change meets the goal, do not claim the unchanged baseline succeeds', () => {
  const s = careerSources(); s.profile.value.saved.profile.retire.spend_cents = '600000';
  const d = careerDraft(); d.gap_months = 0; d.recovery.monthly_cents = '-100000000';
  assert.equal(minWindow(s, d).status, 'not_reachable');
  assert.match(minWindow(s, d).message, /未据此判断/);
});

test('M14 explicit monthly target concession finds 2048-03, rejects the previous month, and leaves the original untouched', () => {
  const s = careerSources(), d = careerDraft(); d.recovery.monthly_cents = '300000';
  const frozen = structuredClone({ s, d });
  const x=delayTarget(s,d);assert.equal(x.status,'found');assert.equal(x.month,'2048-03');assert.equal(x.delay_months,41);const earlier=structuredClone(s);earlier.profile.value.saved.profile.retire.simplified.time.target_month='2048-02';assert.equal(judge(evaluateCareerScenario(earlier,d)).verdict,'short');
  assert.deepEqual({ s, d }, frozen);
  d.recovery.monthly_cents = '464286'; assert.deepEqual(delayTarget(s, d), { status: 'already_met' });
  d.recovery.monthly_cents = '0'; assert.equal(delayTarget(s, d, 55).status, 'not_found');
  d.recovery.monthly_cents = null; assert.equal(delayTarget(s, d).status, 'blocked');
});

test('M15 age at a month', () => {
  const s=careerSources();assert.equal(ageMonthsAt(s,'2033-06'),null);s.profile.value.saved.profile.retire.simplified.time.reference={month:'2026-10',age_months:384};assert.equal(ageMonthsAt(s,'2033-06'),(2033-1994)*12+(6-10));
});

test('M16 one-off inflows anywhere on the timeline count once: 120k in 2028-06 lowers the need to (1.8M-1.14M)/168 and closes the window 8 months earlier', () => {
  const d = careerDraft(); d.lumps = [{ month: '2028-06', cents: '12000000' }];
  assert.equal(evaluateCareerScenario(careerSources(), d).requirement.value.monthly_cents, '392858');
  const e = careerDraft(); e.gap_months = 0; e.recovery.monthly_cents = '0'; e.lumps = [{ month: '2028-06', cents: '12000000' }];
  assert.deepEqual(minWindow(careerSources(), e), { status: 'found', months: 73, close_month: '2032-10' });
  for (const bad of [{ month: '2026-08', cents: '100' }, { month: '2044-10', cents: '100' }, { month: '2030-13', cents: '100' }, { month: '2030-01', cents: '-5' }]) {
    const f = careerDraft(); f.lumps = [bad]; assert.equal(evaluateCareerScenario(careerSources(), f).requirement.status, 'blocked', JSON.stringify(bad));
  }
  const g = careerDraft(); g.lumps = Array.from({ length: 25 }, () => ({ month: '2028-06', cents: '1' })); assert.equal(evaluateCareerScenario(careerSources(), g).requirement.status, 'blocked');
});

test('R01 minimum window does not apply recovery insurance to the current working stage', () => {
  const s=careerSources(), d=direct(); s.profile.value.saved.profile.retire.spend_cents='750000';
  d.recovery.insurance={monthly_cents:'200000',included:false};
  const result=minWindow(s,d); assert.equal(result.status,'found');
  d.transition_month=result.close_month; assert.equal(judge(evaluateCareerScenario(s,d)).verdict,'meets');
  const month=Number(result.close_month.slice(0,4))*12+Number(result.close_month.slice(5))-2;
  d.transition_month=`${Math.floor(month/12)}-${String(month%12+1).padStart(2,'0')}`;
  assert.equal(judge(evaluateCareerScenario(s,d)).verdict,'short');
});

test('R02 benefit cap participates in gap search, including feasible ranges that do not start at zero', () => {
  const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='0';
  d.gap.extra_income={lump_cents:null,benefit_monthly_cents:'10000000',benefit_months:12};
  const result=maxGap(s,d);
  assert.deepEqual(result,{status:'found',months:54,limit:'goal',ranges:[{from:8,to:54}]});
  for(const [months,expected] of [[0,'short'],[7,'short'],[8,'meets'],[54,'meets'],[55,'short']]){
    d.gap_months=months;assert.equal(judge(evaluateCareerScenario(s,d)).verdict,expected);
  }
});

test('R03 explicitly included insurance is not deducted twice; extra cost changes the feasible gap', () => {
  const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='600000';
  const cost=(amount,included)=>({...structuredClone(d),gap:{...d.gap,insurance:{monthly_cents:amount,included}}});
  assert.equal(maxGap(s,cost('200000',true)).months,26);assert.equal(maxGap(s,cost('200000',false)).months,23);assert.equal(maxGap(s,cost(null,false)).status,'blocked');
});

test('R04 money in a closed anchor month must not be silently accepted, while future money is counted', () => {
  const s=careerSources(),d=careerDraft();d.lumps=[{month:'2026-09',cents:'12000000'}];
  assert.equal(evaluateCareerScenario(s,d).requirement.status,'blocked');
  d.lumps[0].month='2026-10';assert.equal(evaluateCareerScenario(s,d).requirement.value.monthly_cents,'392858');
});

test('R05 search evaluation skips only requirement solving, preserving cash, prefix and prediction', () => {
  for(const mode of ['ready','prefix','unknown']){
    const s=careerSources(),d=careerDraft();d.recovery.monthly_cents='600000';
    if(mode==='prefix'){s.profile.value.saved.profile.retire.basic.start.available_cents='500000';d.transition_month='2026-10';}
    if(mode==='unknown')d.liquid_funds_confirmed=false;
    const full=evaluateCareerScenario(s,d), fast=evaluateCareerScenario(s,d,{requirement:'skip'});
    assert.deepEqual(judge(full),judge(fast));assert.deepEqual(full.cash,fast.cash);
    assert.deepEqual(full.prediction.value?.outcome,fast.prediction.value?.outcome);
  }
});

test('R08 missing items: the savings estimate is never assumable, cash expenses are never assumable, a zero gap needs no gap insurance', () => {
  const d = careerDraft(); d.gap.insurance = { monthly_cents: null, included: false }; d.recovery.insurance = { monthly_cents: null, included: false }; d.recovery.monthly_cents = null;
  assert.deepEqual(missingItems(d, true).map(m => m.assumable), [false, false, false]);
  assert.deepEqual(missingItems(d, false).map(m => m.assumable), [false], 'only the relevant gap expense is asked when the recovery estimate is not needed');
  d.gap_months = 0; assert.equal(missingItems(d, false).length, 0);
  const done = careerDraft(); assert.deepEqual(missingItems(done, true), [{ label: '找到新工作后每月能攒多少', assumable: false }]);
  done.recovery.monthly_cents = '300000'; assert.deepEqual(missingItems(done, true), []);
});
