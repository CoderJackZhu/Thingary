# T21 完整 P0 验收：GPT 执行契约

日期：2026-09-26。本文是 T21 的唯一执行入口；产品设计与功能规格仍是业务权威。用户要求 T20 完成后把 T21 交给 GPT，本轮只准备材料与 Prompt，不实施 T21。

## 1. 起点与授权

- 工作目录：`<repo>`。准备时 main 为 `cf39e99`（含 T12–T20），实际从**包含本文的最新 main HEAD** 开始，开工时记录完整 SHA。
- 先核对 cwd、branch、HEAD、git status；从最新 main 在主目录创建 `codex/t21-p0-acceptance`。分支已存在先检查内容；不覆盖、不 reset、不使用旧 `outputs/Possio-t06b` 工作树。
- 未跟踪 `.gitignore` 是用户文件，SHA256 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`，不暂存、不修改。仓库没有远程：不配置、不推送、不发布。
- 用户粘贴第 7 节 Prompt 后，授权：逐项验收、编写验证报告与交付说明、为验收所需的**小型**缺陷修复（带测试）、任务分支本地提交。不得合并 main，不宣布 CP4／P0 通过——最终判定由 review 与用户作出。
- 计划要求：Sol 整理并执行验收；Astra High 独立核验缺口与最终出口（[实施计划 §4 T21 行、§7](../../IMPLEMENTATION_PLAN.md#7-模型成本codex--hermes-与协作入口)）。单执行者串行，不启动子代理、MoA 或后台循环，不改全局配置。报告写明实际模型与档位。

## 2. 最少阅读顺序

先读 `AGENTS.md`、`README.md`，再完整读本文。其后局部阅读：

1. [实施计划](../../IMPLEMENTATION_PLAN.md)：开头状态表、§4 T21 行、§5 CP4、§6 AC 归属表（「必要补验时点」列即 T21 待补项）。
2. [功能规格](../../FUNCTIONAL_SPEC.md) AC01–AC44 全表、E01–E09、§8 验证计划；[产品设计](../../PRODUCT_DESIGN.md) §15。
3. 各阶段记录的「剩余边界／未验证」章节：`docs/verification/T0*_RESULT.md`…`T20_MAC_EXPERIENCE_RESULT.md`、`VERIFICATION_REPORT.md`、`VISUAL_ALIGNMENT.md`、`U01_MATERIAL_LIBRARY_RESULT.md`。只引用结论与链接，不重抄全文。
4. [ADR-001](../../decisions/001-local-desktop.md) R01–R07。代码用 codebase-memory 图工具发现（未索引先索引），局部阅读。

## 3. 交付物

- `docs/verification/T21_P0_ACCEPTANCE_RESULT.md`：
  - 环境：macOS 版本、芯片、Xcode/Rust/Node/Tauri 版本、构建命令、包大小、数据规模（资产／心愿／图片数）。
  - **AC01–AC44 逐项表**：AC、主责任任务、证据来源（既有记录链接或本轮新证据）、本轮是否复测、结论（通过／部分／未执行／失败）、缺口。不得因主责任任务已出口就写「通过」；只有实际证据覆盖整条 AC 才写通过。
  - R01–R07 对应结论；未测的旧系统／Intel 不写成受支持（Info.plist 最低 14.0）。
  - 需要用户本人完成的检查清单（见 §5 末）。
  - 发现的缺陷：复现、根因、所属原任务、修复提交与受影响范围复测；未修复的列为阻塞或非阻塞并说明理由。
- 交付说明（可在同一报告末节）：如何构建与启动、数据位置、备份／恢复／CSV 的区别、已知限制。
- README 与实施计划状态更新为「T21 验收已交回，待 review」。

## 4. 本轮必须补的实测（T21 补验点）

| AC | 本轮补验 |
|---|---|
| AC01／AC39 | **正式（release，非 debug）打包**后离线启动：断网（或确认无网络请求）完成新增→详情→更正→删除→恢复；⌘Q 退出后无残留进程（含无自建 HTTP 服务、无监听端口）；重开记录与外观保持。 |
| AC14 | 跨日刷新：保障「今天到期／30 天内」在日期变化后正确（可用固定日期注入测试或已有 `refreshCostsForNewDay` 路径的测试；原生若无法改系统时间则写明）。 |
| AC26 | 售出后真实买回建新资产：两个不同 ID、各自历史与成本独立。 |
| AC30 | 同一库分别做完整备份与 CSV：说明并实测两者含义不同（CSV 不能恢复、备份不可读表格）。 |
| AC31–AC34 | 空目录完整恢复、坏备份不覆盖、恢复阶段中断后选择完整数据集、备份期间写入排队与取消面板不写文件：复用 T18 自动与原生证据，补正式包上的至少一次备份→空库恢复。 |
| AC35／AC36 | 口径与缺失、月末与闰日：复用 T15–T17 独立 SQL 结论，补一次在正式包数据上的独立算回。 |
| AC40 | 缺图占位与修复、不支持格式可取消、键盘主流程与深浅色可读：复用 T05／T20，正式包上抽检。 |
| AC43／AC44 | 最近删除入口（侧栏与设置）、重试幂等：复用 T11，正式包抽检。 |

其余 AC 以既有记录为证据逐项核对；记录中写明「未验／留待」的，要么本轮补，要么在表中如实标「部分」。

### 正式包与数据隔离

- 正式包不要用默认标识 `local.possio.preview`（那是普通库，不得写入）。新建本机配置 `.local/t21-release.conf.json`（`.local/` 不入库），仿照 `.local/t18-empty.conf.json` 设独立 `identifier`（如 `local.possio.t21.release`）、`productName`、窗口标题，执行 `npm run tauri -- build --config .local/t21-release.conf.json --bundles app`（不加 `--debug`）。只用虚构资料。
- 需要已有数据的场景可用隔离 debug 包 `local.possio.t06b.preview` 的虚构库，或把其完整备份在 T21 身份中恢复。操作前按 `library/active.json` 动态定位数据集并做一致性快照（`library/backups/t21-before-*.sqlite`）；不重置、不重新导入 Demo。
- 真实发票、序列号、数据库、备份和凭据不入库。

### 原生操作方法（已验证可用）

- WKWebView 内点击用辅助功能 API（`AXUIElementCreateApplication(pid)` 遍历窗口、`AXPress` 按标签），`System Events click at` 到不了网页；先 `activate` App，否则窗口列表为空。
- 截图：`screencapture -x -o -l <CGWindowID>`（从 `CGWindowListCopyWindowInfo` 取）。窗口尺寸可经 `AXSize` 设为 800×600。
- 原生保存／打开面板：面板是单独 AX 窗口，按钮可直接 `AXPress`（Cancel／导出／保存备份）；改目录用 ⌘⇧G，把前往框的值经 AX 设为短路径（如 `/tmp/possio-t21`）后回车。中文经 `LANG=en_US.UTF-8 pbcopy` 粘贴。
- `<select>`：AX 聚焦该 `AXPopUpButton` 后空格展开、方向键、回车。
- **每次键盘注入前**确认 Possio 在前台且目标窗口在 AX 树中可达；用户在前台使用其他应用时停止注入并记录。面板若出现在其他桌面空间（不在屏幕窗口列表），不要盲按，正常结束 App 后重来。
- `kill -9` 会丢失新写入的 WebKit localStorage；回执丢失类场景按 T10/T11/T13 方法用临时 QA 构建，不提交。

## 5. 不做与需用户完成

- 不新增产品功能，不改业务规则、schema 或恢复协议；遇到须改规则的缺陷，携复现与建议交回。
- 不做公开分发、签名公证、上架、双语。
- 需用户本人完成（代理不改系统设置）：运行中切换系统深浅色观察「跟随系统」、VoiceOver 朗读主流程、显示器缩放／辅助字号、物理点击 Dock、断网（若需关闭 Wi-Fi）。在报告中给出逐步检查单，结论写「待用户」。

## 6. 检查、提交与交回

最终 HEAD 上依次运行并记录退出码与数量：`npm run test:ui`、`npm test`、`npm run test:demo`、`npm run check`、`npm run build`、隔离 debug 包构建 `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`、正式包构建、`git diff --check`。当前基线：前端 82、Rust 103、Demo 2。修复后复测，不用提交前日志代替。只暂存 T21 文件，在任务分支本地提交后停止。

交回格式：

```text
请 review Possio T21 完整 P0 验收。
工作目录：<repo>
分支：codex/t21-p0-acceptance
起点 HEAD：<完整 SHA>
最终 HEAD：<完整 SHA>
报告：docs/verification/T21_P0_ACCEPTANCE_RESULT.md
实际模型／档位：<如实>
AC 汇总：通过 <n>／部分 <n>／未执行 <n>／失败 <n>；阻塞项：<列表>
最终检查：<命令、退出码、数量>
待用户检查：<列表>
进程与隔离库状态：<如实>
```

## 7. 可直接输入 GPT 的 Prompt

```text
请执行 Possio T21「完整 P0 验收」，完成后停止并交回 review。

