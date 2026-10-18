#!/usr/bin/env node
// Mirror one published GitHub Release (notes, pre-release flag, attachments) to the Gitee repository and verify the files.
// Usage: GITEE_TOKEN=... node scripts/sync-gitee-release.mjs v0.0.8 [--dry-run]
// GITHUB_TOKEN is optional (higher API limits). The tag and source commit must already be pushed to Gitee (git push gitee main <tag>).
// It never moves a published tag, never overwrites an attachment and never deletes anything; it only creates what is missing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GITHUB = 'CoderJackZhu/Thingary';
const GITEE = 'CoderJackZhu/thingary';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** "<hash>  <name>" lines as written by shasum/sha256sum. */
export function parseSums(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+?)\s*$/i);
    if (m) out.set(m[2], m[1].toLowerCase());
  }
  return out;
}

/** What still has to be created on Gitee: the release itself and each attachment it does not have yet. */
export function plan(githubRelease, giteeRelease, giteeFiles) {
  const have = new Set(giteeFiles.map(f => f.name));
  return {
    createRelease: !giteeRelease,
    upload: githubRelease.assets.map(a => a.name).filter(n => !have.has(n)),
  };
}

/** Every attachment must match SHA256SUMS.txt (for the files it lists) and the GitHub copy. */
export function mismatches(sums, githubHashes, giteeHashes) {
  const bad = [];
  for (const [name, hash] of giteeHashes) {
    if (githubHashes.has(name) && githubHashes.get(name) !== hash) bad.push(`${name}: Gitee differs from GitHub`);
    if (sums.has(name) && sums.get(name) !== hash) bad.push(`${name}: Gitee differs from SHA256SUMS.txt`);
  }
  for (const name of githubHashes.keys()) if (!giteeHashes.has(name)) bad.push(`${name}: missing on Gitee`);
  return bad;
}

async function main() {
  const [tag, ...flags] = process.argv.slice(2);
  const dry = flags.includes('--dry-run');
  if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) throw new Error('Usage: node scripts/sync-gitee-release.mjs v<version> [--dry-run]');
  const token = process.env.GITEE_TOKEN;
  if (!token && !dry) throw new Error('GITEE_TOKEN is not set (a Gitee personal access token with projects scope).');

  const gh = async (url, init = {}) => {
    const headers = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
    const r = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'follow' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r;
  };
  const release = await (await gh(`https://api.github.com/repos/${GITHUB}/releases/tags/${tag}`)).json();
  if (release.draft) throw new Error(`${tag} is still a draft on GitHub; publish it first.`);
  const assets = [];
  for (const a of release.assets) {
    const bytes = Buffer.from(await (await gh(a.browser_download_url, { headers: { Accept: 'application/octet-stream' } })).arrayBuffer());
    assets.push({ name: a.name, bytes, hash: sha256(bytes) });
  }
  const githubHashes = new Map(assets.map(a => [a.name, a.hash]));
  const sums = parseSums(assets.find(a => a.name === 'SHA256SUMS.txt')?.bytes.toString('utf8') ?? '');
  const own = [...githubHashes].flatMap(([n, h]) => (sums.has(n) && sums.get(n) !== h ? [`${n}: GitHub copy differs from SHA256SUMS.txt`] : []));
  if (own.length) throw new Error(own.join('\n'));

  const api = `https://gitee.com/api/v5/repos/${GITEE}`;
  const gitee = async (path, init = {}) => {
    const r = await fetch(`${api}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, init);
    return r;
  };
  let giteeRelease = null, files = [];
  if (!dry) {
    const r = await gitee(`/releases/tags/${tag}`);
    if (r.ok) giteeRelease = await r.json();
    else if (r.status !== 404) throw new Error(`Gitee release lookup: HTTP ${r.status}`);
    if (giteeRelease) files = await (await gitee(`/releases/${giteeRelease.id}/attach_files?per_page=100`)).json();
  }
  const todo = plan(release, giteeRelease, files);
  console.log(`${tag}: ${release.prerelease ? 'pre-release' : 'release'}, ${assets.length} attachments; Gitee release ${todo.createRelease ? 'to create' : 'exists'}; to upload: ${todo.upload.join(', ') || 'nothing'}`);
  if (dry) { console.log('Dry run: nothing was written. GitHub hashes:'); for (const a of assets) console.log(`  ${a.hash}  ${a.name}`); return; }

  if (todo.createRelease) {
    const form = new FormData();
    form.set('tag_name', tag); form.set('name', release.name); form.set('body', release.body ?? ''); form.set('prerelease', String(!!release.prerelease)); form.set('target_commitish', release.target_commitish || 'main');
    const r = await gitee('/releases', { method: 'POST', body: form });
    if (!r.ok) throw new Error(`Create Gitee release: HTTP ${r.status} ${await r.text()}`);
    giteeRelease = await r.json();
  }
  // Smallest first, so a slow link shows up before the big installer.
  for (const name of [...todo.upload].sort((x, y) => assets.find(a => a.name === x).bytes.length - assets.find(a => a.name === y).bytes.length)) {
    const a = assets.find(x => x.name === name);
    // curl, not fetch: the runner-to-Gitee upload of a large installer can take longer than Node's fixed 5 minute body timeout.
    const dir = mkdtempSync(join(tmpdir(), 'gitee-'));
    try {
      writeFileSync(join(dir, a.name), a.bytes);
      let last = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          // The token goes in a form field read from the environment, not onto the command line.
          const out = execFileSync('curl', ['--silent', '--show-error', '--http1.1', '--max-time', '1200', '--fail-with-body', '--write-out', '\n[curl] HTTP %{http_code}, %{size_upload} bytes in %{time_total}s (%{speed_upload} B/s)\n', '-F', 'access_token=<-', '-F', `file=@${join(dir, a.name)}`, `${api}/releases/${giteeRelease.id}/attach_files`], { input: token, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
          console.log(out.split('\n').filter(l => l.startsWith('[curl]')).join(' '));
          if (!/"id"\s*:/.test(out)) throw new Error(out.slice(0, 200));
          last = ''; break;
        } catch (e) { last = String(e.stderr || e.message).slice(0, 300); console.log(`upload ${a.name} attempt ${attempt} failed: ${last}`); }
      }
      if (last) throw new Error(`Upload ${a.name} failed: ${last}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    console.log(`uploaded ${a.name}`);
  }

  files = await (await gitee(`/releases/${giteeRelease.id}/attach_files?per_page=100`)).json();
  const giteeHashes = new Map();
  for (const f of files) {
    const dir = mkdtempSync(join(tmpdir(), 'gitee-'));
    try {
      const file = join(dir, 'f');
      execFileSync('curl', ['--silent', '--show-error', '--fail', '--location', '--max-time', '3000', '--retry', '3', '-o', file, f.browser_download_url], { stdio: ['ignore', 'pipe', 'pipe'] });
      giteeHashes.set(f.name, sha256(readFileSync(file)));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const bad = mismatches(sums, githubHashes, giteeHashes);
  if (bad.length) throw new Error(`Gitee verification failed:\n${bad.join('\n')}`);
  console.log(`Gitee verified: ${[...giteeHashes].map(([n, h]) => `${h.slice(0, 12)} ${n}`).join('; ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
