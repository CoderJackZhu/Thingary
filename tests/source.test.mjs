import test from 'node:test';
import assert from 'node:assert/strict';
import { missingSource, openSourceRequest, sourcePage, validReturn } from '../src/source.ts';

const focus = (target, generation = 'g1') => ({ target, generation, token: 1 });

test('a stale dataset never resolves, whatever the target', async () => {
  const calls = [];
  const outcome = await openSourceRequest(
    focus({ kind: 'payment', id: 'p', plan_id: 'pl' }, 'old'),
    'new',
    async t => { calls.push(['validate', t]); },
    async t => { calls.push(['resolve', t]); return true; },
    () => true,
  );
  assert.deepEqual(outcome, { state: 'failed', message: missingSource });
  assert.equal(calls.length, 0);
});

test('a failed validation surfaces its message and never resolves', async () => {
  const calls = [];
  const outcome = await openSourceRequest(
    focus({ kind: 'wish', id: 'w' }),
    'g1',
    async () => { throw { code: 'NOT_FOUND', message: '这条来源记录已删除或失效，请返回后重新读取。' }; },
    async t => { calls.push(t); return true; },
    () => true,
  );
  assert.deepEqual(outcome, { state: 'failed', message: '这条来源记录已删除或失效，请返回后重新读取。' });
  assert.equal(calls.length, 0);
});

test('a request superseded after validation resolves nothing', async () => {
  let live = true;
  const outcome = await openSourceRequest(
    focus({ kind: 'virtual', id: 'v' }),
    'g1',
    async () => { live = false; },
    async () => { throw new Error('resolver must not run'); },
    () => live,
  );
  assert.deepEqual(outcome, { state: 'late' });
});

test('a resolver result arriving after its request died is discarded', async () => {
  let live = true;
  const outcome = await openSourceRequest(
    focus({ kind: 'expense', id: 'x' }),
    'g1',
    async () => {},
    async () => { live = false; return true; },
    () => live,
  );
  assert.deepEqual(outcome, { state: 'late' });
});

test('found, not found and resolver errors map to their outcomes', async () => {
  const ok = await openSourceRequest(focus({ kind: 'plan', id: 'pl' }), 'g1', async () => {}, () => true, () => true);
  assert.deepEqual(ok, { state: 'applied' });
  const missing = await openSourceRequest(focus({ kind: 'plan', id: 'pl' }), 'g1', async () => {}, () => false, () => true);
  assert.deepEqual(missing, { state: 'failed', message: missingSource });
  const guard = await openSourceRequest(
    focus({ kind: 'snapshot', id: 's' }),
    'g1',
    async () => {},
    async () => { throw new Error('请先核对上次保存结果，再打开来源盘点。'); },
    () => true,
  );
  assert.deepEqual(guard, { state: 'failed', message: '请先核对上次保存结果，再打开来源盘点。' });
});

test('targets route to their owning page', () => {
  assert.equal(sourcePage({ kind: 'asset', id: 'a' }), 'assets');
  assert.equal(sourcePage({ kind: 'wish', id: 'w' }), 'wishlist');
  assert.equal(sourcePage({ kind: 'snapshot', id: 's' }), 'wealth');
  assert.equal(sourcePage({ kind: 'expense', id: 'x' }), 'expenses');
  assert.equal(sourcePage({ kind: 'payment', id: 'p', plan_id: 'pl' }), 'recurring');
  assert.equal(sourcePage({ kind: 'plan', id: 'pl' }), 'recurring');
  assert.equal(sourcePage({ kind: 'virtual', id: 'v' }), 'virtual');
});

test('return contexts only survive within their own dataset', () => {
  const context = { section: 'overview', generation: 'g1', scroll: 320, reviewYear: 2025, timeline: { filter: 'all', domain: 'all', year: null } };
  assert.equal(validReturn(context, 'g1'), context);
  assert.equal(validReturn(context, 'g2'), null);
  assert.equal(validReturn(null, 'g1'), null);
});
