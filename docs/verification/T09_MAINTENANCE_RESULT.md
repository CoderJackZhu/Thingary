# T09 维护档案实现与验收记录

日期：2026-09-25

状态：**待 Codex 审阅**

工作树：`Possio-t06b` / `codex/t06b-taxonomy-storage`

起点：`310fe9d83f60db0f4a8c14d284ecfef57c472f40`

最终提交：本报告所在的 T09 本地提交（交回时以 `git rev-parse HEAD` 的输出为准）

## 1. 本轮范围

仅完成 T09，不含 T10：

- schema 7 → 8，新增 `maintenances`、`maintenance_photos`、`maintenance_audit` 及维护日期／购入成本聚合触发器；
- 维护新增与同 ID 更正，request idempotency、generation/revision 冲突保护、审计快照与故障注入；
- 维护日期与购入、售出日期的双向约束；
- 维护费用的未知（`NULL`）、免费（`0`）、已知求和，以及购买／售出结算联动；
- 维护图片复用托管附件，纳入 schema 8 校验、备份和恢复；
- A「静序」基线下的维护表单、详情列表、图片、草稿、关闭保护与摘要联动；
- 后端、前端、构建与可执行的隔离原生持久性验收。

T09 未增加维护记录独立删除；统一子实体删除／恢复仍归 T11。

## 2. 实现结果

### 2.1 存储与领域

- 当前维护事实写入 `maintenances`，更正保留原 maintenance ID。
- `maintenance_audit` 追加 `add` / `correct` 快照；事实、图片关联、资产 revision、资料更新时间、审计和请求回执同事务提交。
- `maintenance_photos` 复用资产附件并验证同资产归属；父资产软删除／恢复不丢失维护及原图关系。
- schema 8 数据集校验和备份白名单覆盖三张维护表及触发器；schema 1–7 可恢复后迁移到 8。
- 已知维护费用采用 `SUM(cost_cents)`；未知条数采用 `cost_cents IS NULL` 计数，避免把 `0` 当未知。
- 只有购入价和全部维护费用均已知时才生成总投入、净成本和日均成本；售出收益由后端统一扣除。
- 已知维护日期不得早于购入、晚于售出或晚于今天；更正购入／售出日期时反向检查已有维护并返回冲突记录。

### 2.2 前端

- 详情页接入维护列表、新增与更正入口；Sold 资产仍可补录售出日前历史。
- 表单区分费用留空（未知）与 `0`（免费），以元输入并在提交时规范化为整数分。
- 表单支持维护图片选择／移除、sessionStorage 草稿、关闭保护、保存中状态和后端错误提示。
- 保存后刷新同一资产档案及费用摘要；前端不复制后端成本公式。

## 3. 自动验证

提交前重新执行完整命令链：

```bash
cargo fmt --all --manifest-path src-tauri/Cargo.toml
npm run test:ui
npm test
npm run check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection
npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app
git diff --check
```

结果：整条命令链 **exit 0**。

- 前端逻辑：23 项通过。
- Rust：50 项通过，0 失败；包含 4 项维护集成测试。
- TypeScript 检查与 Vite 生产构建通过。
- 隔离 debug App 构建成功：`src-tauri/target/debug/bundle/macos/Possio T06b Preview.app`。
- `git diff --check` 通过。

维护集成测试覆盖：

- 新增 ¥200、同 ID 更正 ¥150、未知费用、`0` 免费、售出收益与日均成本；
- 重复请求、请求 ID 冲突、过期 generation/revision、提交前失败回滚、提交后回执丢失恢复；
- 购入／售出／维护日期双向冲突和 Sold 历史补录；
- 图片、父资产软删除／恢复、重开、备份／恢复及原图预览。

## 4. 隔离原生 App 证据

隔离 App 使用 bundle id `local.possio.t06b.preview`，数据集位于独立目录：

```text
~/Library/Application Support/local.possio.t06b.preview/
```

在虚构资产「虚构 T06b 旅行相机」上实际执行：

1. 新增维护「T09 虚构镜头清洁」，费用 ¥200；
2. 关闭并重新启动隔离 App，详情仍显示同一记录和 ¥200；
3. 打开该记录更正为 ¥150；
4. 再次关闭并重新启动隔离 App；
5. 直接读取活动 SQLite 数据集并核对完整性和审计。

数据库读回结果：

- `PRAGMA integrity_check`：`ok`；
- `maintenances`：1 行，`cost_cents = 15000`；
- `maintenance_audit`：2 行；
- 两条审计分别为 `add` 与 `correct`，`maintenance_id` 相同；
- 更正后总投入从 ¥1,119.00 变为 ¥1,069.00，维护记录仍为 1 条。

浏览器预览仍使用内存 fixture；本轮原生证据来自独立 bundle id 的真实 SQLite 数据集，未把浏览器预览当作原生持久性证据。

## 5. 已验证边界与未验证边界

### 已由自动测试验证

- schema 7 → 8、schema 1–7 恢复迁移、v8 白名单与损坏拒绝；
- 未知／零／已知费用和购买／维护／售出聚合；
- 日期双向冲突；
- 图片归属、软删除／恢复、备份／恢复、重开；
- 写入失败回滚、回执丢失、重复请求与 stale generation/revision；
- 前端草稿键、校验、金额转换和命令负载。

### 本轮未做完整原生 GUI 手工验收

以下路径有自动测试证据，但未逐条在原生 GUI 重演，因此不宣称手工通过：

- 空日期、空费用、`0` 免费三种 GUI 输入；
- 购入／售出日期冲突的 GUI 错误文案；
- HEIC 维护图片的选择、源文件移动、缺图修复；
- 未保存草稿在关闭／重开时的完整交互；
- 写锁失败后的 GUI 重试；
- 从设置界面执行维护数据备份／恢复和坏备份拒绝；
- VoiceOver、完整键盘路径及不同缩放，仍归 T20。

因此本报告结论是“已实现并具备交回审阅条件”，不是完整 P0 或 CP2 通过。

## 6. 审阅建议

Codex review 优先核对：

1. schema 8 迁移／白名单／触发器是否保持旧版本恢复兼容；
2. `NULL` 与 `0` 的费用语义、溢出路径及售出后日均公式；
3. maintenance add/correct 在事务、审计、request replay 与图片归属上的一致性；
4. 购入／售出日期反向修改时是否覆盖所有维护冲突；
5. 前端草稿、关闭保护、图片选择与 unknown receipt 的状态路径；
6. 是否需要把上述未做的原生 GUI 边界列为审阅补验，而不是提前推进 T10。

结论：T09 已完成本轮实现和可执行验证，**待 Codex 审阅**；未合并、未推送、未发布。
