import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { debtFixture } from '../src/planning-debt-fixture.ts';
import { buildBasicCapabilities, prepareBasicPlan } from '../src/plan-basic.ts';
import { startPaymentsOf } from '../src/plan-ledger.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/planning-basic/debt-loops.json', import.meta.url), 'utf8'));
raw.profile.value.saved.profile.worker = null;
function finalMonthDebt(after, monthly = null, month = '2028-10') {
  const sources = debtFixture(raw, 'normal');
  const retire = sources.profile.value.saved.profile.retire;
  retire.simplified.time.target_month = '2027-01';
  retire.simplified.time.horizon_month = '2028-10';
  const entry = sources.snapshot.value.entries.find(e => e.counted && e.side === 'liability');
  retire.core.debt_repayments = [{
    account_id: entry.account_id, recorded_on: sources.today, as_of: sources.snapshot.value.date,
    balance_cents: entry.amount_cents, start_month: month, last_month: month,
    monthly_cents: monthly, before: 'included', after,
  }];
  return { sources, sourceId: `debt:${entry.account_id}` };
}
const debtAnnotations = ({ sources, sourceId }) => buildBasicCapabilities(sources).annotations.filter(a => a.source_ids.includes(sourceId));

for (const treatment of [null, 'scheduled']) {
  test(`unconfirmed final-month repayment (${treatment ?? 'no treatment'}) keeps its missing-payment warning`, () => {
    const scenario = finalMonthDebt(treatment);
    const capability = buildBasicCapabilities(scenario.sources);
    assert.equal(capability.requirement.status, 'ready');
    const note = debtAnnotations(scenario).find(a => a.reason_code === 'DEBT_UNLINKED');
    assert.ok(note);
    assert.equal(note.effect, 'requirement_lower');
    assert.match(note.message, /退休后还款未计入/);
  });
}

test('excluded final-month repayment keeps its explanation without requesting another confirmation', () => {
  const note = debtAnnotations(finalMonthDebt('excluded')).find(a => a.reason_code === 'DEBT_EXCLUDED');
  assert.ok(note);
  assert.equal(note.actionable, false);
  assert.equal(note.effect, 'requirement_lower');
});

test('repayments starting after the final month create no warning about the covered period', () => {
  for (const treatment of [null, 'scheduled', 'excluded']) {
    assert.deepEqual(debtAnnotations(finalMonthDebt(treatment, null, '2028-11')), []);
  }
});

test('confirmed final-month repayment is present in the same ledger that supplies the warnings', () => {
  const scenario = finalMonthDebt('scheduled', '200000');
  const prepared = prepareBasicPlan(scenario.sources);
  assert.equal(prepared.plan.status, 'ready');
  const compiler = prepared.plan.value;
  const plan = compiler.compile(0, compiler.before, compiler.after);
  const payments = startPaymentsOf(plan, 'retired');
  assert.ok(payments.at(-1) > 0);
  assert.equal(payments.slice(0, -1).every(value => value === 0), true);
  assert.deepEqual(debtAnnotations(scenario), []);
});
