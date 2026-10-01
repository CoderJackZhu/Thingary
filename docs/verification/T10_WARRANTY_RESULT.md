# T10 保障档案实现与验收记录

日期：2026-09-25。执行：Z code（GLM-5.3 单执行者串行；未启用子代理、Hermes、MoA 或其他执行器；未统计 Token 费用）。

当前状态：**Codex review 修复与原生核心补验完成，按用户授权本地合并 main**。最新结论以第 10 节为准；第 1–9 节保留 Z code 交回时的历史记录。CP2/P0 未完成。

## 1. 起点、分支与提交

- 工作目录：`<repo>`（主目录，未使用 `outputs/` 旧工作树）
- 分支：`codex/t10-warranties`（自含 T10 交接文档的 main 创建）
- 起点 HEAD：`d5630643eadb5ef0ad0a36a3660e41f7622538a9`（开工时 `git status` 仅未跟踪 `.gitignore` 用户文件，保持原样未提交，SHA256 `b93631bb…53f21b9` 与契约一致）
- 代码提交：`2dee0c92e4180cbc4d80593d2b73ecde2ebfe709`（feat: add T10 warranty records with schema 10 migration，25 文件 +2043/−48）
- 本报告提交：见交回信息最终 HEAD；本提交只改文档与证据，父代码提交即上行的 `2dee0c9`。
- 未合并 main、未推送、未配置远程、未推进 T11。

## 2. 范围与关键实现决定

仅做 T10 交付范围：保障新增／同 ID 更正、多份展示、查询时派生状态摘要、资产保障筛选、跨日刷新、保障图片、草稿与失败恢复、schema 9→10 迁移与备份恢复覆盖。不做独立删除（T11）、通知、PDF、CSV、AI、同步、总览、全局时间轴或新一轮视觉设计。

- **schema 10**（`warranties`、`warranty_photos`、`warranty_audit` + 起止顺序触发器）：一个 SQLite 事务内完成，失败整笔回滚（测试注入中断验证停留 v9、无残留表）。`warranties.deleted_at` 列随本版建立但 T10 不写入，为 T11 独立删除语义预留。类型白名单：厂家保修、延保、AppleCare、商店保修、其他保障；提供方／起止日／备注可空。
- **日期规则独立于维护**：已知起止要求结束不早于开始（领域校验 + 触发器双层），起止同日合法；允许未来开始／未来到期；不设今天、购入或售出钳制；保障变化不触碰生命周期状态与任何成本口径（测试断言成本与状态逐项不变）。
- **状态查询时派生**（`warranty::derive_status`/`summarize`，无落库事件、无常驻任务）：完整日期且 `start <= today <= end` 才当前有效；剩余自然日 0–30（含两端）即将到期，≥31 保障中；任一日期缺失为待补全、不推断有效；无记录是与有记录不同的第四种摘要态。
- **混合状态筛选语义（固定用例锁定）**：资产级筛选 `covered`（存在有效保障，含仅临期）、`expiring`（存在 0–30 天有效保障，不因另有长保障而丢提示）、`lapsed`（有记录但当前无有效——未来／已到期／待补全混合时呈现各类事实，不声称已覆盖）、`none`（无任何记录）。SQL 条件与 Rust 派生同口径：`tests/warranty.rs` 的 e05 测试对同一批混合数据逐资产交叉核对四种筛选与派生摘要完全一致；前端不复制规则，仅展示后端结果（浏览器内存适配器使用 `tests/warranty.test.mjs` 中与 Rust 相同 E04/E05 用例固定的 TS 镜像 `deriveStatus`/`summarizeWarranties`）。
- **筛选交集**：保障筛选与搜索、分类筛选、生命周期筛选在 SQL `WHERE` 中取交集，并沿用既有 `deleted_at` 可见性排除已删除资产（测试覆盖三者两两组合及父删除后退出结果）。
- **事务协议复用**：request_id 幂等（重复同请求返回原档案、同 ID 不同 payload 拒绝）、generation/revision 冲突、审计快照（add/correct 保留 warranty ID）、资产 revision 与 `asset_profiles.updated_at` 同事务推进、`warranty.before_commit/after_commit` 故障钩子；提交前失败零残留，回执丢失经 `saved_request` 核对恢复且不重演。
- **图片**：`commit_warranty_photos` 复用托管附件管道，校验附件属于同一资产（跨资产引用拒绝 `IMAGE_OWNER`），同内容按哈希共享字节但引用独立；缺图/修复走既有 PhotoView/PhotoPreview。
- **前端**：`WarrantyEditor` 复用维护表单协议（原生 `<dialog>`、showModal、初始焦点、焦点归还、ESC、关闭保护三选、localStorage 草稿 `possio.warranty-draft.v1`、pending 完整 payload 先持久化、回执核对冻结、conflict 需显式确认最新版本）；详情右列在售出与维护之间新增“保障档案”卡片（复用 `.detail-section`/`.maintenance-history` 同构样式与 tokens），hero 增加“添加保障”；筛选区“筛选与排序”内新增“保障”下拉（不改左侧状态导航与页面分区）；跨日刷新沿用 `refreshCostsForNewDay` 同一路径（日期变化重读列表与当前详情，保障摘要随派生结果更新）。
- **兼容**：备份 manifest 写 schema 10、`validate_dataset` 白名单加入保障三表与触发器校验；schema 1–9 旧备份仍可恢复并迁移到 10（手造 v9 归档实测）；既有维护／售出／素材／Demo 测试全部通过。

