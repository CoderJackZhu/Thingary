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
  assert.deepEqual(reminders.due.map(x=>x.plan_id),['rent']);assert.deepEqual(reminders.upcoming.map(x=>x.plan_id),['rent']);assert.deepEqual(o,before);
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

// ---- 虚拟资产标签与计费（设计 §4/§6/§8）----
import { billingText, billingOf, cumulativeCost, topupSpendText, virtualStatusText } from '../src/virtual.ts';
import { firstSubscriptionPeriod, shiftDays } from '../src/recurring-model.ts';

test('免费试用：7 天含起点，计费从第 8 天开始；首期覆盖一天不少', () => {
  const f = { ...blankPlan('2026-01-01'), service_start: '2026-01-01', trial_days: 7 };
  assert.equal(shiftDays('2026-01-01', 6), '2026-01-07');
  assert.equal(shiftDays('2026-01-01', 7), '2026-01-08');
  assert.deepEqual(firstSubscriptionPeriod(f), ['2026-01-08', '2026-02-07']);
});

test('2026-10-05 固定 30 天：首期 10-05 至 11-03，下期 11-04（UTC 无漂移）', () => {
  const f = { ...blankPlan('2026-10-05'), interval_days: 30 };
  assert.deepEqual(firstSubscriptionPeriod(f), ['2026-10-05', '2026-11-03']);
  assert.equal(shiftDays('2026-10-05', 30), '2026-11-04');
});

test('闰年 2 月 29 日在自然月计数中稳定；固定天数不随闰年漂移', () => {
  assert.deepEqual(firstSubscriptionPeriod(blankPlan('2024-01-31')), ['2024-01-31', '2024-02-28']);
  const f = { ...blankPlan('2024-01-31'), interval_days: 30 };
  assert.deepEqual(firstSubscriptionPeriod(f), ['2024-01-31', '2024-02-29']);
});

test('计费方式显示与旧类型映射；周期不同不代表负担可比', () => {
  const make = (fields, plan) => ({ id: 'x', fields, plan, status: 'active', spent_cents: null, plan_name: null, plan_deleted: false, valid_until: null });
  assert.equal(billingText(billingOf(make({ billing: 'single', kind: 'license' }))), '单次购买');
  assert.equal(billingText(billingOf(make({ billing: 'topup', kind: 'general' }))), '储值');
  // 旧独立订阅：kind=subscription 但无计划 → 单次投入
  assert.equal(billingOf(make({ billing: 'single', kind: 'subscription' })), 'single');
});

test('储值投入区分：尚未记录、完全未知、仅已知部分', () => {
  const base = { id: 'x', fields: { billing: 'topup' }, status: 'active', spent_cents: null, plan_name: null, plan_deleted: false, valid_until: null };
  assert.equal(topupSpendText({ ...base, topup_count: 0 }).note, '尚未记录充值');
  assert.equal(topupSpendText({ ...base, topup_count: 1, topup_known_cents: null, topup_unknown_paid: 1 }).note, '投入未知');
  assert.deepEqual(topupSpendText({ ...base, topup_count: 2, topup_known_cents: '15000', topup_unknown_paid: 1 }), { main: '15000', note: '仅已知部分' });
  const full = topupSpendText({ ...base, topup_count: 1, topup_known_cents: '15000', topup_unknown_paid: 0 });
  assert.equal(full.main, '15000'); assert.equal(full.note, null);
  assert.equal(cumulativeCost({ ...base, topup_count: 1, topup_known_cents: null }).cents, null);
});

test('未来开始的订阅显示未开始且仍属于有效筛选', () => {
  const v = { id: 'x', fields: { kind: 'general', billing: 'subscription', plan_id: 'p' }, plan: { fields: { service_start: '2027-01-01', paused: false, end_date: null } }, status: 'future', spent_cents: null, plan_name: null, plan_deleted: false, valid_until: null };
  assert.equal(virtualStatusText(v), '未开始');
  assert.ok(matchesFilter(v, 'valid'));
});

test('今日等于最后使用日仍未结束（VA-10 边界的纯逻辑面）', () => {
  const v = { id: 'x', fields: { kind: 'subscription', billing: 'subscription', plan_id: 'p' }, plan: { fields: { service_start: '2026-09-01', paused: false, end_date: '2026-09-30' } }, status: 'expiring', spent_cents: null, plan_name: null, plan_deleted: false, valid_until: '2026-09-30' };
  // 状态由后端按日期推导；最后一天处于“即将到期”而不是已结束。
  assert.ok(matchesFilter(v, 'expiring'));
  assert.ok(!matchesFilter(v, 'expired'));
  assert.ok(matchesFilter({ ...v, status: 'expired' }, 'expired'));
});

