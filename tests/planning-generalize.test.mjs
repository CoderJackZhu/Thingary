import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const currentFixture = raw => structuredClone(raw);
import { conditionChips } from '../src/planning-first-run.ts';
import { unknownCapabilityFixture } from '../src/plan-basic-fixtures.ts';
import { runtime } from './planning-component-runtime.mjs';
const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const sources = () => currentFixture(raw, 'normal');
const saved = s => s.profile.value.saved;
const click = (r, name) => { r.button(name).props.onClick(); r.render(); };
const enter = (r, type, label, value) => { r.find(type, p => p.label === label || p['aria-label'] === label).props.onChange(type === 'input' ? { target: { value } } : value); r.render(); };

test('more assumptions preserves existing values and removes unsupported allocation presets', async () => {
  const source = sources();
  source.profile.value.saved.profile.retire.real_return_before_hundredths = 150;
  source.profile.value.saved.profile.retire.real_return_after_hundredths = 100;
  source.profile.value.saved.profile.retire.volatility_hundredths = 750;
  const r = runtime('PlanningSetup', { sources: source, editMode: true, initialStep: 5 });
  assert.equal(r.button('含股票基金（3% / 2%）'), undefined);
  assert.equal(r.find('input', p => p['aria-label'] === '退休前实际年收益'), undefined);
  assert.match(r.text(r.render()), /市场模拟年波动率/);
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  const basic = r.calls.at(-1).fields.basic;
  assert.equal(basic.real_return_before_hundredths, 150);
  assert.equal(basic.real_return_after_hundredths, 100);
  assert.equal(basic.volatility_hundredths, 750);
});

test('zero real return chip says money only keeps pace with inflation', () => {
  const p = saved(sources());
  p.profile.retire.real_return_before_hundredths = 0; p.profile.retire.real_return_after_hundredths = 0;
  assert.match(conditionChips(p, unknownCapabilityFixture, c => c).find(c => c.step === 5).text, /（只跑平通胀）/);
  p.profile.retire.real_return_before_hundredths = 150;
  assert.doesNotMatch(conditionChips(p, unknownCapabilityFixture, c => c).find(c => c.step === 5).text, /只跑平/);
});

test('setup step 3 subtitle distinguishes real inventory from manual amounts', () => {
  const subtitle = r => { const p = r.nodes().find(n => n.type === 'p' && n.props.className === 'muted' && /确认可动用的现金和投资账户|还没有完整盘点/.test(r.text(n))); return p ? r.text(p) : ''; };
  const withSnapshot = currentFixture(raw, 'empty');
  const inventory = runtime('PlanningSetup', { sources: withSnapshot, snapshot: withSnapshot.snapshot.value, initialStep: 2 });
  assert.match(subtitle(inventory), /^确认可动用的现金和投资账户，保存后用于规划，不改变实际余额。$/);
  const manual = runtime('PlanningSetup', { sources: currentFixture(raw, 'empty'), initialStep: 2 });
  assert.match(subtitle(manual), /^还没有完整盘点：先填现在能用来准备退休的钱和截至日期，不会创建盘点，也不会和账户余额相加。$/);
  assert.notEqual(subtitle(inventory), subtitle(manual));
});

test('other future income saves its explicit month and amount with the whole setup', async () => {
 const r=runtime('PlanningSetup',{sources:sources(),initialStep:3});
 r.find('input',p=>p['aria-label']==='填写预计收入').props.onChange();r.render();
 click(r,'+ 其他收入');
 enter(r,'input','收入名称','配偶养老金');enter(r,'CentInput','每月预计净到账金额','300000');enter(r,'MonthInput','开始领取时间','2052-06');
 click(r,'完成');r.find('form').props.onSubmit({preventDefault(){}});await r.settle();
 const i=r.calls[0].fields.simplified.future_incomes.find(i=>i.name==='配偶养老金');
 assert.equal(i.role,'other');assert.equal(i.monthly_cents,'300000');assert.equal(i.start_month,'2052-06');
});

import { withSpendItem, withoutSpendItem, draftOf } from '../src/planning-basic-forms.ts';
import { prepareBasicPlan } from '../src/plan-basic.ts';
import { table } from '../src/plan-ledger.ts';

