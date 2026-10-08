import test from 'node:test';
import assert from 'node:assert/strict';
import { project, outcome, required } from '../src/plan-ledger.ts';
import { stressTests } from '../src/plan-risk.ts';
import { calloutBaselines, compactYuan, refLabelLayout, coverage, milestones, rangeRows, progress, scaleAt, snapshotRows, trajectory, verdict } from '../src/plan-view.ts';

const pension = () => ({ monthly_cents: 300, lump_cents: 20_000, unlock_age_months: 756 });
const plan = (over = {}) => ({
  now_months: 360, horizon_months: 1080, search_cap_months: 840, target_months: 480, mode: 'fire', assets_cents: 50_000,
  saving_cents: 1500, saving_growth_hundredths: 0, r_before_hundredths: 200, r_after_hundredths: 100, inflation_hundredths: 200, volatility_hundredths: 500,
  items: [
    { id: 'l', label: '生活', monthly_cents: 1000, start_age: null, end_age: null, inflation_hundredths: null, essential: true },
    { id: 't', label: '旅行', monthly_cents: 200, start_age: 65, end_age: 75, inflation_hundredths: null, essential: false },
  ],
  incomes: [{ id: 's', label: '企业年金', monthly_cents: 150, start_age: 65, end_age: null, indexed: true }], pension_at: pension, spends: [], ...over,
});
const fmt = c => `¥${Math.round(c)}`;
const run = (P) => { const proj = project(P, 2026), out = outcome(P, proj); return { proj, out, v: verdict(P, proj, out, P.assets_cents, 'today', fmt) }; };
const text = s => s.map(x => x.t).join('');

test('compact money uses 万 and 亿 with a sign', () => {
  assert.deepEqual([compactYuan(123400), compactYuan(2_100_000_00), compactYuan(-350_000_00), compactYuan(12_300_000_000)], ['¥1,234', '¥210万', '−¥35万', '¥1.2亿']);
});

test('FIRE verdicts: reached, on time, late and never', () => {
  const rich = run(plan({ assets_cents: 5_000_000_00 }));
  assert.equal(rich.v.badge, '已实现财务独立');
  assert.equal(rich.v.tone, 'good');
  const early = run(plan({ target_months: 1000 }));  // 目标定得很晚：按时
  assert.equal(early.v.badge, '进展顺利');
  assert.match(text(early.v.headline), /测算时点为 \d+ 岁/);
  const late = run(plan({ target_months: 361, saving_cents: 300 }));
  assert.ok(late.proj.fi_month > 361 + 12, 'fixture should be late');
  assert.match(late.v.badge, /^晚 \d+ 年/);
  assert.match(late.v.guidance, /后实现财务独立/);
  const never = run(plan({ saving_cents: 0, assets_cents: 0 }));
  assert.equal(never.v.tone, 'bad');
  assert.match(never.v.badge, /^预计 90 岁前无法达到$/);
  assert.match(text(never.v.summary), /预计每月投入 ¥0/);
});

test('traditional verdicts: shortfall, depleted, on track and surplus', () => {
  const trad = (o = {}) => run(plan({ mode: 'traditional', ...o }));
  const need = required(plan({ mode: 'traditional' }), 480);
  const surplus = trad({ assets_cents: need * 3 });
  assert.equal(surplus.v.badge, '盈余');
  assert.equal(surplus.v.status, 'overfunded');
  const ok = trad({ assets_cents: (need + 100) / 1.02 ** 10, saving_cents: 0 });
  assert.equal(ok.v.status, 'on_track');
  const short = trad({ assets_cents: 0, saving_cents: 0 });
  assert.ok(['shortfall', 'depleted'].includes(short.v.status));
  assert.equal(short.v.tone === 'bad' || short.v.tone === 'watch', true);
  assert.match(text(short.v.headline), /缺口|资金不足/);
  assert.match(text(surplus.v.summary), /岁时的预计余额为.*所需资金为/);
});

