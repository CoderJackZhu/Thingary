import test from 'node:test';
import assert from 'node:assert/strict';
import { mismatches, parseSums, plan } from '../scripts/sync-gitee-release.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('the workflow can mirror an old tag repeatedly without moving main or replacing a tag', () => {
  const root = mkdtempSync(join(tmpdir(), 'thingary-gitee-test-'));
  try {
    const source = join(root, 'source'), remote = join(root, 'remote.git');
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'empty.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', TAG: 'v0.0.1', GITEE_TOKEN: 'fictional' };
    writeFileSync(env.GIT_CONFIG_GLOBAL, '');
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fictional Test', '-c', 'user.email=fictional@example.invalid', ...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '--bare', remote);git('init', '-b', 'main', source);
    writeFileSync(join(source, 'fictional.txt'), 'first');git('-C', source, 'add', '.');git('-C', source, 'commit', '-m', 'first');git('-C', source, 'tag', 'v0.0.1');
    writeFileSync(join(source, 'fictional.txt'), 'second');git('-C', source, 'commit', '-am', 'second');git('-C', source, 'push', remote, 'main');
    const head = git('-C', source, 'rev-parse', 'HEAD');
    git('-C', source, 'checkout', '--detach', 'v0.0.1');
    const workflow = readFileSync(new URL('../.github/workflows/gitee-mirror.yml', import.meta.url), 'utf8');
    const step = workflow.split('- name: Push the tag and source commit to Gitee')[1].split('- name:')[0];
    const command = step.split('run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n')
      .replace('https://oauth2:${GITEE_TOKEN}@gitee.com/CoderJackZhu/thingary.git', remote);
    const push = () => spawnSync('bash', ['-e', '-c', command], { cwd: source, encoding: 'utf8', env });
    for (let attempt=0;attempt<2;attempt++) { const result=push();assert.equal(result.status,0,result.stderr); }
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/main'),head);
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/tags/v0.0.1'),git('-C', source, 'rev-parse', 'v0.0.1'));
    git('--git-dir', remote, 'update-ref', 'refs/tags/v0.0.1',head);
    assert.notEqual(push().status,0,'an existing different tag must be rejected');
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/tags/v0.0.1'),head);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
