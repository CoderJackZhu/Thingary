// Shared offline dependency discovery for license summaries and full notices.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const releaseTargets = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc'];
export const defaultNoticeTarget = releaseTargets[0];
export const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function parseNoticeArguments(args) {
  let output, target = defaultNoticeTarget;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--target requires a target triple');
      target = args[++i];
    } else if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (output === undefined) {
      output = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!releaseTargets.includes(target)) throw new Error(`Unsupported license target: ${target}`);
  return { target, output };
}

export function reachableRustPackages(meta, root = projectRoot) {
  if (!meta.resolve) throw new Error('Cargo metadata must include the resolved dependency graph');
  const nodes = new Map(meta.resolve.nodes.map(node => [node.id, node]));
  const roots = new Set(meta.workspace_members);
  // Exclude only the reviewed first-party core, while still walking its deps.
  const own = new Set([...roots, ...meta.packages.filter(pkg => pkg.manifest_path === resolve(root, 'crates/planning-engine/Cargo.toml')).map(pkg => pkg.id)]);
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodes.get(id);
    if (!node) throw new Error(`Missing Cargo resolve node: ${id}`);
    // metadata --filter-platform removes inactive target edges. Exclude dev-only
    // edges; retain build dependencies conservatively for each release target.
    for (const dep of node.deps) {
      if (dep.dep_kinds.some(kind => kind.kind !== 'dev')) visit(dep.pkg);
    }
  }
  for (const id of roots) visit(id);
  return meta.packages.filter(pkg => visited.has(pkg.id) && !own.has(pkg.id));
}

export function rustPackagesForTarget(target, root = projectRoot) {
  if (!releaseTargets.includes(target)) throw new Error(`Unsupported license target: ${target}`);
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--offline', '--locked', '--format-version', '1',
    '--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', target,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }));
  return reachableRustPackages(metadata, root);
}

function insideRoot(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel));
}

export function productionNpmPackages(root = projectRoot) {
  const seen = new Set(), visitedDirectories = new Set(), packages = [];
  function dependencyDirectory(directory, name) {
    let parent = directory;
    while (insideRoot(root, parent)) {
      const candidate = resolve(parent, 'node_modules', name);
      if (existsSync(resolve(candidate, 'package.json'))) return candidate;
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  function visit(directory) {
    if (visitedDirectories.has(directory)) return;
    visitedDirectories.add(directory);
    const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (!seen.has(key)) {
      seen.add(key);
      packages.push({ ...pkg, directory });
    }
    const required = Object.keys(pkg.dependencies ?? {});
    const peers = Object.keys(pkg.peerDependencies ?? {});
    const optional = new Set([...Object.keys(pkg.optionalDependencies ?? {}), ...peers.filter(name => pkg.peerDependenciesMeta?.[name]?.optional)]);
    for (const name of new Set([...required, ...peers, ...optional])) {
      const found = dependencyDirectory(directory, name);
      if (!found && !optional.has(name)) throw new Error(`Missing production dependency: ${key} -> ${name}`);
      if (found) visit(found);
    }
  }
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const optional = Object.keys(pkg.optionalDependencies ?? {});
  for (const name of new Set([...Object.keys(pkg.dependencies ?? {}), ...optional])) {
    const directory = dependencyDirectory(root, name);
    if (!directory && !optional.includes(name)) throw new Error(`Missing production dependency: ${name}`);
    if (directory) visit(directory);
  }
  return packages.sort((a, b) => compareText(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
}
