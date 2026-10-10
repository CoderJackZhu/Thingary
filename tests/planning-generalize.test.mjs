import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pensionFixture } from '../src/planning-pension-fixture.ts';
import { conditionChips } from '../src/planning-first-run.ts';
import { unknownCapabilityFixture } from '../src/plan-basic-fixtures.ts';
import { runtime } from './pension-runtime.mjs';
const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const sources = () => pensionFixture(raw, 'normal');
const saved = s => s.profile.value.saved;
const click = (r, name) => { r.button(name).props.onClick(); r.render(); };
const enter = (r, type, label, value) => { r.find(type, p => p.label === label || p['aria-label'] === label).props.onChange(type === 'input' ? { target: { value } } : value); r.render(); };

test('return presets fill both real returns, mark the active tier and save as hundredths', async () => {
  const r = runtime('PlanningSetup', { sources: sources(), editMode: true, initialStep: 5 });
  const tier = label => r.nodes().find(n => n.type === 'button' && r.text(n).startsWith(label));
  click(r, '含股票基金（3% / 2%）');
  assert.equal(r.find('input', p => p['aria-label'] === '退休前实际年收益').props.value, '3');
  assert.equal(r.find('input', p => p['aria-label'] === '退休后实际年收益').props.value, '2');
  assert.equal(tier('含股票基金').props['aria-pressed'], true);
  assert.equal(tier('存款为主').props['aria-pressed'], false);
  enter(r, 'input', '退休前实际年收益', '3.00');
  assert.equal(tier('含股票基金').props['aria-pressed'], true);
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  const basic = r.calls.at(-1).fields.basic;
  assert.equal(basic.real_return_before_hundredths, 300);
  assert.equal(basic.real_return_after_hundredths, 200);
});

test('zero real return chip says money only keeps pace with inflation', () => {
  const p = saved(sources());
  p.profile.retire.real_return_before_hundredths = 0; p.profile.retire.real_return_after_hundredths = 0;
  assert.match(conditionChips(p, unknownCapabilityFixture, c => c).find(c => c.step === 5).text, /（只跑平通胀）/);
  p.profile.retire.real_return_before_hundredths = 150;
  assert.doesNotMatch(conditionChips(p, unknownCapabilityFixture, c => c).find(c => c.step === 5).text, /只跑平/);
});

test('setup step 3 subtitle distinguishes real inventory from manual amounts', () => {
  const subtitle = r => { const p = r.nodes().find(n => n.type === 'p' && n.props.className === 'muted' && /默认只动用现金类账户|还没有完整盘点/.test(r.text(n))); return p ? r.text(p) : ''; };
  const withSnapshot = pensionFixture(raw, 'empty');
  const inventory = runtime('PlanningSetup', { sources: withSnapshot, snapshot: withSnapshot.snapshot.value, initialStep: 2 });
  assert.match(subtitle(inventory), /^默认只动用现金类账户，确认后保存即可。不会改变实际余额。$/);
  const manual = runtime('PlanningSetup', { sources: pensionFixture(raw, 'empty'), initialStep: 2 });
  assert.match(subtitle(manual), /^还没有完整盘点：先填现在能用来准备退休的钱和截至日期，不会创建盘点，也不会和账户余额相加。$/);
  assert.notEqual(subtitle(inventory), subtitle(manual));
});

test('spouse income shortcut is an other-role income, available with the employee estimator', async () => {
  const s = sources();
  saved(s).profile.retire.basic.retirement_income.mode = 'employee';
  const r = runtime('PlanningSetup', { sources: s, initialStep: 3 });
  click(r, '+ 添加一笔退休收入');
  click(r, '配偶养老金或收入');
  assert.match(r.text(r.find('div', p => p['aria-label'] === '添加退休收入')), /按你自己的年龄填/);
  enter(r, 'CentInput', '税后每月收入', '300000'); enter(r, 'input', '收入起始年龄', '62');
  click(r, '加入列表');
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  const fields = r.calls[0].fields, item = fields.budget.income_items.find(i => i.label === '配偶养老金');
  assert.equal(item.monthly_cents, '300000');
  assert.deepEqual(fields.basic.basic.retirement_income.selected.find(x => x.id === item.id), { id: item.id, source_id: item.id, role: 'other' });
});

