import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Tauri CLI 2.11.5 patches the first unknown bundle marker before packaging,
// then restores the unpatched build output. Reproduce that exact operation on
// an expected copy; never normalize arbitrary differences in the payload.
// https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle.rs
const unknownBundle = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
const nsisBundle = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_NSS');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyNsisPayload(built, embedded) {
  const patchOffset = built.indexOf(unknownBundle);
  assert.ok(patchOffset >= 0, 'Built application is missing the Tauri unknown bundle marker.');
  assert.equal(built.lastIndexOf(unknownBundle), patchOffset, 'Built application has ambiguous Tauri bundle markers.');
  assert.equal(embedded.length, built.length, 'Installer payload size differs from built application.');
  const expected = Buffer.from(built);
  nsisBundle.copy(expected, patchOffset);
  assert.ok(embedded.equals(expected), 'Installer payload differs from the exact Tauri NSIS-patched built application.');
  return {
    payload_sha256: sha256(embedded),
    build_payload_sha256: sha256(built),
    bundle_transform: {
      from: unknownBundle.toString('ascii'),
      to: nsisBundle.toString('ascii'),
      offset: patchOffset,
    },
  };
}
