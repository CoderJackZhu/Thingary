# T12 心愿记录实现与验证

日期：2026-09-25。起点 SHA：`1b443780d108554d12d89ce61992cfddfd2ccfae`；工作目录 `/Users/jackzhu/Code/Own/Possio`，分支 `codex/t12-wishlist`。初版由单一 Hermes 执行器串行实现；实际模型为 `gpt-5.6-sol`、`model_reasoning_effort=medium`、`workspace-write`，没有子代理、MoA、后台循环或全局配置变更。实现提交为 `c21c3af590696340453bec6ad1a4580cd5e4f4c2`，首轮修复提交为 `37a36661dde4ef170ffdbc9279c551fde600b14f`；2026-09-26 Codex 独立 review 的修复与补验见文末。

## 实现范围

- 侧栏启用独立「心愿清单」页，沿用 A「静序」的导航、卡片、tokens、原有心形 SVG 和素材缩略图；提供进行中／已实现／已放弃筛选、列表／网格、搜索和最近加入／优先级／预计价格／目标日期排序。已实现在 T12 为空，不写假转换数据。
- 新增心愿名称必填；分类、预计价格、优先级、未来目标日期、HTTP(S) 外部链接、封面和备注可空。预计价格以可空整数分保存，固定 CNY；明确 ¥0 与未知分开。优先级固定高／中／低／未设置，排序为高→中→低→未设置；价格和目标日期不论方向均把空值放末尾，最后以建档时间和 ID 稳定打破并列。
- 进行中预计总额只累加价格已知的 Ongoing，并单列未知数量；Achieved/Abandoned 不参与，也不改资产数量、购入金额、维护或售出成本。放弃保留同一 ID、资料、封面、建档时间并写 `abandoned_at`；取消确认不写记录。
- schema 10 顺序迁移至 schema 11：`wishlist_items`、`wishlist_attachments`、`wishlist_media`、`wishlist_audit`。心愿只有 `category_id`，没有购买渠道字段。分类删除迁移／转未分类在分类请求同一事务中覆盖 Ongoing 与 Abandoned 并增加其 revision；移除确认框分别展示进行中／已放弃心愿引用数量。渠道操作不触碰心愿。
- 心愿封面使用独立附件表和显式关系，不复用资产／维护／保障附件 ID；仍复用现有托管文件、素材准备、预览、缺图校验与同 hash 修复。备份文件枚举、schema 清单、恢复迁移和数据集验证均已纳入 schema 11，同时继续接受 schema 1–10 旧备份。
- 新增和放弃均走既有串行 worker、generation、revision、request ID、指纹和 `requests` 回执。同请求同 payload 返回同记录，异 payload 冲突；提交后回包丢失使用原请求核对。表单使用原生 `<dialog>`、ESC/关闭保护及 localStorage 草稿；恢复前比较 generation，文本、封面和原请求随失败保留。

没有实现 T13 购入转换、Achieved 写入、实际购买渠道、资产双向链接、时间轴／统计、放弃后重开、永久清空、多币种或 AC17–19。

## AC16 / AC37 与自动证据

| 场景 | 结果 |
|---|---|
| AC16 ¥1,500 | Rust 定向测试新增 `150000` 分心愿；资产查询总数不变，进行中总额为 `150000`；放弃后同 ID 出现在 Abandoned，进行中总额归零。取消放弃由 UI 确认框不发请求。 |
| 未知／零／未来日期 | Rust 与前端测试分别覆盖 `NULL`、`0` 和 2099 目标日；目标日不读取或默认今天。 |
| 四种排序与交集 | 后端权威查询覆盖 created/priority/price/target、稳定 tie-break 和显式 null-last；搜索 `alpha` 与 Ongoing 筛选在同一 SQL 条件中取交集。Grid/List 为同一结果集的展示状态。 |
| AC37 | 自动测试覆盖分类迁移到另一 ID及转未分类，Ongoing 与 Abandoned 同事务更新；改名天然保留 ID；删除渠道后心愿分类不变。故障点位于事务提交前，失败不留下半迁移或回执。 |
| 图片与素材 | 测试覆盖自定义素材→独立心愿封面、删除素材行、移动原来源、托管文件缺失、同图修复、重开、完整备份／恢复。还覆盖资产附件表不存在同 ID 的独立性校验。 |
| 幂等与恢复 | 测试覆盖同请求重放、异 payload、旧 generation、提交前故障、提交后丢回包、原请求核对、真实 SQLite `BEGIN IMMEDIATE` 写锁失败与释放后同请求重试；最终无重复和错误总额。前端测试覆盖草稿/pending 请求 round-trip 与损坏草稿拒绝。 |
| schema 10→11 | 内存旧库先迁移到 schema 10，写入资产／维护／保障／附件各一条，再迁移 schema 11；四类数量保持。旧备份接受范围扩至 schema 1–10，恢复后统一迁移 11。 |

## 已执行检查

- `cargo test --features fault-injection --test wishlist`：exit 0，7/7。
- `npm run test:ui`：exit 0，68/68。
- `npm test`：exit 0，84/84（18 个 Rust 测试二进制，包含 lib 与全部集成测试）。
- `npm run test:demo`：exit 0，2/2。
- `npm run check`：exit 0；Rustfmt 与 Clippy `-D warnings` 通过。
- `npm run build`：exit 0；TypeScript 与 Vite 正式构建通过（最终修改后复跑）。
- `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`：exit 0；隔离 debug App 成功打包为 `src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`。
- `git diff --check`：exit 0。

