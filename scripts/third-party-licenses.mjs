// Generate the union of supported release-target Rust inventories and installed
// frontend production dependencies. Full texts are collected separately offline.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot, releaseTargets, rustPackagesForTarget, productionNpmPackages, compareText } from './license-graph.mjs';

const rustById = new Map();
for (const target of releaseTargets) {
  for (const pkg of rustPackagesForTarget(target)) {
    const row = rustById.get(pkg.id) ?? {
      name: pkg.name, version: pkg.version,
      license: pkg.license ?? (pkg.license_file ? `见 ${pkg.license_file}` : '未声明'),
      url: pkg.repository ?? pkg.homepage ?? '', targets: [],
    };
    row.targets.push(target);
    rustById.set(pkg.id, row);
  }
}
const rust = [...rustById.values()].sort((a, b) => compareText(a.name, b.name) || compareText(a.version, b.version));
const npm = productionNpmPackages().map(pkg => ({
  name: pkg.name, version: pkg.version,
  license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? '未声明',
  url: (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, ''),
}));
const cell = value => value.replace(/\|/g, '/');
const table = (rows, targets = false) => [
  `| 名称 | 版本 | 许可证 | 来源 |${targets ? ' 目标 |' : ''}`,
  `|---|---|---|---|${targets ? '---|' : ''}`,
  ...rows.map(r => `| ${r.name} | ${r.version} | ${cell(r.license)} | ${cell(r.url)} |${targets ? ` ${r.targets.join('<br>')} |` : ''}`),
].join('\n');
const count = rows => [...rows.reduce((m, r) => m.set(r.license, (m.get(r.license) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}（${n}）`).join('、');

writeFileSync(resolve(projectRoot, 'THIRD_PARTY_LICENSES.md'), `# 第三方许可证清单

本文件由 \`node scripts/third-party-licenses.mjs\` 生成，列出锁定的 macOS（Apple Silicon、Intel）与 Windows x64 MSVC Rust 依赖并集（保守包含构建依赖，不含仅用于测试的依赖）与前端生产依赖及其许可证标识。目标范围为 ${releaseTargets.map(t => `\`${t}\``).join('、')}；目标列表示该依赖在对应目标的解析图中可达，不代表已经完成原生构建、验收或发布，也不等于二进制中实际链接的包。物谱自身按 [AGPL-3.0-or-later](LICENSE) 授权。此清单仅列标识与来源；安装包内 \`许可/THIRD_PARTY_NOTICES.txt\` 附全文与声明，由 \`node scripts/distribution-notices.mjs\` 按打包目标离线收集，另附每份文本的来源和 SHA-256。补全文本见 [说明](https://github.com/CoderJackZhu/Thingary/blob/main/scripts/license-overrides/README.md)；依赖升级后请重新核对并生成。

直接内置的外部内容不由包管理器发现，另见 [来源告知](SOURCE_NOTICES.md)；随包告知同时附上来源告知。

## Rust（macOS 与 Windows 目标并集，${rust.length} 个）

许可证分布：${count(rust)}

${table(rust, true)}

## 前端生产依赖（${npm.length} 个）

许可证分布：${count(npm)}

${table(npm)}
`);
console.log(JSON.stringify({ rust: rust.length, npm: npm.length, targets: releaseTargets }));
