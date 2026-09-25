# T11 统一最近删除验收记录

日期：2026-09-25。工作目录 `/Users/jackzhu/Code/Own/Possio`，任务分支 `codex/t11-unified-trash`，起点 `29d6515ffb753c4965bd7fe53a1dd139dbefdeed`。Z code 使用 GLM-5.3 串行完成未提交的首轮实现；额度耗尽后由 Codex 接续审查、修复和验证。没有使用子代理、Hermes、MoA 或并行执行器。首次代码提交为 `dd75c32f7c7e69804139aed90543b510cb113244`，最终 review 修复与本地集成见末节。未推送、未发布。

## 范围与实现

沿用 schema 10 的 `assets`、`maintenances`、`warranties.deleted_at`，未增加迁移。维护和保障单条软删除及恢复保留原 ID、字段、附件引用和原状态；父资产删除仅隐藏有效子项，父恢复不会清除此前独立删除的子项标记。统一最近删除展示资产、维护、保障，提供四种筛选、稳定倒序、分页与父已删除时的先恢复父资产入口。普通详情、费用完整性和保障摘要从有效记录投影重算；未知费用与零费用仍区分。

写入沿用 generation、资产 revision、原 request ID、完整 payload 指纹与同事务回执。新增按原记录操作的完整 payload 核对回执接口，避免仅凭共享 request ID 将其他操作误认为成功。提交前将待确认操作存入 `localStorage`；响应丢失后保持同一请求、冻结后续操作并允许重开核对。恢复日期冲突会保留删除项并返回具体错误。资产原有删除协议保留；其“当前状态等于目标状态”分支也改为不冒认原请求成功。

Codex 接续修复了 Z code 首轮实现中的前端模块导入、仅在第一页查找已删父资产、旧数据状态误判为操作回执、待确认退出保护、详情刷新，以及 T11 页面被旧图标按钮样式挤压的问题。对恢复提醒增加 generation 和 revision 形状校验。A「静序」侧栏与页头保持原视觉基线。

## 自动与浏览器证据

- Rust `unified_trash` 聚焦测试 8 项通过，覆盖 E09 父子删除顺序、未知/零维护费用与 Sold、保障、附件和备份、日期冲突、分页排序、同请求重放/异 payload 冲突以及事务故障点。代码提交 `dd75c32` 之后按交接顺序重跑：`npm run test:ui` 62/62、`npm test` 77/77（macOS 原生权限，以允许 HEIC 解码）、`npm run test:demo` 2/2、`npm run check` exit 0、`npm run build` exit 0、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` exit 0、`git diff --check` exit 0。
- UI 逻辑测试 62 项通过，Demo 导入测试 2 项通过。浏览器内存预览的空态与四个筛选在 [1080×760](t11/browser-empty-1080.png) 和 [800×600](t11/browser-empty-800.png) 核对，修复后 `scrollWidth == clientWidth`；浏览器资料刷新即重置，不能作为原生持久性证据。

## 原生隔离库

仅使用 bundle ID `local.possio.t06b.preview` 的虚构库；操作前通过 SQLite backup API 制作 `/tmp/possio-t11-protection/before.sqlite` 一致性快照，schema 10、`integrity_check=ok`，原有 13 件资产、4 条维护、2 份保障、15 个附件。未重置或导入 Demo，未触碰普通 `local.possio.preview` 库。

为 E09 在图形界面新增虚构父资产 `T11 Fictional Parent`（购入 ¥1,000）、维护 A（¥200）、维护 B（¥100）及一份日期待补全的保障。图形界面删除维护 A 后，详情维护投入显示 ¥100、总投入显示 ¥1,100；统一最近删除列出 A、所属父资产与 ¥200。正常退出旧运行进程后，启动 `dd75c32` 构建的隔离 App，A 仍在[最近删除](t11/native-trash-after-restart.jpeg)，父资产摘要仍显示维护 ¥100，且保障与维护 B 仍可见。只读 SQLite 旁证：schema 10、`integrity_check=ok`，14 件资产、6 条维护、3 份保障、15 个附件；A 的 `deleted_at` 非空，B/保障/父资产的 `deleted_at` 仍为空。

用户对两次原生删除分别作出即时确认后，完成后续图形界面操作：

- 在[父资产确认框](t11/native-parent-confirm.jpeg)移入最近删除，正常列表由 14 件变为 13 件。统一最近删除同时显示父资产和先前独立删除的维护 A；A 行提示先恢复父资产，点击“恢复所属物品 T11 Fictional Parent”打开正确的父恢复框。恢复父资产后，它仍是“使用中”，维护 B 和保障仍可见，维护 A 仍独立留在最近删除，总投入仍为 ¥1,100。再单独恢复 A，最近删除变空，总投入回到 ¥1,300、维护投入回到 ¥300，A/B 均在详情可见。这一顺序覆盖 E09、AC13/42 的父子独立恢复和 AC43 的定位入口。
- 单独移入最近删除 `T11 Fictional Warranty` 时，父资产仍在正常列表，详情暂时显示无保障记录，成本和两条维护记录不变；最近删除的保障筛选显示 1 条、维护筛选为空。单独恢复原保障后，保障重新出现在详情，保障筛选清空。
- 正常退出并重开同一完整路径的隔离 App；[深色恢复后](t11/native-e09-restored.jpeg)和[浅色恢复后](t11/native-light-restored.jpeg)均见父资产、两条维护、保障及总投入 ¥1,300。统一最近删除为空。只读 SQLite 复核 schema 10、`integrity_check=ok`，14 件资产、6 条维护、3 份保障、15 个附件；父资产、A、B、保障的原 ID 均未改变且 `deleted_at` 均为空。未重置或导入隔离库。

## 剩余边界与最终交回

核心原生父子与保障删/恢复、重启持久性、浅深色已通过。原生 800×600 截图尚未取得：App 的正常窗口可观察，但 Computer Use 的窗口拖动返回 `noWindowsAvailable`；浏览器 800×600 无横向溢出不能替代原生截图。T11 写锁失败、响应丢失的完整 GUI 注入也未执行；相应事务故障、同请求重放与备份关系有自动测试证据，不将其记为 GUI 通过。隔离 App 当前运行于浅色主题，虚构库保留上述测试记录。

T10 留存的原生 800×600 截图与响应丢失 GUI 注入不因 T11 完成自动记为通过。T11 功能与核心原生业务链具备集成审查条件；上述 GUI 错误恢复和小窗口证据仍是验收缺口，CP2/P0 不据此判定完成。用户未跟踪 `.gitignore` 的 SHA-256 仍是 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`，本轮未修改、未暂存。

## 最终 review 与本地集成

最终 review 又发现一处入口冻结缺口：维护/保障删除结果待核对时，新增/更正资产和状态变更仍能打开，素材库及设置入口也可进入。`57b1207900cab9ae17cd3212447c182facd2f6bd` 已补齐这些入口保护；不更改事务和持久数据。该提交后的完整命令链依序 exit 0：`npm run test:ui` 62/62、`npm test` 77/77、`npm run test:demo` 2/2、`npm run check`、`npm run build`、隔离 Tauri debug App 构建及 `git diff --check`。这是代码和构建验证，未伪称新增原生故障注入 GUI 验收。

`main` 从 `29d6515` 快进到 `57b1207`，无冲突；T11 核心功能已本地集成。没有配置 Git remote，因此尚未推送或发布。进入 T12 的开发准备可在此集成点继续，但 CP2 正式验收仍需处理上列原生证据缺口。
