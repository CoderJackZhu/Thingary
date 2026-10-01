# Q03 · zcode 开发交接（历史记录）

> 2026-09-28 后续：zcode 已按本交接完成 Q03a–Q03f，结果见 [Q03 记录](../../verification/Q03_SOURCE_NAVIGATION_RESULT.md)。下文保留交接时的状态，不代表当前进度。

更新：2026-09-28。用户在 Q03 开发中改为要求“把任务拆分了，然后准备好相关材料……Prompt……复制给 zcode 来开发”。因此 Codex 停止继续接功能，只做编译衔接、检查与交接整理。**Q03 未完成，不能把这份交接当验收报告。**

## 1. 从哪里开始

- 仓库：`<repo>`。
- 当前分支：`main`；起点 HEAD：`cd4e11125be950840c9ea6457114278cfa331693`（1.8.0）。最新工作在未提交工作区，不在 HEAD 中。
- 未提交内容同时包含 Q00/Q01 设计、已验证的 Q02 和刚开始的 Q03。**不要重置、清理、切换到远程版本，或把所有差异当作本次新增。** 不要用 `git checkout --` 丢弃 Q02。
- `.claude/launch.json` 是既有未跟踪文件，`.gitignore` 由用户维护，均不修改、不纳入提交。
- 只使用当前工作目录继续。若必须分支或隔离，先保留当前工作区全部已授权改动；普通新 worktree 不会携带它们。本次不要求建分支、提交、推送或安装。
- 正式版 `/Applications/物志.app` 及 `~/Library/Application Support/local.possio.main/` 是用户真实资料，**不打开、不读取、不写入**。仅用临时虚构库、开发预览及隔离身份。

先执行只读核对：

```sh
pwd
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
```

若实际状态与本节不同，查看差异来源，不自动 reset/clean。本文件描述的是交接时状态，不覆盖之后的用户改动。

## 2. 唯一权威与材料入口

按顺序阅读；本文件只维护交接状态、风险与 Prompt，不复制产品规则或任务状态表。

1. [README](../../../README.md)、[AGENTS](../../../AGENTS.md)。
2. [实施计划](../../IMPLEMENTATION_PLAN.md)：顶部 Q03a–Q03f 是本次顺序与出口，逐步更新这里。
3. [产品设计](../../PRODUCT_DESIGN.md)第 17.13 节：X-D17、来源跳转、日期/金额口径、D-AC01–10。
4. [ADR-001](../../decisions/001-local-desktop.md)第 22 节：共享读取、target、返回状态与刷新；第 17–21 节按需查领域规则。
5. [Q02 结果](../../verification/Q02_COMPREHENSIVE_RESULT.md)、[实际界面与原方案对照](../../ui/comprehensive/q02/index.html)、[UI 设计](../../UI_DESIGN.md)。
6. [Q01 结果](../../verification/Q01_COMPREHENSIVE_DESIGN_RESULT.md)：历史设计证据及其模拟边界，勿当作功能验收。

本地可操作预览：`http://127.0.0.1:1429/visual-preview.html`；原有服务不是本轮创建，不随意终止。界面工作按 AGENTS 优先 Ego Lite；截图曾连续超时，确实不可用时再按技能使用应用内浏览器。代码图索引曾被自动审批拒绝，理由是可能向服务导出私有源码；不要重试绕过。工具仍不可用时基于本地代码阅读继续。无需为本任务联网发送源码。

## 3. 交接时已有什么

| 状态 | 文件 / 入口 | 接手方式 |
|---|---|---|
| Q02 已完成本阶段验证 | `src/Overview.tsx`、`ReviewView.tsx`、`review.ts`、`review.css`；`src-tauri/src/review.rs` | 保留双视图、金额层级、同源查询与保护。不要重做设计 |
| Q03 后端初稿 | `src-tauri/src/source.rs` 的 Target、validate_source；`timeline.rs` 的 target/domain/missing/years、timeline_with_snapshots、timeline_view | 需要新增定向测试与语义核对，尚不能称完成 |
| 命令已注册 | `src-tauri/src/commands.rs`、`lib.rs`：timeline_view、validate_source | 对照 Tauri 调用参数与返回序列化 |
| 前端类型/打开准备 | `src/source.ts`、`useSource.ts`；WealthPage / ExpensesPage / RecurringPage / VirtualPage / WishlistPanel 的可选 SourceProps | 主应用尚未传 source，不会自动启用；先解决下节竞态，再接线 |
| 新时间轴控件未挂载 | `src/Timeline.tsx` 的 SourceTimelinePage | 现有 main.tsx 仍挂载旧 TimelinePage，保持 Q02 主界面可编译；完成接线后删除过渡双入口，保留一个最终组件 |
| 综合页尚是 Q02 行为 | `ReviewView.tsx` 的近期记录合并、`review.ts` 的 attention.pages、main.tsx 的 onNavigate | 仍是模块级跳转，待换成稳定 target；App 返回上下文未实现 |
| 预览未适配 Q03 | `src/visual-preview.ts`、`wealth-preview.ts` | 目前仅 Q02 命令；timeline_view/validate_source、target 与来源失效样例待加 |

`timeline` 保留原领域查询路径，`timeline_with_snapshots` 才加入财富点位。`review_overview.recent` 当前仍调用原 `timeline`，前端仍合并财富 points。这是过渡边界：**后端 recent 切到含盘点的投影时，必须同一批移除 ReviewView 的前端盘点合并，否则重复。** 不要让财富模块读取失败拖垮原实物 overview；Q02 的局部失败测试已对此有约束。

