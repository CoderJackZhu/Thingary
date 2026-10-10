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
