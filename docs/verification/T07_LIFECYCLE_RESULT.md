# T07：退役、重新启用与日期更正

日期：2026-09-25。用户在 T06c 完成后要求“进入下一个阶段”，并要求“继续”；在原工作树、`codex/t06b-taxonomy-storage` 串行执行，起点 `3c203e8`，未从 main 新建工作树。后端提交 `c211787`，界面与本记录在后续本地提交中。

**结论：T07 的 Active → Retired → Active、状态日期更正及原生持久性验收通过，具备本地集成条件；未合并、推送或发布。** AC20 和 AC21 的 Active/Retired 范围有证据，AC21 的真实 Sold 流程留 T08；完整 P0 尚未完成。任务状态唯一入口是 [实施计划](../IMPLEMENTATION_PLAN.md)。

## 本次实现

- schema 6：当前状态与有序动作历史分开存储；旧资产迁移为 Active，保留资产、分类渠道、图片和建档资料。状态、动作、revision、回执同事务保存。
- 退役/重新启用：日期必填，可选备注；拒绝未来、早于已知购入日期或前次动作的日期。同日按动作序号排列，重新启用不重置购入资料。
- 日期更正：修改原动作日期，保留 ID、备注、顺序和当前状态；不能跨越相邻动作。购入日期更正会列出与已有动作的冲突。
- 详情显示状态历史；列表、摘要、最近删除显示真实状态；增加持有/使用中/已退役筛选。计数明确为“本页”，没有提前实现全局统计。
- 草稿关闭保护、失败保留输入、回执未知时锁定与核对沿用现有模式。深浅色和布局继续采用 A「静序」，退役标签采用原型灰色语义。

## 自动检查与浏览器证据

| 检查 | 实际结果与证据 |
|---|---|
| Rust 全量 | `npm test`：41/41 通过；含原有存储/图片/分类/备份/进程恢复、新增生命周期事务故障、迟到回执、日期邻接、退役删除恢复与重开。[日志](t07/rust-tests.txt) |
| 迁移与备份 | schema 5 → 6 失败整笔回滚、旧删除资产保留；schema 6 备份恢复含动作与状态一致性检查。旧 schema 1–5 接受迁移；原有 schema 3 照片迁移夹具同步清理 schema 6 字段，旧路径回归通过 |
| 前端逻辑 | `npm run test:ui`：17/17 通过；新增状态来源、未知购入日、非法/未来日期和双向邻接约束。[日志](t07/ui-tests.txt) |
| 格式与静态检查 | `npm run check`（fmt、Clippy all-targets、`-D warnings`）通过。[日志](t07/rust-check.txt) |
| 最终构建 | TypeScript/Vite 与隔离 debug App 打包通过；最终原生包已重开，不包含 fault-injection feature。[日志](t07/native-build.txt) |
| 浏览器生产组件 | 保存前失败保留日期/备注；提交成功但丢回执后锁定；查询失败保留原请求；恢复核对不重复写入。回退日期拒绝、同日启用、更正越界拒绝与合法更正通过。[结果](t07/browser-regression.json)、[可重复脚本](../../tests/t07.browser.mjs) |

浏览器使用 Ego Lite TaskSpace 6，已 `finish({keep:[]})` 关闭本任务页面。脚本需在已有 TaskSpace 中对 `http://127.0.0.1:1429/visual-preview.html` 调用 `runT07(page)`，不纳入纯逻辑测试；它包装开发内存 IPC 制造故障，不接触原生库。浏览器浅色流程和深色表单无文档水平溢出；截图调用 `Page.captureScreenshot` 超时，未计作截图验收成功，也未绕过工具限制。真实视觉证据来自下方原生截图。

## 原生隔离资料库验收

沿用 `local.possio.t06b.preview`，仅操作两个已有虚构资产。升级前的 SQLite 保护副本留在 `/tmp/possio-t07-evidence/fictional-schema5.sqlite`，没有提交数据库或真实资料。

