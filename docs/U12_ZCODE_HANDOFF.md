# U12 · zcode 顶栏与页面搜索交接

更新：2026-09-29。本文件仅维护接手基线、代码入口、技术风险与启动 Prompt；业务规则以产品设计 3.5 为准，阶段状态只在实施计划 U12 更新。**历史交接文件**：zcode 已按本文件完成 U12a–d，Claude 已复核，当前状态与结果见实施计划 U12 及 [U12 验证记录](verification/U12_TOPBAR_SEARCH_RESULT.md)。

## 1. 基线与授权

- 工作目录：`/Users/jackzhu/Code/Own/Possio`。
- 文档整理时分支 `main`，HEAD `1e41c192f26a9b64f2f557ac0ee576dab49c85e9`（1.12.1）。本次文档是未提交工作区内容，普通新 worktree 不包含它们；直接在本目录接续，不要求新建分支。
- 开始前已存在未跟踪 `.claude/`，不修改、不清理、不提交；根 `.gitignore` 由用户维护。先重新核对实际状态，不 reset/clean，不覆盖用户或其他任务差异。
- 用户已确认方向并指定交给 zcode。接手范围为 U12a–d 顺序开发、必要查询接入、文档、测试和隔离原生验收；完成当前步骤出口即可继续下一步，不需要逐阶段重复批准。
- 不提交、不合并、不推送、不创建 PR、不升版、不安装/发布、不改模型或全局配置，不自动委派其他 agent。最终停在审阅交付。
- **不打开正式 `/Applications/物志.app`，不读取或写入 `~/Library/Application Support/local.possio.main/`。** 原生验收使用独立 identifier（建议 `local.possio.u12.acceptance`）及虚构库，确认构建配置、运行身份和资料路径后再操作；其中“我的资料”也是隔离身份下的虚构资料。不得复用正式版来验证快捷键。

开工执行 `pwd`、`git branch --show-current`、`git rev-parse HEAD`、`git status --short`、`git diff --stat`。若 HEAD 漂移，审查新差异并记录实际起点，不盲目回退。本次文档修改涉及 README、PRODUCT_DESIGN、UI_DESIGN、IMPLEMENTATION_PLAN、CHANGELOG 及本交接文件，必须保留。

## 2. 阅读顺序与职责

