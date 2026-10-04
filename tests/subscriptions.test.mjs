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

test('default subscription is ongoing and the first service period lasts one calendar month',async()=>{
  const { firstSubscriptionPeriod }=await import('../src/recurring-model.ts');
  const f=blankPlan('2026-10-04');
  assert.equal(f.interval_months,1);assert.equal(f.end_date,null);
  assert.deepEqual(firstSubscriptionPeriod(f),['2026-10-04','2026-11-03']);
  assert.deepEqual(firstSubscriptionPeriod(blankPlan('2024-01-31')),['2024-01-31','2024-02-28']);
  assert.deepEqual(firstSubscriptionPeriod(blankPlan('2025-01-31')),['2025-01-31','2025-02-27']);
  for(const service_start of ['', '2026-02-31', '2026-13-01']) assert.equal(firstSubscriptionPeriod({...f,service_start}),null);
});

test('ongoing payment reminders are quiet without removing dues, history or financial totals',async()=>{
  const { paymentReminders }=await import('../src/recurring.ts');
  const plans=[{id:'new',fields:blankPlan('2026-10-04')},{id:'old',fields:{...blankPlan('2026-10-04'),service_start:null,coverage_start:null}},{id:'finite',fields:{...blankPlan('2026-10-04'),end_date:'2027-01-01'}},{id:'rent',fields:{...blankPlan('2026-10-04'),category:'rent'}}];
  const o={plans,due:plans.map(p=>({plan_id:p.id})),upcoming:plans.map(p=>({plan_id:p.id})),payments:[{id:'old-payment',amount_cents:'14000'}],annual_cents:'123456'};
  const before=structuredClone(o),reminders=paymentReminders(o);
  assert.deepEqual(reminders.due.map(x=>x.plan_id),['finite','rent']);assert.deepEqual(reminders.upcoming.map(x=>x.plan_id),['finite','rent']);assert.deepEqual(o,before);
  const v={fields:{kind:'subscription',plan_id:'old'},plan:plans[1],status:'ongoing',valid_until:'2024-02-01'};
  assert.equal(validityText(v),'持续进行，无结束日期');
  v.plan={...plans[1],fields:{...plans[1].fields,end_date:'2027-01-01'}};v.status='active';
  assert.equal(validityText(v),'至 2027-01-01');
});

test('past payment dates remain ongoing; an explicit historical end stops future periods', () => {
  const today='2026-10-05';
  const f={...blankPlan(today),service_start:'2024-01-20',first_due:'2026-01-20',coverage_start:'2026-01-20'};
  assert.ok(scheduleDates(f,today,'2027-10-05').length > 0);
  const ended={...f,end_date:'2026-02-19'};
  assert.equal(scheduleDates(ended,'2024-01-20',today).length,25);
  assert.deepEqual(scheduleDates(ended,today,'2027-10-05'),[]);
  assert.equal(ended.first_due,f.first_due);
  assert.equal(ended.coverage_start,f.coverage_start);
  const future={...f,end_date:'2027-02-19'};
  assert.ok(scheduleDates(future,today,'2027-10-05').length > 0);
});

test('subscription cost distinguishes estimates, unknown amounts and recorded zero payments', async () => {
  const { cumulativeCost, paymentScheduleText, virtualStatusText } = await import('../src/virtual.ts');
  const v={fields:{kind:'subscription'},status:'expired',spent_cents:'0',paid_count:0,plan:{estimated_cents:'350000',fields:{end_date:'2026-02-19',paused:false},next_due:null}};
  assert.deepEqual(cumulativeCost(v),{estimated:true,cents:'350000'});
  assert.equal(virtualStatusText(v),'已结束');
  assert.equal(paymentScheduleText(v),'订阅已结束，不再续费');
  const copy=structuredClone(v);copy.plan.estimated_cents='0';copy.paid_count=1;
  assert.deepEqual(cumulativeCost(copy),{estimated:true,cents:'0'});
  assert.deepEqual(cumulativeCost({...v,plan:null,spent_cents:null}),{estimated:false,cents:null});
  assert.deepEqual(cumulativeCost({...v,plan:{...v.plan,estimated_cents:null},spent_cents:'12300'}),{estimated:false,cents:'12300'});
  assert.equal(virtualStatusText({...v,fields:{kind:'domain'}}),'已到期');
});
