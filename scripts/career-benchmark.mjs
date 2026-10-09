// Reproducible fictional benchmark; JSON to stdout, no database or filesystem writes.
import { cases, inputs } from '../tests/helpers/career-benchmark.mjs';
import { referenceCareer } from '../tests/helpers/career-reference.mjs';
import { evaluateCareerScenario } from '../src/plan-career.ts';

const report = cases.map(([name, input]) => {
  const { s, d } = inputs(input), expected = referenceCareer(input), result = evaluateCareerScenario(s, d);
  if (result.prediction.status !== 'ready') throw new Error(`${name}: ${JSON.stringify(result.prediction)}`);
  const { projection, outcome } = result.prediction.value, offset = input.firstFraction === undefined ? 1 : 0;
  const months = [
    ...expected.rows.map(row => ({ phase: 'accumulation', month: row.m, expected_cents: row.end, actual_cents: projection.assets[offset + row.m + 1] })),
    ...expected.retirementRows.map(row => ({ phase: 'retirement', month: row.k, expected_cents: row.end, actual_cents: projection.assets[offset + expected.rows.length + row.k + 1], expected_unfunded_cents: row.unfunded, actual_unfunded_cents: projection.unfunded[offset + expected.rows.length + row.k] })),
  ].map(row => ({ ...row, difference_cents: row.actual_cents - row.expected_cents }));
  const checks = [
    { name: 'assets_at_goal', expected_cents: expected.assets, actual_cents: outcome.assets_at_goal },
    { name: 'required_at_goal', expected_cents: expected.required, actual_cents: outcome.required_at_goal },
  ].map(row => ({ ...row, difference_cents: row.actual_cents - row.expected_cents }));
  const maximum_difference_cents = Math.max(...months.map(row => Math.abs(row.difference_cents)), ...months.map(row => Math.abs((row.actual_unfunded_cents ?? 0) - (row.expected_unfunded_cents ?? 0))), ...checks.map(row => Math.abs(row.difference_cents)));
  return { name, input: { sources: s, draft: d, independent_options: input }, maximum_difference_cents, passed: maximum_difference_cents < .02, checks, months };
});
process.stdout.write(JSON.stringify({ units: 'cents', fictional: true, cases: report }, null, 2) + '\n');
if (report.some(row => !row.passed)) process.exitCode = 1;
