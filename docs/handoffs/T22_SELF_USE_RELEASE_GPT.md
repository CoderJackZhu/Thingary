# T22 自用正式版：GPT 执行契约

> review 更正（2026-09-27）：下文原定 identifier `local.possio.app` 以 `.app` 结尾，macOS 会把同名资料文件夹识别为「应用程序」包；review 时改为 **`local.possio.main`**，见 [T22 记录 §7](../verification/T22_SELF_USE_RELEASE_RESULT.md)。

日期：2026-09-26。本文是 T22 的唯一执行入口。P0 已由 CP4 判定完成（见 [T21 报告 §9](../verification/T21_P0_ACCEPTANCE_RESULT.md#9-判定2026-09-26)）；T22 只把现有功能做成可以放真实资料的自用正式版，**不新增产品功能**。本轮只准备材料与 Prompt，不实施 T22。

## 1. 起点与授权

- 工作目录 `/Users/jackzhu/Code/Own/Possio`。从**包含本文的最新 main HEAD** 创建 `codex/t22-self-use-release`，开工记录完整 SHA；先核对 cwd、branch、HEAD、git status，不 reset、不覆盖现有改动。
- 未跟踪 `.gitignore` 是用户文件，SHA256 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`，不暂存、不修改。仓库无远程：不配置、不推送、不发布到任何外部渠道。
- 用户粘贴第 7 节 Prompt 即授权：T22 范围内的配置与少量代码/文档改动、测试、构建、把正式包安装到 `/Applications`、任务分支本地提交。不合并 main（交回 Claude review），不启动 P1。
- 单执行者串行（建议 Sol 中档；数据身份与发布配置请 Astra 审），不启子代理或后台循环，不改全局配置。报告写实际模型与档位。

## 2. 最少阅读

`AGENTS.md`、`README.md`、本文；[实施计划](../IMPLEMENTATION_PLAN.md)开头状态表与 T22 行；[T21 报告](../verification/T21_P0_ACCEPTANCE_RESULT.md) §1、§7–9（release 构建、数据位置、已知限制）；`src-tauri/tauri.conf.json`、`index.html`、`package.json`、`.local/t21-release.conf.json`（本机 release 覆盖配置样例，不入库）。

## 3. 要交付的行为

### 3.1 两套身份，互不串库（最重要）

| 用途 | 配置 | productName | identifier | 窗口标题 |
|---|---|---|---|---|
| 开发/预览（保持默认，不变） | `src-tauri/tauri.conf.json` | Possio Preview | `local.possio.preview` | 物志 · 开发预览 |
| **自用正式版（新增）** | `src-tauri/tauri.release.conf.json`（入库，只覆盖身份/标题/版本） | 物志 | `local.possio.app` | 物志 |

- **不要改默认配置的 identifier**：`npm run tauri dev`、调试构建和所有测试继续落在开发身份，永远碰不到真实库 `~/Library/Application Support/local.possio.app/`。
- 新增脚本 `npm run release` = `tauri build --config src-tauri/tauri.release.conf.json --bundles app`（无 `--debug`，无任何 feature）。
- `productName` 用中文「物志」若导致打包、单实例或启动异常，改用 `Possio` 并在报告说明；identifier 不变。
- 版本号 `1.0.0`（只在正式配置；开发配置可保持 0.0.1）。「关于物志」显示正式名称与版本。
- `index.html` 的 `<title>` 改为中性的「物志」（窗口标题由各自配置决定）。

### 3.2 正式包不含测试入口

在正式包上确认并记录：未启用 `fault-injection`；`dist` 只含正式入口（无 `visual-preview`、`t06-preview` 页面及其脚本）；Demo 导入只是 cargo example、未进 App；无 `possio.qa.*` 测试构建逻辑；CSP 保持。若 `dist` 带出预览页，调整构建输入使正式构建排除它们（开发预览仍可用）。

### 3.3 安装与首次启动

- 构建后用 `ditto` 安装到 `/Applications/物志.app`（或 `Possio.app`）；只替换同名旧正式版，不动其他 App。
- 在**正式身份**下只做无数据的检查：首次启动为空库欢迎状态（「从第一件物品开始」）、离线可启动、⌘Q 后无残留进程、重开正常。**不要在正式身份里新增任何虚构资产**——那是用户的真实库。
- 功能性复测（新增→详情→更正→删除→恢复、完整备份→空库恢复、CSV）用**同一份正式配置加临时 identifier 覆盖**（如 `local.possio.t22.check`，覆盖文件放 `.local/`，不入库）构建的包完成，只用虚构资料；结束后退出。复用 T21 的独立读回脚本思路核对备份与 CSV。

### 3.4 使用说明

新增 `docs/USER_GUIDE.md`（中文、面向非技术用户、1–2 页），README 登记入口：
1. 安装与打开（首次打开若提示来自未认证开发者，如何在「系统设置 › 隐私与安全性」中允许——只写说明，代理不改设置）。
2. 资料存在哪里（`~/Library/Application Support/local.possio.app/`，不要手动改）。
3. **开始录入真实资料后立刻做一次完整备份**，之后定期备份，并把 `.possio` 文件另存到这台 Mac 以外的地方；如何从备份恢复。
4. 完整备份、CSV、最近删除三者区别；CSV 不能用于恢复。
5. 已知限制：见 T21 报告 §8 表末行与 §9（未实测项、无自动备份、未签名公证、未测 macOS 14/Intel）。

## 4. 不做

不新增功能、不改业务规则/schema/恢复协议；不做签名公证、上架、自动更新、同步、P1（CSV 导入、自动备份、提醒等）。不迁移或复制任何测试库（`local.possio.preview`、`*.t06b*`、`*.t18*`、`*.t21*`）到正式库。不改系统设置。

## 5. 验收与检查

| 项 | 通过条件 |
|---|---|
| 身份隔离 | 默认配置身份未变；`npm run tauri dev`/debug 构建仍写 `local.possio.preview`；正式包 Info.plist 的 bundle ID 为 `local.possio.app` |
| 正式包纯净 | §3.2 各项有命令输出证据 |
| 正式身份首启 | 空库、欢迎状态、离线、⌘Q 无残留、重开；截图 1–2 张 |
| 功能复测（临时身份） | 新增→更正→删除→恢复；备份→空库恢复全表一致；CSV 逐行核对 |
| 文档 | USER_GUIDE 覆盖 §3.4 五点；README／实施计划状态更新为「T22 已交回，待 review」 |

最终提交后依次运行并记录退出码与数量：`npm run test:ui`、`npm test`、`npm run test:demo`、`npm run check`、`npm run build`、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`、`npm run release`、`git diff --check`。当前基线：前端 83、Rust 103、Demo 2。

原生操作沿用 T21 交接 §4 的辅助功能方法；每次键盘注入前确认 App 在前台、窗口在 AX 树中可达，用户在前台使用其他应用时暂停并记录。

## 6. 交回

新增 `docs/verification/T22_SELF_USE_RELEASE_RESULT.md`（起点/最终 SHA、实际模型、改动文件、§5 逐项证据、安装位置、正式库状态、剩余风险）。只暂存 T22 文件，在任务分支本地提交后停止。

```text
请 review Possio T22 自用正式版。
工作目录：/Users/jackzhu/Code/Own/Possio
分支：codex/t22-self-use-release
起点 HEAD：<完整 SHA>
最终 HEAD：<完整 SHA>
报告：docs/verification/T22_SELF_USE_RELEASE_RESULT.md
实际模型／档位：<如实>
正式包：<安装路径、bundle ID、版本>；正式库状态：<空库/未写入虚构资料>
最终检查：<命令、退出码、数量>
进程与临时身份库状态：<如实>
```

## 7. 可直接输入 GPT 的 Prompt

```text
请执行 Possio T22「自用正式版」，完成后停止并交回 Claude review。

直接在 /Users/jackzhu/Code/Own/Possio 工作。先核对 cwd、分支、HEAD 和 git status；从包含 docs/handoffs/T22_SELF_USE_RELEASE_GPT.md 的最新 main 创建 codex/t22-self-use-release。不 reset、不覆盖现有改动；未跟踪 .gitignore 是用户文件，保持原样且不提交。仓库无远程，不配置、不推送。

先读 AGENTS.md、README.md，再完整读交接文档并严格执行：保持默认 tauri.conf.json 的开发身份 local.possio.preview 不变；新增入库的 src-tauri/tauri.release.conf.json（productName 物志、identifier local.possio.app、标题 物志、版本 1.0.0）和 npm run release；确认正式包不含故障注入、QA、预览页与 Demo 导入；安装到 /Applications。正式身份下只做空库首启、离线、退出无残留、重开检查，绝不写入虚构资料；功能复测用 .local/ 下的临时 identifier 覆盖构建。新增 docs/USER_GUIDE.md（中文、非技术用户、强调录入真实资料后立即完整备份并异地保存）。

授权：T22 范围内的配置、少量代码与文档改动、测试、构建、安装到 /Applications、任务分支本地提交。不新增功能、不改业务规则或 schema、不做签名公证或 P1、不迁移任何测试库、不改系统设置、不合并 main。原生操作前确认 App 在前台且窗口可达，用户在用其他应用时暂停。

单执行者串行（建议 Sol 中档，数据身份与发布配置请 Astra 审），不启子代理或后台循环，不改全局配置。最终提交后运行交接文档 §5 的完整检查并如实记录；更新 README、实施计划为待 review；按交回格式给出完整 SHA。
```
