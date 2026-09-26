# T21 完整 P0 验收结果

日期：2026-09-26。**T21 验收已交回，待 review；不宣布 CP4 或 P0 通过。** 本轮只有验收证据、独立读回脚本和交付说明，没有应用代码、业务规则或 schema 改动。

## 1. 起点、执行者与环境

- 工作目录 `/Users/jackzhu/Code/Own/Possio`；从包含交接的最新本地 main `89e19190519a9e81df0d1bbb785bab16393e5b2a` 创建 `codex/t21-p0-acceptance`。未 reset、未合并 main、无远程、未推送。
- 开工仅 `?? .gitignore`；SHA256 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`，保持原样、不暂存。
- 实际执行者：本会话 Codex（系统标识 GPT-6 系列；未提供可核实的 Sol/Astra 子型号及推理档位，不能冒称 Sol 中档或独立 Astra High 已 review）。单执行者，无子代理、MoA、后台循环、全局配置更改；建议由 Astra High 独立核验本报告出口。
- macOS 27.0 / 26A428，arm64；Node v22.22.3；rustc 1.96.0 / cargo 1.96.0；Tauri CLI 2.11.5。仅 CommandLineTools 27.0.0.0.1788430756、SDK 27.0，`xcodebuild -version` 因无完整 Xcode 退出 1。Info.plist 最低 macOS 14.0 **只是打包目标**；未测 14.0、Intel 或其他机器。
- release 命令：`npm run tauri -- build --config .local/t21-release.conf.json --bundles app`（无 `--debug`，无 fault-injection）。产物 `src-tauri/target/release/bundle/macos/Possio T21 Release.app`；bundle ID `local.possio.t21.release`；初次构建 exit 0，App 磁盘占用 14,484 KiB，主可执行文件 14,803,552 字节。
- 空库接受方同为 release，配置 `.local/t21-empty.conf.json`，App `Possio T21 Empty.app`，identifier `local.possio.t21.empty`。两个配置本机保留、不入 Git；只改变 productName/identifier/窗口标题，不改业务。

## 2. 数据保护与本轮实测

### 2.1 隔离及快照

普通库 `local.possio.preview` 未打开或写入。未重置、未重导 Demo，也未操作开工前已运行的 T06b 虚构库。本轮只从已知虚构的 `/tmp/possio-t18/t18-with-trash.possio` 恢复到 T21 身份，原阶段资料不变。

首次 T21 启动确认目录原不存在、库 0 资产。每次定位均解析 `library/active.json`，使用 SQLite backup API 做一致性快照；见 [源初始快照](t21/initial-snapshot.json)、[目标空库快照](t21/empty-snapshot.json)。源库后续恢复前、缺图操作前另有 `library/backups/t21-before-*.sqlite`；自动恢复保护副本与旧数据集原样保留。数据库、备份、修复源图全部只在隔离库和 `/tmp/possio-t21`，不提交 Git。

### 2.2 release 离线闭环与重开

先仅填名称“ T21 虚构耳机”（实际值见 AX 记录）保存，金额/日期留空，进入详情并显示待补充。正常 ⌘Q 退出后，用 `sandbox-exec` 启动同一正式包，仅禁止 IP 入站/出站，保留本机系统 IPC；新增“ T21 离线虚构相机”、进入详情、更正名称、软删除、从侧栏最近删除同记录恢复，再从设置入口查看最近删除为空，均成功。退出后目标 PID 消失，重开两条记录仍在。完整命令、启动工具限制和残留核对见 [运行记录](t21/runtime.md)。

明确选择浅色后正常退出、重开，[浅色与新旧 iPad](t21/reopened-light.png) 保持；[浅色总览](t21/overview-light.png) 与 [深色总览](t21/overview-dark.png) 为同尺寸 1080×760 实际窗口，文字/关键操作可读。首次脚本把同名标题当下拉，未改主题；修正 AX 角色后成功，失败截图不当浅色证据。

### 2.3 买回、统计、图片

恢复既有虚构数据后，独立算回的买回前总览：持有 15，购入 3,921,550 分，平均 688.7 天（界面总览 689）、中位 516、最长 2054。正式包显示一致，统计毛/净日均分列。随后通过新增创建同名 `iPad Air 4`：新 ID `1e7dfc48-0ea1-410a-adc3-3b3b5059584f`，Active、¥1,000、2026-09-26；旧 ID `3494ca5d-416c-40ed-8dce-8ed62c268949` 仍 Sold、原购入 ¥4,799、售出 ¥1,800，维护与历史保持。旧净成本 ¥2,999 / 1412 天，新成本 ¥1,000 / 1 天，各自独立。买回后持有 16、¥40,215.50，历史 ¥45,014.50，平均 626.1818 天；见 [独立计算](t21/independent-readback.json)及[脚本](t21/verify_release.py)。

关闭源 App、快照并可逆移走新 iPad 的一张托管图片（保留原件与修复源），正式包显示缺图占位和明确修复入口，档案未清空；经 NSOpenPanel 重新选择同一原图后“原图已修复”，SHA256 相同。非图片内容伪装 `.png` 被正式包拒绝，“不使用这次未读取的图片”后可取消空表单；取消后目标库全部表仍与恢复备份相同。不是依靠 SQL 写业务数据来制造 GUI 通过。

### 2.4 同库备份、CSV 与空库恢复

正式包先取消保存备份面板，回到空闲且 T21 目录无 `.possio`；再次保存成功并提示已校验。输出 `/tmp/possio-t21/物志备份-20260926-1438.possio`，548,885 字节；清单 10 项（SQLite + 9 原图）逐项散列及大小一致，SQLite integrity 为 ok。随后同库导出 CSV，标准 CSV 解析器独立按只读 SQL 对照全部 13 列：18 条未删除资产一致，已删除 1 条排除；未知价格 5、明确零价 1、未知日期 6、售出 2。见 [读回](t21/csv-readback.txt)及[脚本](t21/verify_csv.py)。

备份是归档，不是可读资产表；CSV 不含关系、原图、最近删除，不能恢复。新身份空库原生“选择→检查摘要→确认替换”恢复本轮备份后：19 资产（含 1 最近删除）、103 心愿、6 维护、3 保障、17 资产附件行（共享后共 9 原图）。[独立比对](t21/restore-readback.json)覆盖 **25 张表全部行**（包括请求、审计、关系），全部相同；9 原图哈希相同、外键 0 异常、保护副本 1 份。已实现心愿可打开正确资产，最近删除可见原项目，重开保持。

原生选择 `bad.possio` 后明确提示“不能用于恢复，当前资料未改变”；[再比对](t21/bad-backup-unchanged.json)仍全部一致。恢复阶段进程中断、权限/空间故障与备份写入排队复用 T18/底层实验，在最终自动检查重跑，未在正常 GUI 包强造磁盘满。

## 3. AC01–AC44 逐项结论

通过 40／部分 4／未执行 0／失败 0。这里“通过”仅表示该 AC 的现有证据组合覆盖其条件，不表示 44 条都通过或 CP4 已批准。自动回归以第 6 节最终 HEAD 检查记录为条件；若最终检查失败，对应结论须降级并在交回中说明。历史记录的旧未验描述以同文件后续补验与 T20 为准，不以阶段出口替代证据。

| AC | 主责任任务 | 证据来源 | 本轮复测 | 结论 | 范围与缺口 |
|---|---|---|---|---|---|
| AC01 | T01 | 本轮名称最小新增、禁网闭环及重开；[名称](t21/name-only.txt)、[重开](t21/reopened.txt) | 是 | 通过 | 价格/日期留空，独立建档；旧数据集及快照仍保留。 |
| AC02 | T01 | [CP1](../VERIFICATION_REPORT.md) 空名称/未来日期；表单测试 | 自动回归 | 通过 | 原生历史证据＋当前自动测试；本轮未逐字段重复 GUI。 |
| AC03 | T05 | [T05](../VERIFICATION_REPORT.md) 托管、移动源文件、故障；本轮恢复原图散列 | 恢复/自动 | 通过 | 原件与源分离；失败点沿用集成测试。 |
| AC04 | T01 | [CP1](../VERIFICATION_REPORT.md)、[T13](T13_WISHLIST_CONVERSION_RESULT.md)；提交回执及崩溃测试 | 自动回归 | 通过 | 重复保存、提交后丢回执、转换同请求均有证据；不是仅凭阶段出口。 |
| AC05 | T01 | [T05](../VERIFICATION_REPORT.md) 选图关闭继续；[T20](T20_MAC_EXPERIENCE_RESULT.md) 空表单 Esc；本轮不支持图片取消 | 局部 | 部分 | 未找到当前完整资产表单“有文字及选图→放弃”两分支成对的完整原生证据；不能把空表单取消替代。 |
| AC06 | T02 | [CP1](../VERIFICATION_REPORT.md)、[T20](T20_MAC_EXPERIENCE_RESULT.md)；本轮搜索新旧 iPad | 局部 | 部分 | 同对象与搜索、选中已有证据；长列表滚动、全部筛选排序组合返回与显示缩放仍未成套验收。 |
| AC07 | T03 | [T14](T14_TIMELINE_RESULT.md) 补日期事件归位一次；[T15](T15_OVERVIEW_RESULT.md) 汇总；本轮同记录更正 | 是/自动 | 通过 | 原建档、同 ID 与有效事件由存储和时间轴测试覆盖。 |
| AC08 | T03 | [T07](T07_LIFECYCLE_RESULT.md) 退役筛选更正后说明；[T06c](T06C_REGRESSION_RESULT.md) 失效分类筛选 | 自动回归 | 通过 | 不匹配后详情结果可见、返回有解释及清除入口；历史 GUI 证据复用。 |
| AC09 | T02 | [CP1](../VERIFICATION_REPORT.md) 无结果；[T13](T13_WISHLIST_CONVERSION_RESULT.md) 删除链接；本轮已删除心愿关联 | 局部 | 部分 | 不存在链接与读取失败的当前原生成对证据不足；不能仅以代码文案存在判通过。 |
| AC10 | T03 | [T07](T07_LIFECYCLE_RESULT.md)、[T09](T09_MAINTENANCE_RESULT.md#5-已验证边界与未验证边界) 双向日期与冲突 | 自动回归 | 通过 | 购入晚于维护/退役/售出阻止，已有 GUI 和领域测试互补。 |
| AC11 | T09 | [T09](T09_MAINTENANCE_RESULT.md)、[T14](T14_TIMELINE_RESULT.md)；维护及 timeline 测试 | 自动回归 | 通过 | 同维护 ID 更正、费用只计一次，事件与汇总同步。 |
| AC12 | T09 | [T11](T11_UNIFIED_TRASH_RESULT.md) unknown/zero 恢复测试；维护 E01/E02 | 自动回归 | 通过 | 未知费用不当零；删除/恢复后完整性重新派生。 |
| AC13 | T11 | [T11](T11_UNIFIED_TRASH_RESULT.md) E09 与确认/取消、成本联动；T18 全关系恢复 | 自动回归 | 通过 | 原 ID、有效时间轴与费用同步，独立删除语义保留。 |
| AC14 | T10 | [T10](T10_WARRANTY_RESULT.md) 重叠/未来/今日保障；[日期测试](t21/date-tests.log) 与 Rust E04 | 固定日期/自动 | 通过 | 0/30/31 天及次日 Expired/29/30；刷新路径列表和详情各读一次；未修改系统时间。 |
| AC15 | T10 | [T10](T10_WARRANTY_RESULT.md)、[T14](T14_TIMELINE_RESULT.md) 同 ID 更正和重启；timeline 测试 | 自动回归 | 通过 | 到期查询派生，无持久重复事件/常驻通知进程。 |
| AC16 | T12 | [T12](T12_WISHLIST_RESULT.md) GUI 放弃；[T15](T15_OVERVIEW_RESULT.md) 总览隔离 | 自动回归 | 通过 | 预计价、资产实付与进行中心愿汇总分开，历史保留。 |
| AC17 | T13 | [T13](T13_WISHLIST_CONVERSION_RESULT.md) 1500→1200；[恢复详情](t21/restored-conversion-detail.txt) | 恢复/自动 | 通过 | 原预计与实付分离，双方引用及唯一购入事件保留。 |
| AC18 | T13 | [T13](T13_WISHLIST_CONVERSION_RESULT.md) 连续触发/取消/回包丢失崩溃；[T18](T18_BACKUP_RESTORE_RESULT.md) worker 排队 | 自动回归 | 通过 | 恢复/故障自动用例复测；未把本轮正常包当作 GUI 故障注入。 |
| AC19 | T13 | [T13](T13_WISHLIST_CONVERSION_RESULT.md)、[恢复心愿](t21/restored-wishlist.txt) | 恢复/自动 | 通过 | 已实现保持，删除关联引导最近删除，不再转换。 |
| AC20 | T07 | [T07](T07_LIFECYCLE_RESULT.md) Active→Retired→Active；[T17](T17_HOLDING_RESULT.md) | 自动回归 | 通过 | 原购买与费用、持有天数不重置。 |
| AC21 | T07 | [T07](T07_LIFECYCLE_RESULT.md)、[T08](T08_SALES_RESULT.md) Sold 拒绝启用和日期顺序 | 自动回归 | 通过 | 同日顺序、相邻动作及 Sold 来源有定向测试。 |
| AC22 | T08 | [T09](T09_MAINTENANCE_RESULT.md)、[T17](T17_HOLDING_RESULT.md)；maintenance/sales/insights 测试 | 自动回归 | 通过 | 含维护净成本、售出截至日冻结；本轮新旧 iPad 独立算回。 |
| AC23 | T08 | [T08](T08_SALES_RESULT.md) 原生负净成本；[T19](T19_CSV_EXPORT_RESULT.md) 原始售价导出 | 导出/自动 | 通过 | 同售出 ID 更正；负净成本不截零；CSV 不冒充成本结算表。 |
| AC24 | T08 | [T08](T08_SALES_RESULT.md) Retired 撤销并重开；[T14](T14_TIMELINE_RESULT.md) 有效事件 | 自动回归 | 通过 | 恢复售出前状态，纠错审计保留，有效结算移除。 |
| AC25 | T08 | [T08](T08_SALES_RESULT.md) 未知购入/零售价 GUI；[T17](T17_HOLDING_RESULT.md) 排除原因 | 自动回归 | 通过 | 未知不显示精确净成本，已售出仍退出当前持有。 |
| AC26 | T08 | [买回详情](t21/repurchase.txt)、[独立核对](t21/independent-readback.json)、[同名两件](t21/reopened-light.png) | 是 | 通过 | 新旧真实 UUID 不同；旧 Sold、旧维护/售价保留，新 Active 独立成本。 |
| AC27 | T04 | [T11](T11_UNIFIED_TRASH_RESULT.md)、[T13](T13_WISHLIST_CONVERSION_RESULT.md)、完整关系备份测试 | 自动回归 | 通过 | 图片/子记录/心愿关联保持；删除不变更生命周期。 |
| AC28 | T04 | [T11](T11_UNIFIED_TRASH_RESULT.md)、[T13](T13_WISHLIST_CONVERSION_RESULT.md)、[全表核对](t21/restore-readback.json) | 恢复/自动 | 通过 | 原 ID/状态/共享原图和关系一致；不增重复业务记录。 |
| AC29 | T04 | [T08](T08_SALES_RESULT.md) Sold 恢复；[T11](T11_UNIFIED_TRASH_RESULT.md) 写锁与同请求重试 | 自动回归 | 通过 | 失败仍在最近删除；无自动永久清空。 |
| AC30 | T18、T19 | [完整备份](t21/backup-done.txt)、[CSV](t21/csv-done.txt)、[逐行核对](t21/csv-readback.txt) | 是 | 通过 | 同库两种输出；备份 19 资产及关系/原图，CSV 18 未删除资产、不能恢复。 |
| AC31 | T18 | [空库前快照](t21/empty-snapshot.json)、[恢复后](t21/empty-restored.txt)、[全表/原图比对](t21/restore-readback.json) | 是 | 通过 | 新 identifier 空库，25 张表全部行相同、9 原图一致；重开及最近删除可用。 |
| AC32 | T18 | [坏档拒绝](t21/bad-backup.txt)、[未改变](t21/bad-backup-unchanged.json)；backup/recovery 测试 | 是/自动 | 通过 | 坏文件原生拒绝；不支持版本/缺文件/非法路径由故障测试复测。 |
| AC33 | T18 | [T18](T18_BACKUP_RESTORE_RESULT.md)、[工程恢复实验](../VERIFICATION_REPORT.md)；recovery 子进程中断测试 | 自动回归 | 通过 | 测试独立临时库的中断/空间权限故障；未制造真实磁盘满或电源中断，不据此保证硬件耐久。 |
| AC34 | T18 | [T18](T18_BACKUP_RESTORE_RESULT.md) backup_pauses_queued_writes；本轮原生取消备份面板 | 是/自动 | 通过 | 取消后无 .possio 输出再发起正式备份；worker 排队和失败不发布由自动测试覆盖。 |
| AC35 | T15 | [正式包总览](t21/release-overview.txt)、[统计](t21/release-statistics.txt)、[独立计算](t21/independent-readback.json) | 是/自动 | 通过 | Active+Retired、历史含 Sold、未知单列、毛/净日均分列；买回前后分别核对。 |
| AC36 | T16、T17 | [T16](T16_TRENDS_RESULT.md)、[T17](T17_HOLDING_RESULT.md)、本轮正式包统计与独立算回 | 是/自动 | 通过 | E06/E07 月末闰日与期间边界沿用固定日期 tests；本机日期未改。 |
| AC37 | T06 | [T06c](T06C_REGRESSION_RESULT.md)、[T12](T12_WISHLIST_RESULT.md)；taxonomy/wishlist 测试 | 自动回归 | 通过 | 分类/渠道 ID、迁移、软删除与心愿引用覆盖；不只引用早期资产出口。 |
| AC38 | T14 | [T14](T14_TIMELINE_RESULT.md)、[T18](T18_BACKUP_RESTORE_RESULT.md) 全投影比较；本轮完整恢复 | 恢复/自动 | 通过 | 有效业务日期、未知日期单列、过滤、心愿购入去重均有测试证据。 |
| AC39 | T20 | 本轮 IP 禁网闭环、[重开浅色](t21/reopened-light.png)、[运行记录](t21/runtime.md) | 是 | 通过 | 明确为进程级禁网；未关闭 Wi-Fi。目标 App 已退出，无本任务 HTTP 服务。 |
| AC40 | T05、T20 | [缺图](t21/missing-image.txt)、[修复](t21/image-repaired.txt)、[格式拒绝](t21/unsupported-image.txt)、浅深色截图和 T20 | 是/局部 | 部分 | 图片抽检通过；完整键盘与辅助功能覆盖仍不完整，VoiceOver、缩放待用户。 |
| AC41 | T11 | [T11](T11_UNIFIED_TRASH_RESULT.md) 子项删除恢复/附件；T18 全关系测试 | 自动回归 | 通过 | 原记录 ID，费用/保障/有效事件同步，附件保持。 |
| AC42 | T11 | [T11](T11_UNIFIED_TRASH_RESULT.md) E09 原生；unified_trash 与 full_backup | 自动回归 | 通过 | 先删子后删父，恢复父不复活已独立删除子项。 |
| AC43 | T11 | [T11](T11_UNIFIED_TRASH_RESULT.md) 恢复所属物品入口；[设置最近删除](t21/settings-trash.txt) | 入口/自动 | 通过 | 父未恢复时不连带恢复；正式包侧栏/设置入口抽检。 |
| AC44 | T11 | [T11](T11_UNIFIED_TRASH_RESULT.md) 原请求回包丢失核对；本轮删除恢复，unified_trash | 局部/自动 | 通过 | 父删除不制造独立子删除项，回执重放无重复费用/事件/文件。 |

## 4. 风险与缺陷

| 风险 | 结论与边界 |
|---|---|
| R01 | 本机 release、进程级禁网、退出重开、文件面板已有实测；其他 OS/Intel 未测，不作为支持承诺。 |
| R02 | 日期、金额、回执、转换与同名买回证据齐备；固定日期/事务/故障测试随最终 HEAD 重跑。 |
| R03 | 四种格式与崩溃协议复用 T05，正式包缺图修复和非法图片取消补验；相机 HEIC 变体和断电耐久性未测。 |
| R04 | T11 E09、原请求核对及本轮恢复表/原图比对，原 ID 和独立删除语义有证据。 |
| R05 | 正式包空库完整恢复、坏档不覆盖通过；切换中断、失败与排队由独立临时库自动实验承担，不冒称原生磁盘满实测。 |
| R06 | CSV 逐列核对与正式包独立算回通过；E06/E07 月末闰日由固定日期自动测试覆盖；Numbers/Excel 实际打开效果未测。 |
| R07 | **部分**。已有 T20 800×600 与快捷键/焦点证据，本轮原生主题、图片及搜索/新增抽检；长列表完整返回上下文、VoiceOver/缩放和四类异常页面仍留缺口。 |

未发现并确认需要本轮修改产品代码的小型缺陷，所以没有修复提交或新增镜像测试。已知非阻塞文案问题仍沿用 T12/T13：心愿图片拒绝错图时提示“编辑资料”，但心愿尚无编辑入口；不擅自新增功能。

验收阻塞（阻塞完整 P0/CP4 判定，不阻塞本次交回）：AC05、AC06、AC09、AC40 的缺口及以下用户检查。没有把未执行/不完整的部分写成失败，也没有把“暂无已确认数据损坏”写成可托付唯一真实资料。

工具异常如实保留：第一次 Swift 编译默认缓存目录不可写，改用 `/tmp/possio-t21/swift-cache` 后成功，未改全局环境；直接运行禁网 App 不按 bundle 登记，改按已核对 PID 定位 AX；前往面板曾需第二次回车确认路径，期间禁用状态不是应用死锁；空库收尾一次 ⌘Q 未观察到退出，AX 原生“退出物志”立即退出，故不把该次按键视为成功。源正式包 ⌘Q 的退出证据独立存在。所有键盘操作前均检查前台及可达窗口；失败即停，未盲发至别的 App。用户明确允许占用前台后才继续。

## 5. 待用户本人检查

以下均为 **待用户**，不是通过：

1. 打开 T21 正式包，在设置选择“跟随系统”；保持 App 运行切换系统浅/深色，观察列表、详情、表单均同步且可读，再重开确认设置保持。
2. 开启 VoiceOver，依次走搜索→新增→校验错误→取消→详情→最近删除→设置备份面板；确认名称、角色、状态、错误和焦点顺序可理解，无焦点逃逸。
3. 用日常显示缩放/辅助字号，检查 800×600 与常用尺寸下长名称、表格、表单底部按钮；记录实际显示器及设置，勿以网页缩放替代。
4. 物理点击 Dock：关闭窗口后点击图标应重开；⌘Q 后点击应重新启动，同一记录/主题保持。
5. 如需验证系统级完全断网，由用户关闭 Wi-Fi/有线网络，重复新增→更正→删除→恢复→退出重开；本轮使用进程级 IP 禁网，没有改系统网络设置。

## 6. 最终 HEAD 检查与交回

本报告先随证据本地提交，随后在**最终提交的 HEAD** 依序运行以下完整检查。为避免把记录检查结果的新提交冒称已测 HEAD，提交后机器日志保存于 `/tmp/possio-t21/final-checks/`（不入库）；[summary.json](/tmp/possio-t21/final-checks/summary.json)记录完整 SHA、每项命令、退出码、数量、起止时间，[summary.md](/tmp/possio-t21/final-checks/summary.md)为可读索引。最终交回消息亦列实际结果。本提交不预写尚未发生的成功结果。

1. `npm run test:ui`
2. `npm test`
3. `npm run test:demo`
4. `npm run check`
5. `npm run build`
6. `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app`
7. `npm run tauri -- build --config .local/t21-release.conf.json --bundles app`
8. `git diff --check`

检查在普通 macOS 权限环境串行执行，HEIC ImageIO 不以受限沙箱失败代替业务失败；只重建 debug 包，不启动或改写旧 debug 虚构库。最终 HEAD 从上述记录与交回消息取得，不能用报告内自引用制造伪 SHA。

## 7. 交付与继续 review

- 本机源码构建入口见 README；T21 使用第 1 节独立配置，启动完整 `.app` 路径。配置重建模板：默认 `tauri.conf.json` 合并 productName=`Possio T21 Release`、identifier=`local.possio.t21.release`，窗口 main/title=`物志 · T21 P0 验收`、1080×760、min 800×600。空库身份对应 `Possio T21 Empty` / `local.possio.t21.empty`。
- 数据位置：`~/Library/Application Support/<identifier>/library`；先读 `active.json` 再定位 `datasets/<id>/data.sqlite` 与 `files/`。不要直接编辑 SQLite，不把普通库作为验收库，不删除恢复前数据集/保护副本。
- 完整备份用于整体恢复，CSV 只供阅读和其他表格工具处理，最近删除只找回本库误删。备份上限 100 MiB / 1023 文件，图片限制与 HEIC 变体范围见 T05；未做 1,000 资产/5,000 关联的性能承诺。
- 结束时本任务 source/empty 两个 App 已退出、无测试写锁、图片已修复；开工前的 T06b App PID 33139 与 Vite PID 32895（127.0.0.1:1429）保留，它们不是本轮退出残留，也未当作 release 服务。详见运行记录。
- review 优先核查四条部分项、历史证据覆盖完整条件的判断、独立对照脚本、最终 HEAD 日志及发布范围。不合并 main，不自行继续下一阶段。
