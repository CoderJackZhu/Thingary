import { mkdtempSync, rmSync, renameSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] ?? join(root, 'docs/images/walkthrough.gif'));
const files = ['overview.png', 'accounts.png', 'planning.png', 'savings.png', 'review.png', 'belongings.png'];
const dimensions = { width: 2560, height: 1920 };
const work = mkdtempSync(join(dirname(output), '.walkthrough-'));
const run = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
function probe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,nb_frames,duration', '-of', 'json', path], { encoding: 'utf8' })).streams[0];
}
try {
  const inputs = files.map((file, i) => {
    const path = join(root, 'docs/images/readme-desktop', file), { width, height } = probe(path);
    if (width !== dimensions.width || height !== dimensions.height) {
      throw new Error(`Unexpected screenshot dimensions: ${file} ${width}×${height}`);
    }
    run(['-i', path, '-vf', 'setsar=1', '-frames:v', '1', join(work, `frame-${String(i + 1).padStart(2, '0')}.png`)]);
    return { file, width, height };
  });
  const gif = join(work, 'walkthrough.gif');
  run(['-framerate', '2/7', '-i', join(work, 'frame-%02d.png'), '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=single:reserve_transparent=0[p];[b][p]paletteuse=new=1:dither=none', '-frames:v', String(files.length), '-fps_mode', 'passthrough', '-gifflags', '0', '-loop', '0', '-final_delay', '350', gif]);
  const result = probe(gif);
  if (result.width !== dimensions.width || result.height !== dimensions.height || Number(result.nb_frames) !== files.length || Number(result.duration) !== files.length * 3.5) {
    throw new Error(`Unexpected GIF output: ${JSON.stringify(result)}`);
  }
  if (statSync(gif).size > 8 * 1024 * 1024) throw new Error('README GIF exceeds the 8 MiB size limit');
  renameSync(gif, output);
  console.log(JSON.stringify({ output, inputs, ...result, bytes: statSync(output).size }, null, 2));
} finally {
  rmSync(work, { recursive: true, force: true });
}
