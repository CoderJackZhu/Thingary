// 生成 THIRD_PARTY_LICENSES.md：随应用分发的 Rust crate（macOS 目标）与前端生产依赖的名称、版本、许可证。
// 用法：node scripts/third-party-licenses.mjs   （需要 cargo 与已执行 npm ci）
// 只列标识与来源；安装包全文由 distribution-notices.mjs 离线收集。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });

const meta = JSON.parse(run('cargo', ['metadata', '--offline', '--locked', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml', '--filter-platform', 'aarch64-apple-darwin']));
const self = new Set(meta.workspace_members);
const rust = meta.packages.filter(p => !self.has(p.id)).map(p => ({ name: p.name, version: p.version, license: p.license ?? (p.license_file ? `见 ${p.license_file}` : '未声明'), url: p.repository ?? p.homepage ?? '' }));

const tree = JSON.parse(run('npm', ['ls', '--omit=dev', '--all', '--json']));
const seen = new Map();
(function walk(deps) { for (const [name, d] of Object.entries(deps ?? {})) { seen.set(`${name}@${d.version}`, name); walk(d.dependencies); } })(tree.dependencies);
const npm = [...seen.keys()].sort().map(key => {
  const name = seen.get(key), version = key.slice(name.length + 1);
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, 'utf8')); } catch { /* 嵌套安装的包读不到时留空 */ }
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? '未声明';
  const url = (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
  return { name, version, license, url };
});

const table = rows => ['| 名称 | 版本 | 许可证 | 来源 |', '|---|---|---|---|', ...rows.map(r => `| ${r.name} | ${r.version} | ${r.license.replace(/\|/g, '/')} | ${r.url} |`)].join('\n');
const count = rows => [...rows.reduce((m, r) => m.set(r.license, (m.get(r.license) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}（${n}）`).join('、');
const sort = rows => rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

writeFileSync(`${root}THIRD_PARTY_LICENSES.md`, `# 第三方许可证清单

本文件由 \`node scripts/third-party-licenses.mjs\` 生成，列出锁定的 macOS Rust 依赖（保守包含构建依赖）与前端生产依赖及其许可证标识。物谱自身按 [GPL-3.0-or-later](LICENSE) 授权。此清单仅列标识与来源；安装包内 \`许可/THIRD_PARTY_NOTICES.txt\` 附全文与声明，由 \`node scripts/distribution-notices.mjs\` 离线收集，另附每份文本的来源和 SHA-256。补全文本见 [说明](https://github.com/CoderJackZhu/Thingary/blob/main/scripts/license-overrides/README.md)；依赖升级后请重新核对并生成。

## Rust（macOS 目标，${rust.length} 个）

许可证分布：${count(rust)}

${table(sort(rust))}

## 前端生产依赖（${npm.length} 个）

许可证分布：${count(npm)}

${table(npm)}
`);
console.log(`rust ${rust.length}, npm ${npm.length}`);
