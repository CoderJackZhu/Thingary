import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyNsisPayload } from '../scripts/windows-package-payload.mjs';

const unknown = '__TAURI_BUNDLE_TYPE_VAR_UNK';
const nsis = '__TAURI_BUNDLE_TYPE_VAR_NSS';
const build = () => Buffer.from(`MZ enum constant ${nsis} before variable ${unknown} trailing code`);
function patched(built) {
  const result = Buffer.from(built);
  Buffer.from(nsis).copy(result, built.indexOf(unknown));
  return result;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('NSIS provenance patches the unknown variable, retaining an earlier NSS constant', () => {
  const built = build();
  const original = Buffer.from(built);
  const embedded = patched(built);
  const summary = verifyNsisPayload(built, embedded);
  assert.deepEqual(built, original);
  assert.equal(summary.payload_sha256, sha(embedded));
  assert.equal(summary.build_payload_sha256, sha(built));
  assert.deepEqual(summary.bundle_transform, { from: unknown, to: nsis, offset: built.indexOf(unknown) });
});

test('NSIS provenance rejects a modification outside the bundle marker', () => {
  const built = build();
  const embedded = patched(built);
  embedded[embedded.length - 1] ^= 1;
  assert.throws(() => verifyNsisPayload(built, embedded), /exact Tauri NSIS-patched/);
});

test('NSIS provenance rejects missing, incorrect and ambiguous bundle markers', () => {
  const built = build();
  assert.throws(() => verifyNsisPayload(Buffer.from('no marker'), Buffer.from('no marker')), /missing/);
  assert.throws(() => verifyNsisPayload(built, built), /exact Tauri NSIS-patched/);
  const ambiguous = Buffer.concat([built, Buffer.from(unknown)]);
  assert.throws(() => verifyNsisPayload(ambiguous, patched(ambiguous)), /ambiguous/);
});

test('NSIS provenance rejects truncated and appended payload bytes', () => {
  const built = build();
  const embedded = patched(built);
  assert.throws(() => verifyNsisPayload(built, embedded.subarray(0, -1)), /size differs/);
  assert.throws(() => verifyNsisPayload(built, Buffer.concat([embedded, Buffer.from([0])])), /size differs/);
});