## 3. 受影响文件

代码：`src-tauri/src/warranty.rs`（新）、`src-tauri/src/{storage,backup,catalog,commands,lib,photos}.rs`、`src-tauri/examples/import_demo.rs`、`src-tauri/tests/warranty.rs`（新）及 `{catalog,lifecycle,trash,materials,taxonomy,sales,photos}.rs`（Query 增 `warranty` 字段与旧版本回退模拟）、`src/{warranty.ts,WarrantyEditor.tsx}`（新）、`src/{asset,main,AssetViews,preview-costs,visual-preview}.ts(x)`、`src/app-layout.css`、`tests/warranty.test.mjs`（新）。
文档：README、IMPLEMENTATION_PLAN、ADR-001（新增第 16 节）、UI_DESIGN（详情分区基线补保障卡片）、本记录。截图：`docs/verification/t10/`（浏览器 4 张）。

## 4. 命令与退出码（在代码提交 2dee0c9 上按序执行）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | 57 项通过（基线 45 + 保障 12），0 失败 |
| `npm test` | 0 | 68 项通过（基线 58 + warranty 集成 8 + 模块内边界 2），0 失败 |
| `npm run test:demo` | 0 | 2 项通过（Demo 导入在 schema 10 下不回归） |
| `npm run check` | 0 | Rustfmt 与 Clippy（fault-injection，-D warnings）通过 |
| `npm run build` | 0 | TypeScript 检查与 Vite 生产构建通过 |
| `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` | 0 | 隔离验收包重建成功（标识 `local.possio.t06b.preview` 未改） |
| `git diff --check` | 0 | 无空白问题 |

完整输出留 `/tmp/possio-t10-{ui,rust,demo,check,build,native-build}.txt`。

## 5. 验收矩阵逐项

