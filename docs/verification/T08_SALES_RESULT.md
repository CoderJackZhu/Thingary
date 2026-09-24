# T08：售出、结算与纠错

日期：2026-09-25。起点 `073ad33`，工作树 `outputs/Possio-t06b`，分支 `codex/t06b-taxonomy-storage`。后端第一笔提交 `ef272e1`；金额规范化、前端和证据随本记录提交。用户“然后执行下一项”授权 T08，未授权合并、推送或发布。

**结论：T08 已实现范围及原生持久性验收通过，具备本地集成条件；尚未合并。** AC24/25 有原生证据；AC22/23 的购入减售价、固定天数及负净成本已验，包含维护 ¥200 的完整例子必须在 T09 接入后联测；AC26 的另建 ID 与旧 Sold 保留有后端测试。完整 P0 未完成。任务状态以 [实施计划](../IMPLEMENTATION_PLAN.md) 为唯一入口。

## 实现与针对性修复

- schema 7 新增有效售出及内部纠错链：Active/Retired → Sold，更正同 sale ID，撤销恢复来源状态并使有效售出失效。内部保留售出、更正、撤销快照及 request_id，不删除资产或图片。
- 售出日期与实际售价必填，售价可零不可负；购入资料未知也能售出。日期不早于购入/前置状态、不晚于今天。Sold 历史日期更正不可超过有效售出日期；修改购入日期也检查售出冲突。
- 售出状态、revision、审计及回执同事务；旧请求迟到不会重演。沿用 generation/版本冲突和恢复隔离。schema 1–6 备份可迁移，schema 7 校验有效事实与纠错链。
- 前端复用关闭保护、原请求暂存和核对机制；失败保留输入，未知回执禁写，冲突先读取后决策。详情显示实际售价、平台/买家/备注、固定持有天数及净成本，已售出不直接重新启用；真实购回另建档案。
- 审查修复前导零售价规范化：例如 `0030000` 分写入前统一为 `30000`，避免 SQLite 整数值与审计快照字符串不一致、导致后续备份校验失败。含前导零的实际售出/更正/备份测试通过。

## 自动检查与浏览器

| 检查 | 结果与证据 |
|---|---|
| Rust 全量，`cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection` | [45 项通过](t08/rust-tests.txt)，含原有 41 项、迁移单测及 3 项售出集成场景 |
| Rust 格式及 Clippy | `cargo fmt` 完成；[Clippy all-targets + fault-injection，-D warnings 通过](t08/rust-check.txt) |
| `npm run test:ui` | [20 项通过](t08/ui-tests.txt)，含金额/日期、零/未知、负数舍入、同 ID 更正 |
| `npm run build` | [TypeScript + Vite 通过](t08/ui-build.txt) |
| 隔离原生 App debug 构建 | [通过](t08/native-build.txt)，未启用 fault-injection |
| Ego Lite 生产组件内存回归 | [故障与回执证据](t08/browser.json)、[撤销结果](t08/browser-revoked.json)；TaskSpace 7 已 `finish({keep:[]})` |

后端测试覆盖两种来源状态、撤销再售出、同 ID 更正、迟到请求/不同内容冲突、过时 generation/revision、有效日期边界、未知/零售价、事务提交前失败与提交后丢回执、Sold 软删除/恢复、HEIC 与备份恢复、审计一致性。新建同型号资产获得不同 ID，旧 Sold 保留。

浏览器脚本 [tests/t08.browser.mjs](../../tests/t08.browser.mjs) 可在已有 Ego TaskSpace 中运行 `runT08(page)`；默认停在最终撤销按钮前。验证空售价、草稿关闭继续编辑、提交前失败保留输入、已提交但回执不可用时锁定输入、仅核对不重写、同一 sale ID 更正。获得本轮用户即时确认后，另行点击最终撤销，恢复 Active、无有效售出、草稿清理、无文档水平溢出。浏览器数据仅在内存，不能替代原生验收。

## 原生隔离虚构库

App 标识仍 `local.possio.t06b.preview`，窗口标题“物志 · T08 虚构资料验收”。沿用两件虚构资产；普通 `local.possio.preview` 没有用于验收。

