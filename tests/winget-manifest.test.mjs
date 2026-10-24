import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('winget manifest generator writes a complete, versioned manifest set', () => {
  const output = mkdtempSync(join(tmpdir(), 'thingary-winget-'));
  try {
    execFileSync(process.execPath, [
      'scripts/generate-winget-manifest.mjs',
      '--version', '9.9.9',
      '--sha256', 'A'.repeat(64),
      '--release-date', '2026-01-02',
      '--output', output,
    ], { cwd: root });

    const directory = join(output, 'c', 'CoderJackZhu', 'Thingary', '9.9.9');
    const files = [
      'CoderJackZhu.Thingary.yaml',
      'CoderJackZhu.Thingary.installer.yaml',
      'CoderJackZhu.Thingary.locale.zh-CN.yaml',
      'CoderJackZhu.Thingary.locale.en-US.yaml',
    ];
    for (const file of files) assert.ok(existsSync(join(directory, file)), file);

    const version = readFileSync(join(directory, 'CoderJackZhu.Thingary.yaml'), 'utf8');
    assert.match(version, /PackageVersion: 9\.9\.9/);
    assert.match(version, /DefaultLocale: zh-CN/);
    assert.match(version, /ManifestVersion: 1\.10\.0/);

    const installer = readFileSync(join(directory, 'CoderJackZhu.Thingary.installer.yaml'), 'utf8');
    assert.match(installer, /InstallerType: nullsoft/);
    assert.match(installer, /Scope: user/);
    assert.match(installer, /ReleaseDate: "2026-01-02"/);
    assert.match(installer, /InstallerSha256: A{64}/);
    assert.match(installer, /releases\/download\/v9\.9\.9\/Thingary_9\.9\.9_x64-setup\.exe/);

    const en = readFileSync(join(directory, 'CoderJackZhu.Thingary.locale.en-US.yaml'), 'utf8');
    assert.match(en, /PackageLocale: en-US/);
    assert.match(en, /ManifestType: locale/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
