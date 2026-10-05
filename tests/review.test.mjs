import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { attention, latestComplete, monthsBefore, overviewView, rangePoints, rangeUsable, requestGate, structureCompareRange, structureRows } from '../src/review.ts';
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

test('combined attention omits subscription payment prompts and retains rent reminders',()=>{
  const plans=[{id:'gpt',fields:{category:'subscription',end_date:null}},{id:'claude',fields:{category:'subscription',end_date:null}},{id:'finite',fields:{category:'subscription',end_date:'2026-10-31'}},{id:'rent',fields:{category:'rent',end_date:null}}];
  const due=plans.map(p=>({plan_id:p.id,plan_name:p.id,due_date:'2026-10-04'}));
  const groups=attention({...review,recurring:ok({plans,due,upcoming:[]}),virtual_assets:ok({items:[{id:'gpt-profile',fields:{name:'虚构 GPT',plan_id:'gpt'},status:'ongoing',valid_until:'2024-02-01'}]})});
  assert.deepEqual(groups.map(g=>g.id),['plan:rent']);
});

test('ended subscriptions stay in history without attention; upcoming expiries and other rights remain actionable', () => {
  const items = [
    { id: 'gpt', fields: { name: '虚构 GPT Plus', kind: 'subscription', plan_id: 'gpt-plan' }, status: 'expired', valid_until: '2025-02-19' },
    { id: 'legacy', fields: { name: '旧独立订阅', kind: 'subscription', plan_id: null }, status: 'expired', valid_until: '2025-02-19' },
    { id: 'new', fields: { name: '新订阅', kind: 'general', billing: 'subscription', plan_id: 'new-plan' }, status: 'expired', valid_until: '2026-10-04' },
    { id: 'linked', fields: { name: '关联订阅', kind: 'license', plan_id: 'linked-plan' }, plan: { fields: { category: 'subscription' } }, status: 'expired', valid_until: '2026-10-04' },
    { id: 'today', fields: { name: '今天最后使用', kind: 'subscription', plan_id: null }, status: 'expiring', valid_until: '2026-10-05' },
    { id: 'domain', fields: { name: '域名', kind: 'domain', plan_id: null }, status: 'expired', valid_until: '2026-10-04' },
  ];
  const plans = items.filter(v => v.fields.plan_id).map(v => ({ id: v.fields.plan_id, fields: { category: 'subscription', end_date: v.valid_until } }));
  const input = { ...review, today: '2026-10-05', recurring: ok({ plans, due: plans.map(p => ({ plan_id: p.id, plan_name: p.id, due_date: '2025-01-20' })), upcoming: [], payments: [{ id: 'historical-payment', amount_cents: '14000' }] }), virtual_assets: ok({ items, spent_cents: '14000' }) };
  const before = structuredClone(input);
  assert.deepEqual(attention(input).map(g => g.id), ['virtual:domain', 'virtual:today']);
  assert.deepEqual(input, before);
});

const point = (date, extra = {}) => ({ snapshot_id: 's' + date, date, complete: true, net_cents: '100', compared_to: null, scope_changed: false, change_cents: null, ...extra });
test('range cut-off is a calendar day, month ends clamp instead of rolling over', () => {
  assert.equal(monthsBefore('2026-10-06', 6), '2026-04-06');
  assert.equal(monthsBefore('2026-08-31', 6), '2026-02-28');
  assert.equal(monthsBefore('2028-08-31', 6), '2028-02-29');
  assert.equal(monthsBefore('2026-03-15', 12), '2025-03-15');
  assert.equal(monthsBefore('2026-02-10', 6), '2025-08-10');
});
test('range only trims the plotted points; a range needs two complete check-ins', () => {
  const points = [point('2025-01-05'), point('2026-03-01'), point('2026-07-01'), point('2026-09-30', { complete: false })];
  assert.equal(rangePoints(points, 'all', '2026-10-06').length, 4);
  assert.deepEqual(rangePoints(points, '6m', '2026-10-06').map(p => p.date), ['2026-07-01', '2026-09-30']);
  assert.ok(!rangeUsable(points, '6m', '2026-10-06'), 'one complete + one incomplete is not a trend');
  assert.ok(rangeUsable(points, '1y', '2026-10-06'));
  assert.ok(rangeUsable(points, 'all', '2026-10-06'));
});
test('structure change compares the latest complete check-in with its previous complete one only', () => {
  const a = point('2026-08-03'), b = point('2026-10-03', { compared_to: '2026-08-03', change_cents: '5' });
  assert.deepEqual(structureCompareRange([a, b, point('2026-10-05', { complete: false })]), { from: a.snapshot_id, to: b.snapshot_id });
  assert.equal(structureCompareRange([a]), null, 'first complete check-in has nothing to compare');
  assert.equal(structureCompareRange([a, { ...b, scope_changed: true, change_cents: null }]), null, 'counted scope changed: not comparable');
  assert.equal(structureCompareRange([{ ...a, complete: false }, b]), null, 'start must be a complete check-in');
});
test('structure rows: change is known, newly added, or unknown — never a silent zero', () => {
  const structure = [{ kind: 'cash', amount_cents: '10000', share_hundredths: 5000 }, { kind: 'fund', amount_cents: '9000', share_hundredths: 4500 }, { kind: 'bond', amount_cents: '1000', share_hundredths: 500 }];
  const pairs = [{ kind: 'cash', from_cents: '12000', to_cents: '10000' }, { kind: 'fund', from_cents: null, to_cents: '9000' }];
  const rows = structureRows(structure, pairs);
  assert.deepEqual(rows.map(r => [r.kind, r.change_cents, r.added]), [['cash', '-2000', false], ['fund', '9000', true], ['bond', null, false]]);
  assert.ok(structureRows(structure, null).every(r => r.change_cents === null && !r.added), 'unavailable compare leaves every change unknown');
  assert.equal(structureRows(structure, [{ kind: 'cash', from_cents: '10000', to_cents: '10000' }])[0].change_cents, '0', 'a real zero change stays zero');
});
test('overview keeps the rule-mandated net-worth wording and compare source', () => {
  const page = readFileSync(new URL('../src/ReviewView.tsx', import.meta.url), 'utf8');
  for (const text of ['截至 {latest.date} 完整盘点 · 距今 {daysSince} 天', '账户范围变化，暂不可比', '基期非正，不显示变化率', '第一份完整盘点，暂无可比变化']) assert.ok(page.includes(text), text);
  assert.match(page, /invoke<Compare>\('wealth_compare'/);
  assert.match(page, /不等于投资收益/);
});
