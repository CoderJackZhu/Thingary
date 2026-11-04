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
  ['Android client hints', { userAgentData: { platform: 'Android' }, platform: 'Linux armv8l' }, 'android'],
  ['Android UA fallback', { userAgent: 'Mozilla/5.0 (Linux; Android 15)' }, 'android'],
  ['Windows Phone is not desktop Windows', { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0)' }, ''],
  ['Linux has no published installer', { userAgentData: { platform: 'Linux' }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, ''],
  ['unknown browser has no platform hint', {}, ''],
];

for (const [label, browser, expected] of cases) {
  test(`website installer: ${label}`, () => assert.equal(detect(browser), expected));
}

test('website platform menu starts with an available installer for the detected platform', () => {
  assert.equal(defaultPlatform({ userAgentData: { platform: 'Windows' } }), 'windows');
  assert.equal(defaultPlatform({ platform: 'MacIntel' }), 'mac');
  assert.equal(defaultPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), 'mac');
  assert.equal(defaultPlatform({ userAgentData: { platform: 'Android' } }), 'android');
  assert.equal(defaultPlatform({ platform: 'Linux x86_64' }), 'mac');
  assert.equal(defaultPlatform({}), 'mac');
});

test('website installers link directly to versioned packages, with a universal Mac build', () => {
  assert.deepEqual(Object.keys(installers).sort(), ['android', 'mac', 'windows']);
  for (const url of Object.values(installers)) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.host, 'github.com');
    assert.match(parsed.pathname, /^\/CoderJackZhu\/Thingary\/releases\/download\/v0\.1\.0\//);
  }
  assert.ok(installers.mac.endsWith('/Thingary-0.1.0-universal.dmg'));
  assert.ok(installers.windows.endsWith('/Thingary_0.1.0_x64-setup.exe'));
  assert.ok(installers.android.endsWith('/Thingary-0.1.0-android.apk'));
});

test('all homepage download menus and no-script fallbacks include Android', () => {
  const homepage = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  const menus = [...homepage.matchAll(/<div class="platform-menu"[\s\S]*?<\/div>/g)];
  assert.equal(menus.length, 4);
  for (const [menu] of menus) {
    const platforms = [...menu.matchAll(/data-platform-option="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(platforms.sort(), Object.keys(installers).sort());
  }
  const fallbacks = [...homepage.matchAll(/<span data-download-fallback>([\s\S]*?)<\/span>/g)];
  assert.equal(fallbacks.length, 4);
  for (const [, fallback] of fallbacks) {
    assert.ok(fallback.includes(installers.android));
    assert.ok(fallback.includes(installers.windows));
  }
});
