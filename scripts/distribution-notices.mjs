// Collect license texts from the locked macOS dependency graph, without downloading.
// Includes build dependencies conservatively; does not modify the application bundle.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? `${root}/.local/distribution/notices`);
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const meta = JSON.parse(run('cargo', ['metadata', '--offline', '--locked', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', 'aarch64-apple-darwin']));
const own = new Set(meta.workspace_members);
const overridesRoot = `${root}/scripts/license-overrides`;
const overrides = JSON.parse(readFileSync(`${overridesRoot}/manifest.json`, 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const texts = [], inventory = [];
function collect(ecosystem, pkg, directory, extra = []) {
  const files = readdirSync(directory, { withFileTypes: true }).filter(f => f.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(f.name)).map(f => ({ path: resolve(directory, f.name), source: 'package archive' }));
  if (pkg.license_file) {
    const path = resolve(directory, pkg.license_file);
    if (!files.some(f => f.path === path)) files.push({ path, source: 'package license_file' });
  }
  for (const entry of extra) {
    const path = resolve(overridesRoot, entry.file);
    if (!path.startsWith(`${overridesRoot}/`) || sha(readFileSync(path)) !== entry.sha256) throw new Error(`Invalid license override: ${pkg.name}`);
    files.push({ path, source: entry.source });
  }
  if (!files.length || !pkg.license) throw new Error(`Missing license: ${pkg.name}@${pkg.version}`);
  const record = { ecosystem, name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository ?? pkg.homepage ?? '', authors: pkg.authors ?? [], files: [] };
  texts.push(`\n${'='.repeat(80)}\n${ecosystem}: ${pkg.name}@${pkg.version}\nLicense declaration: ${pkg.license}\nRepository: ${typeof record.repository === 'object' ? record.repository.url : record.repository}\nAuthors declared by package metadata: ${record.authors.join('; ')}\n`);
  for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
    const data = readFileSync(file.path);
    record.files.push({ name: basename(file.path), source: file.source, sha256: sha(data) });
    texts.push(`\n--- ${basename(file.path)} (${file.source}) ---\n${data.toString('utf8')}\n`);
  }
  inventory.push(record);
}
for (const p of meta.packages.filter(p => !own.has(p.id)).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
  collect('Rust', p, dirname(p.manifest_path), overrides[`${p.name}@${p.version}`] ?? []);
}
const seen = new Set();
function npmPackage(directory) {
  const p = JSON.parse(readFileSync(`${directory}/package.json`, 'utf8'));
  const key = `${p.name}@${p.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  collect('npm', { ...p, license: typeof p.license === 'string' ? p.license : p.license?.type, authors: [typeof p.author === 'string' ? p.author : p.author?.name].filter(Boolean) }, directory);
  for (const name of Object.keys(p.dependencies ?? {})) {
    let parent = directory, found;
    while (parent.startsWith(root)) {
      const candidate = `${parent}/node_modules/${name}`;
      if (existsSync(`${candidate}/package.json`)) { found = candidate; break; }
      const next = dirname(parent); if (next === parent) break; parent = next;
    }
    if (!found) throw new Error(`Missing production dependency: ${key} -> ${name}`);
    npmPackage(found);
  }
}
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
for (const name of Object.keys(packageJson.dependencies)) npmPackage(`${root}/node_modules/${name}`);
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/THIRD_PARTY_NOTICES.txt`, 'Thingary third-party license texts\nCollected from locked package archives and pinned upstream sources.\nThe Rust inventory conservatively includes build dependencies. System frameworks are not redistributed.\nSPDX reference templates are supplemental; upstream declarations and author metadata are retained.\n' + texts.join(''));
writeFileSync(`${output}/license-inventory.json`, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ output: relative(root, output), rust: inventory.filter(p => p.ecosystem === 'Rust').length, npm: inventory.filter(p => p.ecosystem === 'npm').length, missing: 0, notices_sha256: sha(readFileSync(`${output}/THIRD_PARTY_NOTICES.txt`)) }));
