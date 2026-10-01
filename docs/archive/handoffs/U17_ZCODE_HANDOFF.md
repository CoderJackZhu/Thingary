# U17 · zcode 标签投入分析开发交接

更新：2026-09-30。本文件是给 zcode 的唯一交接入口，只维护接手基线、执行方式、代码导航、回交与 Prompt；业务事实仍在产品设计、技术在 ADR、页面在 UI 设计、任务状态在实施计划。**2026-09-30 更新：zcode 已按第 7 节 Prompt 完成 U17a–d 开发与自测，停在待独立 Review；回交摘要与证据见[U17 验证报告](../../verification/U17_TAG_INVESTMENT_RESULT.md)，实现在未提交工作区。**

## 1. 接手基线与权限

- 目录：`<repo>`。文档准备时实测分支 `main`，HEAD `6cc4189ecbed56a6b0301abd2cb9a86bc307c6b4`；这是当时快照，开工重新核对，不回退到它。
- **U17 设计尚未提交**，普通从 HEAD 新建 worktree 看不到这些内容。默认在当前目录接续，不自动创建/切换分支、worktree 或 stash。若用户之后另给隔离 checkout，先确认全套 U17 文档已带入再动手。
- 既有 U17 差异：README、CHANGELOG、PRODUCT_DESIGN、IMPLEMENTATION_PLAN、FUNCTIONAL_SPEC、USER_GUIDE、ADR-001、U16_DESIGN_SPEC，及新增 U17_TAG_INVESTMENT_DESIGN、本交接文件。都是本次设计资产，保留。既有未跟踪 `.claude/` 不修改、不清理、不提交；根 `.gitignore` 由用户维护。
- 用户把第 7 节 Prompt 发给 zcode 后，按 U17a → U17b → U17c → U17d 实施并自测；达到阶段出口即继续，不需逐阶段重复请求许可。**本文件本身不触发开发、不授权其他会话自行接续。**
- 不提交、不合并、不推送、不创建 PR、不升版、不发布或安装正式 App、不清理旧构建、不改模型或全局配置，不自动委派其他 agent。保留可审阅的工作区差异，交回用户。
- 不打开 `/Applications/家底.app` 或旧 `/Applications/物志.app`，不读写 `~/Library/Application Support/local.possio.main/`，不得从正式资料取样。原生验收只用隔离身份 `local.possio.u17.acceptance` 和虚构数据；先核对实际 identifier、进程与资料路径，不能仅凭包名判断。

开工分别执行并在验证报告保存输出：

```sh
pwd
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
```

HEAD 或状态变化先读差异，保留他人工作，不 reset/clean。未识别的冲突只暂停涉及的文件，先完成不受影响部分。报告记录“接手时已有文档差异”和“zcode 新增改动”，不能把整份 dirty tree 当成自己实现；后续 Review 以记录的基线、未提交差异及新增文件一起核对。

## 2. 阅读顺序与单一权威

