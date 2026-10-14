// Integration checks use fictional input and the exact Rust dispatch on both targets.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { engineRequest } from '../src/planning-engine.ts';
import { planningEngineWasm } from '../src/planning-engine-wasm.ts';
const plan = {
  now_months: 0, horizon_months: 36, target_months: 12, search_cap_months: 36,
  mode: 'traditional', input_mode: 'basic', assets_cents: 150_000, saving_cents: 2_000,
  saving_growth_hundredths: 50, r_before_hundredths: 150, r_after_hundredths: 80,
  inflation_hundredths: 180, volatility_hundredths: 1200,
  anchor_date: '2026-10-14', monetary_basis_date: '2026-10-01', first_month_fraction: 0.5, age_reference: null,
  items: [{ id: 'life', label: '虚构生活预算', monthly_cents: 4000, start_age: null, end_age: null, inflation_hundredths: null, essential: true }],
  incomes: [], spends: [{ offset_months: 3, cents: 10000 }],
  transfers: [{ id: 'release', account_id: 'fictional', month: 18, cents: 5000 }],
  pensions: [{ monthly_cents: 0, lump_cents: 0, unlock_age_months: 0 }],
};
const requests = ['tables', 'required_series', 'project', 'outcome', 'coast', 'glide', 'sensitivity', 'sensitivity_parameters', 'sequence'].map(op => ({ op, plan, year: 2026 }));
requests.push({ op: 'simulate', plan, paths: 37, seed: 47 });
requests.push({ op: 'matrix', kind: 'contribution_return', plan });
requests.push({ op: 'solve_contribution', plan: { ...plan, saving_cents: 0 }, search_limit_cents: 1_000_000 });
requests.push({ op: 'coverage_at', plan, month: 15 });
requests.push({ op: 'retirement_step', balance: -200, growth: 1.02, lump: 50, income: 400, spend: 100 });
requests.push({ op: 'solve_contribution', contribution_from_month: 18, search_limit_cents: 1_000_000,
  plan: { ...plan, target_months: 24, saving_cents: 0,
    saving_phases: [{ from_month: 0, cents: 2000 }, { from_month: 18, cents: 0 }] } });
const invalidRequests = ['balance', 'growth', 'lump', 'income', 'spend'].map(field => {
  const request = { op: 'retirement_step', balance: 100, growth: 1, lump: 0, income: 0, spend: 0 };
  delete request[field];
  return request;
});
const lines = execFileSync('cargo', ['run', '--quiet', '--locked', '--manifest-path', 'crates/planning-engine/Cargo.toml',
  '--target-dir', 'src-tauri/target/planning-engine', '--example', 'dispatch_stdio'], {
  input: [...requests, ...invalidRequests].map(r => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}).trim().split('\n').map(line => JSON.parse(line));
function equivalent(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') {
    assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-12), `${path}: ${a} != ${b}`);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
    for (const key of Object.keys(a)) equivalent(a[key], b[key], `${path}.${key}`);
  } else assert.equal(a, b, path);
}
assert.equal(lines.length, requests.length + invalidRequests.length);
for (let i = 0; i < requests.length; i++) {
  assert.equal(lines[i].ok, true, JSON.stringify(lines[i]));
  equivalent(engineRequest(requests[i]), lines[i].value, requests[i].op);
}
for (let i = 0; i < invalidRequests.length; i++) {
  assert.equal(lines[requests.length + i].ok, false);
  assert.throws(() => engineRequest(invalidRequests[i]), RangeError);
}
const wasm = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(atob(planningEngineWasm), c => c.charCodeAt(0)))).exports;
assert.equal(wasm.alloc(64 * 1024 * 1024 + 1), 0);
// Invalid pointers must report JSON errors without dereferencing host-controlled memory.
let pointer = wasm.evaluate(123, 4);
assert.equal(JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer, wasm.result_len()))).ok, false);
for (let i = 0; i < 100; i++) {
  const input = new TextEncoder().encode(JSON.stringify(requests[13]));
  const allocated = wasm.alloc(input.length);
  new Uint8Array(wasm.memory.buffer, allocated, input.length).set(input);
  pointer = wasm.evaluate(allocated, input.length);
  assert.equal(JSON.parse(new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer, wasm.result_len()))).ok, true);
  wasm.release(allocated, input.length);
  wasm.release(allocated, input.length); // stale free is a no-op
}
console.log(`${requests.length} native/WASM operations and ${invalidRequests.length} required-field rejections agree; allocation and ownership checks passed.`);