// ---- Review R1/R6 回归 ----
test('R1 月末覆盖：第二期按原锚点网格到 Mar30，不产生空档', async () => {
  const { coverageFor } = await import('../src/recurring-model.ts');
  const f = { ...blankPlan('2026-01-31'), service_start: '2026-01-31', coverage_start: '2026-01-31' };
  assert.deepEqual(coverageFor(f, '2026-02-28'), ['2026-02-28', '2026-03-30']);
  assert.deepEqual(coverageFor(f, '2026-03-31'), ['2026-03-31', '2026-04-29']);
});

test('R6 清空未来价格发送取消载荷：未修改为 null，取消为空串，设置为值', async () => {
  const { renewalPayload } = await import('../src/virtual.ts');
  assert.equal(renewalPayload(null, ''), null, '初始无值且当前为空 → 不触碰');
  assert.equal(renewalPayload(undefined, ''), null);
  assert.equal(renewalPayload('16000', ''), '', '初始有值且清空 → 取消未生效段');
  assert.equal(renewalPayload('16000', '18000'), '18000', '有值 → 设置');
  assert.equal(renewalPayload(null, '16000'), '16000', '初始无值且填入 → 设置');
});

test('R5 永久有效与未设置有效期：新 general 区分，旧 domain 保持待补充', async () => {
  const { singleValidityText } = await import('../src/virtual.ts');
  assert.equal(singleValidityText({ fields: { perpetual: true, kind: 'general', expires: null, plan_id: null } }), '永久有效');
  assert.equal(singleValidityText({ fields: { perpetual: false, kind: 'general', expires: null, plan_id: null } }), '未设置有效期');
  // 旧 domain 的“待补充”由 validityText 的兜底分支给出。
  assert.equal(singleValidityText({ fields: { perpetual: false, kind: 'domain', expires: null, plan_id: null } }), null);
});

test('effective rule history preserves past monthly candidates after switching to quarters', async () => {
  const {planScheduleDates}=await import('../src/recurring-model.ts');
  const fields={...blankPlan('2026-01-01'),interval_months:3};
  const base={effective_date:'2026-01-01',anchor:'2026-01-01',first_due:'2026-01-01',service_start:'2026-01-01',interval_months:1,interval_days:null,trial_days:null};
  assert.deepEqual(planScheduleDates({fields,rules:[base,{...base,effective_date:'2026-05-01',anchor:'2026-05-01',first_due:'2026-05-01',interval_months:3}]},'2026-02-01','2026-10-05'), ['2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-08-01']);
});

test('trial payment range excludes the free window and end suggestion uses the current period', async () => {
  const {suggestedFinalDay}=await import('../src/recurring-model.ts');
  const f={...blankPlan('2026-01-01'),trial_days:7,first_due:'2026-01-08',coverage_start:'2026-01-08'};
  assert.deepEqual(scheduleDates(f,'2025-12-01','2026-02-09'),['2026-01-08','2026-02-08']);
  assert.equal(suggestedFinalDay(blankPlan('2024-01-01'),'2026-10-05'),'2026-10-31');
});

test('subscriptions with an explicit final day remain quiet unless a one-time reminder is enabled',async()=>{
  const {paymentReminders}=await import('../src/recurring.ts');
  const plans=[{id:'subscription',fields:{...blankPlan('2026-01-01'),end_date:'2026-12-31'}},{id:'rent',fields:{...blankPlan('2026-01-01'),category:'rent',end_date:'2026-12-31'}}];
  const result=paymentReminders({plans,due:[{plan_id:'subscription'},{plan_id:'rent'}],upcoming:[{plan_id:'subscription'}]});
  assert.deepEqual(result.due,[{plan_id:'rent'}]);assert.deepEqual(result.upcoming,[]);
});

test('denied notification permission preserves reminder settings and reports delivery failure',async()=>{
  const {saveReminderWithPermission}=await import('../src/virtual.ts');
  const calls=[];
  const warning=await saveReminderWithPermission(true,async()=>{calls.push('permission');throw new Error('denied');},async()=>{calls.push('save');});
  assert.deepEqual(calls,['permission','save']);assert.match(warning,/denied/);
  const cleared=[];
  assert.equal(await saveReminderWithPermission(false,async()=>cleared.push('permission'),async()=>cleared.push('save')),null);
  assert.deepEqual(cleared,['save']);
});

test('unknown reminder save propagates without reporting a successful settings update',async()=>{
  const {saveReminderWithPermission}=await import('../src/virtual.ts');
  await assert.rejects(saveReminderWithPermission(true,async()=>{throw new Error('denied');},async()=>{throw new Error('result unknown');}),/result unknown/);
});