test('progress, milestones and the nominal toggle', () => {
  const P = plan(), { out } = run(P);
  const today = progress(P, out, P.assets_cents, 'today'), nominal = progress(P, out, P.assets_cents, 'nominal');
  assert.ok(Math.abs(today.target - out.required_at_goal) < 1e-9);
  assert.ok(Math.abs(nominal.target - out.required_at_goal * 1.02 ** 10) < 1e-6);
  assert.ok(nominal.pct < today.pct);
  const [coast, lean, fi, fat] = milestones(P, P.assets_cents, 'today');
  assert.ok(coast.amount < fi.amount && lean.amount < fi.amount && fi.amount < fat.amount);
  assert.equal(milestones(P, 1e12, 'today').every(m => m.done), true);
  assert.equal(scaleAt(P, 'today', 900), 1);
});

test('trajectory ends at the horizon; coverage splits spending into income, pension, withdrawal and unfunded', () => {
  const P = plan({ assets_cents: 3_000_00 }), proj = project(P, 2026);
  const pts = trajectory(P, proj, 'today');
  assert.equal(pts[pts.length - 1].age, 90);
  assert.equal(pts[0].projected, P.assets_cents);
  const month = 70 * 12, c = coverage(P, proj, month, 'today');
  assert.equal(c.age, 70);
  assert.equal(c.spend, 1200);
  assert.deepEqual(c.segments.filter(s => s.kind !== 'portfolio' && s.kind !== 'unfunded').map(s => [s.label, s.monthly]), [['企业年金', 150], ['国家养老金', 300]]);
  assert.ok(Math.abs(c.pct.income + c.pct.portfolio + c.pct.unfunded - 100) < 1e-6 || c.pct.income + c.pct.portfolio + c.pct.unfunded <= 100.0001);
  assert.deepEqual(c.spend_items.map(i => [i.label, i.active, i.start, i.end]), [['生活', true, '退休', '终身'], ['旅行', true, '65 岁', '75 岁']]);
  const before = coverage(P, proj, 60 * 12, 'today');
  assert.equal(before.income_items.every(i => !i.active), true);
  assert.equal(before.next_income_age, 65);
  const nominal = coverage(P, proj, month, 'nominal');
  assert.ok(Math.abs(nominal.spend - 1200 * 1.02 ** 40) < 1e-6);
});

test('snapshot rows scale by the inflation at the start of each row', () => {
  const P = plan(), proj = project(P, 2026);
  const t = snapshotRows(P, proj, 'today'), n = snapshotRows(P, proj, 'nominal');
  assert.equal(t.length, proj.rows.length);
  assert.ok(Math.abs(n[5].contribution - t[5].contribution * 1.02 ** 5) < 1e-6);
  assert.equal(t[0].age, 30);
  assert.equal(t[0].year, 2026);
});

test('range rows compare general assumptions beside the base case', () => {
  const P = plan({ saving_cents: 1500, now_months: 436, target_months: 760, mode: 'fire' });
  const proj = project(P, 2026), base = outcome(P, proj), rows = rangeRows(P, stressTests(P, 2026), base);
  assert.deepEqual(rows.map(r => r.id), ['base', 'return-drag', 'inflation-shock', 'spending-shock', 'save-less']);
  assert.ok(rows.slice(1).every(r => r.late_months === null || r.late_months >= 0));
});

test('trajectory chart labels: close reference lines go on separate rows, edge labels flip, callouts keep 14 apart', () => {
  const w = 52;
  assert.deepEqual(refLabelLayout([{ x: 300, w }, { x: 340, w }], 702), [{ row: 0, end: false }, { row: 1, end: false }]);
  assert.deepEqual(refLabelLayout([{ x: 340, w }, { x: 300, w }], 702), [{ row: 1, end: false }, { row: 0, end: false }]);
  assert.deepEqual(refLabelLayout([{ x: 200, w }, { x: 400, w }], 702), [{ row: 0, end: false }, { row: 0, end: false }]);
  assert.deepEqual(refLabelLayout([{ x: 690, w }], 702), [{ row: 0, end: true }]);
  for (const [p, r] of [[100, 100], [100, 108], [108, 100], [100, 200], [200, 100], [270, 270], [269, 120]]) {
    const b = calloutBaselines(p, r, 270 - 4);
    assert.ok(Math.abs(b.projected - b.required) >= 14 && b.projected <= 266 && b.required <= 266, `${p}/${r}`);
    if (Math.abs(p - r) > 20) assert.equal(b.projected < b.required, p < r);
  }
});
