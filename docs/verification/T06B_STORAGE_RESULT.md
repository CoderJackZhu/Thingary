# T06b：分类与购买渠道接入记录

日期：2026-09-24。范围：稳定分类/渠道 ID、真实存储和资产 UI 接入。分支 `codex/t06b-taxonomy-storage`，基于视觉基线 `3ce42b9`；存储增量 `fdb67ad`。未合并、推送或发布。

## 已完成

- schema 4 → 5 事务迁移，默认分类/渠道、名称统一验证、改名、分类图标与排序；资产可不选择。
- 移除前显示正常与最近删除引用数，必须明确迁移目标或空值；受影响资产 revision 随同事务更新。
- 设置管理、资产新增/编辑、摘要/详情、分类筛选、分类名称搜索接入真实 IPC。继续复用 A「静序」页面布局。
- 请求持久提醒、回执核对、旧修订号和旧数据集拒绝；未携带新字段的旧资产请求保持兼容。
- 备份校验与恢复支持 schema 5，旧备份仍可迁移；完整备份 UI 不在本任务。

## 自动验证

| 检查 | 实际结果 |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --offline --features fault-injection --lib --tests` | 36 项通过，包括既有图片/HEIC、真实测试子进程终止、备份与恢复 |
| 新增存储用例 | 同 ID 改名、分类搜索、正常/最近删除引用迁移、空目标、错误目标、NFC/ASCII 重名、旧修订冲突、旧请求兼容、回执幂等、提交前/后故障、备份恢复 |
| v4 迁移单元用例 | 失败保留 v4，重试成功；再次运行保持已生成 ID |
| `npm run test:ui` | 15 项通过，包括 Unicode 标量计数、NFC 与控制字符；这些是纯逻辑测试，不是原生 UI 自动化 |
| `npm run build` | TypeScript 与 Vite 生产构建通过；开发样例入口未进入生产包 |
| `cargo fmt --check` / Clippy `-D warnings` | 通过 |

原生图片解码在默认沙箱返回 IMAGE_CORRUPT；已通过获准的沙箱外命令重跑全部 Rust 测试，不改变系统权限。schema 3 图片迁移测试的旧库构造同步剥离新增 schema 5 元数据，保留原断言。

## 原生 App 实测

构建：`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`。本地配置覆盖 productName 为 `Possio T06b Preview`、identifier 为 `local.possio.t06b.preview`；配置文件和构建产物不纳入 Git。此标识的独立库只含本轮虚构资料，未读取或修改普通预览库。

通过 Computer Use 实际操作：

1. 设置新建「虚构摄影分类」（摄影图标）和「虚构渠道」。
2. 新增「虚构 T06b 旅行相机」，金额 1200 元、日期 2026-09-01，选择刚建的分类和渠道。
3. 保存进入详情：显示分类、渠道、1200 元、24 个持有日和日均 50 元。
4. ⌘Q 退出后重开，列表仍有这条样例；摘要保留上述分类、渠道与金额/日期。
5. 最终构建中填写「虚构关闭校验」但不保存，⌘Q 被关闭保护拦住；返回设置后输入保留，随后保存成功。见 [关闭保护窗口文字](t06b/native-close-guard.txt)。

证据：[原生详情截图](t06b/native-classification.jpg)、[保存后的窗口文字](t06b/native-save.txt)、[重开后的摘要文字](t06b/native-reopen.txt)。下拉菜单通过键盘 End/Return 选择；AX 直接点击菜单项未触发选值，不据此误报成功。

## 浏览器交互检查

Ego Lite TaskSpace 4，实际组件的内存虚构资料入口 `http://127.0.0.1:1429/visual-preview.html?theme=light`：

- 筛选「摄影」得到唯一相机及金额 9790 元。
- 设置将「摄影」的 1 条引用迁移至「其他」。移除后原筛选显示「已不可用的分类」，没有静默改条件。
- 选择「其他」仍能找到原相机，摘要显示「其他」和「京东」，无水平溢出。
- TaskSpace 已完成并保留结果页。预览刷新重置；SQLite 持久性由上面的真实窗口操作与存储测试验证。

## 结论与下一步

T06b 已接通并具备首轮验证证据。下一步 T06c 在同一分支回归原生改名/图标/排序/迁移、资产更正/图片/删除恢复、关闭保护和错误恢复，核对 AC37 已实现部分后再决定集成。当前没有声称 T06 完整验收或 P0 完成；心愿引用留 T12，完整辅助功能、最低系统和 Intel 兼容留 T20/T21。

T06c 一般走查建议 GPT-6 Astra 中档；遇到事务、迁移或恢复问题再升高档。无需重新派发 Hermes 或 zcode。

## 跨窗口交接