| 项目 | 结论 | 证据 |
|---|---|---|
| E04（固定 2026-09-10，0/30/31 边界、次日过期） | 自动通过 | Rust `warranty::tests::status_boundaries_follow_natural_days` 与 `tests/warranty.rs::e04_fixed_day_boundaries_and_next_day_rollover`（9/11 观察日首条 Expired、无时区偏移；成本/状态不变断言）；TS 同用例 `deriveStatus`；自然日由 NaiveDate/UTC 午夜日期串计算，非 24 小时毫秒差 |
| E05／多份与混合 | 自动通过 | `e05_mixed_facts_summary_and_filters_use_one_rule_set`：未来+过期+未知混合→NotCovered 且计数分列；长有效+临期+未来→Covered 保留临期提示；仅临期→ExpiringSoon；无记录≠未知；四类筛选与派生摘要逐资产一致；与搜索／分类／生命周期交集；父删除后退出；未知筛选值拒绝 |
| AC14（重叠多份，未来不冒充当前有效，截止含当天） | 自动+浏览器通过 | Rust `ac14_*`：摘要 ExpiringSoon 且 upcoming 单列；TS/浏览器同规则；浏览器实测 MacBook 双份卡片分别显示 |
| AC15（同 ID 更正、重开不重复事实） | 自动通过 | 更正保留 warranty ID（1 行不变）、审计 add+correct 共 2 行、重复读 3 次无重复、重开 Store 后状态一致、重放同请求返回原档案；退役资产保障状态与成本不变 |
| 恢复（提交前故障／回执丢失／核对失败／重复请求不同 payload／过时 revision、generation） | 自动通过 | `faults_receipts_and_conflicts_do_not_duplicate_facts`（fault-injection）：before_commit 零残留、after_commit 回执核对仅 1 条事实、REQUEST_CONFLICT、STALE_DATASET、REVISION_CONFLICT、未知 warranty_id 更正拒绝不转新增；前端 `recoverWarranty` 12 项测试覆盖跨库冻结、回执优先、pending 保留、conflict 显式确认 |
| 迁移与引用 | 自动+原生通过 | 9→10 原子与失败回滚（内存库注入中断停留 v9）；回退到 v9 的真实库重开升级保留资产/维护/售出/素材；含保障与图片的备份恢复、手造 v9 旧归档恢复并迁移；父删除/恢复后保障与图片哈希、归属正确 |
| 原生实际流程 | **部分：迁移与库完整性原生已验，GUI 未验**（见第 6 节） | 原生启动新包实测 schema 9→10；GUI 操作本会话无 Computer Use 工具 |
| 视觉 | 浏览器通过；**原生截图未取** | 见第 7 节 |

## 6. 原生证据与未验项

### 原生已验（真实隔离库，非浏览器内存）

1. **升级前保护快照**：对活动数据集 `0a0e28f8-…` 以 `VACUUM INTO` 制作一致副本 `/tmp/possio-t10-protection/pre-upgrade-v9.sqlite`（`integrity_check=ok`，schema 9，13 资产）；未在线拷贝 WAL 主文件。升级前无 Possio 进程。
2. **真实 9→10 迁移**：从本工作树最新构建启动 `Possio T06b Preview.app`，活动库随启动迁移：`user_version=10`，资产 13（Active 9／Retired 2／Sold 2）、维护 4、有效售出 2、素材 0、附件 14 全部保留，`warranties` 表 0 行（迁移不发明事实），`integrity_check=ok`、`foreign_key_check` 空。此后 App 正常退出（SIGTERM，无未保存编辑）并在最终 HEAD 上重建同包。

### 原生未验（本会话 GUI 工具不可用，如实列出，不冒充通过）

本会话 node_repl 未启用 Computer Use（与 U01 记录第 6 节同一情况），且不使用 osascript／直接写库绕过（契约 §5）。以下由自动测试与浏览器内存路径覆盖同等逻辑，但**不能替代原生 GUI 验收**，请 Codex 在可用环境补验：

- 多份保障 GUI 新增 → 更正 → 退出重开核对；
- 空日期保存、日期逆序就地提示、未来保障、当日到期的原生目视；
- 带图草稿的 ⌘Q 关闭保护／保留草稿／重启恢复（含照片）；NSOpenPanel 实际选图托管、源文件移动后预览、缺图与“重新选择原图修复”；
- 写锁失败后的 GUI 恢复（重试同 ID 成功）；
- 已有维护／售出／素材库的原生定向回归目视；
- 原生浅／深色 1080×760 与 800×600 窗口截图。

说明：跨日刷新的“日期变化重读列表与当前详情”逻辑与 T09 完全同源（`refreshCostsForNewDay`，前端测试覆盖同日跳过/侧栏/完整详情/无选中四种路径），未改系统时钟、未按 24 小时毫秒差计算；E04/E05 边界由固定观察日测试锁定。

