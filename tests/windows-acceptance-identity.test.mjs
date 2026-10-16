import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceProfile, isAcceptanceIdentity } from '../scripts/windows-acceptance-identity.mjs';
test('default acceptance profile stays compatible; a fresh suffix owns separate install and output names', () => {
  assert.deepEqual(acceptanceProfile(), {identity:'local.thingary.win.acceptance',productName:'Thingary Windows Acceptance',outputName:'acceptance'});
  assert.deepEqual(acceptanceProfile('local.thingary.win.acceptance.run-20261016a'), {identity:'local.thingary.win.acceptance.run-20261016a',productName:'Thingary Windows Acceptance run-20261016a',outputName:'acceptance-run-20261016a'});
});
test('acceptance namespace rejects formal, preview, nested, oversized and command-like identities', () => {
  for (const id of [undefined, '', 'local.thingary.main','local.thingary.preview','local.thingary.win.acceptance.','local.thingary.win.acceptance.A','local.thingary.win.acceptance.a.b','local.thingary.win.acceptance.-a','local.thingary.win.acceptance.a;cmd','local.thingary.win.acceptance.'+'a'.repeat(33)]) {
    assert.equal(isAcceptanceIdentity(id),false);
    if (id !== undefined) assert.throws(() => acceptanceProfile(id));
  }
});
