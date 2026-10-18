import test from 'node:test';
import assert from 'node:assert/strict';
import { mismatches, parseSums, plan } from '../scripts/sync-gitee-release.mjs';

const h = c => c.repeat(64);

test('SHA256SUMS lines map file names to hashes', () => {
  const sums = parseSums(`${h('a')}  Thingary-0.0.8-universal.dmg\n${h('B')} *Thingary_0.0.8_x64-setup.exe\n\nnot a hash line\n`);
  assert.equal(sums.get('Thingary-0.0.8-universal.dmg'), h('a'));
  assert.equal(sums.get('Thingary_0.0.8_x64-setup.exe'), h('b'));
  assert.equal(sums.size, 2);
});

test('only what is missing on Gitee is created, and nothing is ever replaced', () => {
  const release = { assets: [{ name: 'a.dmg' }, { name: 'b.exe' }, { name: 'SHA256SUMS.txt' }] };
  assert.deepEqual(plan(release, null, []), { createRelease: true, upload: ['a.dmg', 'b.exe', 'SHA256SUMS.txt'] });
  assert.deepEqual(plan(release, { id: 1 }, [{ name: 'a.dmg' }, { name: 'SHA256SUMS.txt' }]), { createRelease: false, upload: ['b.exe'] });
  assert.deepEqual(plan(release, { id: 1 }, release.assets), { createRelease: false, upload: [] });
});

test('verification catches a changed, missing or unlisted-mismatch attachment', () => {
  const sums = new Map([['a.dmg', h('1')]]), github = new Map([['a.dmg', h('1')], ['b.exe', h('2')]]);
  assert.deepEqual(mismatches(sums, github, new Map([['a.dmg', h('1')], ['b.exe', h('2')]])), []);
  assert.deepEqual(mismatches(sums, github, new Map([['a.dmg', h('9')], ['b.exe', h('2')]])).length, 2);
  assert.deepEqual(mismatches(sums, github, new Map([['a.dmg', h('1')]])), ['b.exe: missing on Gitee']);
  assert.deepEqual(mismatches(sums, github, new Map([['a.dmg', h('1')], ['b.exe', h('3')]])), ['b.exe: Gitee differs from GitHub']);
});
