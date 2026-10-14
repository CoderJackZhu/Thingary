// Collect license texts from the locked release-target graph, without downloading.
// Includes build dependencies conservatively; does not modify the application bundle.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, basename, isAbsolute } from 'node:path';
import { projectRoot, parseNoticeArguments, rustPackagesForTarget, productionNpmPackages, compareText } from './license-graph.mjs';

const root = projectRoot;
const options = parseNoticeArguments(process.argv.slice(2));
const output = resolve(options.output ?? `${root}/.local/distribution/notices`);
const rust = rustPackagesForTarget(options.target);
const overridesRoot = `${root}/scripts/license-overrides`;
const overrides = JSON.parse(readFileSync(`${overridesRoot}/manifest.json`, 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const texts = [], inventory = [];
function collect(ecosystem, pkg, directory, extra = []) {
  const files = directory ? readdirSync(directory, { withFileTypes: true }).filter(f => f.isFile() && /^(licen[cs]e|copying|copyright|notice)([._-]|$)/i.test(f.name)).map(f => ({ path: resolve(directory, f.name), source: 'package archive' })) : [];
  if (pkg.license_file) {
    const path = resolve(directory, pkg.license_file);
    if (!files.some(f => f.path === path)) files.push({ path, source: 'package license_file' });
  }
  for (const entry of extra) {
    const path = resolve(overridesRoot, entry.file);
    if (relative(overridesRoot, path).startsWith('..') || isAbsolute(relative(overridesRoot, path)) || sha(readFileSync(path)) !== entry.sha256) throw new Error(`Invalid license override: ${pkg.name}`);
    files.push({ path, source: entry.source, archive_sha256: entry.archive_sha256 });
  }
  if (!files.length || !pkg.license) throw new Error(`Missing license: ${pkg.name}@${pkg.version}`);
  const record = { ecosystem, ...(['Rust', 'SDK'].includes(ecosystem) ? { target: options.target } : {}), name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository ?? pkg.homepage ?? '', authors: pkg.authors ?? [], files: [] };
  texts.push(`\n${'='.repeat(80)}\n${ecosystem}: ${pkg.name}@${pkg.version}\nLicense declaration: ${pkg.license}\nRepository: ${typeof record.repository === 'object' ? record.repository.url : record.repository}\nAuthors declared by package metadata: ${record.authors.join('; ')}\n`);
  for (const file of files.sort((a, b) => compareText(basename(a.path), basename(b.path)) || compareText(a.source, b.source))) {
    const data = readFileSync(file.path);
    record.files.push({ name: basename(file.path), source: file.source, sha256: sha(data), ...(file.archive_sha256 ? { archive_sha256: file.archive_sha256 } : {}) });
    texts.push(`\n--- ${basename(file.path)} (${file.source}) ---\n${data.toString('utf8')}\n`);
  }
  inventory.push(record);
}
for (const p of rust.sort((a, b) => compareText(`${a.name}@${a.version}`, `${b.name}@${b.version}`))) {
  collect('Rust', p, dirname(p.manifest_path), overrides[`${p.name}@${p.version}`] ?? []);
}
for (const p of productionNpmPackages()) {
  collect('npm', { ...p, license: typeof p.license === 'string' ? p.license : p.license?.type, authors: [typeof p.author === 'string' ? p.author : p.author?.name].filter(Boolean) }, p.directory);
}
// The Rust sys crate also embeds a Microsoft SDK loader. Its binary is not
// licensed by the Rust wrapper's MIT declaration. Keep the SDK texts separate.
if (options.target === 'x86_64-pc-windows-msvc') {
  const loader = rust.find(pkg => pkg.name === 'webview2-com-sys');
  if (!loader || loader.version !== '0.38.2') throw new Error('Recheck WebView2 SDK loader provenance for this webview2-com-sys version');
  const sdkKey = 'Microsoft.Web.WebView2@1.0.3650.58';
  const sdk = overrides[sdkKey];
  if (!sdk?.length) throw new Error(`Missing SDK license override: ${sdkKey}`);
  collect('SDK', { name: 'Microsoft.Web.WebView2 loader', version: '1.0.3650.58', license: 'BSD-3-Clause; see SDK LICENSE.txt and NOTICE.txt', repository: 'https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3650.58', authors: ['Microsoft Corporation'] }, null, sdk);
}
// Directly embedded content is not discoverable through either package manager.
// Keep the human-reviewed source ledger alongside the generated dependency texts.
const sourceNotices = readFileSync(`${root}/SOURCE_NOTICES.md`);
texts.push(`\n${'='.repeat(80)}\nDirectly embedded content: SOURCE_NOTICES.md\n${sourceNotices.toString('utf8')}\n`);
inventory.push({ ecosystem: 'source', name: 'Thingary embedded-content notices', version: '1', license: 'See per-entry declarations in SOURCE_NOTICES.md', repository: '', authors: [], files: [{ name: 'SOURCE_NOTICES.md', source: 'reviewed project source ledger', sha256: sha(sourceNotices) }] });
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/THIRD_PARTY_NOTICES.txt`, `Thingary third-party license texts\nRust target: ${options.target}\nCollected from locked package archives and pinned upstream sources.\nThe Rust inventory conservatively includes build dependencies. System frameworks are not redistributed.\nSPDX reference templates are supplemental; upstream declarations and author metadata are retained.\n` + texts.join(''));
writeFileSync(`${output}/license-inventory.json`, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ output: relative(root, output), target: options.target, rust: inventory.filter(p => p.ecosystem === 'Rust').length, npm: inventory.filter(p => p.ecosystem === 'npm').length, sdk: inventory.filter(p => p.ecosystem === 'SDK').length, source: inventory.filter(p => p.ecosystem === 'source').length, missing: 0, notices_sha256: sha(readFileSync(`${output}/THIRD_PARTY_NOTICES.txt`)) }));
