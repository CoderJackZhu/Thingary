// Re-render the original project-owned SVG, without redesigning it.
// Optional argument: absolute entry point of an existing sharp installation.
// API: https://sharp.pixelplumbing.com/api-constructor/ and /api-output/
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { objectArt } from '../src/illustrations.ts';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
// The material catalog drives rendering: one PNG per catalog id.
const materials = JSON.parse(await readFile(new URL('../src-tauri/materials/materials.json', import.meta.url), 'utf8'));
const output = new URL('../src-tauri/materials/', import.meta.url);
await mkdir(output, { recursive: true });
for (const material of materials.filter(m => m.style !== 'icon')) {
  await sharp(Buffer.from(objectArt(material.id)), { density: 144 }).png().toFile(fileURLToPath(new URL(material.id + '.png', output)));
}
console.log(`Rendered ${materials.length} original illustrations.`);
