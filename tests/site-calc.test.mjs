import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { calculate, validate, buildPlan, durationText, yuanText, DEFAULTS } from '../site/calc/model.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineBase64 = readFileSync(join(root, 'src/planning-engine-wasm.ts'), 'utf8').match(/planningEngineWasm = '([A-Za-z0-9+/=]+)'/)[1];

function engine(bytes) {
  const w = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
  return request => {
    const input = new TextEncoder().encode(JSON.stringify(request));
    const pointer = w.alloc(input.length) >>> 0;
    new Uint8Array(w.memory.buffer, pointer, input.length).set(input);
    const at = w.evaluate(pointer, input.length) >>> 0;
    const out = JSON.parse(new TextDecoder().decode(new Uint8Array(w.memory.buffer, at, w.result_len() >>> 0)));
    w.release(pointer, input.length);
    if (!out.ok) throw new Error(out.error);
    return out.value;
  };
}
const run = engine(Buffer.from(engineBase64, 'base64'));
const today = '2026-10-21';
const base = { ...DEFAULTS, age: 30, assets_wan: 50, spend: 8000, saving: 6000, income: 3000 };

test('the published website ships the committed engine byte for byte', () => {
  const output = mkdtempSync(join(tmpdir(), 'thingary-calc-test-'));
  try {
    execFileSync(process.execPath, ['scripts/build-site.mjs', output], { cwd: root });
    assert.deepEqual(readFileSync(join(output, 'calc/engine.wasm')), Buffer.from(engineBase64, 'base64'));
    assert.match(readFileSync(join(output, 'index.html'), 'utf8'), /href="calc\/"/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('answers become a basic FIRE plan in today’s money', () => {
  const plan = buildPlan(base, today);
  assert.equal(plan.mode, 'fire');
  assert.equal(plan.input_mode, 'basic');
  assert.equal(plan.horizon_months, 60 * 12);
  assert.equal(plan.assets_cents, 50_000_000);
  assert.equal(plan.items[0].monthly_cents, 800_000);
  assert.equal(plan.future_incomes[0].start_month, '2056-10');
  assert.equal(plan.future_incomes[0].growth, 'constant_purchasing_power');
  assert.equal(buildPlan({ ...base, income: 0 }, today).future_incomes.length, 0);
});

test('the earliest stop month is the engine’s own FIRE retirement month', () => {
  const r = calculate(run, base, today);
  const projection = run({ op: 'project', plan: buildPlan(base, today), year: 2026 });
  assert.equal(r.months, projection.retire_month);
  assert.ok(r.reachable && r.months > 0);
  assert.equal(r.stop_month, `${2026 + Math.floor((9 + r.months) / 12)}-${String((9 + r.months) % 12 + 1).padStart(2, '0')}`);
  assert.ok(r.need_yuan > 0);
  assert.ok(r.extra_1000_months > 0, 'saving more brings the date forward');
  assert.equal(r.series.length, 60);
});

test('more saving, a higher return or a lower budget never makes the date later', () => {
  const months = v => calculate(run, v, today).months;
  const start = months(base);
  assert.ok(months({ ...base, saving: 9000 }) <= start);
  assert.ok(months({ ...base, preset: 'high' }) <= start);
  assert.ok(months({ ...base, preset: 'low' }) >= start);
  assert.ok(months({ ...base, spend: 6000 }) <= start);
});

test('already enough, never enough and a wished stop age are reported plainly', () => {
  assert.equal(calculate(run, { ...base, assets_wan: 3000 }, today).months, 0);
  const short = calculate(run, { ...base, assets_wan: 5, saving: -1000, income: 0, spend: 20000, preset: 'low' }, today);
  assert.equal(short.reachable, false);
  assert.equal(short.need_yuan, null);
  const wish = calculate(run, { ...base, wish_age: 45 }, today).wish;
  assert.equal(wish.status, 'found');
  assert.ok(wish.monthly_yuan > base.saving);
});

test('validation names missing and out-of-range answers', () => {
  assert.deepEqual(validate(base), []);
  assert.deepEqual(validate({ ...base, age: null }).map(i => i.key), ['age']);
  assert.ok(validate({ ...base, end_age: 30 }).some(i => i.key === 'end_age'));
  assert.ok(validate({ ...base, wish_age: 25 }).some(i => i.key === 'wish_age'));
  assert.ok(validate({ ...base, assets_wan: -1 }).some(i => i.key === 'assets_wan'));
  assert.ok(validate({ ...base, age: 30.5 }).some(i => i.key === 'age'));
});

test('durations and amounts read naturally', () => {
  assert.equal(durationText(5), '5 个月');
  assert.equal(durationText(24), '2 年');
  assert.equal(durationText(199), '16 年 7 个月');
  assert.equal(yuanText(8000), '8,000 元');
  assert.equal(yuanText(25_663), '2.6 万');
  assert.equal(yuanText(2_566_373), '257 万');
  assert.equal(yuanText(123_000_000), '1.23 亿');
});
