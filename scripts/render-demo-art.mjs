// Re-render the original project-owned SVG, without redesigning it.
// Optional argument: absolute entry point of an existing sharp installation.
// API: https://sharp.pixelplumbing.com/api-constructor/ and /api-output/
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { objectArt } from '../src/illustrations.ts';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const assets = JSON.parse(await readFile(new URL('../src/demo-assets.json', import.meta.url), 'utf8'));
const output = new URL('../docs/ui/demo-photos/', import.meta.url);
await mkdir(output, { recursive: true });
for (const asset of assets) {
  await sharp(Buffer.from(objectArt(asset.key)), { density: 144 }).png().toFile(fileURLToPath(new URL(asset.key + '.png', output)));
}
console.log(`Rendered ${assets.length} original Demo illustrations.`);
