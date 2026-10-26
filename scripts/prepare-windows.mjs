// Prepare the license resources for a Windows bundle. Does not launch an application.
// Usage: node scripts/prepare-windows.mjs --identity local.thingary.main
//        [--signing-status unsigned|signed] [--packaging nsis|msix] [--output <dir>]
// "signed" is only for a release pipeline that signs the payload before NSIS bundling
// and the installer afterwards; the signature is verified separately after the build.
// MSIX packages are uploaded unsigned and re-signed by the Microsoft Store.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAcceptanceIdentity } from './windows-acceptance-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(name + ' requires a value.');
  return value;
};
const identity = argument('--identity');
if (process.platform !== 'win32') throw new Error('Windows bundle resources must be prepared on Windows.');
if (identity !== 'local.thingary.main' && !isAcceptanceIdentity(identity)) {
  throw new Error('An explicit release or isolated acceptance identity is required.');
}
const signingIndex = process.argv.indexOf('--signing-status');
const signingStatus = signingIndex < 0
  ? (process.env.THINGARY_WINDOWS_SIGNING_STATUS || 'unsigned')
  : process.argv[signingIndex + 1];
if (!['unsigned', 'signed'].includes(signingStatus)) {
  throw new Error('--signing-status must be "unsigned" or "signed".');
}
if (signingStatus === 'signed' && isAcceptanceIdentity(identity)) {
  throw new Error('The isolated acceptance identity must stay unsigned.');
}
const packaging = argument('--packaging') ?? 'nsis';
if (!['nsis', 'msix'].includes(packaging)) {
  throw new Error('--packaging must be "nsis" or "msix".');
}
if (packaging === 'msix' && signingStatus !== 'unsigned') {
  throw new Error('MSIX packages are uploaded unsigned; the Microsoft Store re-signs them.');
}
const outputArgument = argument('--output');
const output = resolve(root, outputArgument ?? '.local/distribution/windows-notices');
if (relative(root, output).startsWith('..')) {
  throw new Error('--output must stay inside the repository.');
}
const store = packaging === 'msix';
const run = (command, args) => execFileSync(command, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 1 << 28,
});
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json')));
const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json')));
const version = packageJson.version;
const cargo = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8');
if (config.version !== version || !cargo.includes('version = "' + version + '"')) {
  throw new Error('Application versions disagree.');
}
const sourceCommit = run('git', ['rev-parse', 'HEAD']).trim();
if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('A Git source commit is required.');
mkdirSync(output, { recursive: true });
run(process.execPath, [
  'scripts/distribution-notices.mjs', output, '--target', 'x86_64-pc-windows-msvc',
]);
for (const file of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'SOURCE_NOTICES.md']) {
  copyFileSync(resolve(root, file), resolve(output, file));
}
const inventory = JSON.parse(readFileSync(resolve(output, 'license-inventory.json')));
for (const dependency of ['rfd', 'windows', 'webview2-com']) {
  if (!inventory.some(entry => entry.ecosystem === 'Rust' && entry.name === dependency)) {
    throw new Error('Missing Windows license inventory entry: ' + dependency);
  }
}
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const info = {
  version, identity, source_commit: sourceCommit,
  source_url: 'https://github.com/CoderJackZhu/Thingary/tree/' + sourceCommit,
  platform: 'windows-x64', packaging,
  signed: signingStatus === 'signed',
  signing_status: signingStatus,
  signing_scope: signingStatus === 'signed' ? 'payload-and-installer' : 'none',
  installer: store
    ? 'MSIX (unsigned; Microsoft Store re-signs after certification)'
    : 'NSIS currentUser',
  acceptance: isAcceptanceIdentity(identity),
  third_party_notices_sha256: sha(resolve(output, 'THIRD_PARTY_NOTICES.txt')),
};
writeFileSync(resolve(output, 'BUILD_INFO.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(resolve(output, '许可与源码.txt'), [
  '物谱 Thingary ' + version,
  info.acceptance ? 'Windows 隔离验收候选包；资料身份为 ' + identity
    : store ? 'Microsoft Store MSIX 提交候选包（未签名；商店认证后重签）'
      : 'Windows 发布候选包',
  '',
  '程序代码按 AGPL-3.0-or-later 授权，完整文本见 LICENSE。',
  '此包对应的源码与锁文件：' + info.source_url,
  '公开发布时必须把此提交的对应源码入口随安装包提供。',
  '第三方全文、作者与来源见 THIRD_PARTY_NOTICES.txt；散列见 license-inventory.json。',
  '直接内置内容见 SOURCE_NOTICES.md。',
  '名称“物谱”“Thingary”及图标使用权保留，不属于 AGPL 授权范围。',
  '修改后再分发请更换名称和图标，避免与官方版本混淆。',
  '',
  store
    ? '由 Microsoft Store 安装和更新；不通过安装包向导。'
    : '当前用户安装，无需管理员。' + (signingStatus === 'signed'
      ? '安装包与程序文件使用 Authenticode 签名；签名在构建后核验。'
      : '未签名；首次下载可能触发 SmartScreen。'),
  store
    ? '商店版要求 Windows 11，系统自带 WebView2；MSIX 不在启动时联网安装运行时。'
    : '缺少 WebView2 时安装器在线下载安装运行时，需要联网。',
  ...(store ? ['应用内不检查新版本；更新由 Microsoft Store 提供。'] : []),
  store
    ? '资料写入应用包存储；卸载商店应用可能删除这些文件，卸载前请导出完整备份。'
    : '默认卸载保留资料；不要勾选卸载器的“删除应用数据”。',
  store
    ? '资料身份仍为 ' + identity + '；完整换机使用 .thingary 备份，不要直接复制包内目录。'
    : '资料在 %LOCALAPPDATA%\\' + identity + '，完整换机使用 .thingary 备份。',
  'Windows 图片只接受 JPEG、PNG、WebP，HEIC/HEIF 请先转换。',
  '此安装包不包含用户资料、数据库或虚构验收备份。',
  '',
].join('\r\n'));
console.log(JSON.stringify(info));
