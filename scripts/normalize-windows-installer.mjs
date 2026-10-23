// Normalize the Tauri NSIS release installer name to the public asset name.
// Tauri uses productName for the file name, which is "物谱"; releases and winget
// use the ASCII "Thingary_<version>_x64-setup.exe" so URLs stay stable.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version;
const directory = resolve(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
const targetName = 'Thingary_' + version + '_x64-setup.exe';
const target = resolve(directory, targetName);

const installers = readdirSync(directory)
  .filter(name => name.endsWith('.exe'))
  .filter(name => name !== targetName);
if (installers.length !== 0 && installers.length !== 1) {
  throw new Error('Expected at most one NSIS installer before normalization, found: ' + installers.join(', '));
}
if (installers.length === 1) {
  if (existsSync(target)) rmSync(target);
  renameSync(resolve(directory, installers[0]), target);
}
if (!readdirSync(directory).includes(targetName)) {
  throw new Error('Missing NSIS installer: ' + targetName);
}

const sha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
writeFileSync(resolve(directory, 'SHA256SUMS.txt'), sha256 + '  ' + basename(target) + '\n');
console.log(JSON.stringify({ installer: targetName, sha256 }, null, 2));
