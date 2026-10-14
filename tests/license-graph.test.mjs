import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parseNoticeArguments, reachableRustPackages, productionNpmPackages } from '../scripts/license-graph.mjs';

const edge = (pkg, ...kinds) => ({ pkg, dep_kinds: kinds.map(kind => ({ kind })) });
test('license graph walks filtered target edges, retains build deps, and excludes inactive/dev-only packages', () => {
  const meta = {
    workspace_members: ['root'],
    packages: ['root', 'normal', 'build', 'nested', 'dev', 'inactive'].map(id => ({ id })),
    resolve: { nodes: [
      { id: 'root', deps: [edge('normal', null), edge('build', 'build'), edge('dev', 'dev')] },
      { id: 'normal', deps: [edge('nested', null, 'dev')] },
      { id: 'build', deps: [edge('normal', null)] },
      { id: 'nested', deps: [edge('root', null)] },
      { id: 'dev', deps: [] }, { id: 'inactive', deps: [] },
    ] },
  };
  assert.deepEqual(reachableRustPackages(meta).map(pkg => pkg.id), ['normal', 'build', 'nested']);
});
test('license graph fails when reachable Cargo graph data is absent', () => {
  assert.throws(() => reachableRustPackages({}), /resolved dependency graph/);
  assert.throws(() => reachableRustPackages({ workspace_members: ['root'], packages: [], resolve: { nodes: [] } }), /Missing Cargo resolve node/);
});
test('notice CLI preserves positional output and defaults while accepting explicit targets in either order', () => {
  assert.deepEqual(parseNoticeArguments(['some dir']), { output: 'some dir', target: 'aarch64-apple-darwin' });
  for (const args of [ ['some dir', '--target', 'x86_64-pc-windows-msvc'], ['--target=x86_64-pc-windows-msvc', 'some dir'] ]) {
    assert.deepEqual(parseNoticeArguments(args), { output: 'some dir', target: 'x86_64-pc-windows-msvc' });
  }
  for (const args of [['--target'], ['--target', '--bad'], ['--bad'], ['--target=linux'], ['a', 'b']]) assert.throws(() => parseNoticeArguments(args));
});
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'thingary-license-graph-'));
  const put = (path, pkg) => { const dir = resolve(root, path); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, 'package.json'), JSON.stringify(pkg)); };
  return { root, put };
}
test('npm production discovery resolves scoped and nested package versions without an npm executable', () => {
  const { root, put } = fixture();
  try {
    put('.', { dependencies: { '@scope/app': '1', shared: '2' } });
    put('node_modules/@scope/app', { name: '@scope/app', version: '1', dependencies: { shared: '1' }, optionalDependencies: { absent: '1' }, peerDependencies: { peer: '1', optionalPeer: '1' }, peerDependenciesMeta: { optionalPeer: { optional: true } } });
    put('node_modules/@scope/app/node_modules/shared', { name: 'shared', version: '1' });
    put('node_modules/shared', { name: 'shared', version: '2' });
    put('node_modules/peer', { name: 'peer', version: '1' });
    put('node_modules/dev-only', { name: 'dev-only', version: '1' });
    assert.deepEqual(productionNpmPackages(root).map(pkg => `${pkg.name}@${pkg.version}`), ['@scope/app@1', 'peer@1', 'shared@1', 'shared@2']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('npm discovery rejects missing required production dependency instead of dropping its license', () => {
  const { root, put } = fixture();
  try {
    put('.', { dependencies: { missing: '1' } });
    assert.throws(() => productionNpmPackages(root), /Missing production dependency: missing/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('duplicate npm package versions still traverse each location and its resolved dependencies', () => {
  const { root, put } = fixture();
  try {
    put('.', { dependencies: { app: '1', wrapper: '1' } });
    put('node_modules/app', { name: 'app', version: '1', dependencies: { wrapper: '1' } });
    put('node_modules/wrapper', { name: 'wrapper', version: '1', dependencies: { shared: '1' } });
    put('node_modules/shared', { name: 'shared', version: '1' });
    put('node_modules/app/node_modules/wrapper', { name: 'wrapper', version: '1', dependencies: { shared: '2' } });
    put('node_modules/app/node_modules/shared', { name: 'shared', version: '2' });
    assert.deepEqual(productionNpmPackages(root).map(pkg => `${pkg.name}@${pkg.version}`), ['app@1', 'shared@1', 'shared@2', 'wrapper@1']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('first-party planning core is excluded but its dependencies and other local crates retain notices', () => {
  const root = resolve(tmpdir(), 'thingary-license-first-party');
  const meta = {
    workspace_members: ['app'],
    packages: [
      { id: 'app' },
      { id: 'core', manifest_path: resolve(root, 'crates/planning-engine/Cargo.toml') },
      { id: 'vendor', manifest_path: resolve(root, 'vendor/Cargo.toml') },
      { id: 'nested' },
    ],
    resolve: { nodes: [
      { id: 'app', deps: [edge('core', null), edge('vendor', null)] },
      { id: 'core', deps: [edge('nested', null)] },
      { id: 'vendor', deps: [] }, { id: 'nested', deps: [] },
    ] },
  };
  assert.deepEqual(reachableRustPackages(meta, root).map(pkg => pkg.id), ['vendor', 'nested']);
});