import { ownAgeWhenChild, withSpendItem, withoutSpendItem, draftOf } from '../src/planning-basic-forms.ts';
import { prepareBasicPlan } from '../src/plan-basic.ts';
import { table } from '../src/plan-ledger.ts';

test('child age converts to own age; invalid or reversed input stays unknown', () => {
  assert.equal(ownAgeWhenChild('1990-06-01', '2026-10-11', '8', '22'), 50); // own 36 + 14
  assert.equal(ownAgeWhenChild('1990-11-01', '2026-10-11', '8', '22'), 49); // own 35 until November
  for (const [birth, c, u] of [['', '8', '22'], ['1990-06-01', '', '22'], ['1990-06-01', '22', '18'], ['1990-06-01', '8.5', '22']]) assert.equal(ownAgeWhenChild(birth, '2026-10-11', c, u), null);
});

test('spend item add/remove keeps its extra scope in step; saving sends budget items and extra treatment', async () => {
  const s = sources();
  const r = runtime('PlanningSetup', { sources: s, editMode: true, initialStep: 1 });
  click(r, '+ 添加一笔阶段性支出');
  click(r, '子女教育');
  enter(r, 'CentInput', '阶段性支出每月金额', '300000');
  enter(r, 'input', '孩子现在几岁', '8');
  const own = ownAgeWhenChild(saved(s).profile.birth_month + '-01', s.today, '8', '22');
  assert.match(r.text(r.find('div', p => p['aria-label'] === '添加阶段性支出')), new RegExp(`结束于你约 ${own} 岁时`));
  const target = saved(s).profile.retire.target_age;
  assert.ok(own <= target);
  assert.match(r.text(r.find('div', p => p['aria-label'] === '添加阶段性支出')), new RegExp(`在你 ${target} 岁退休前就结束了，不会影响结果`));
  enter(r, 'input', '供到孩子几岁', String(22 + target - own + 1));
  assert.doesNotMatch(r.text(r.find('div', p => p['aria-label'] === '添加阶段性支出')), /不会影响结果/);
  enter(r, 'input', '供到孩子几岁', '22');
  click(r, '加入列表');
  r.button('保存，查看结果').props.onClick(); await r.settle();
  const fields = r.calls.at(-1).fields, item = fields.budget.spend_items.find(i => i.label === '子女教育');
  assert.deepEqual({ ...item, id: 'x' }, { id: 'x', label: '子女教育', monthly_cents: '300000', start_age: null, end_age: own, inflation_hundredths: null, essential: true });
  assert.deepEqual(fields.basic.basic.retirement_costs.find(c => c.source_id === `spend:${item.id}`), { source_id: `spend:${item.id}`, treatment: 'extra', reference_cents: null });
});

test('extra spend item only raises retirement-month spending and removal drops its scope', () => {
  const s = sources(), base = saved(s), d = draftOf(base, s.snapshot.value, s.today);
  const item = { id: 'fx-care', label: '医疗与护理', monthly_cents: '100000', start_age: null, end_age: null, inflation_hundredths: null, essential: true };
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

test('goal page shows the verdict under the required amount and offers estimating when unknown', () => {
  for (const [contribution, pattern] of [['900000000', /比所需多/], [null, /还没填/]]) {
    const s = sources(); saved(s).profile.retire.basic.contribution.monthly_cents = contribution;
    const caps = buildBasicCapabilities(s);
    assert.equal(caps.requirement.value?.set.status, 'found');
    const r = runtime('PlanningBasicGoals', { sources: s, saved: saved(s), openSetup() {}, onGoto() {} }, undefined, () => caps);
    const node = r.find('p', p => String(p.className).startsWith('planning-contribution-verdict'));
    assert.ok(node, `verdict for ${contribution}`);
    assert.match(r.text(node), pattern);
    assert.equal(!!r.nodes().find(n => n.type === 'button' && r.text(n) === '估一估'), contribution === null);
  }
});