test('spend item saves explicit months and extra treatment atomically', async () => {
 const r=runtime('PlanningSetup',{sources:sources(),editMode:true,initialStep:1});
 click(r,'+ 添加一笔阶段性支出');click(r,'子女教育');
 enter(r,'CentInput','阶段性支出每月金额','300000');enter(r,'MonthInput','支出开始月份','2051-01');enter(r,'MonthInput','支出结束月份','2055-01');
 click(r,'加入列表');r.button('保存，查看结果').props.onClick();await r.settle();
 const f=r.calls.at(-1).fields,i=f.budget.spend_items.find(i=>i.label==='子女教育');
 assert.equal(i.start_month,'2051-01');assert.equal(i.end_month,'2055-01');assert.equal(i.time_unconfirmed,false);
 assert.deepEqual(f.basic.basic.retirement_costs.find(c=>c.source_id===`spend:${i.id}`),{source_id:`spend:${i.id}`,treatment:'extra',reference_cents:null});
});

test('extra spend item only raises retirement-month spending and removal drops its scope', () => {
  const s = sources(), base = saved(s), d = draftOf(base, s.snapshot.value);
  const item = { id: 'fx-care', label: '医疗与护理', monthly_cents: '100000', start_month: null, end_month: null, time_unconfirmed: false, inflation_hundredths: null, essential: true };
  const added = withSpendItem(d, item);
  assert.equal(added.retScopes['spend:fx-care'].treatment, 'extra');
  assert.equal(withoutSpendItem(added, 'fx-care').retScopes['spend:fx-care'], undefined);
  const withItem = structuredClone(s), r = saved(withItem).profile.retire;
  r.spend_items = [item]; r.basic.retirement_costs = [...r.basic.retirement_costs, { source_id: 'spend:fx-care', treatment: 'extra', reference_cents: null }];
  const p0 = prepareBasicPlan(s).plan.value, p1 = prepareBasicPlan(withItem).plan.value;
  const t0 = table(p0.compile(0, p0.before, p0.after)).spend, t1 = table(p1.compile(0, p1.before, p1.after)).spend;
  assert.ok(Math.abs(t1.at(-1) - t0.at(-1) - 100000) < 1e-6);
  assert.equal(p1.compile(0, p1.before, p1.after).annotations.some(a => a.source_ids?.includes('spend:fx-care')), false);
});

import { contributionVerdict } from '../src/planning-basic-view.ts';
import { buildBasicCapabilities } from '../src/plan-basic.ts';

test('contribution verdict compares saved estimate with requirement; unknown is never zero', () => {
  const fmt = c => `¥${c}`, found = { status: 'found', monthly_cents: '260890', before_hundredths: 0, after_hundredths: 0 };
  assert.deepEqual(contributionVerdict(found, null, fmt), { text: '你估计每月能存多少：还没填', tone: 'plain', unknown: true });
  assert.deepEqual(contributionVerdict(found, '500000', fmt), { text: '你估计每月能存 ¥500000，比所需多 ¥239110', tone: 'good', unknown: false });
  assert.deepEqual(contributionVerdict(found, '260890', fmt), { text: '你估计每月能存 ¥260890，正好够', tone: 'good', unknown: false });
  assert.deepEqual(contributionVerdict(found, '0', fmt), { text: '你估计每月能存 ¥0，每月还差 ¥260890', tone: 'warn', unknown: false });
  assert.deepEqual(contributionVerdict(found, '-100000', fmt), { text: '你估计每月要取用 ¥100000，每月还差 ¥360890', tone: 'warn', unknown: false });
  const none = { status: 'no_positive_contribution', monthly_cents: '0', before_hundredths: 0, after_hundredths: 0 };
  assert.equal(contributionVerdict(none, '0', fmt).tone, 'good');
  assert.equal(contributionVerdict(none, '-1', fmt).tone, 'plain');
  assert.equal(contributionVerdict({ status: 'search_not_found', search_limit_cents: '1', before_hundredths: 0, after_hundredths: 0 }, '500000', fmt).text, '你估计每月能存 ¥500000');
});

test('goal page compares saved contribution with required amount and exposes a scoped edit', () => {
  for (const [contribution, pattern] of [['900000000', /每月余量约/], [null, /还没填/]]) {
    const s = sources(); saved(s).profile.retire.basic.contribution.monthly_cents = contribution;
    const caps = buildBasicCapabilities(s);
    assert.equal(caps.requirement.value?.set.status, 'found');
    const r = runtime('PlanningBasicGoals', { sources: s, saved: saved(s), openSetup() {}, onGoto() {} }, undefined, () => caps);
    const node = r.find('article', p => p['aria-label'] === '退休目标');
    assert.ok(node, `verdict for ${contribution}`);
    assert.match(r.text(node), pattern);
    assert.ok(r.button('调整每月能存的钱'));
  }
});
