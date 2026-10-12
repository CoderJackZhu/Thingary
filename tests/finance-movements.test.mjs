import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewResult } from '../src/investment-review/model.ts';

test('disabled native review result is valid without change_cents and rejects any fabricated amounts', () => {
  const unavailable = { status: 'unavailable', reasons: ['movements_disabled'] };
  assert.deepEqual(parseReviewResult(unavailable), { ok: true, value: unavailable });
  assert.equal(parseReviewResult({ ...unavailable, change_cents: '0' }).ok, false);
  assert.equal(parseReviewResult({ ...unavailable, change_cents: null }).ok, false);
  assert.equal(parseReviewResult({ ...unavailable, reasons: [] }).ok, false);
});
