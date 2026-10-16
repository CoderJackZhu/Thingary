// Rebuild the README slideshow from the registered fictional native captures.
// Derive the physical title-bar trim from the screenshot's actual pixel ratio.
import { mkdtempSync, rmSync, renameSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, 'docs/images/walkthrough.gif'));
const files = ['overview-light.jpg', 'wealth-light.jpg', 'planning-goals.jpg', 'savings-goals.jpg', 'annual-review.jpg', 'assets-light.jpg'];
const work = mkdtempSync(join(dirname(output), '.walkthrough-'));
const run = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
function probe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames,duration', '-of', 'json', path], { encoding: 'utf8' })).streams[0];
}
try {
  const inputs = files.map((file, i) => {
    const path = join(root, 'docs/images', file), { width, height } = probe(path);
    const ratio = width / 1440;
    if (![1, 2].includes(ratio)) throw new Error(`Unregistered screenshot width: ${file} ${width}`);
    // Four Retina JPEGs retain 16 logical pixels of the native title bar.
    const top = height === 917 * ratio ? 16 * ratio : [901, 968].includes(height / ratio) ? 0 : null;
    if (top === null) throw new Error(`Unregistered screenshot height: ${file} ${height}`);
    const filter = `${top ? `crop=iw:ih-${top}:0:${top},` : ''}scale=960:645:flags=lanczos,setsar=1`;
    run(['-i', path, '-vf', filter, '-frames:v', '1', join(work, `frame-${String(i + 1).padStart(2, '0')}.png`)]);
    return { file, width, height, pixelRatio: ratio, trimTopPixels: top };
  });
  const gif = join(work, 'walkthrough.gif');
  run(['-framerate', '2/7', '-i', join(work, 'frame-%02d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-frames:v', '6', '-fps_mode', 'passthrough', '-gifflags', '0', '-loop', '0', '-final_delay', '350', gif]);
  const result = probe(gif);
  if (result.width !== 960 || result.height !== 645 || Number(result.nb_frames) !== 6 || Number(result.duration) !== 21) {
    throw new Error(`Unexpected GIF output: ${JSON.stringify(result)}`);
  }
  renameSync(gif, output);
  console.log(JSON.stringify({ output, inputs, ...result, bytes: statSync(output).size }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
