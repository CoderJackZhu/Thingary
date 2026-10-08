import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Regression guard for the complete localization values identified by the
// provenance audit. Store fingerprints, not a copy of the upstream wording.
// This guard detects text reintroduction; passing it is not a legal conclusion.
const fingerprints = JSON.parse(readFileSync(new URL('./fixtures/removed-upstream-text-hashes.json', import.meta.url), 'utf8'));
test('audited UI does not reintroduce the removed upstream localization values', () => {
  const forbidden = new Set(fingerprints.map(entry => entry.sha256));
  const lengths = [...new Set(fingerprints.map(entry => entry.characters))];
  for (const name of ['plan-view.ts', 'RiskLab.tsx', 'RetireOverview.tsx',  'RetireCharts.tsx']) {
    const source = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
    for (const size of lengths) for (let index = 0; index + size <= source.length; index++) {
      const hash = createHash('sha256').update(source.slice(index, index + size)).digest('hex');
      assert.equal(forbidden.has(hash), false, `upstream text fingerprint returned in ${name} at character ${index}`);
    }
  }
});