以上为最终代码提交后的完整检查；汇总脚本 exit 0。日志保存在本机 `/Users/jackzhu/.hermes/cache/scratch/possio-t12-final-checks/`。

## 原生、浏览器与隔离边界

本轮启动过打包 App 与 `tauri dev`，并以既有隔离库完成真实 schema 10→11 启动迁移；没有把浏览器内存预览当作原生持久化证据。两次启动中进程存活，但 macOS `System Events` 和 CUA 均报告 0 个窗口，无法执行可见 GUI 操作。因此原生新增／放弃／筛选／排序／封面／重启、浅深色 1080×760 和 800×600 如实记为未验，留给 reviewer 在可见窗口环境实测。

迁移前已制作一致性保护快照 `/Users/jackzhu/Library/Application Support/local.possio.t06b.preview/library/backups/t12-protection-before-20260925-175113.sqlite`：schema 10、`integrity_check=ok`，14 assets / 13 categories / 10 channels / 6 maintenances / 3 warranties。启动隔离 App 后，原库为 schema 11、`integrity_check=ok`；上述 assets/categories/channels 数量保持，新增心愿表存在且 `wishlist_items=0`、`wishlist_audit=0`。未重导 Demo、未重置隔离库、未触碰普通 `local.possio.preview` 库。未配置远程、未推送、未合并、未发布，未提交用户 `.gitignore`。

## 首轮交回时的 review 风险

- schema 11、分类引用同事务、共享 `requests` 表中的心愿回执反序列化边界，以及独立心愿附件在备份／恢复／修复中的所有权校验，应以 Astra High 重点复审。
- 原生关闭期间若正处于放弃请求的未知回执窗口，应重点确认可见恢复提示和原请求核对体验；自动测试已覆盖存储语义，未宣称 GUI 通过。
- 原生窗口未出现，故自动测试与真实 schema 迁移不能代替可见 GUI 交互及重启持久性验收。
- 首轮交回时 T12 尚未完成 review；CP3、P0、AC17–19 均未宣布完成。

## Codex review 修复与补验（2026-09-26）

独立 review 指出五项问题，已在 `codex/t12-wishlist` 修复：空白新增表单点击「取消」仍留下可恢复草稿；已保存封面缺少进入缺图修复的预览入口；查询最多返回 100 条但页面没有翻页；优先级排序按钮不能切换反向；1080×760 原生窗口内列表／网格文字因通用按钮宽度而换行。

- 关闭表单时统一清除明确放弃的草稿，保留草稿仍可恢复。原生隔离 App 打开空白表单后取消、退出重启并回到心愿清单，未再出现「恢复草稿」入口。
- 已保存心愿封面改为可聚焦的预览按钮，复用现有 `PhotoPreview` 的缺图提示和「重新选择原图修复」流程。隔离原生库新增「T12 虚构封面回归心愿」，选内置相机素材保存后，列表封面能打开原生模态预览；退出、重建 App 并再次启动后，心愿与封面入口仍在。此次没有故意移走托管原图，因此缺图后的原生文件选择与同图修复未重新点击；原有 Rust 缺图／同 hash 修复测试仍覆盖存储语义。
- 页面按后端每页 100 条提供上一页／下一页和页码；结果集缩小导致当前页越界时回到最后有效页，旧请求的迟到响应不会覆盖新查询。Rust 新增 101 条跨页测试。
- SQL 优先级排序尊重升降序，未设置优先级始终末尾；Rust 定向测试断言双向顺序。切换排序字段时使用该字段的常用初始方向。
- 心愿工具栏局部修正分段按钮宽度和标签不换行，未修改资产页样式。重建后的隔离原生 App 在 1080×760 下目视确认「列表」「网格」横向完整显示、工具栏未溢出。

上述原生操作只使用 `local.possio.t06b.preview` 虚构资料库；原始资产、分类、渠道未重置或重导。新增的虚构心愿留在隔离库供后续复核。T12 的放弃、筛选、分页大数据量及缺图修复完整 GUI 链路仍未作为原生通过项；浏览器或 Rust 证据不替代这些操作。未进入 T13，未配置远程、推送或发布。

修复后已执行 `npm run test:ui`（68/68）、`npm test`（85/85，18 个测试二进制），心愿定向测试为 8/8。首次 `npm test` 在受限沙箱运行时，既有维护 HEIC 用例的 ImageIO 解码返回 `IMAGE_CORRUPT`；同一用例及完整 `npm test` 在普通 macOS 环境复跑通过。沙箱内 `sips` 读取该 HEIC 的尺寸成功，但转换 PNG 同样报错；此差异保留为环境边界，不隐去初次失败。

其余检查在最终代码状态通过：`npm run test:demo`（2/2）、`npm run check`（fmt 与 Clippy `-D warnings`）、`npm run build`、`npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` 和 `git diff --check`。本机日志位于 `/tmp/possio-t12-fix-*.log`；没有把隔离库或图片加入 Git。
