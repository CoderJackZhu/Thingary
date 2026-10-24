// Generate winget manifests for the Windows NSIS installer.
// Usage:
//   node scripts/generate-winget-manifest.mjs --version 0.0.8 --installer Thingary_0.0.8_x64-setup.exe --release-date 2026-10-18
//   node scripts/generate-winget-manifest.mjs --version 0.0.8 --sha256 <64 hex chars> --release-date 2026-10-18
// The output is a ready-to-copy directory under packaging/winget/manifests.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const PACKAGE_IDENTIFIER = 'CoderJackZhu.Thingary';
const MANIFEST_VERSION = '1.10.0';
const DEFAULT_LOCALE = 'zh-CN';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith('--')) throw new Error('Unexpected argument: ' + flag);
    const key = flag.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error('Missing value for --' + key);
    args[key] = value;
    index += 1;
  }
  return args;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function indent(text) {
  return text.split('\n').map(line => '  ' + line).join('\n');
}

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(resolve('package.json')));
const version = args.version || packageJson.version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Version must be a semantic version: ' + version);
}
if (args.installer && args.sha256) {
  throw new Error('Use either --installer or --sha256, not both.');
}
if (args.installer && args['installer-name']) {
  throw new Error('--installer-name is only used with --sha256.');
}

const installerName = args.installer
  ? basename(args.installer)
  : (args['installer-name'] || 'Thingary_' + version + '_x64-setup.exe');
if (!/^[A-Za-z0-9._-]+$/.test(installerName)) {
  throw new Error('Installer name contains unsupported characters: ' + installerName);
}

const digest = args.installer ? sha256(args.installer) : args.sha256;
if (!digest || !/^[0-9a-f]{64}$/i.test(digest)) {
  throw new Error('Provide --installer or a 64-character --sha256.');
}
const sha256Upper = digest.toUpperCase();

const releaseDate = args['release-date'] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
  throw new Error('--release-date must be YYYY-MM-DD: ' + releaseDate);
}
const tag = args.tag || 'v' + version;
const baseUrl = args['base-url'] || 'https://github.com/CoderJackZhu/Thingary/releases/download/' + tag;
if (!/^https:\/\//.test(baseUrl)) {
  throw new Error('--base-url must start with https://');
}
const installerUrl = baseUrl.replace(/\/$/, '') + '/' + installerName;
const output = resolve(args.output || 'packaging/winget/manifests');
const directory = resolve(output, 'c', 'CoderJackZhu', 'Thingary', version);
mkdirSync(directory, { recursive: true });

const versionManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_IDENTIFIER}
PackageVersion: ${version}
DefaultLocale: ${DEFAULT_LOCALE}
ManifestType: version
ManifestVersion: ${MANIFEST_VERSION}
`;

const installerManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_IDENTIFIER}
PackageVersion: ${version}
InstallerType: nullsoft
UpgradeBehavior: install
ReleaseDate: "${releaseDate}"
Installers:
- Architecture: x64
  Scope: user
  InstallerUrl: ${installerUrl}
  InstallerSha256: ${sha256Upper}
ManifestType: installer
ManifestVersion: ${MANIFEST_VERSION}
`;

const zhDescription = '物谱是本地优先的个人资产盘点与财务独立测算工具。每月或每季对照各平台录入一次余额和欠款，查看净资产变化，并按自己的条件估算每月要存多少、什么时候可以不靠工资。支持账户与盘点、目标与测算、收支记录、财务复盘和可选的物品档案；金额未知保持未知，不当作零。无需账号，资料保存在本机。界面目前只有简体中文。';

const defaultLocaleManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_IDENTIFIER}
PackageVersion: ${version}
PackageLocale: ${DEFAULT_LOCALE}
Publisher: Jack Zhu
PublisherUrl: https://github.com/CoderJackZhu
PublisherSupportUrl: https://github.com/CoderJackZhu/Thingary/issues
PrivacyUrl: https://thingary.jackzhu.top/privacy/
Author: Jack Zhu
PackageName: 物谱
PackageUrl: https://thingary.jackzhu.top/
License: AGPL-3.0-or-later
LicenseUrl: https://github.com/CoderJackZhu/Thingary/blob/main/LICENSE
Copyright: Copyright © 2026 Jack Zhu
ShortDescription: 每月盘一次家底，算清还要上几年班。
Description: |-
${indent(zhDescription)}
Moniker: thingary
Tags:
- personal-finance
- net-worth
- financial-independence
- fire
- budgeting
- privacy
- local-first
- tauri
ReleaseNotesUrl: https://github.com/CoderJackZhu/Thingary/releases/tag/${tag}
ManifestType: defaultLocale
ManifestVersion: ${MANIFEST_VERSION}
`;

const enDescription = 'Thingary is a local-first desktop app for periodic net-worth check-ins and financial-independence planning. Record balances and debts across accounts, see how net worth changes, and estimate how much to save each month and when work becomes optional. It includes account check-ins, goals and projections, income and spending records, reviews, and optional belongings records. Unknown amounts stay unknown rather than becoming zero. No account or cloud service is required; data stays on the device. The interface is currently Simplified Chinese only.';

const enLocaleManifest = `# yaml-language-server: $schema=https://aka.ms/winget-manifest.locale.${MANIFEST_VERSION}.schema.json

PackageIdentifier: ${PACKAGE_IDENTIFIER}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Jack Zhu
PublisherUrl: https://github.com/CoderJackZhu
PublisherSupportUrl: https://github.com/CoderJackZhu/Thingary/issues
PrivacyUrl: https://thingary.jackzhu.top/privacy/
Author: Jack Zhu
PackageName: Thingary
PackageUrl: https://thingary.jackzhu.top/
License: AGPL-3.0-or-later
LicenseUrl: https://github.com/CoderJackZhu/Thingary/blob/main/LICENSE
Copyright: Copyright © 2026 Jack Zhu
ShortDescription: A local-first net-worth and financial-independence tracker.
Description: |-
${indent(enDescription)}
Moniker: thingary
Tags:
- personal-finance
- net-worth
- financial-independence
- fire
- budgeting
- privacy
- local-first
- tauri
ReleaseNotesUrl: https://github.com/CoderJackZhu/Thingary/releases/tag/${tag}
ManifestType: locale
ManifestVersion: ${MANIFEST_VERSION}
`;

const files = [
  [PACKAGE_IDENTIFIER + '.yaml', versionManifest],
  [PACKAGE_IDENTIFIER + '.installer.yaml', installerManifest],
  [PACKAGE_IDENTIFIER + '.locale.' + DEFAULT_LOCALE + '.yaml', defaultLocaleManifest],
  [PACKAGE_IDENTIFIER + '.locale.en-US.yaml', enLocaleManifest],
];
for (const [name, contents] of files) {
  writeFileSync(resolve(directory, name), contents);
}
console.log(JSON.stringify({
  directory,
  packageIdentifier: PACKAGE_IDENTIFIER,
  version,
  installerUrl,
  sha256: sha256Upper,
  files: files.map(([name]) => name),
}, null, 2));