1. [README](../README.md)、[AGENTS](../AGENTS.md)：项目约束和运行入口。
2. [产品设计 3.3–3.5](PRODUCT_DESIGN.md#33-搜索与快捷键)：页面矩阵、完整搜索字段、状态、快捷键、U12-AC01–10；D14 查样例规则，第 17 节查金额和来源规则。
3. [实施计划 U12](IMPLEMENTATION_PLAN.md#u12--页面顶栏与搜索统一2026-09-29zcode-实现claude-复核待审阅)：唯一阶段进度表。
4. [UI 设计 U12](UI_DESIGN.md#u12--顶栏与页面搜索2026-09-29已实现待审阅)：布局与同尺寸证据。
5. [ADR-001](decisions/001-local-desktop.md)：既有查询、generation、回执及第 22 节来源/返回契约。U12a 在同一 ADR 补充本次技术接线方案，不另建平行规格。
6. [Q03 验证](verification/Q03_SOURCE_NAVIGATION_RESULT.md)、[Q04 原生验证](verification/Q04_COMPREHENSIVE_NATIVE_RESULT.md)、[最近设置验证](verification/SETTINGS_POLISH_RESULT.md)：只参考方法和风险，旧结果不代替 U12 验收。

产品设计 3.5 中账户标签切换、搜索匹配算法、输入上限、分页与返回状态等是对已确认方向的执行细化。发现实际字段/接口不足，记录在 U12a 并补齐必要只读契约；不要静默删掉页面或字段，也不要扩大成全局检索、拼音搜索、全文索引或数据迁移。

## 3. 已核对的代码入口

本轮用代码图定位入口并核对顶栏文案，未做完整调用链审计。接手后按 AGENTS 优先图查询及源码片段重新核对，图不足再使用本地搜索；以下不是已确定可直接套用的 API 设计。

| 入口 | 接手关注 |
|---|---|
| `src/main.tsx` / App | app-topbar 固定物品搜索与新增；全局键盘、newRef/searchRef、页面切换、样例、模块开关、来源返回上下文及全局 busy/回执 |
| `src/WealthPage.tsx` | 页内已有新增账户/开始盘点，账户列表与其他标签、全体有效账户、盘点打开逻辑 |
| `src/ExpensesPage.tsx` | 页内记一笔支出，年度聚合与列表/日期待补，自动来源和独立支出并存 |
| `src/RecurringPage.tsx`、`src/VirtualPage.tsx` | 页内新增与局部 editing 状态，计划/档案筛选及统计摘要 |
| `src/WishlistPanel.tsx`、`src/WishEditor.tsx` | 已有心愿查询、详情/新增及键盘边界；不得制造第二份编辑状态 |
| `src/Timeline.tsx` / SourceTimelinePage | 领域/年份/类型组合、分页、来源及滚动恢复；搜索必须作用于完整结果 |
| `src/MaterialLibrary.tsx` | 已有 source/category/search 状态、上传恢复锁，迁移入口但保留语义 |
| `src/Trash.tsx` / TrashPanel | 删除项分页、种类筛选、不同恢复路径，完整结果搜索与计数 |
| `src/source.ts`、`src/useSource.ts` | 稳定 ID 定位、generation/请求身份、来源表单与返回恢复 |
| `src/visual-preview.ts`、`src/wealth-preview.ts` | 复用内存虚构适配；需跟随真实查询契约，不另造统计业务逻辑 |
| `src-tauri/src/commands.rs`、`timeline.rs` 等领域查询 | 图追踪实际读路径；按分页需要扩展参数化只读过滤/计数，不能只在前端过滤已加载页 |

样式复用当前顶栏、desktop 样式及领域组件，不做全 App 重构。新增小型共享顶栏/动作/搜索控制组件可按实际需要决定，不引入全局状态库或新运行依赖。默认不改 schema；若确需迁移，先说明证据与影响，不能自动执行。

## 4. 必须解决的接线风险

- 一个动作一份状态：顶栏按钮、空态和 ⌘N 调用同一业务入口，避免复制保存逻辑、隐式 DOM click、window 上零散自定义事件或离页后残留回调。若用注册接口必须有解绑及当前页身份校验。
- 模块自身数据决定 readiness。财富新增不能因物品加载失败永久禁用；提交/切库/未决回执等保护不放松。新增请求不可跨切页/切库继续打开旧表单。
- 拆开列表关键词与聚合统计；物品当前摘要如依赖同一查询也必须纳入修正。搜索所有匹配项再分页，不能拿当前页数量当总数。U12a 记录每页是完整集还是分页、哪些字段在后端才能获得。
- 同时核对前端及原生菜单/事件中的快捷键，防止一次按键触发两次。任何弹窗、输入法组合和待核对提交不能穿透后台；无搜索页不切到物品。
- 搜索词只放会话内存；跨库/generation 更换清空。异步响应必须校验请求身份，错误也一样。回到来源页要等待数据就绪后恢复滚动，不能通过搜索名称代替按 ID 打开。
- 重要支出、周期费用、虚拟资产有交叉展示但不建立第二笔记录；搜索不改变金额来源或去重规则。账户搜索不限制开始盘点的账户集合。
- 样例新增物品保持现有切库规则，其他创建保持所属库，不借统一新增菜单改变数据归属。旧资产/心愿业务模型和数据不重命名。
- 正式资料、真实截图及文件不得进入证据；不为新搜索输出原始关键词到日志或新增持久搜索历史。

## 5. 验证与交付

按产品 U12-AC01–10 给出实际行为证据；新增测试针对分页漏搜、金额口径隔离、请求乱序、上下文返回、快捷键作用域，不只做源码字符串断言。每步先运行相关定向测试；U12d 做一次最终回归，后续只有新修改或失败才重复。

```sh
npm run build
npm run test:ui
npm run check
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --lib --tests -- --test-threads=1
git diff --check
```

这些命令按当前 package.json 核对，但本轮文档准备未执行功能测试。Rust 需 Mac。故障注入只用于测试，不进入普通 App 构建；隔离原生构建复用现有验证方法并先确认身份，不执行 `npm run release`。

浏览器优先 Ego Lite，先读 `~/.codex/skills/ego-browser/SKILL.md`，遵守 TaskSpace、观察、操作和收尾；不可用才按项目规则使用其他工具，记录原因。不要终止非本任务服务。涉及 React/Tauri 等具体 API 用法时按 AGENTS 查 Context7，不能把旧记忆当当前 API 证据。

U12d 新建 `docs/verification/U12_TOPBAR_SEARCH_RESULT.md`：逐 AC 写命令、实际结果、截图路径、原生身份、失败与未验项；截图索引放 `docs/ui/topbar-search/`。界面要求见 UI_DESIGN。浏览器验证不代表原生通过；若原生工具受阻，完成其余工作并准确标“未验证”，不得宣布 U12d 全部完成。

完成后更新实施计划 U12、README 状态、CHANGELOG（未发布）、USER_GUIDE 中当前操作说明与 ADR 技术事实；旧历史验收文案不批量改写。交付准确工作目录、分支、HEAD、变更清单、检查结果与剩余风险，停在审阅，等待用户另行安排集成和发布。

## 6. 可直接复制的启动 Prompt

```text
请在 /Users/jackzhu/Code/Own/Possio 接手 U12「页面顶栏与搜索统一」。先完整阅读 docs/U12_ZCODE_HANDOFF.md，并依其顺序读取 README、AGENTS、PRODUCT_DESIGN 3.3–3.5、IMPLEMENTATION_PLAN 的 U12、UI_DESIGN 的 U12 和相关 ADR。

用户已确认该方案，授权你按 U12a→U12b→U12c→U12d 顺序完成技术核对、顶栏与动作统一、各页面真实搜索、回归和隔离原生验收。每步先通过出口再继续，不是只给方案或逐步等待批准。产品规则以 PRODUCT_DESIGN 3.5 为准，阶段状态只更新 IMPLEMENTATION_PLAN；不要另造一套需求和计划。

交接时 main/HEAD 为 1e41c192f26a9b64f2f557ac0ee576dab49c85e9；本轮交接文档尚未提交。先核对实际分支/HEAD/差异并保留全部现有文档和用户改动，不从 HEAD 重来，不 reset/clean，不修改 .gitignore 和既有 .claude/。直接在当前目录接续。

按交接第 4 节处理风险：页面主操作和快捷键共用真实业务入口；搜索覆盖完整结果后分页，不能只过滤当前页；搜索不改变汇总金额；模块关闭、输入法、模态框、未决回执、请求乱序、切库和来源返回均需正确处理。不要只改文案或放无功能的搜索框。沿用既有表单、金额来源、样例归属及来源 ID 定位，保留侧栏和 A 静序视觉。

仅使用临时虚构数据和隔离原生身份，不打开正式 /Applications/物志.app，不访问 local.possio.main 真实资料。浏览器按 AGENTS 优先 Ego Lite。不要自动委派、切换模型或修改全局配置。

完成 U12-AC01–10 的适当行为测试、浅深色同尺寸证据与隔离原生验证，更新权威文档及 docs/verification/U12_TOPBAR_SEARCH_RESULT.md；明确通过、失败和未验项。工具阻塞时完成不受影响部分，不把浏览器或自动测试当原生通过。最后停在审阅交付，不提交、合并、推送、升版、安装或发布。
```
