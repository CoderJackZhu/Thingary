import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { financeReadSession, readFinanceSources, toFinanceSourceState } from '../src/finance-service.ts';
import { normalizeFinancePeriod } from '../src/finance-contract.ts';
import { allModules } from '../src/modules.ts';

const modules = { ...allModules, planning: false, incomes: true, movements: true, finance_status: 'ready', finance_revision: 2 };
const period = { kind: 'range', from: '2026-09-30', to: '2026-10-31', includeFrom: false };
function sources(over = {}) {
  return { generation: 'fictional', write_version: 3, today: '2026-10-12', modules: { ...modules }, period: { ...period }, ...over };
}
test('wire request contains period only and returns native identity and states', async () => {
  globalThis.window = {};
  const expected = sources();
  mockIPC((command, args) => {
    assert.equal(command, 'finance_sources');
    assert.deepEqual(args, { period });
    return expected;
  });
  try { assert.deepEqual(await readFinanceSources(period), expected); }
  finally { clearMocks(); delete globalThis.window; }
});
test('explicit adapter keeps empty view metadata, unknown amounts, disabled and errors', () => {
  const value = { intervals: [], incomplete_count: 2, generation: 'fictional', amount: null };
  assert.deepEqual(toFinanceSourceState({ status: 'ready', value }), { status: 'ready', value });
  assert.deepEqual(toFinanceSourceState({ status: 'ready', value }, x => !x.intervals.length), { status: 'empty' });
  assert.deepEqual(toFinanceSourceState({ status: 'disabled', reason: '收入关闭' }), { status: 'disabled', reason: '收入关闭' });
  assert.deepEqual(toFinanceSourceState({ status: 'error', code: 'SQL', message: '无法读取' }), { status: 'error', message: '无法读取' });
});
test('request ticket rejects late periods, library changes, invalidation and stale errors', async () => {
  const pending = [];
  const session = financeReadSession(request => new Promise((resolve, reject) => pending.push({ request, resolve, reject })));
  const first = session.load('fictional', period, modules);
  const secondPeriod = { kind: 'month', month: '2026-10' };
  const second = session.load('fictional', secondPeriod, modules);
  pending[1].resolve(sources({ period: secondPeriod }));
  assert.deepEqual(await second, sources({ period: secondPeriod }));
  pending[0].resolve(sources()); assert.equal(await first, null);
  const library = session.load('other-library', period, modules);
  pending[2].resolve(sources()); assert.equal(await library, null);
  const invalidated = session.load('fictional', period, modules); session.invalidate();
  pending[3].resolve(sources()); assert.equal(await invalidated, null);
  const error = session.load('fictional', period, modules); session.invalidate();
  pending[4].reject(new Error('old failure')); assert.equal(await error, null);
  const currentError = session.load('fictional', period, modules);
  pending[5].reject(new Error('current failure')); await assert.rejects(currentError, /current failure/);
});
test('capabilities, preference revision, exact period and status must match', async () => {
  for (const changed of [
    { period: { ...period, includeFrom: true } },
    { period: { kind: 'month', month: '2026-10' } },
    ...Object.keys(modules).map(key => ({ modules: { ...modules, [key]: typeof modules[key] === 'boolean' ? !modules[key] : key === 'finance_revision' ? 4 : 'finance_corrupt' } })),
  ]) {
    const session = financeReadSession(async () => sources(changed));
    assert.equal(await session.load('fictional', period, modules), null);
  }
  const session = financeReadSession(async () => sources());
  assert.deepEqual(await session.load('fictional', period, modules), sources());
});
test('caller mutation cannot modify an outstanding scope', async () => {
  let resolve;
  const original = { ...period }, mutableModules = { ...modules };
  const session = financeReadSession(request => new Promise(done => {
    assert.notEqual(request, original); resolve = done;
  }));
  const result = session.load('fictional', original, mutableModules);
  original.to = '2026-11-30'; mutableModules.finance_revision = 8;
  resolve(sources());
  assert.deepEqual(await result, sources());
});

test('annual projection is explicitly requested without changing standard callers', async () => {
  globalThis.window = {};
  const annualPeriod = { kind: 'year', year: 2026 };
  const expected = sources({ period: annualPeriod, annual: { year: 2026, range: normalizeFinancePeriod(annualPeriod) } });
  mockIPC((command, args) => {
    assert.equal(command, 'finance_sources');
    assert.deepEqual(args, { period: annualPeriod, view: 'annual' });
    return expected;
  });
  try { assert.deepEqual(await readFinanceSources(annualPeriod, 'annual'), expected); }
  finally { clearMocks(); delete globalThis.window; }
});

test('annual reads reject standard or wrong-year projections and late results after changing view', async () => {
  const annualPeriod = { kind: 'year', year: 2026 };
  for (const annual of [undefined, { year: 2025 }]) {
    const session = financeReadSession(async () => sources({ period: annualPeriod, annual }));
    assert.equal(await session.load('fictional', annualPeriod, modules, 'annual'), null);
  }
  const pending = [];
  const session = financeReadSession((request, view) => new Promise(resolve => pending.push({ request, view, resolve })));
  const oldAnnual = session.load('fictional', annualPeriod, modules, 'annual');
  const currentStandard = session.load('fictional', annualPeriod, modules);
  assert.deepEqual(pending.map(p => p.view), ['annual', 'standard']);
  const standard = sources({ period: annualPeriod });
  pending[1].resolve(standard);
  assert.deepEqual(await currentStandard, standard);
  pending[0].resolve(sources({ period: annualPeriod, annual: { year: 2026, range: normalizeFinancePeriod(annualPeriod) } }));
  assert.equal(await oldAnnual, null);
});
