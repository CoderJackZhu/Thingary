import test from 'node:test';
import assert from 'node:assert/strict';
import * as classification from '../src/income-classification.ts';
import { runtime } from './planning-component-runtime.mjs';

const fields = { date: '2026-10-12', net_cents: '10000', hpf_cents: '500', notes: '保留事实' };
test('old income stays unclassified and category totals retain exact cents', () => {
  const rows = [{ fields }, { fields: { ...fields, category: 'interest', net_cents: '1' } }];
  assert.deepEqual(classification.incomeCategoryTotals(rows), [
    { category: 'unclassified', cents: '10000', count: 1 }, { category: 'interest', cents: '1', count: 1 },
  ]);
  assert.equal(classification.classifyIncome(fields, 'interest').hpf_cents, '500');
});

function open(income = null, submit = async () => ({})) {
  return runtime('IncomeDialog', { income, generation: 'g', today: '2026-10-12', hpfDefault: '500', accounts: [] }, undefined, undefined, {
    components: [], modules: { './income-classification': classification, './wealth': { submit, Unresolved: class extends Error {} } },
    document: { querySelector: () => ({ focus() {} }) },
  });
}
const select = (r, category) => { r.find('select', p => p['aria-label'] === '来源分类').props.onChange({ target: { value: category } }); r.render(); };
test('new investment income does not inherit a suggested housing deposit', () => {
  const r = open(); select(r, 'interest');
  assert.equal(r.find('CentInput', p => p.label === '公积金缴存'), undefined);
});
test('explicitly edited deposit is retained, even when equal to the suggestion', () => {
  const r = open(); r.find('CentInput', p => p.label === '公积金缴存').props.onChange('500'); r.render(); select(r, 'cash_dividend');
  assert.equal(r.find('CentInput', p => p.label === '公积金缴存').props.value, '500');
  assert.ok(r.find('input', p => p.type === 'checkbox'));
});
test('reclassifying an old mixed income requires explicit deposit confirmation before saving', async () => {
  const saved = []; const r = open({ id: 'i', revision: 1, fields }, async p => saved.push(p));
  select(r, 'interest'); r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  assert.equal(saved.length, 0);
  r.find('input', p => p.type === 'checkbox').props.onChange({ target: { checked: true } }); r.render();
  r.find('form').props.onSubmit({ preventDefault() {} }); await r.settle();
  assert.equal(saved[0].input.fields.hpf_cents, '500');
  assert.equal(saved[0].input.fields.category, 'interest');
  assert.deepEqual(r.closes, [true]);
});
test('a transfer cannot claim the same source and receiving account', () => {
  assert.ok(classification.incomeClassificationIssue({ ...fields, category: 'interest', destination: 'transferred', source_account_id: 'a', receiving_account_id: 'a' }));
});
test('one submit is in flight and late completion cannot close a replacement dialog', async () => {
  let complete; const calls = [];
  const r = open({ id: 'i', revision: 1, fields }, p => { calls.push(p); return new Promise(resolve => { complete = resolve; }); });
  const form = r.find('form');
  form.props.onSubmit({ preventDefault() {} }); form.props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  r.unmount(); complete({}); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(r.closes, []);
});

test('disabled accounts keep original account references through category edits and save', async () => {
  const saved = [], original = { id: 'i', revision: 2, fields: { ...fields, category: 'interest', source_account_id: 'historical-a', destination: 'transferred', receiving_account_id: 'historical-b' } };
  const r = runtime('IncomeDialog', { income: original, generation: 'g', today: '2026-10-12', hpfDefault: '', accountsEnabled: false, accounts: [] }, undefined, undefined, {
    components: [], modules: { './income-classification': classification, './wealth': { submit: async p => { saved.push(p); return original; }, Unresolved: class extends Error {} } }, document: { querySelector: () => ({ focus() {} }) },
  });
  assert.equal(r.find('select', p => p['aria-label'] === '来源账户').props.disabled, true);
  assert.equal(r.find('select', p => p['aria-label'] === '接收账户').props.disabled, true);
  assert.equal(r.find('select', p => p['aria-label'] === '收入去向').props.disabled, true);
  select(r, 'non_investment');assert.equal(r.find('select', p => p['aria-label'] === '来源分类').props.value,'interest');assert.match(r.text(r.nodes()[0]),/先启用账户模块/);select(r, 'cash_dividend');r.find('form').props.onSubmit({ preventDefault() {} });await r.settle();
  assert.equal(saved[0].input.fields.source_account_id,'historical-a');assert.equal(saved[0].input.fields.receiving_account_id,'historical-b');assert.equal(saved[0].input.fields.destination,'transferred');
});
test('saved-income callback carries the native receipt and unknown submission retains inputs', async () => {
  const record={id:'receipt-i',revision:3,fields}, callbacks=[];
  const r=runtime('IncomeDialog',{income:record,generation:'g',today:'2026-10-12',hpfDefault:'',onSavedIncome:i=>callbacks.push(i)},undefined,undefined,{components:[],modules:{'./income-classification':classification,'./wealth':{submit:async()=>record,Unresolved:class extends Error {}}}});
  r.find('form').props.onSubmit({preventDefault(){}});await r.settle();assert.equal(callbacks[0].id,'receipt-i');assert.deepEqual(r.closes,[true]);
  class Unresolved extends Error {} let attempts=0;
  const stuck=runtime('IncomeDialog',{income:record,generation:'g',today:'2026-10-12',hpfDefault:''},undefined,undefined,{components:[],modules:{'./income-classification':classification,'./wealth':{submit:async()=>{attempts++;throw new Unresolved('unknown receipt');},Unresolved}}});
  stuck.find('form').props.onSubmit({preventDefault(){}});await stuck.settle();assert.equal(stuck.find('CentInput',p=>p.label==='税后到账').props.value,'10000');assert.equal(stuck.find('CentInput',p=>p.label==='税后到账').props.disabled,true);stuck.find('form').props.onSubmit({preventDefault(){}});await stuck.settle();assert.equal(attempts,1);assert.deepEqual(stuck.closes,[]);
});
