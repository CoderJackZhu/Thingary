# T11 统一最近删除验收记录

日期：2026-09-25。工作目录 `/Users/jackzhu/Code/Own/Possio`，任务分支 `codex/t11-unified-trash`，起点 `29d6515ffb753c4965bd7fe53a1dd139dbefdeed`。Z code 使用 GLM-5.3 串行完成未提交的首轮实现；额度耗尽后由 Codex 接续审查、修复和验证。没有使用子代理、Hermes、MoA 或并行执行器。代码提交为 `dd75c32f7c7e69804139aed90543b510cb113244`；本记录如实止于原生父资产软删除确认前。未合并、未推送、未发布。

## 范围与实现

沿用 schema 10 的 `assets`、`maintenances`、`warranties.deleted_at`，未增加迁移。维护和保障单条软删除及恢复保留原 ID、字段、附件引用和原状态；父资产删除仅隐藏有效子项，父恢复不会清除此前独立删除的子项标记。统一最近删除展示资产、维护、保障，提供四种筛选、稳定倒序、分页与父已删除时的先恢复父资产入口。普通详情、费用完整性和保障摘要从有效记录投影重算；未知费用与零费用仍区分。

写入沿用 generation、资产 revision、原 request ID、完整 payload 指纹与同事务回执。新增按原记录操作的完整 payload 核对回执接口，避免仅凭共享 request ID 将其他操作误认为成功。提交前将待确认操作存入 `localStorage`；响应丢失后保持同一请求、冻结后续操作并允许重开核对。恢复日期冲突会保留删除项并返回具体错误。资产原有删除协议保留；其“当前状态等于目标状态”分支也改为不冒认原请求成功。

Codex 接续修复了 Z code 首轮实现中的前端模块导入、仅在第一页查找已删父资产、旧数据状态误判为操作回执、待确认退出保护、详情刷新，以及 T11 页面被旧图标按钮样式挤压的问题。对恢复提醒增加 generation 和 revision 形状校验。A「静序」侧栏与页头保持原视觉基线。

## 自动与浏览器证据

- Rust `unified_trash` 聚焦测试 8 项通过，覆盖 E09 父子删除顺序、未知/零维护费用与 Sold、保障、附件和备份、日期冲突、分页排序、同请求重放/异 payload 冲突以及事务故障点。代码提交 `dd75c32` 之后按交接顺序重跑：`npm run test:ui` 62/62、`npm test` 77/77（macOS 原生权限，以允许 HEIC 解码）、`npm run test:demo` 2/2、`npm run check` exit 0、`npm run build` exit 0、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` exit 0、`git diff --check` exit 0。
- UI 逻辑测试 62 项通过，Demo 导入测试 2 项通过。浏览器内存预览的空态与四个筛选在 [1080×760](t11/browser-empty-1080.png) 和 [800×600](t11/browser-empty-800.png) 核对，修复后 `scrollWidth == clientWidth`；浏览器资料刷新即重置，不能作为原生持久性证据。

## 原生隔离库

仅使用 bundle ID `local.possio.t06b.preview` 的虚构库；操作前通过 SQLite backup API 制作 `/tmp/possio-t11-protection/before.sqlite` 一致性快照，schema 10、`integrity_check=ok`，原有 13 件资产、4 条维护、2 份保障、15 个附件。未重置或导入 Demo，未触碰普通 `local.possio.preview` 库。

为 E09 在图形界面新增虚构父资产 `T11 Fictional Parent`（购入 ¥1,000）、维护 A（¥200）、维护 B（¥100）及一份日期待补全的保障。图形界面删除维护 A 后，详情维护投入显示 ¥100、总投入显示 ¥1,100；统一最近删除列出 A、所属父资产与 ¥200。正常退出旧运行进程后，启动 `dd75c32` 构建的隔离 App，A 仍在[最近删除](t11/native-trash-after-restart.png)，父资产摘要仍显示维护 ¥100，且保障与维护 B 仍可见。只读 SQLite 旁证：schema 10、`integrity_check=ok`，14 件资产、6 条维护、3 份保障、15 个附件；A 的 `deleted_at` 非空，B/保障/父资产的 `deleted_at` 仍为空。父子恢复和保障的后续 GUI 操作仍待确认与执行。

## 剩余边界与最终交回

父资产 `T11 Fictional Parent` 的可恢复软删除已在原生 [确认框](t11/native-parent-confirm.png)准备好，但 GUI 删除需按 computer-use 规则在操作前即时确认；尚未收到该项答复，因此没有点击。隔离 App 现运行在代码提交 `dd75c32` 所构建的版本，确认框仍开着。待确认后可继续验证：父删除时 A 独立保留、父恢复后总投入仍 ¥1,100、再恢复 A 后 ¥1,300；保障单条删/恢复、父仍删除时子恢复入口、原生浅深色及 800×600、写锁/响应丢失 GUI 恢复。自动故障注入与备份测试已过，不将其记为未执行的 GUI 通过。

T10 留存的原生 800×600 截图与响应丢失 GUI 注入不因 T11 完成自动记为通过。T11 尚未到完整原生出口，CP2/P0 仍未判定；不合并 main、不推送或发布。用户未跟踪 `.gitignore` 的 SHA-256 仍是 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`，本轮未修改、未暂存。