1. **升级保留资料**：退出旧包，保存只读基线并启动 schema 6 包。原资产字段、ID、建档时间、分类渠道、封面/附件完全保留；初始状态 Active，未生成虚构动作。[基线](t07/native-before.json)、[升级核对](t07/native-upgrade-check.txt)。
2. **取消与关闭草稿**：打开退役后直接取消，无写入。填写日期 `2026-09-10` 和备注后 ⌘Q 被保护拦住；继续编辑后输入保留。[取消](t07/native-cancel.txt)、[关闭保护](t07/native-close-draft.txt)。
3. **真实写入失败重试**：独立 SQLite 连接持有 `BEGIN IMMEDIATE`，不改变数据；原生保存失败，日期/备注保留。释放锁后重试成功，只有 1 条退役记录，相机 revision 6 → 7。锁连接已关闭。[失败](t07/native-save-failure.txt)、[退役结果](t07/native-retired.txt)。
4. **持有与筛选**：退役后仍持有 2 件，使用中变 1 件；退役筛选匹配相机 1 件。金额仍 ¥1,350.50，购入日仍 `2026-09-01`，日均成本仍 ¥54.02/25 天。[计数](t07/native-retired-counts.txt)、[筛选](t07/native-retired-filter.txt)。
5. **同日启用**：启用日 `2026-09-09` 被拒；改为 `2026-09-10` 成功，revision 7 → 8，先退役再启用，历史 2 条。[日期拒绝](t07/native-activate-invalid.txt)。
6. **动作日期更正**：将退役改为 `2026-09-11` 被拒；改为 `2026-09-05` 成功，revision 8 → 9，原动作 ID/备注和序号不变，仍 Active。[越界拒绝](t07/native-correction-invalid.txt)、[最终数据库核对](t07/native-final-check.txt)。
7. **购入日期冲突**：编辑购入日为 `2026-09-06` 保存被拒，并明确列出退役日 `2026-09-05`，输入保留。恢复原购入日后取消，无额外写入。[原生提示](t07/native-purchase-conflict.txt)。
8. **筛选和计数恢复**：启用后返回已退役筛选，结果 0 件并说明原物品不在当前结果；清除条件回到使用中 2 件/持有 2 件。[筛选](t07/native-retired-filter-after-activate.txt)、[计数](t07/native-active-counts.txt)。
9. **最终包退出重开**：最新构建中同一相机与两条状态历史保留。只读检查 revision 9、原档案字段/建档时间/分类/照片集合/封面不变，原图 SHA256 不变，`integrity_check=ok`、外键检查为空。[重开窗口](t07/native-reopen.txt)、[核对记录](t07/native-final-check.txt)。
10. **实际视觉**：浅色详情、深色更正表单和深色状态历史均已观察，按钮与文字未截断，继续使用 A 基线。[浅色](t07/native-light.png)、[深色表单](t07/native-dark-form.png)、[历史](t07/native-history.png)。这不是完整 VoiceOver/缩放/窗口断点验收。

工具边界：中文填写使用 `sky.set_value`；原生菜单关闭后的 AX 树偶有延迟，再观察后值正确。滚动工具两次返回 `noWindowsAvailable`，窗口读取和点击正常；通过点击历史日期更正入口自动滚入视口后完成截图，未视为 App 崩溃。没有为补截图改变资产事实。

后续运行状态已推进 T08，最新交接以 [T08 记录](T08_SALES_RESULT.md) 为准；下文保留 T07 时点证据。

## Demo 复用说明

以下复用仅指浏览器样例；原生无照片的分类插图兜底尚未接入。Demo 的完整样例和原创 SVG 可以复用，目前 `src/visual-preview.ts` 已从 `src/visual-fixtures.ts` 引用这些插图，并运行同一份生产 `main.tsx`。真实组件按 A 原型实现，同时补上数据库、错误恢复和原生交互；原型的内存保存和未落地功能不能直接作为真实业务。

当前原生验收库仅有两件测试资产，相机 HEIC 是格式验收图，所以看起来比完整 Demo 简单；这不是改选了另一套视觉方向。继续复用布局、色彩和插图，不需重新设计。真实资产依旧显示用户选择的照片，不自动把类型示意图当作已上传实物图。完整业务原型含未来维护/售出，因此其金额和菜单不能直接等同当前已实现功能。

## 跨窗口交接与剩余边界

- 工作目录：`~/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b`；分支仍 `codex/t06b-taxonomy-storage`。先核对 cwd/branch/HEAD/status；主目录未取得此轮实现。
- App：`src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`；窗口标题为“物志 · T07 虚构资料验收”，保留包名和 `local.possio.t06b.preview` 标识以沿用同一虚构库。
- 启动/重打包：沿用被忽略的 `.local/t06b.conf.json`，`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`；通过 app 路径打开。不要把普通 `local.possio.preview` 旧包当最新构建。
- 浏览器开发入口仍为 `npm run dev -- --port 1429` → `http://127.0.0.1:1429/visual-preview.html`，仅内存资料，刷新重置，不能替代原生持久性验收。
- 当前相机为 Active，revision 9；退役 `2026-09-05`，启用 `2026-09-10`。第二件资产仍 Active、revision 3，无状态事件。没有待确认保存或持有中的测试写锁。
- 下一任务 T08 售出与撤销。Sold 目前只有非法来源保护测试，未验证售出交互；维护关系/成本归 T09，全局时间轴归 T14，完整备份界面归 T18，Mac 与辅助功能归 T20。T07 没有提前交付这些功能。
- 具备当前范围的本地集成条件；仍需用户决定集成或下一任务，不自行合并 main、推送或发布。
