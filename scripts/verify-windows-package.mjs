// Static checks only: this script never launches the formal application.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNsisPayload } from './windows-package-payload.mjs';

import { acceptanceProfile, defaultAcceptanceIdentity } from './windows-acceptance-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const acceptance = process.argv.includes('--acceptance');
const profile = acceptance ? 'debug' : 'release';
const identityIndex = process.argv.indexOf('--identity');
assert.ok(identityIndex < 0 || acceptance, '--identity requires --acceptance');
const selected = acceptance ? acceptanceProfile(identityIndex < 0 ? defaultAcceptanceIdentity : process.argv[identityIndex + 1]) : null;
const identity = selected?.identity ?? 'local.thingary.main';
const target = resolve(root, 'src-tauri/target/x86_64-pc-windows-msvc', profile);
const installers = readdirSync(resolve(target, 'bundle/nsis')).filter(name => name.endsWith('.exe') && (!selected || name === selected.productName + '_' + JSON.parse(readFileSync(resolve(root, 'package.json'))).version + '_x64-setup.exe'));
assert.equal(installers.length, 1, 'Expected one NSIS installer for this build flavor.');
const installer = resolve(target, 'bundle/nsis', installers[0]);
const payload = resolve(target, 'thingary.exe');
const binary = readFileSync(payload);
assert.equal(binary.toString('ascii', 0, 2), 'MZ');
const pe = binary.readUInt32LE(0x3c);
assert.equal(binary.toString('ascii', pe, pe + 4), 'PE\0\0');
assert.equal(binary.readUInt16LE(pe + 4), 0x8664, 'Application payload must be Windows x64.');
const output = resolve(root, '.local/windows-package', selected?.outputName ?? 'release');
mkdirSync(output, { recursive: true });
const extracted = resolve(output, 'installer-content');
mkdirSync(extracted);
execFileSync('7z', ['x', installer, '-o' + extracted, '-y'], { stdio: 'inherit' });
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const contents = files(extracted);
const infoFiles = contents.filter(path => basename(path) === 'BUILD_INFO.json');
assert.equal(infoFiles.length, 1, 'Installer must contain exactly one provenance manifest.');
const info = JSON.parse(readFileSync(infoFiles[0]));
assert.equal(info.identity, identity);
assert.equal(info.acceptance, acceptance);
assert.equal(info.version, JSON.parse(readFileSync(resolve(root, 'package.json'))).version);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(info.source_commit, head);
const licenseRoot = dirname(infoFiles[0]);
for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'SOURCE_NOTICES.md', 'THIRD_PARTY_NOTICES.txt', 'license-inventory.json', '许可与源码.txt']) {
  assert.ok(contents.includes(resolve(licenseRoot, name)), 'Missing installer license resource: ' + name);
}
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(sha(resolve(licenseRoot, 'THIRD_PARTY_NOTICES.txt')), info.third_party_notices_sha256);
const inventory = JSON.parse(readFileSync(resolve(licenseRoot, 'license-inventory.json')));
for (const name of ['rfd', 'windows', 'webview2-com']) {
  assert.ok(inventory.some(entry => entry.ecosystem === 'Rust' && entry.name === name));
}
assert.ok(inventory.some(entry => entry.ecosystem === 'SDK' && entry.name === 'Microsoft.Web.WebView2 loader'));
const embeddedExecutables = contents.filter(path => basename(path) === 'thingary.exe');
assert.equal(embeddedExecutables.length, 1);
const payloadVerification = verifyNsisPayload(binary, readFileSync(embeddedExecutables[0]));
assert.ok(!contents.some(path => /\.(thingary|sqlite|sqlite3|db)$/i.test(path)), 'Installer must not contain data fixtures or databases.');
const summary = {
  ...info, architecture: 'AMD64', installer: basename(installer),
  installer_sha256: sha(installer), ...payloadVerification,
  license_rust_count: inventory.filter(entry => entry.ecosystem === 'Rust').length,
  license_missing: 0, static_verification: true,
};
writeFileSync(resolve(output, 'package-verification.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(resolve(target, 'bundle/nsis/SHA256SUMS.txt'), summary.installer_sha256 + '  ' + basename(installer) + '\n');
console.log(JSON.stringify(summary));
