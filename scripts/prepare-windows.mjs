// Prepare the license resources for an NSIS build. Does not launch an application.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isAcceptanceIdentity } from './windows-acceptance-identity.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const identity = process.argv[process.argv.indexOf('--identity') + 1];
if (process.platform !== 'win32') throw new Error('NSIS resources must be prepared on Windows.');
if (identity !== 'local.thingary.main' && !isAcceptanceIdentity(identity)) {
  throw new Error('An explicit release or isolated acceptance identity is required.');
}
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
const output = resolve(root, '.local/distribution/windows-notices');
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
  platform: 'windows-x64', signed: false, installer: 'NSIS currentUser',
  acceptance: isAcceptanceIdentity(identity),
  third_party_notices_sha256: sha(resolve(output, 'THIRD_PARTY_NOTICES.txt')),
};
writeFileSync(resolve(output, 'BUILD_INFO.json'), JSON.stringify(info, null, 2) + '\n');
writeFileSync(resolve(output, '许可与源码.txt'), [
  '物谱 Thingary ' + version,
  info.acceptance ? 'Windows 隔离验收候选包；资料身份为 ' + identity : 'Windows 发布候选包',
  '',
  '程序代码按 AGPL-3.0-or-later 授权，完整文本见 LICENSE。',
  '此包对应的源码与锁文件：' + info.source_url,
  '公开发布时必须把此提交的对应源码入口随安装包提供。',
  '第三方全文、作者与来源见 THIRD_PARTY_NOTICES.txt；散列见 license-inventory.json。',
  '直接内置内容见 SOURCE_NOTICES.md。',
  '名称“物谱”“Thingary”及图标使用权保留，不属于 AGPL 授权范围。',
  '修改后再分发请更换名称和图标，避免与官方版本混淆。',
  '',
  '当前用户安装，无需管理员。未签名；首次下载可能触发 SmartScreen。',
  '缺少 WebView2 时安装器在线下载安装运行时，需要联网。',
  '默认卸载保留资料；不要勾选卸载器的“删除应用数据”。',
  '资料在 %LOCALAPPDATA%\\' + identity + '，完整换机使用 .thingary 备份。',
  'Windows 图片只接受 JPEG、PNG、WebP，HEIC/HEIF 请先转换。',
  '此安装包不包含用户资料、数据库或虚构验收备份。',
  '',
].join('\r\n'));
console.log(JSON.stringify(info));
