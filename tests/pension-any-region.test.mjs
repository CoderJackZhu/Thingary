import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beijing, noOverrides, effectiveParams, paramsFor } from '../src/plan-params.ts';
import { pensionFixture } from '../src/planning-pension-fixture.ts';
import { buildBasicCapabilities, prepareBasicPlan } from '../src/plan-basic.ts';
import { draftOf, pensionInput, incomeInflationContext, retirementIncomeToday } from '../src/planning-basic-forms.ts';
import { missingPensionFields, pensionRefinementFields } from '../src/planning-pension-refinement.ts';
import { runtime } from './pension-runtime.mjs';
const today = '2026-10-10';
const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
const sources = scenario => pensionFixture(raw, scenario);
const saved = s => s.profile.value.saved;

test('paramsFor: Beijing unchanged, custom rounded integer defaults/year/overrides, unknown is null', () => {
  const o = { ...noOverrides, avg_wage_cents: '1000001' };
  assert.deepEqual(paramsFor({ region: 'beijing', overrides: o }, today), effectiveParams(beijing, o));
  const custom = paramsFor({ region: 'custom', overrides: o }, today);
  assert.equal(custom.base_lower_cents, '600001');
  assert.equal(custom.base_upper_cents, '3000003');
  assert.equal(custom.avg_wage_year, 2025);
  assert.equal(paramsFor({ region: 'custom', overrides: o }, '2027-01-01').avg_wage_year, 2026);
  const overrides = { ...o, base_lower_cents: '700000', base_upper_cents: '4000000', notional_rate_hundredths: 200, hpf_rate_hundredths: 300 };
  const overridden = paramsFor({ region: 'custom', overrides }, today);
  for (const k of Object.keys(overrides)) assert.equal(overridden[k], overrides[k]);
  assert.equal(paramsFor({ region: 'custom', overrides: noOverrides }, today), null);
  assert.equal(paramsFor({ region: null, overrides: o }, today), null);
  assert.equal(paramsFor({ region: 'custom', overrides: { ...o, avg_wage_cents: '9007199254740993' } }, today).base_lower_cents, '5404319552844596');
});

test('custom benefit base missing blocks pension and requirement; complete equals Beijing with matching parameters', () => {
  const missing = buildBasicCapabilities(sources('custom-missing'));
  assert.equal(missing.pension.status, 'blocked');
  assert.equal(missing.requirement.status, 'blocked');
  assert.ok(missing.pension.missing.some(m => m.owner === 'pension' && m.field === 'overrides.avg_wage_cents' && /当地养老金计发基数/.test(m.message)));
  assert.equal('value' in missing.pension, false);
  const s = sources('custom'), p = saved(s).profile, params = paramsFor(p, s.today);
  const comparison = structuredClone(s), bp = saved(comparison).profile;
  bp.region = 'beijing'; bp.overrides = { ...bp.overrides, avg_wage_cents: params.avg_wage_cents, base_lower_cents: params.base_lower_cents, base_upper_cents: params.base_upper_cents };
  assert.equal(params.avg_wage_year, beijing.avg_wage_year);
  assert.deepEqual(buildBasicCapabilities(s).pension, buildBasicCapabilities(comparison).pension);
  assert.deepEqual(buildBasicCapabilities(s).requirement, buildBasicCapabilities(comparison).requirement);
  // The employee selector must use restricted pools in every region.
  const plan = prepareBasicPlan(s).plan;
  assert.equal(plan.status, 'ready');
  const pension = plan.value.compile(0, plan.value.before, plan.value.after).pension_at(720);
  assert.ok(pension.lump_cents > 0);
  const excluded = structuredClone(s); saved(excluded).profile.retire.basic.retirement_income.mode = 'excluded';
  const without = prepareBasicPlan(excluded).plan;
  assert.equal(without.value.compile(0, without.value.before, without.value.after).pension_at(720).lump_cents, 0);
});

test('refinement lists/locates region and custom base independently, retains changed region in setup DTO', () => {
  for (const [region, key, label] of [['', 'region', '参保地'], ['custom', 'oWage', '当地养老金计发基数']]) {
    const s = sources('normal'), d = draftOf(saved(s), s.snapshot.value, s.today);
    d.incomeMode = 'employee'; d.pension.region = region; d.pension.oWage = '';
    assert.deepEqual(missingPensionFields(d), [key]);
    const r = runtime('PlanningPensionRefinement', { sources: s, initialDraft: d, completion: true });
    assert.match(r.text(r.find('h2')), /社保资料/);
    assert.ok(r.find(region === '' ? 'div' : 'CentInput', p => p['aria-label'] === label || p.label === label));
    const fields = pensionRefinementFields(d, saved(s), s.today);
    assert.equal(fields.pension.region, region || null);
  }
});