1. **迁移**：正常退出 T07，SQLite backup 保存 schema 6 临时副本；T08 启动后 schema 7，资产 ID/revision/原状态历史完全一致，售出表为空。[迁移证据](t08/migration.json)。SQLite 副本只在 `/tmp/possio-t08-evidence/fictional-schema6.sqlite`，没有提交数据库。
2. **Retired 来源**：相机新增 `2026-09-12` 退役，保留两条 T07 历史，再打开售出。空售价被拒绝；`2026-09-11` 被前置退役日期约束拒绝。改为 `2026-09-15`、¥300、虚构平台/买家/备注。
3. **关闭与错误恢复**：⌘Q 弹出未保存确认，继续编辑后字段保留。在隔离库持有 `BEGIN IMMEDIATE` 测试写锁，保存显示“本地数据操作失败，原资料已保留 输入已保留”；释放锁后原样重试成功，未丢草稿。测试锁已释放。
4. **结算**：购入 ¥1,350.50、9 月 1 日；9 月 15 日售出 ¥300，固定持有 15 天，净成本 ¥1,050.50，净日均 ¥70.03。[原生结果](t08/native-sold.txt)、[深色表单](t08/native-sale-form.jpg)。
5. **更正**：售价改为 ¥1,500，sale ID 仍 `d8435f72-c215-441f-b5e9-ecfd11ebffa1`，购入价和来源 Retired 不变。净成本 −¥149.50、净日均 −¥9.97，未截断为零。[更正结果](t08/native-negative.txt)、[售出记录视觉](t08/native-negative.jpg)。正常退出重开，列表持有数从 2 变 1；更正持久保存。
6. **未知购入资料与零**：第二件“虚构 T06c 正常迁移样例”购入金额/日期均未知；以 ¥0、2026-09-25 从 Active 售出成功。显示成本不完整、精确净成本/净日均待补充；持有数变 0。[原生证据](t08/native-unknown.txt)。
7. **撤销误记**：自动审批最初以 GUI 删除需即时确认为由拒绝包含最终点击的脚本；没有绕过。两项具体记录已就绪后，用户明确答复“确认执行这两项撤销”。随后原生相机恢复 Retired，原三条状态记录保留，有效结算移除，持有天数恢复到 25 天、日均 ¥54.02；浏览器键盘恢复 Active。[原生撤销](t08/native-revoked.txt)。
8. **最终重开和原图**：再正常退出、重开，相机 Retired revision 13，第二件 Sold revision 4，当前使用中 0、持有 1。原相机照片集合、封面、建档时间、原字段、原图 SHA256 不变；纠错链依次 sell/correct/revoke。`integrity_check=ok`，外键检查为空。[只读核对](t08/native-final-check.json)、[重开](t08/native-final-reopen.txt)、[重开详情](t08/native-final-detail.txt)、[最终深色详情](t08/native-final-detail.jpg)。

工具记录：中文使用 Sky `set_value`；某次更正首次点击只聚焦容器，观察界面及只读库证实未保存后，再按新 AX 索引提交成功。Ego 脚本一处省略号定位修正后重跑通过。原生截图为实际窗口，仍沿用 A「静序」；未把本轮当作完整缩放/VoiceOver/键盘验收。

## Demo 图片与剩余边界

- 六种分类小 SVG 图标已有；原 Demo 丰富彩色物品插图目前仅复用在浏览器生产组件的虚构样例。**原生无照片资产仍是名称首字，尚未接入分类插图兜底**。前一轮“已复用”的表述不能理解为原生封面已同步。现有图可继续复用，无需重画；具体边界已补入 [UI 设计](../UI_DESIGN.md)。
- T09 接入维护费用后补齐 AC22/23 的完整数值与关联更正；T14 全局时间轴、T18 全实体备份界面、T20 完整 Mac/可访问性、T21 P0 验收未交付。本轮没有提前实现这些功能。
- 本轮由当前 Astra 主线串行执行，未切换 Sol、未委派 Hermes/M3/GLM，也没有独立模型审阅。档位/账单/可比费用未采集，不报告节省比例。阶段选型建议仍见实施计划 §4、§7。

## 跨窗口交接

- 工作目录：`/Users/jackzhu/Documents/Codex/2026-09-24/referenced-chatgpt-conversation-this-is-an/outputs/Possio-t06b`，分支 `codex/t06b-taxonomy-storage`。先核对 cwd/branch/HEAD/status；不要从落后的 main 重建工作树。
- 原生包：`src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`。构建使用 `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`；包名/标识不变，标题为 T08。
- 虚构库：`~/Library/Application Support/local.possio.t06b.preview/library`；当前 dataset `0a0e28f8-0b00-4f4a-9d05-9c1da9650abe`、schema 7。相机 Retired，第二件 Sold，无待核对提交或持有测试写锁。
- 开发浏览器仍为端口 1429 的 `visual-preview.html`，刷新重置；本轮 Ego TaskSpace 已关闭。
- 下一项 T09 维护记录，尚未启动。T08 已实现范围可本地集成；不自行合并 main、推送或发布。
