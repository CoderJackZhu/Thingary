import test from 'node:test';
import assert from 'node:assert/strict';
import { attention, latestComplete, overviewView, requestGate } from '../src/review.ts';
const ok = value => ({ status: 'ready', value });
const review = { wealth: ok({ points: [] }), recurring: ok({ due: [], upcoming: [] }), virtual_assets: ok({ items: [] }) };
test('latest incomplete subtotal never replaces complete net worth', () => {
  const complete = { complete: true, net_cents: '33000000', date: '2026-08-31' };
  assert.equal(latestComplete([complete, { complete: false, net_cents: '999', date: '2026-09-28' }]), complete);
  assert.equal(latestComplete([{ complete: false }]), undefined);
});
test('group by explicit plan relation, never by matching names; keep both entries', () => {
  const item = (id, plan_id) => ({ id, fields: { name: '同名服务', plan_id }, status: 'expired', valid_until: '2026-09-01' });
  const result = attention({ ...review, recurring: ok({ due: [{ plan_id: 'p', plan_name: '同名服务', due_date: '2026-09-02' }], upcoming: [] }), virtual_assets: ok({ items: [item('a', 'p'), item('b', null), { ...item('c', 'p'), plan_deleted: true }] }) });
  assert.equal(result.length, 3);
  const merged = result.find(g => g.id === 'plan:p');
  // A merged plan/entitlement group keeps one precise entry per meaning.
  assert.deepEqual(merged.entries.map(e => e.target), [{ kind: 'plan', id: 'p' }, { kind: 'virtual', id: 'a' }]);
  assert.deepEqual(result.find(g => g.id === 'virtual:b').entries.map(e => e.target), [{ kind: 'virtual', id: 'b' }]);
  assert.deepEqual(result.find(g => g.id === 'virtual:c').entries.map(e => e.target), [{ kind: 'virtual', id: 'c' }]);
  assert.equal(merged.details.length, 2);
});
test('partial failure preserves other attention rows; incomplete snapshot first with its own target', () => {
  const r = attention({ ...review, wealth: ok({ points: [{ snapshot_id: 's', complete: false, date: '2026-09-28', missing: 1 }] }), recurring: { status: 'error', value: {} }, virtual_assets: ok({ items: [{ id: 'v', fields: { name: '域名' }, status: 'expiring', valid_until: '2026-10-01' }] }) });
  assert.deepEqual(r.map(g => g.id), ['snapshot:s', 'virtual:v']);
  assert.deepEqual(r[0].entries.map(e => e.target), [{ kind: 'snapshot', id: 's' }]);
});
test('late year/library responses and unmounted requests cannot publish', async () => {
  const gate = requestGate(), old = gate.next(), current = gate.next();
  assert.ok(!gate.accepts(old, 'same-generation', 'same-generation'));
  assert.ok(gate.accepts(current, 'same-generation', 'same-generation'));
  assert.ok(!gate.accepts(current, 'new-library', 'old-library'));
  gate.invalidate();
  assert.ok(!gate.accepts(current, 'same-generation', 'same-generation'));
});
test('default overview is combined; valid explicit preference survives', () => {
  for (const value of [null, '', 'invalid', 'combined']) assert.equal(overviewView(value), 'combined');
  assert.equal(overviewView('physical'), 'physical');
});

test('combined attention omits continuing subscriptions and retains finite and rent reminders',()=>{
  const plans=[{id:'gpt',fields:{category:'subscription',end_date:null}},{id:'claude',fields:{category:'subscription',end_date:null}},{id:'finite',fields:{category:'subscription',end_date:'2026-10-31'}},{id:'rent',fields:{category:'rent',end_date:null}}];
  const due=plans.map(p=>({plan_id:p.id,plan_name:p.id,due_date:'2026-10-04'}));
  const groups=attention({...review,recurring:ok({plans,due,upcoming:[]}),virtual_assets:ok({items:[{id:'gpt-profile',fields:{name:'虚构 GPT',plan_id:'gpt'},status:'ongoing',valid_until:'2024-02-01'}]})});
  assert.deepEqual(groups.map(g=>g.id),['plan:finite','plan:rent']);
});