本节只保存接手所需的运行上下文；任务状态仍以实施计划为准，产品规则不在这里另抄一套。新窗口无需读取整段历史聊天。

### 唯一继续开发入口

- 工作目录：`/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b`
- 分支：`codex/t06b-taxonomy-storage`。本次交接整理前的代码 HEAD 为 `d6268cd`，其后只有交接文档更新。
- 已包含的链条：T06a 返修 `7eb1eeb` → A 视觉对齐 `3ce42b9` → 存储 `fdb67ad` → 页面接入与验证 `d6268cd`。
- 主工作树 `/Users/jackzhu/Code/Own/Possio` 仍在 `main` 的 `3b46442`，不是最新开发入口；其中用户未跟踪的 `.gitignore` 保持原样。其他 `Possio-t06a`、`Possio-t06a-repair`、`Possio-visual` 工作树保留，不清理、不覆盖、不重复拣选它们的提交。
- 接手先核对 cwd、分支、HEAD 和 git status；沿用现有工作树，不再复制仓库或从 main 新开一个旧基线。

### 按需读取，控制上下文

1. `AGENTS.md`、`README.md`、`docs/IMPLEMENTATION_PLAN.md` 开头状态表与第 7 节、当前记录。
2. T06c 用到的 `docs/FUNCTIONAL_SPEC.md` AC37，以及资产编辑、图片、删除恢复相关 AC；数据库约束看 `docs/decisions/001-local-desktop.md` 第 12 节。
3. 视觉基线看 `docs/UI_DESIGN.md`、`docs/verification/VISUAL_ALIGNMENT.md`；产品规则有疑问再读 `docs/PRODUCT_DESIGN.md` 对应章节和第 15.2 节。竞品研究已在 `docs/COMPETITOR_RESEARCH.md`，本次回归无需重做调研。
4. 代码按问题局部读取：管理 `src/TaxonomyManager.tsx`，IPC 状态/回执 `src/useTaxonomy.ts`，资产编辑 `src/AssetEditor.tsx`，页面整合 `src/main.tsx`，后端 `src-tauri/src/taxonomy.rs`、`storage.rs`、`catalog.rs`，已有回归 `src-tauri/tests/taxonomy.rs`。优先可用的代码图发现能力；图缺失/过期或工具受限时明确说明并按允许方式定位，不绕过审批拒绝。

### 运行与工具边界

- 浏览器：在上述目录运行 `npm run dev -- --port 1429 --strictPort`，访问 `http://127.0.0.1:1429/visual-preview.html?theme=light`。先核对端口是否已有正确服务；不随意杀进程。1427/1428 是旧阶段预览。会话工具变量、终端 session ID 不作为新窗口依赖。
- 原生：`src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`。若源码变化则重新构建；使用 `.local/t06b.conf.json`，不要直接用默认标识构建后操作旧库。
- 资料隔离：`~/Library/Application Support/local.possio.t06b.preview/library` 仅本轮虚构样例；普通预览库 `local.possio.preview/library` 不在本轮操作范围。已有样例「虚构 T06b 旅行相机」、分类「虚构摄影分类」「虚构关闭校验」、渠道「虚构渠道」。测试不能假定它們永远未变化，先观察。
- 本地配置与产物不进 Git。本机配置当前存在；如果换机器或文件丢失，按下方配置重建，再运行本记录的构建命令。

```json
{"productName":"Possio T06b Preview","identifier":"local.possio.t06b.preview","app":{"windows":[{"label":"main","title":"物志 · T06b 虚构资料验收","width":1080,"height":760,"minWidth":800,"minHeight":600}]}}
```

- 浏览器优先 Ego Lite，先读其 Skill。本轮 TaskSpace 4 已 finish 并保留结果页，新任务不要假定还持有它的控制权。原生用 computer-use Skill 的 Node REPL + Sky；此前截图/AX 已可用，新窗口重新初始化即可。
- 原生 GUI 删除等动作遵守当前 Skill 的即时确认规则：到具体动作时说明对象和原因；不要因为未来可能需要确认就停掉其他检查。测试仅使用虚构资料，不永久删除真实数据。
- 依赖已安装，Rust 缓存已在工作树中；不无故重装全局环境。测试命令和成功证据见上文，新增改动后运行相关检查；不要为消耗上下文重复全量验证。

### T06c 出口

回归分类/渠道改名和引用显示、图标/排序、正常及最近删除引用迁移、资产更正/图片/删除恢复、关闭草稿与未知回执恢复。发现缺陷先记录可复现证据，再做必要修复及针对性复测；分清后端故障测试、浏览器内存流程和原生真实库验收。

完成后更新原有任务状态和验收记录，提交当前分支，报告通过项、缺口及是否可集成。无需重新规划产品或重做 T06a/T06b；本次不提前实现 T07，不自行合并 main、推送或发布。
