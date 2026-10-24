import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Android excludes all application data from cloud backup and device transfer', () => {
  const main = new URL('../src-tauri/gen/android/app/src/main/', import.meta.url);
  const manifest = readFileSync(new URL('AndroidManifest.xml', main), 'utf8');
  const application = manifest.match(/<application\b[^>]*>/)?.[0];
  assert.ok(application, 'application declaration exists');
  assert.match(application, /android:allowBackup="false"/);

  const resource = (attribute) => {
    const name = application.match(new RegExp(`android:${attribute}="@xml/([a-z_]+)"`))?.[1];
    assert.ok(name, `${attribute} references a local XML resource`);
    return readFileSync(new URL(`res/xml/${name}.xml`, main), 'utf8');
  };
  const domains = ['root', 'file', 'database', 'sharedpref', 'external',
    'device_root', 'device_file', 'device_database', 'device_sharedpref'];
  const excluded = (xml) => {
    assert.doesNotMatch(xml, /<include\b/, 'no allowlist can reintroduce data');
    for (const domain of domains) {
      assert.match(xml, new RegExp(`<exclude\\s+domain="${domain}"\\s+path="\\."\\s*/>`),
        `${domain} must be excluded at its root`);
    }
  };
  const legacy = resource('fullBackupContent');
  assert.match(legacy, /<full-backup-content>[\s\S]*<\/full-backup-content>/);
  excluded(legacy);
  const modern = resource('dataExtractionRules');
  assert.match(modern, /<data-extraction-rules>[\s\S]*<\/data-extraction-rules>/);
  for (const mode of ['cloud-backup', 'device-transfer']) {
    const section = modern.match(new RegExp(`<${mode}>([\\s\\S]*?)</${mode}>`))?.[1];
    assert.ok(section, `${mode} rules exist`);
    excluded(section);
  }
});