## 7. 浏览器证据（visual-preview.html，代码 HEAD 2dee0c9，内存虚构数据）

| 检查 | 结果 | 截图 |
|---|---|---|
| 保障筛选：即将到期=MacBook+相机；有有效保障=同两件；有记录无有效=iPhone；无记录=其余 5 件 | 通过 | — |
| 交集：即将到期∩已退役=空（iPhone 无有效保障，语义正确）；有有效保障∩使用中=MacBook+相机；清除条件恢复 8 件 | 通过 | — |
| MacBook 详情卡片：摘要“保障中，1 份即将到期”，两份分别显示 保障中·剩余300天 / 即将到期·剩余10天；hero 含“添加保障” | 通过 | [浅色 1080×760](t10/browser-detail-light-1080.png)、[深色 1080×760](t10/browser-detail-dark-1080.png) |
| iPhone 混合事实：摘要“当前无有效保障（1 份尚未生效，1 份已到期，1 份日期待补全）”，三行分别标注；侧栏摘要同步 | 通过 | — |
| 表单：逆序日期（结束早于开始）阻止并提示；ESC 触发关闭保护三选；保存未来保障显示“尚未生效”；更正同 ID（先被逆序拒绝，改有效区间后成功）变为“保障中·剩余40天”，仅 1 条记录 | 通过 | [表单 1080×760](t10/browser-form-light-1080.png) |
| 800×600：详情+表单打开与列表均无横向溢出 | 通过 | [800×600](t10/browser-detail-light-800.png) |

浏览器为内存 mock（含按当日锚定的虚构保障 fixtures），不能证明原生持久性。

## 8. 进程、库与交接状态

- 隔离 App 当前未运行（最终包构建自最终代码 HEAD，可随时启动复核）；vite dev server（1429 端口）仍在后台，可停止。
- 隔离虚构库：schema 10，13 件资产，未重置、未导入 Demo、未新增/删除任何业务记录（本轮原生操作仅启动迁移与只读核对）；保护快照留 `/tmp/possio-t10-protection/`。未触碰 `local.possio.preview` 普通库。
- 本地分支 `codex/t10-warranties` 两个提交（代码 + 本报告），未合并、未推送。`.gitignore` 用户文件保持未跟踪。
- 已知问题：无已知缺陷；缺口即第 6 节原生 GUI 清单。

## 9. 审阅建议

1. schema 10 迁移/白名单/触发器与 1–9 旧备份恢复兼容；
2. `derive_status`/`summarize` 与 `query_assets` SQL 条件是否严格同口径（e05 交叉核对是否足够固定混合语义）；
3. change_warranty 事务、审计、幂等与图片归属同 maintenance 的一致性；
4. 前端 WarrantyEditor 草稿/关闭保护/回执核对路径与 maintenance 的等价性；
5. 原生 GUI 缺口按第 6 节清单补验。

```text
请 review Possio T10 保障档案。
工作目录：<repo>
分支：codex/t10-warranties
起点 HEAD：d5630643eadb5ef0ad0a36a3660e41f7622538a9
最终 HEAD：<本报告提交后以 git rev-parse HEAD 为准>
代码提交：2dee0c92e4180cbc4d80593d2b73ecde2ebfe709
报告：<repo>/docs/verification/T10_WARRANTY_RESULT.md
实际模型：GLM-5.3（Z code 单执行者串行；未启用子代理/Flash/其他执行器）
提交后检查：test:ui 57 通过 / test 68 通过 / test:demo 2 通过 / check / build / tauri 隔离构建 / git diff --check 全部 exit 0（在代码提交 2dee0c9 上）
原生已验：升级前一致性快照；真实启动 9→10 迁移（数据全保留、完整性 ok、无发明保障行）
原生未验：多份保障 GUI 新增/更正/重开；空日期/逆序/未来/当日到期目视；带图草稿恢复；NSOpenPanel 选图/源文件移动/缺图修复；写锁失败 GUI 恢复；维护/售出/素材原生回归；原生浅深色截图
已知问题、进程与资料库状态：无已知缺陷；隔离 App 未运行、vite dev server 仍在 1429；隔离库 schema 10 未重置未改业务数据；未合并未推送
```