## 4. 接手必须处理的风险

这些是未完成项，不是已验证能力：

- `useSource` 的 live 检查只包住外层调用；ExpensesPage/WishlistPanel resolver 内 await 后会直接 setState。需把请求身份/取消信号传到 resolver，或改为返回纯结果，再由当前请求统一应用。测试“打开 A、立刻打开 B、A 晚返回”和离页/切库/恢复后的晚返回。
- 各模块可能先加载列表、再 validate_source，随后从较旧的列表取对象。验证存在不等于金额/日期最新。请以稳定 ID 重新读取或在同一来源读取中取得所需数据；同 generation 下更正也必须可见。
- 在源页面尚未准备好时不要消费 target；消费成功后不要因刷新重复弹窗。新的 token 区分同一个 ID 再次打开。
- WealthPage 已有 expectedId 保护初稿：根据 snapshot ID 找到日期后，draft 的 existing.id 必须仍匹配；不能在删除后把同日新建盘点当原记录，也不能自动进入“新盘点”。处理该保护与用户主动切换日期的边界，并补测试。
- validate_source 当前核对 generation、有效 ID、软删除、付款计划关系、付款状态和关联物品。仍需验证各分支，尤其付款更正为 skipped、计划连带删除、退款关联物品已删除、空 ID、跨库 ID。
- wish 来源必须 read_wishlist(id)，不能只把名称放进搜索框。同名与翻页后不在当前列表的档案都要准确打开。
- SourceTimelinePage 当前筛选 UI 只是准备；年份/领域/事件类型组合、空结果、日期待补、年份选项稳定性仍待核对。仅维护日期明确的快照事件，不伪造到期付款。
- 返回滚动位置须在数据渲染后恢复；不能立即设 scrollTop 后被短暂 loading 高度截断。跨库丢弃 returnContext；来源失效时刷新来源页并给提示，不能保留旧金额假装成功。
- 页面打开不代表授权写入：仅显式保存/确认付款才修改资料。普通关闭直接退出，不能新增草稿确认。原有未决提交回执优先于来源打开，不能绕过 busy/恢复核对保护。

## 5. 如何验证与交付

交接前检查结果见实施计划 Q03 交接检查；Q02 报告中的 176 项是**上一阶段基线**，不能代替 Q03 的最终回归。当前未运行 Q03 原生 App、来源往返 UI 或新命令的专项测试。

常用命令：

```sh
npm run build
npm run test:ui
npm run check
cargo test --manifest-path src-tauri/Cargo.toml --lib review::tests
cargo test --manifest-path src-tauri/Cargo.toml --test timeline
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --lib --tests -- --test-threads=1
git diff --check
```

新增测试要验证行为，不只匹配源码字符串。定向数据仅用临时目录中的虚构记录。Rust 测试依赖 macOS；若沙箱 IMAGE_CORRUPT，先按既有证据检查原生框架访问，不改坏图片逻辑。此前并行完整回归出现过 worker 重开 LOCKED，单项与串行重跑通过；如复现，记录而不是静默吞掉。构建现有 >500 kB 包提示不属于本批重构范围。

在 `docs/verification/Q03_SOURCE_NAVIGATION_RESULT.md` 写新增测试、完整回归、实际页面路径、同尺寸截图、未验项与剩余风险；README 登记入口，更新原有计划/ADR/CHANGELOG。不要另建一套需求或任务系统。Q03 出口后停在开发审阅，不自动推进 Q04，不发布/安装。除非用户另行要求，不创建 PR、提交、推送、发送消息或修改模型配置。

## 6. 可直接复制的启动 Prompt

```text
请在 <repo> 接手 Q03 开发。先完整阅读 docs/Q03_ZCODE_HANDOFF.md，并按其中顺序阅读 README、AGENTS、实施计划、产品设计 17.13、ADR-001 第 22 节和 Q02 结果。

这次授权你完成实施计划 Q03a–Q03f：稳定来源与盘点事件、导航/返回上下文、各来源页面接入、综合页与时间轴整合、虚构样例验证及最终回归。按依赖顺序推进，每步先通过对应出口再继续；不是只给方案或等待逐步批准。先核对工作区和已有半成品，先补齐交接文件第 4 节的风险，再继续接线。

当前 main/HEAD 是 cd4e11125be950840c9ea6457114278cfa331693，但 Q00–Q03 的最新工作尚未提交，不能从 HEAD 重来，也不能 reset/clean 或覆盖用户改动。Q02 完成不等于 Q03 完成；SourceTimelinePage 与 SourceProps 尚未在 main.tsx 挂载。最终只保留一套时间轴与来源导航，消除过渡重复。

保持已确认双视图和金额优先，不扩大业务范围；不用名称猜 ID，不重复计算金额或投影盘点，不把失败变成零，处理同 generation 更正、旧响应、来源失效和切库。正式 App 及 local.possio.main 真实库完全不接触；只用临时虚构数据。不要修改 .gitignore 或既有 .claude/ 文件。

完成后更新原有权威文档和 Q03 验证报告，提供实际浅深色/窗口/来源往返证据，明确自动测试与原生 UI 的区别。停在 Q03 审阅交付，不自行进入 Q04，不提交、推送、安装或发布。不自动委派其他 agent，也不改模型/全局配置。遇到真实阻塞，先完成不受影响的工作，再准确说明缺什么。
```
