// Replay only the three amount functions of the reviewed public calculator.
// No network access, personal records, annual-index or eligibility validation.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { calculateBeijingBenefit } from '../src/pension-lab/benefit.ts';

const samples = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/beijing-pension-calibration.json', import.meta.url), 'utf8'));
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/pension-external-replay.mjs <downloaded official index7.html>');
const html = fs.readFileSync(path, 'utf8');
const hash = crypto.createHash('sha256').update(html).digest('hex');
assert.equal(hash, samples.sha256, 'Official source changed: review differences before updating the frozen reference.');
const wanted = new Set(['initjcylj', 'initgrzh', 'inithj']);
const functions = [];
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  const ast = ts.createSourceFile('official.js', match[1], ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && wanted.has(node.name?.text)) functions.push(node.getText(ast));
  }
}
assert.equal(functions.length, 3, 'Expected exactly three reviewed amount functions');
const premise = { basis: 'assumption', source: 'Fictional external amount comparison; not approved benefits' };
const toCents = x => Math.round(Number(x) * 100);
const results = samples.cases.map(c => {
  const fields = { zszs: c.index, snzgpjgz: c.base, qbjfn: Math.floor(c.paid / 12), qbjfy: c.paid % 12,
    date_2: '2025-01-01', txnl: '60', grzhcce: c.account };
  const output = Object.fromEntries(['jcjfjs', 'jcjfbl', 'jcjfje', 'gdjfje', 'grzhyljjfys', 'grzhyljjfje', 'yljhj']
    .map(k => {
      let text = '0';
      return [k, { get innerHTML() { return text; }, set innerHTML(value) { text = String(value); } }];
    }));
  // Only reviewed, hash-pinned functions execute. VM is not a security sandbox.
  const context = vm.createContext({
    $: selector => ({ val: () => fields[selector.slice(1)] }),
    document: { getElementById: id => { assert.ok(output[id], id); return output[id]; } },
    jfys: { 60: 139 }, // Fixed whole-age premise; this replay does not validate the schedule table.
  });
  vm.runInContext(functions.join('\n') + '\ninitjcylj(); initgrzh(); inithj();', context, { timeout: 1000 });
  const external = [output.jcjfje, output.grzhyljjfje, output.yljhj].map(v => toCents(v.innerHTML));
  const frozen = [c.expected.base_cents, c.expected.account_cents, c.expected.total_cents];
  assert.deepEqual(external, frozen, c.id + ': frozen external output drift');
  const actual = calculateBeijingBenefit({ scope: 'beijing-enterprise-post-1998', birth_month: '1965-01',
    worker: 'male', flex_months: -1, paid_months_at_retirement: c.paid,
    average_index: { ten_thousandths: Math.round(c.index * 10000), ...premise },
    benefit_base: { cents: String(toCents(c.base)), year: 2025, ...premise },
    account_at_retirement: { cents: String(toCents(c.account)), ...premise },
    disbursement: { months: 139, ...premise } });
  assert.equal(actual.status, 'ready', c.id);
  const app = [actual.value.base_monthly_cents, actual.value.account_monthly_cents, actual.value.total_monthly_cents];
  assert.deepEqual(app, external, c.id + ': application amount differs');
  return { id: c.id, external_cents: external, application_cents: app };
});
console.log(JSON.stringify({ source: samples.source, sha256: hash,
  scope: 'Explicit amount functions only; no online UI, annual index, account accumulation, eligibility or approved entitlement.',
  results }, null, 2));