1. [README](../../../README.md)、[AGENTS](../../../AGENTS.md)：当前入口、正式库保护和仓库命令。
2. [产品设计 D23](../../PRODUCT_DESIGN.md#u17-product)及[U17 验收](../../PRODUCT_DESIGN.md#u17-acceptance)：阅读 D23 标题起全文（含开发细化），关联第 6 节成本、D16 标签/排除、3.5 搜索、D17 删除。
3. [U17 实施计划](../../IMPLEMENTATION_PLAN.md#u17)：唯一进度表，zcode 更新 U17a–d；U17r 留给后续 Reviewer。
4. [U17 界面设计](../../ui/U17_TAG_INVESTMENT_DESIGN.md)全部章节，及 [U16 规范](../../ui/U16_DESIGN_SPEC.md)的组件/主题/格式；[U16 设计稿](../../ui/u16/mockup-v3.html)只作现有视觉参照，不把旧稿没有 U17 当成无须设计。
5. [ADR-001 第 25 节](../../decisions/001-local-desktop.md#u17-technical)及 23.2/23.3：读取、字段、排序、身份、返回与测试契约。字段名可以按实际风格收敛，语义不能删减。
6. [U16 验证](../../verification/U16_PARITY_RESULT.md)、[U12 验证](../../verification/U12_TOPBAR_SEARCH_RESULT.md)、[Q04 原生验证](../../verification/Q04_COMPREHENSIVE_NATIVE_RESULT.md)：只参考隔离方法、导航风险和证据形式，旧通过记录不算 U17 通过。

使用代码图优先定位。图未索引先索引，图不足再定向读文件；配置、文案及文档可直接搜索。具体库/API 用法按 AGENTS 查 Context7。浏览器优先 Ego Lite 并先读其 SKILL；不可用时说明后选可用工具。不要安装新工具或换框架来完成本功能。

## 3. 代码导航与必须核对的接线

此表是静态发现的入口，非实现完成证明；实际名称和调用链开工复核，发现漂移先更新 ADR。

| 入口 | 已知作用 | U17 关注点 |
|---|---|---|
| `src-tauri/src/catalog.rs` · `Store::query_assets` | `matching_ids` 后逐件读取，返回 Page | 不从其单页 items 算标签合计；沿用标签归属及过滤字段 |
| `src-tauri/src/maintenance.rs` · `summary` | 维护已知金额/未知条数，完整总投入可为空 | 复用业务语义，不把 null 强制变成完整零成本 |
| `src-tauri/src/insights.rs` · `Store::stats_snapshot` | 统计排除与有效销售 | 复用 `exclude.statistics` 资格，避免维护 JOIN 倍增；不改全局统计含义 |
| `src-tauri/src/worker.rs` · `Worker::call` | 按当前 demo_mode 选择 Store | 用当前库只读聚合，回传同库身份，不能借 call_personal 绕过样例 |
| `src-tauri/src/commands.rs` 与 `lib.rs` | IPC 命令入口及注册 | 新读命令接线，正常包不带故障注入 |
| `src/main.tsx` · `openSource`/`beginReturn` | 按稳定 ID 打开来源并保存返回信息 | 两层返回、来源列表上下文、删除后返回、切库失效；完整调用链待 U17a 核对 |
| `src/topbar.tsx` · `usePageBar` | section 动作注册与最新回调 | 分析没有新增；详情仍用原操作；不要落回 assets 默认 ⌘N |
| `src/Batch.tsx` · `BatchPanel`；`src/batch-select.ts` · `batchSummary` | 多选购入小计 | 不能拿批量面板代替分析；进入分析不触发批量操作 |
| 标签选择/停用、样例和预览入口 | 图工具继续发现，ADR 25.6 列出待核对项 | 停用仍可分析但新建不能重新选用；浏览器/原生共享虚构事实，无真实库补录 |

推荐新分析组件和纯格式/状态辅助函数独立于大 App 函数，Rust 聚合留在现有数据层风格中；不为本任务重构无关页面。新文件名在 U17a 定稿并记录，不要求照交接凭空造文件。

## 4. 阶段执行与判断边界

- **U17a**：先记录起点及上述接线，完成 ADR 25.6 核对表；产出按 U16 的同尺寸视觉稿（正常、缺失、空/错误布局可复用组件），在证据索引标为设计稿；确定接口字段、错误、100 件分段与两层返回。既定范围内的命名和布局细节直接落实，不将每个技术选择变成确认问题。
- **U17b**：独立夹具驱动只读聚合及定向业务测试；关键断言来自 D23 的人工预期，不能靠前后端同函数互证。先验证空值/零、多维护、有效销售、排除及超过一页，保证真正全量。
- **U17c**：完成列表入口、子视图、明细搜索/比例、档案返回、样例/预览；定向测试乱序请求与快捷键；同样数据、主题和尺寸对比设计稿，修正可见差异。
- **U17d**：全量检查一次，执行隔离原生操作与重开、切库、备份恢复；填写全部 AC 的实际结果及限制。遇到工具/权限阻塞记录命令和原因，完成无关部分，原生未执行不得写通过。
- **U17r**：不由 zcode 自行宣布完成。用户带回结果后由本对话独立 Review：检查实际 diff、回交证据、关键计算与原生风险，再报告发现。Review 不自动合并或发布。

只有改变已确认业务语义、增加迁移/依赖/跨模块范围、修改既有导航或数据保护边界时，才暂停对应工作并说明需要用户决定的取舍。不以“能编译”代替功能完成，不静默缩减未知金额、停用标签或返回上下文要求。

## 5. 验证证据与报告格式

定向检查先行；最后根据实际改动完成以下现有脚本（名称来自本仓库 package.json，不是新命令）。若改动涉及样例，`test:demo` 必跑：

```sh
npm run test:ui
npm test
npm run check
npm run build
npm run test:demo
git diff --check
```

不运行 `npm run release`，不安装正式包。隔离原生构建的方法参考既有验证记录并核对实际配置；验证报告写下准确命令、配置路径、identifier、bundle 路径及源代码版本/差异，不可只写“原生通过”。运行 App 前验证身份；通过键盘驱动时每次确认前台与可访问窗口，失焦就停止注入。

开发后创建唯一结果文件 `docs/verification/U17_TAG_INVESTMENT_RESULT.md`（本次尚不创建）。章节必须包含：

1. **基线与变更边界**：接手/交付目录、分支、HEAD、git status；已有文档和本次新增文件清单；不提交时注明 HEAD 不包含工作区实现，报告自身更新与最后测试代码是否一致。
2. **实现核对**：ADR 25.6 接线表的实际函数、拟议与实际接口差异、无 schema/依赖变化的核对；有偏差说明原因，不在结果报告另造产品规则。
3. **命令与结果**：命令、日期、退出码、通过/失败数、日志路径、失败原因与重跑记录；后续改代码必须重跑受影响检查，不能用改前全量结果盖章。
4. **AC 证据矩阵**：逐项列 U17-AC01–11 的前置夹具、操作、预期出处、实际数字/行为、测试/截图路径、通过/失败/部分/未执行。复合 AC 子场景有一项缺证据就不能全项通过。
5. **视觉证据**：`docs/ui/tag-investment/index.html`，正常态 B/C/D × 浅深 × 常规/窄窗共 12 组同尺寸设计/实现对照；默认主题浅深补空、缺失、无搜索结果和错误状态；其他主题抽查状态对比度。不要只提交一个正常态大截图。
6. **原生证据与资料隔离**：实际临时身份/资料路径、启动前检查、UI 操作、重开数据、切换隔离样例/我的资料、备份恢复；不含任何正式库内容。备份二进制/数据库不提交仓库，只记录虚构断言和必要截图。
7. **自检重点**：缺失不冒零、占比分母、跨页、售出回收、两层返回、竞态、⌘N/⌘A、未知回执/普通关闭未被改坏；列出未验边界和残余问题。
8. **回交摘要**：采用第 6 节格式，更新实施计划阶段状态和文档；标注“zcode 自测完成，待独立 Review”，不写“已发布”。

AC 与证据层的最小映射：AC01–07/10 需要真实 Rust/SQLite 断言；AC03–04/08–09/11 需要前端交互或原生可观察行为；AC08 需明确命中第 101 件以上；AC09 需同时验证旧成功和旧失败；AC11 需视觉对照与原生快捷键。数据层通过不自动使整条 AC 通过，截图也不能代替后台去重断言。

## 6. 回交给用户，再由用户启动 Review

```text
U17 zcode 开发回交（待独立 Review，未提交/未发布）
目录：
分支 / 接手 HEAD / 当前 HEAD：
接手已有文档与本次新增改动：
已完成阶段 / 尚未达到出口的阶段：
验证报告：docs/verification/U17_TAG_INVESTMENT_RESULT.md
视觉索引：docs/ui/tag-investment/index.html
最终测试命令与结果：
隔离原生 identifier / 包路径 / 虚构资料路径：
AC 通过 / 部分 / 未执行及原因：
业务或技术偏差 / 已知风险：
待 Reviewer 重点核对：
```

中断时把当前阶段、实际改动、已跑命令、未完成问题及下一条具体操作写入同一验证报告，不依赖聊天记忆。用户通知本对话后再 Review，不自动发消息或建立监控。

## 7. 可直接复制给 zcode 的启动 Prompt

```text
请在 <repo> 完成 U17「标签投入分析」开发。

先完整阅读 docs/U17_ZCODE_HANDOFF.md，并按其中第 2 节顺序读取 README、AGENTS、PRODUCT_DESIGN 的 D23（含开发细化与 U17-AC01–11）、IMPLEMENTATION_PLAN 的 U17、UI 的 U17_TAG_INVESTMENT_DESIGN/U16_DESIGN_SPEC、ADR-001 第 25 节。需求、UI、技术与进度各以对应原文为准，不另起一套规格。

我授权你按 U17a → U17b → U17c → U17d 顺序完成技术核对与视觉稿、数据聚合、页面及统一虚构样例、测试与隔离原生验收。每阶段达到出口即可继续，无须逐阶段问我。具体工作方式、检查和回交格式执行交接文档第 3–6 节。U17r 独立 Review 留给我之后交回原 Codex 对话处理。

开工先核对目录、分支、HEAD 和工作区。交接时是 main / 6cc4189ecbed56a6b0301abd2cb9a86bc307c6b4，但以你实际检查为准，不回退。U17 文档尚未提交，直接从当前目录接续，不新建/切换分支或 worktree、不 stash、不 reset/clean；保留现有设计文档、.claude/ 和用户改动，不修改根 .gitignore。

重点遵守 D23：真实标签 ID 和全量未删除物品；历史全部默认含售出，可切当前持有；购入+有效维护为累计投入，售出回收单列；沿用 exclude.statistics；未知不冒充零，缺失时全组占比隐藏；分母不受搜索/分段影响；每段 100 件、先全量搜索；两层返回、切库和晚响应守卫；不增加跨模块统计、多标签、预算、迁移或依赖。复用 U16 三主题组件，不用批量面板代替分析。

只用虚构资料和隔离身份 local.possio.u17.acceptance，不打开 /Applications/家底.app 或旧物志.app，不读取或写入 local.possio.main 的正式资料。普通构建不带故障注入。不要委派其他 agent，不改全局配置。

完成后按交接文档创建 docs/verification/U17_TAG_INVESTMENT_RESULT.md 与 docs/ui/tag-investment/index.html，逐项记录实际 AC 证据、最终检查和未验项，更新实施计划、ADR 实际接线、README、使用说明及 CHANGELOG，注明未发布。工具阻塞就完成其他部分并如实列缺口，不能把模拟预览当原生通过。遇到必须改变业务语义/范围/资料保护边界的情况，暂停该部分并说明，不静默改变方案。

最终给出第 6 节回交摘要，停在“待独立 Review”。不提交、不合并、不推送、不创建 PR、不升版、不安装正式版、不发布或清理旧构建。我会把你的结果交给原 Codex 对话 Review。
```