## 10. Codex review 修复与本地集成（2026-09-25）

用户在 review 后明确授权“修复并合并”，仅本地 main，不推送、不发布、不启动 T11。此前第 6 节为 Z code 交回时的验收状态；本节记录后续补验，优先于历史“未验／无已知缺陷”表述。

代码修复提交：`2b74e1f05097dcfd3ed97d5687dba5fde79f5e04`。

- **保留草稿后的退出**：维护／保障草稿在表单关闭后仍受原生关闭保护，但原先没有组件消费 close-intent。新增独立模态，支持继续使用、保留草稿并退出／关闭窗口；不删除持久草稿，不把 pending 请求误报为成功。打开中的表单仍走原有三选保护。
- **保障附件独立归属**：保障只允许保留当前保障自己的附件 ID；拒绝资产封面、维护、其他保障及无有效归属的既存 ID。资产／维护入口也拒绝借用保障 ID；备份校验拒绝跨实体混用。相同字节仍可共享哈希文件，但重新选图使用独立 ID，无 schema 变更。
- **新增 Rust 回归**：封面／维护→保障、保障→封面／维护、保障→其他保障均拒绝；失败不递增 revision、不写回执；同保障更正保留图片；四个独立附件共享一个哈希并完成备份恢复；损坏的跨实体引用被备份校验拒绝。

补验使用主目录构建和既有 `local.possio.t06b.preview` 虚构库；补验前 SQLite 一致性保护快照位于 `/tmp/possio-t10-fix-protection/before.sqlite`。原 13 件资产、4 条维护、3 条售出历史（其中 2 条有效）、14 附件、0 保障；不重置、不导入 Demo，不使用直接写库伪造 UI 结果。

### 提交后的检查

