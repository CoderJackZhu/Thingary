import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('macOS icon generation requires macOS.');
if (process.argv.slice(2).some(argument => argument !== '--check')) {
  throw new Error('Usage: node scripts/build-macos-icon.mjs [--check]');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src-tauri/icons/icon.png');
const target = join(root, 'src-tauri/icons/icon.icns');
const directory = mkdtempSync(join(tmpdir(), 'thingary-macos-icon-'));
try {
  const iconset = join(directory, 'icon.iconset');
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      const output = join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
      if (pixels === 1024) copyFileSync(source, output);
      else execFileSync('sips', ['--resampleHeightWidth', String(pixels), String(pixels), source, '--out', output], { stdio: 'pipe' });
    }
  }
  const generated = join(directory, 'icon.icns');
  execFileSync('iconutil', ['--convert', 'icns', '--output', generated, iconset], { stdio: 'pipe' });
  if (process.argv.includes('--check')) {
    if (!readFileSync(target).equals(readFileSync(generated))) {
      throw new Error('macOS icon is stale; run node scripts/build-macos-icon.mjs.');
    }
    console.log('macOS icon: all 10 representations match the five-line master.');
  } else {
    copyFileSync(generated, target);
    console.log('Generated macOS icon from the five-line master.');
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
