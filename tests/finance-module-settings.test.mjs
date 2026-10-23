import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime } from './planning-component-runtime.mjs';
import * as moduleModel from '../src/modules.ts';
import * as choice from '../src/start-choice.ts';
const base = { ...moduleModel.allModules, planning: false, incomes: true, movements: true, finance_status: 'ready', finance_revision: 1 };
function mount(modules = base, invoke = async (_name, args) => ({ ...modules, ...args }), changes = []) {
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  return runtime('ModuleSettings', { modules, onChange: m => changes.push(m) }, undefined, undefined, { components: [], modules: { './start-choice': { ...choice, choiceStorage: () => storage }, './modules': moduleModel, './asset': { errorMessage: e => e.message }, '@tauri-apps/api/core': { invoke } } });
}
test('income settings submit explicit choice without enabling goals', async () => {
  const calls = [], changes = [];
  const r = mount(base, async (name, args) => { calls.push([name, args]); return { ...base, incomes: false }; }, changes);
  r.find('Switch', p => p.label === '启用收入记录').props.onChange(false);
  await r.settle();
  assert.equal(calls[0][0], 'modules_set');
  assert.equal(calls[0][1].incomes, false);
  assert.equal(calls[0][1].modules.planning, false);
  assert.equal(changes[0].incomes, false);
});
test('partial preference failure rereads actual state', async () => {
  const calls = [], changes = [];
  const actual = { ...base, wealth: false };
  const r = mount(base, async name => { calls.push(name); if (name === 'modules_set') throw Error('偏好部分写入'); return actual; }, changes);
  r.find('Switch', p => p.label === '启用账户与盘点').props.onChange(false);
  await r.settle();
  assert.deepEqual(calls, ['modules_set', 'modules_get']);
  assert.equal(changes[0], actual);
  assert.match(r.text(r.nodes()[0]), /偏好部分写入/);
});
test('corrupt preferences require an explicit repair with both switches', async () => {
  const calls = [];
  const broken = { ...base, finance_status: 'finance_corrupt', incomes: false, movements: false };
  const r = mount(broken, async (name, args) => { calls.push([name, args]); return base; });
  assert.equal(calls.length, 0);
  assert.equal(r.find('Switch', p => p.label === '启用收入记录').props.disabled, true);
  r.button('按以上选择修复开关').props.onClick();
  await r.settle();
  assert.equal(calls[0][1].repair, true);
  assert.equal(calls[0][1].incomes, false);
  assert.equal(calls[0][1].movements, false);
});
test('newer preference version has no overwrite repair action', () => {
  const r = mount({ ...base, finance_status: 'unsupported_version' });
  assert.equal(r.button('按以上选择修复开关'), undefined);
  assert.match(r.text(r.nodes()[0]), /偏好版本较新/);
  assert.equal(moduleModel.financeOff({ ...base, wealth: false, expenses: false, recurring: false, virtual: false }), false);
});
