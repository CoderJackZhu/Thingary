// Test-only installer wrapper. A new identity never reuses the old install or data paths.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceProfile, defaultAcceptanceIdentity } from './windows-acceptance-identity.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--identity')) {
  throw new Error('Usage: build:win:acceptance [--identity local.thingary.win.acceptance.<suffix>]');
}
if (process.platform !== 'win32') throw new Error('Windows acceptance builds require Windows.');
const profile = acceptanceProfile(args[1] ?? defaultAcceptanceIdentity);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, '.local/windows-acceptance-config');
mkdirSync(directory, { recursive: true });
const config = resolve(directory, profile.outputName + '.json');
writeFileSync(config, JSON.stringify({
  identifier: profile.identity,
  productName: profile.productName,
  build: { beforeBuildCommand: 'npm run build && node scripts/prepare-windows.mjs --identity ' + profile.identity },
}, null, 2) + '\n');
execFileSync(process.execPath, [resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'),
  'build', '--config', 'src-tauri/tauri.windows.acceptance.conf.json', '--config', config,
  '--bundles', 'nsis', '--target', 'x86_64-pc-windows-msvc', '--debug', '--features', 'fault-injection', '--ci',
], { cwd: root, stdio: 'inherit' });