直接在 <repo> 工作。先核对 cwd、分支、HEAD 和 git status；从包含 docs/handoffs/T21_P0_ACCEPTANCE_GPT.md 的最新 main 创建 codex/t21-p0-acceptance。不 reset、不覆盖现有改动；未跟踪 .gitignore 是用户文件，保持原样且不提交。仓库无远程，不配置、不推送。

先读 AGENTS.md、README.md，再完整读交接文档，按其阅读顺序、§4 补验表和数据隔离规则执行：AC01–AC44 逐项给出证据与结论（通过／部分／未执行／失败），既有阶段出口不等于整条 AC 通过；补 release 正式包（独立 identifier，不写普通库 local.possio.preview）上的离线、退出无残留、重开保持、备份→空库恢复与 CSV 含义等实测。只用虚构资料；操作隔离库前做一致性快照。原生操作用辅助功能 API，每次键盘注入前确认 Possio 在前台且窗口可达，用户在用其他应用时停止。

授权：验收、报告与交付说明、验收所需的小型缺陷修复（带测试）、任务分支本地提交。不新增功能、不改业务规则或 schema，需要时携复现交回。不合并 main、不宣布 CP4 或 P0 通过。系统外观实时切换、VoiceOver、显示缩放、物理 Dock 点击列为待用户检查单。

单执行者串行（建议 Sol 中档执行、Astra High 独立核验出口），不启子代理或后台循环，不改全局配置。最终提交后运行交接文档 §6 的完整检查并如实记录；按交回格式给出完整 SHA。
```