全部在修复提交 `2b74e1f` 上顺序执行，exit 0：`npm run test:ui`（57）、`npm test`（Rust 69）、`npm run test:demo`（2）、`npm run check`、`npm run build`、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`、`git diff --check`。后续仅更新本文、状态文档和验收证据，无代码变化。此次不把未单独重跑的 Clippy 记为新结果。

### 原生补验及证据

以下均操作主目录构建的隔离 App，非浏览器内存结果。截图与 AX 文本同名配套保存在 `t10/native-review/`。

| 实际操作 | 结果／证据 |
|---|---|
| 表单关闭后保留草稿，⌘Q | 独立退出模态可操作，保留草稿后正常退出；[退出保护](t10/native-review/retained-draft-quit.txt) |
| NSOpenPanel 选择获用户确认的虚构 HEIC，保留草稿退出，移动源文件后重启 | 标题与已导入图片恢复；[带图恢复](t10/native-review/photo-draft-restored.txt) |
| 空起止日期保存 | 待补全，不推断为已覆盖；[空日期](t10/native-review/unknown-dates-saved.txt) |
| 逆序日期更正 | 拒绝保存，保留输入；[逆序](t10/native-review/reversed-dates.txt) |
| 持有 SQLite 写锁后尝试更正，释放锁重试 | 明确已确认未提交，表单与图保留；重试同一保障 ID 更正成功，未重复新增；[错误恢复](t10/native-review/write-lock-recovered.txt) |
| 2026-09-25 起止同日 | 当天有效，剩余 0 天；[同日](t10/native-review/same-day-saved.txt) |
| 第二份未来保障新增 | 与第一份独立显示，尚未生效；[多份未来](t10/native-review/multiple-future.txt) |
| 临时移开托管原图，以 NSOpenPanel 重新选择同一虚构文件 | 显示缺失并修复成功，哈希一致；[缺图](t10/native-review/missing-original.txt)、[修复](t10/native-review/original-repaired.txt) |
| 正常退出再启动 | 两份保障、日期、图片及成本保留；[重启](t10/native-review/reopened.txt)、[重启预览](t10/native-review/reopened-photo.txt) |
| 旧维护／售出／素材定向回归 | 维护 HEIC 可预览；iPad 售价 ¥1,800、净成本 ¥2,999、日均 ¥2.12 正常；8 件内置素材保留；[维护图片](t10/native-review/existing-maintenance-photo.txt)、[售出](t10/native-review/existing-sold.txt)、[素材](t10/native-review/existing-materials.txt) |
| 1080×760 原生浅／深色 | A 静序页面结构与单一状态导航保留；[浅色](t10/native-review/detail-light.png)、[深色](t10/native-review/detail-dark.png) |

浏览器单独验证 pending 草稿关闭：刷新后原 request ID 保持，保留草稿退出仅调用 `finish_close`，不重提请求；[fixture 证据](t10/native-review/browser-pending-close.json)。测试草稿已清理，Ego TaskSpace 已结束。此项不冒充原生响应丢失注入验收。

最终只读 [持久性核对](t10/native-review/persistence.json)：schema 10、integrity ok、外键检查无异常；13 资产、4 维护、3 售出历史、15 附件、2 保障、3 保障审计。旧维护／图片关系／售出／售出审计／附件／素材行与保护快照逐行比对保留，所有托管原图哈希正确。新增两份保障和一次更正均来自 GUI。写锁已释放，缺失原图已修复，隔离 App 正常退出，1429 原有服务保留。

### 集成结论与剩余边界

两项 review 缺陷已修复，核心持久性与失败恢复补验通过，具备此次本地集成条件；按用户授权将 `codex/t10-warranties` 快进合并到主目录 `main`，保留开发分支与旧工作树，不推送、不发布、不启动 T11。

尚未取得原生 800×600 截图（窗口坐标调整工具返回 noWindowsAvailable），不以现有浏览器小窗口截图代替。原生响应丢失后的 pending 故障注入尚未执行；本轮原生实际错误恢复覆盖的是写锁失败，pending 协议由自动测试与浏览器 fixture 提供证据。此前迁移和 E04/E05 固定用例结果继续有效，本轮未逐一重做每个原生筛选组合。以上保留为后续回归边界，不宣称全部 GUI 矩阵或 CP2/P0 完成。

## 11. CP2 原生缺口补验（2026-09-25）

本节更新上文历史缺口，不改变第 10 节当时的结论。将隔离 App 的窗口配置在构建时设为 **800×600 逻辑像素**，Sky 截图实得 1600×1200 Retina 像素；直接验收原生[列表](cp2/native-800-list.jpeg)、[资产详情](cp2/native-800-detail-light.jpeg)、[保障表单](cp2/native-800-warranty-form-light.jpeg)及[深色列表](cp2/native-800-list-dark.jpeg)。内容与操作入口在窗口宽度内，保障表单在竖向滚动；未发现横向溢出。此处没有用浏览器截图替代原生。

针对响应丢失，在临时 QA 构建中让真实 `change_warranty` 完成提交后仅丢弃前端收到的回包，并让首次 `saved_request` 回包也丢失。原生表单保留提供方「T11 Fictional Warranty · response recovery」，输入冻结、仅允许[核对保存结果](cp2/native-warranty-response-pending.jpeg)；⌘Q 被待核对保护拦住。随后只终止此隔离 QA App 进程以模拟崩溃，重新启动后出现“恢复保障草稿”，点击即用原 request ID 查询回执，显示[同一份已更正保障](cp2/native-warranty-response-recovered.jpeg)。只读 SQLite 核对：保障 ID `8d80e696-868a-4e64-a3a4-56a6573909c8` 未变，请求 ID `119235b1-3a98-4cc3-8d10-a00b53e3b963` 只对应一条 `warranty_audit` 更正（sequence 5）；保障仍不进入资产成本，详情总投入 ¥1,300。临时注入仅用于这次原生测试，正常构建前撤除，不属于产品代码。

原生 800×600 与保障响应丢失这两项现有证据；第 10 节所述其他矩阵边界照旧，T11 统一最近删除的补验另见其结果文档。
