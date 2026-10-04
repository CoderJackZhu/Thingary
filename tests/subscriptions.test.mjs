import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPlan, shiftMonth, suggestCoverage, scheduleDates, coverageFor } from '../src/recurring-model.ts';
import { matchesFilter, validityText, statusText } from '../src/virtual.ts';

test('prepaid one-year quarterly lease contains four payments and no extra last prepayment', () => {
  const f={...blankPlan('2026-10-04'), category:'rent',first_due:'2026-10-25',service_start:'2026-11-01',coverage_start:'2026-11-01',interval_months:3,end_date:'2027-10-31'};
  const ds=scheduleDates(f,'2026-10-04','2027-12-31');
  assert.deepEqual(ds,['2026-10-25','2027-01-25','2027-04-25','2027-07-25']);
  assert.deepEqual(coverageFor(f,ds[3]),['2027-08-01','2027-10-31']);
});
test('coverage suggestions accept advance rent and old use dates without old automatic dues', () => {
  assert.equal(suggestCoverage('2026-11-01','2026-10-25',1),'2026-11-01');
  assert.equal(suggestCoverage('2024-01-04','2026-10-04',1),'2026-10-04');
  const f={...blankPlan('2026-10-04'),service_start:'2024-01-04'};
  assert.deepEqual(scheduleDates(f,f.first_due,'2026-10-04'),['2026-10-04']);
  assert.equal(scheduleDates(f,'2024-01-04','2024-03-04').length,3);
});
test('month-end anchor survives leap February and service covers the original anchored next period',()=>{
  const f={...blankPlan('2024-01-31')};
  assert.equal(shiftMonth('2024-01-31',1),'2024-02-29');
  assert.deepEqual(scheduleDates(f,'2024-01-01','2024-04-30'),['2024-01-31','2024-02-29','2024-03-31','2024-04-30']);
  assert.deepEqual(coverageFor(f,'2024-02-29'),['2024-02-29','2024-03-30']);
});
test('ongoing subscriptions and paused renewal keep usable filter without fabricated expiry',()=>{
  const v={fields:{kind:'subscription',plan_id:'p'},plan:{fields:{service_start:'2024-01-01',paused:false,end_date:null}},status:'ongoing',valid_until:null};
  assert.equal(statusText.ongoing,'持续订阅');assert.ok(matchesFilter(v,'valid'));assert.equal(validityText(v),'持续进行，无结束日期');
  v.plan.fields.paused=true;v.status='paused';assert.ok(matchesFilter(v,'valid'));assert.equal(validityText(v),'暂停续费，结束日期未指定');
});
