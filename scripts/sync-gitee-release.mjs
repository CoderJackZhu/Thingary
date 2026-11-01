#!/usr/bin/env node
// Mirror one published GitHub Release (notes, pre-release flag, attachments) to the Gitee repository and verify the files.
// Usage: GITEE_TOKEN=... node scripts/sync-gitee-release.mjs v0.0.8 [--dry-run]
// GITHUB_TOKEN is optional (higher API limits). The tag and source commit must already be pushed to Gitee (git push gitee <tag>；分支同步单独处理).
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
const RETRYABLE_STATUS = new Set([408, 425, 429]);

function redactSecrets(value) {
  return String(value).replace(/([?&]access_token=)[^&\s]+/gi, '$1[REDACTED]');
}

function describeError(error, seen = new Set(), depth = 0) {
  if (error == null || depth > 5) return String(error);
  if (typeof error !== 'object') return String(error);
  if (seen.has(error)) return '[circular cause]';
  seen.add(error);
  const parts = [error.name, error.message].filter(Boolean);
  for (const key of ['code', 'errno', 'syscall', 'hostname']) {
    if (error[key] != null) parts.push(`${key}=${error[key]}`);
  }
  if (error.cause && !seen.has(error.cause)) parts.push(`cause: ${describeError(error.cause, seen, depth + 1)}`);
  if (Array.isArray(error.errors)) {
    for (const nested of error.errors.slice(0, 3)) parts.push(`cause: ${describeError(nested, seen, depth + 1)}`);
  }
  return redactSecrets(parts.join(': ') || String(error));
}

function abortReason(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new Error('fetch aborted', { cause: reason });
}

/** Fetch with a bounded attempt count, per-attempt timeout, and exponential backoff. */
export async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    attempts = 4,
    timeoutMs = 120_000,
    retryDelayMs = 750,
    maxRetryDelayMs = 8_000,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  } = options;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer');
  if (!(timeoutMs > 0)) throw new Error('timeoutMs must be positive');

  const callerSignal = init.signal;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (callerSignal?.aborted) throw abortReason(callerSignal);
    const controller = new AbortController();
    const relayAbort = () => controller.abort(callerSignal.reason);
    callerSignal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('fetch attempt timed out')), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const retryable = RETRYABLE_STATUS.has(response.status) || response.status >= 500;
      if (!retryable || attempt === attempts) return response;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      if (callerSignal?.aborted) throw abortReason(callerSignal);
      if (attempt === attempts) {
        const detail = describeError(error);
        throw new Error(redactSecrets(`fetch failed after ${attempts} attempts for ${String(url)}: ${detail}`), { cause: error });
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', relayAbort);
    }
    const delay = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** (attempt - 1));
    await sleep(delay);
  }
  throw new Error('fetch retry loop exited unexpectedly');
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error(redactSecrets(`${label}: invalid JSON: ${describeError(error)}`), { cause: error });
  }
}

async function requiredJson(response, label) {
  if (!response.ok) {
    const body = redactSecrets((await response.text()).slice(0, 500));
    throw new Error(`${label}: HTTP ${response.status}${body ? ` ${body}` : ''}`);
  }
  return readJson(response, label);
}

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
    const r = await fetchWithRetry(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'follow' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r;
  };
  const release = await readJson(await gh(`https://api.github.com/repos/${GITHUB}/releases/tags/${tag}`), 'GitHub release');
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
    const r = await fetchWithRetry(`${api}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, init);
    return r;
  };
  let giteeRelease = null, files = [];
  if (!dry) {
    const r = await gitee(`/releases/tags/${tag}`);
    if (r.ok) giteeRelease = await readJson(r, 'Gitee release lookup');
    else if (r.status !== 404) throw new Error(`Gitee release lookup: HTTP ${r.status}`);
    if (giteeRelease) {
      files = await requiredJson(
        await gitee(`/releases/${giteeRelease.id}/attach_files?per_page=100`),
        'Gitee attachment list',
      );
    }
  }
  const todo = plan(release, giteeRelease, files);
  console.log(`${tag}: ${release.prerelease ? 'pre-release' : 'release'}, ${assets.length} attachments; Gitee release ${todo.createRelease ? 'to create' : 'exists'}; to upload: ${todo.upload.join(', ') || 'nothing'}`);
  if (dry) { console.log('Dry run: nothing was written. GitHub hashes:'); for (const a of assets) console.log(`  ${a.hash}  ${a.name}`); return; }

  if (todo.createRelease) {
    const form = new FormData();
    form.set('tag_name', tag); form.set('name', release.name); form.set('body', release.body ?? ''); form.set('prerelease', String(!!release.prerelease)); form.set('target_commitish', release.target_commitish || 'main');
    const r = await gitee('/releases', { method: 'POST', body: form });
    giteeRelease = await requiredJson(r, 'Create Gitee release');
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
          const out = execFileSync('curl', ['--silent', '--show-error', '--http1.1', '--max-time', '5400', '--fail-with-body', '--write-out', '\n[curl] HTTP %{http_code}, %{size_upload} bytes in %{time_total}s (%{speed_upload} B/s)\n', '-F', 'access_token=<-', '-F', `file=@${join(dir, a.name)}`, `${api}/releases/${giteeRelease.id}/attach_files`], { input: token, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
          console.log(out.split('\n').filter(l => l.startsWith('[curl]')).join(' '));
          if (!/"id"\s*:/.test(out)) throw new Error(out.slice(0, 200));
          last = ''; break;
        } catch (e) { last = String(e.stderr || e.message).slice(0, 300); console.log(`upload ${a.name} attempt ${attempt} failed: ${last}`); }
      }
      if (last) throw new Error(`Upload ${a.name} failed: ${last}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
    console.log(`uploaded ${a.name}`);
  }

  files = await requiredJson(
    await gitee(`/releases/${giteeRelease.id}/attach_files?per_page=100`),
    'Gitee attachment list after upload',
  );
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
