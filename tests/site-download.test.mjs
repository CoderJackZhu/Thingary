import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/download.js', import.meta.url), 'utf8');
const { detect, defaultPlatform, installers } = vm.runInNewContext(`${source}\n({ detect: detectThingaryPlatform, defaultPlatform: defaultThingaryPlatform, installers: thingaryDownloads })`);

const cases = [
  ['Mac Chrome client hints', { userAgentData: { platform: 'macOS' } }, 'mac'],
  ['Mac Safari fallback', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }, 'mac'],
  ['Mac UA without platform API', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'mac'],
  ['Windows client hints', { userAgentData: { platform: 'Windows' } }, 'windows'],
  ['Windows legacy platform string', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
  ['Windows UA without platform API', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
  ['iPad desktop mode', { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }, ''],
  ['iPhone Mac OS token', { platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, ''],
  ['Android client hints', { userAgentData: { platform: 'Android' }, platform: 'Linux armv8l' }, ''],
  ['Android UA fallback', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' }, ''],
  ['Windows Phone is not desktop Windows', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0)' }, ''],
  ['Linux has no published installer', { userAgentData: { platform: 'Linux' }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, ''],
  ['unknown browser has no platform hint', {}, ''],
];

for (const [label, browser, expected] of cases) {
  test(`website installer: ${label}`, () => assert.equal(detect(browser), expected));
}

test('website platform menu always starts with an available desktop installer', () => {
  assert.equal(defaultPlatform({ userAgentData: { platform: 'Windows' } }), 'windows');
  assert.equal(defaultPlatform({ platform: 'MacIntel' }), 'mac');
  assert.equal(defaultPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), 'mac');
  assert.equal(defaultPlatform({ platform: 'Linux x86_64' }), 'mac');
  assert.equal(defaultPlatform({}), 'mac');
});

test('website installers link directly to versioned packages, with a universal Mac build', () => {
  assert.deepEqual(Object.keys(installers).sort(), ['mac', 'windows']);
  for (const url of Object.values(installers)) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.host, 'github.com');
    assert.match(parsed.pathname, /^\/CoderJackZhu\/Thingary\/releases\/download\/v0\.0\.7\//);
  }
  assert.ok(installers.mac.endsWith('/Thingary-0.0.7-universal.dmg'));
  assert.ok(installers.windows.endsWith('/Thingary_0.0.7_x64-setup.exe'));
});