test('manual conversion uses month-precise age and rounds once to integer cents', () => {
  // Independent rational calculation for a whole-year interval (no floating-point oracle).
  const denominator = 102n ** 24n, numerator = 500000n * 100n ** 24n;
  assert.equal(retirementIncomeToday('500000', '60', '1990-06-01', '2', '2026-06-10'), String((numerator + denominator / 2n) / denominator));
  assert.deepEqual(incomeInflationContext('1990-06-01', '2', '2026-09-30'), { age: 36.25, rate: .02 });
  assert.equal(retirementIncomeToday('500000', '60', '1990-06-01', '2', '2026-09-30'), '312404');
  assert.equal(retirementIncomeToday('500001', '60', '1990-06-01', '0', today), '500001');
  for (const [birth, infl] of [['', '2'], ['1990-06-01', ''], ['1990-13-01', '2']]) {
    assert.equal(incomeInflationContext(birth, infl, today), null);
    assert.equal(retirementIncomeToday('500000', '60', birth, infl, today), null);
  }
});

const click = (r, name) => { r.button(name).props.onClick(); r.render(); };
const enter = (r, type, label, value) => { const n = r.find(type, p => p.label === label || p['aria-label'] === label); n.props.onChange(type === 'input' ? { target: { value } } : value); r.render(); };
function manualEditor(overrides = {}) {
  const s = sources('normal'), d = draftOf(saved(s), s.snapshot.value, s.today);
  Object.assign(d, { incomeMode: 'manual', ...overrides });
  saved(s).profile.retire.basic.retirement_income.mode = 'manual';
  if (overrides.birth === '') saved(s).profile.birth_month = null;
  const r = overrides.infl === '' ? runtime('PlanningPensionRefinement', { sources: s, initialDraft: d }) : runtime('PlanningSetup', { sources: s, initialStep: 3 });
  click(r, '+ 添加一笔退休收入');
  return r;
}

test('Q4 shortcut saves state_pension role and discounts only when switch is on', async () => {
  const r = manualEditor();
  click(r, '国家养老金（测算结果）');
  enter(r, 'CentInput', '税后每月收入', '500000'); enter(r, 'input', '收入起始年龄', '60');
  assert.equal(r.find('Switch', p => p.label === '这是退休那年的金额').props.value, false);
  enter(r, 'Switch', '这是退休那年的金额', true);
  const expected = retirementIncomeToday('500000', '60', '1990-06-01', '2', raw.today);
  assert.match(r.text(r.find('div', p => p['aria-label'] === '添加退休收入')), /约合今天的/);
  click(r, '加入列表');
  assert.equal(r.find('select', p => p['aria-label'] === '国家养老金的角色').props.value, 'state_pension');
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  const fields = r.calls[0].fields;
  const item = fields.budget.income_items.find(i => i.label === '国家养老金');
  assert.equal(item.monthly_cents, expected);
  assert.equal(fields.basic.basic.retirement_income.selected.find(i => i.id === item.id).role, 'state_pension');
  const off = manualEditor(); click(off, '国家养老金（测算结果）');
  enter(off, 'CentInput', '税后每月收入', '500001'); enter(off, 'input', '收入起始年龄', '60'); click(off, '加入列表');
  off.find('form').props.onSubmit({ preventDefault() {} }); await off.settle();
  assert.equal(off.calls[0].fields.budget.income_items.find(i => i.label === '国家养老金').monthly_cents, '500001');
});

test('NewIncome disables conversion with unknown birth or inflation and shows reason', () => {
  for (const overrides of [{ birth: '' }, { infl: '' }]) {
    const r = manualEditor(overrides);
    assert.equal(r.find('Switch', p => p.label === '这是退休那年的金额').props.disabled, true);
    assert.match(r.text(r.find('div', p => p['aria-label'] === '添加退休收入')), /先填写出生年月和通胀假设才能折算/);
  }
});


test('goal completion income-choice entry can switch an existing Beijing profile to custom and save', async () => {
  const s = sources('normal');
  const r = runtime('PlanningPensionRefinement', { sources: s, completion: true });
  r.find('input', p => p['aria-label'] === '职工养老金估算').props.onChange(); r.render();
  assert.ok(r.find('input', p => p['aria-label'] === '其他城市（自己填当地参数）'));
  r.find('input', p => p['aria-label'] === '其他城市（自己填当地参数）').props.onChange(); r.render();
  enter(r, 'CentInput', '当地养老金计发基数', '1000001');
  r.find('form').props.onSubmit({ preventDefault() {} }); r.render();
  enter(r, 'MonthInput', '未来缴费开始月份', '2026-10');
  enter(r, 'MonthInput', '未来缴费停止月份', '2050-06');
  enter(r, 'CentInput', '未来月缴费基数', '2000000');
  enter(r, 'CentInput', '未来公积金每月缴存', '0');
  r.find('form').props.onSubmit({ preventDefault() {} }); r.render();
  assert.match(r.text(r.find('h2')), /确认/);
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].fields.pension.region, 'custom');
  assert.equal(r.calls[0].fields.pension.overrides.avg_wage_cents, '1000001');
  assert.equal(r.calls[0].fields.basic.basic.retirement_income.mode, 'employee');
});
