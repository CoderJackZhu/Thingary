# 首批工程验证记录

日期：2026-09-24。范围：用户明确回复“确认开始”，授权 V00–V05；终点 CP0，T01–T21 未开始。

## 结论

本地存储、图片提交、一致备份与隔离恢复的首批实验通过。17 个故障点已用真实测试子进程终止后重启检查。该结果只覆盖最小资产与附件，不能替代完整 P0 验收，也不证明断电耐久性。

**CP0 保留待验项：原生 UI 自动检查受工具版本不匹配阻断；HEIC 尚未接入。** 当前不能宣布全部 V01 或完整 R01/R03/R07 通过。代码停在验证版，后续业务任务未启动。

## 环境与版本

只读实测：macOS 27.0 (26A428)、arm64、SDK 27.0、CommandLineTools；Node 26.9.0、npm 11.19.1、rustc/cargo 1.96.0。未升级全局工具或更改模型路由。

当前锁定的直接关键依赖：Tauri Rust 2.11.6、Tauri CLI 2.11.5、JS API 2.11.1、React 19.3.0、Vite 8.3.0、TypeScript 5.9.3、rusqlite 0.40.2、SQLite **3.53.2**（运行时查询）、image 0.25.10、zip 8.6.0。完整解析版本见 package-lock.json 与 src-tauri/Cargo.lock；后续安装使用锁文件。

最低打包目标设为 macOS 14.0；只有当前机器实测，不构成旧系统或 Intel 支持承诺。验证应用标识 local.possio.verification，与未来正式库分离。

## 实际输入与存储契约

- 名称去首尾空白后 1–200 个 Unicode 字符；金额以整数分字符串或 null 传输，购入价范围 0–99,999,999,999 分，禁止小数分。整数合计检查溢出，日均使用整数比值按分四舍五入，支持负净成本。
- 日期为严格 YYYY-MM-DD，1900–9999 年；购入不晚于本地今天，含首尾自然日。未知值用 null，零只表示免费。查询预留每页 1–100 条，本轮仅读取虚构资产，分页页面未实现。
- 单独存储线程串行执行命令，数据目录有进程锁。SQLite 启用外键、WAL、FULL 同步与 3 秒繁忙等待；请求结果与资产同事务提交，revision 阻止旧资料覆盖。
- 图片实测支持 JPEG、PNG、WebP；上限 20 MiB、最长边 12,000 像素、4,000 万像素、解码内存限 192 MiB。HEIC 当前拒绝并说明未支持，不自动转码或丢弃原图。完整格式目标留给后续能力补验。
- 首批备份使用 Stored ZIP + JSON 清单 + SQLite 快照 + 原图，格式版本 1、当前数据库 schema 2；实验限约 100 MiB / 1,023 个数据文件。这是 CP0 保护性限制，不是最终容量验收。完整备份及更多实体由 T18 扩展并重验。

## V00–V05 实测证据

| 项目 | 实际结果 | 范围限制 |
|---|---|---|
| V00 环境与契约 | SDK/工具链核对、输入契约和依赖锁已建立 | 旧系统与 Intel 未测试 |
| V01 最小 App | TypeScript/Vite 构建和 Tauri debug/release App 打包成功；release 在禁网进程沙箱中两次启动，schema 2/完整性正常且数据集相同 | 首次缺图标已修复；关闭/重开、⌘Q、主题、焦点及实际截图待测 |
| V02 保存 | 未知/零、含首尾/闰日、负净成本；同请求重试、同 key 异内容冲突、revision 冲突、重启同 ID 均通过 | IPC 已接虚构样例界面并编译；真实 UI 点击端到端未完成 |
| V03 图片 | 三种格式、坏图、超大小拒绝；源图移走、共享和软删除引用仍可读；五种错误返回点与四个真实进程终止点通过 | HEIC 未支持；软删除仅为存储夹具，不是 T04/T11 UI 完成 |
| V04 备份 | 非空库及原图完整；取消无产物；三个失败点不发布；排队写入等待快照完成；实际归档再次校验 | 小型单资产/单图片样例一次约 57 ms，仅作实验记录，不代表规模性能 |
| V05 恢复 | 新目录恢复 ID/原图；保护副本、版本与路径/哈希/引用校验；旧数据集请求拒绝；九个恢复故障点后读取完整新库或旧库；旧 schema 迁移失败不损害原库和源备份 | 仅最小资产与附件；完整关联数据、真实恢复交互和大库由 T18/T21 验收 |

测试代码与复现入口：src-tauri/tests/storage.rs、files.rs、backup.rs、recovery.rs、process_crash.rs；纯计算测试位于 domain.rs。共 **18 个测试结果通过，其中 1 个是子进程测试入口，17 个是有效测试用例**。进程测试用例内部覆盖以下 **17 个 SIGKILL 点**：

- 保存：提交前、提交后，共 2 个。
- 图片：暂存后、托管后、事务提交前、提交后，共 4 个。
- 备份：快照后、发布前，共 2 个。
- 恢复：解压后、校验后、保护前、保护后、新数据集就位后、旧连接关闭后、日志写入后、指针切换后、新库打开后，共 9 个。

父测试等待子进程到达指定点，只终止自己创建的子进程，然后重新打开该独立临时库。不是用返回一个错误冒充进程崩溃，也未对用户应用或真实文件做终止/权限修改。进程中断不等于电源中断；跨目录刷盘的硬件耐久性仍未证明。

另有错误返回实验模拟空间/权限等写入故障，不把这些称作真实磁盘耗尽实验。恢复错误包覆盖缺附件、损坏数据、未知格式版本、路径穿越、绝对路径与额外条目。解压也限制总大小、条目数、链接类型和重复路径；这些防护不等同于已完成全面安全审计。

## 构建、检查与数据位置

已执行通过：`npm run check`（格式、Clippy 全目标零警告）、`npm test`（含故障注入的测试构建）、`npm run build`、`npm run tauri -- build --debug --bundles app`。

`npm run tauri -- build --bundles app` 最终成功，生成 optimized release App；没有配置签名身份或公证发布。

release 初次构建出现 E0463，单包缓存重建后暴露 `mis-aligned LINKEDIT string pool`。与 [Rust 上游 #157750](https://github.com/rust-lang/rust/issues/157750) 的 Rust 1.96/macOS 27 问题一致；依据 [Cargo build-override](https://doc.rust-lang.org/cargo/reference/profiles.html#build-dependencies)，仅在项目的 release 构建期依赖设置 `debug = true`、`strip = false` 后重新构建通过，App 仍以 release 优化。没有修改全局 Rust 或降低系统安全设置。

发布版随后在只对测试进程执行 `(deny network*)` 的 macOS 沙箱中启动两次。每次验证主进程存活、无网络 socket、schema 2 和数据库完整性正常；两次使用同一数据集及代号。由测试发出 SIGTERM 结束该子进程，**不把它当作 ⌘Q 或点击窗口关闭验收**。此检查证明进程与存储可禁网启动，因 UI 工具不可用，尚不能证明整个界面正确渲染。

普通 App 不启用 fault-injection feature，故障注入只用于测试。发布界面目前只有一件内置虚构物品的保存/补录工作台；图片/备份/恢复通过实验测试执行，正式选择文件与恢复确认 UI 属于后续任务。

验证 App 的数据位置：Rust `std::env::temp_dir()/possio-verification-v1`。macOS 通常映射到当前用户临时目录；不是正式 Application Support 资产库。应用退出后临时数据通常仍在，但可被系统清理，因此禁止用于唯一真实档案。自动实验各用 tempfile 独立目录。

内部 datasets、active.json、restore-journal 与保护备份只属于验证资料；恢复不会自动清空旧数据集或误删原图。中断留下的暂存/无引用文件暂保留用于诊断，不声明已具备生产清理策略。构建产物和依赖由本地 Git exclude/子目录 ignore 排除，用户原有 .gitignore 保持原内容、未纳入提交。

证据文件：[测试输出](verification/cp0-tests.txt)、[发布构建与启动记录](verification/cp0-build-and-launch.json)。

## CP0 未完成项与后续归属

1. **原生窗口人工/自动检查待补**：computer-use 报告客户端/服务版本不匹配，要求重启 Codex 桌面客户端。当前未取得截图；不能声称关闭重开、⌘Q、深浅色观感、焦点/VoiceOver 已通过。此前浏览器原型截图失败是另一个记录，本轮未绕过其限制。
2. **HEIC 支持待补**：当前受限 image 解码器只启用 JPEG/PNG/WebP，保留清楚的拒绝提示；后续需评估原生解码并保留原图后重新验证 R03，不能默默删掉目标。
3. **完整业务与性能仍未实现**：T01–T21 未开始，44 条 Spec 不能按本轮测试整项勾选；总览、售出、维护/保障、心愿、统一最近删除、CSV、完整备份 UI 尚未交付。容量与性能预算尚未实测。
4. **正式数据协议冻结前再审阅**：CP0 使用最小 schema 和临时库，备份格式、容量和生产迁移策略需要随 T18 及完整实体复核，不应现在迁入真实资料。

结论：底层方案具备继续验证的证据；先补原生窗口检查与图片能力缺口，再决定正式业务阶段。无需重选 A/B 或重新询问已经确认的业务规则。

## 官方依据

- [Tauri 前置环境](https://v2.tauri.app/start/prerequisites/)、[Vite 集成](https://v2.tauri.app/start/frontend/vite/)、[Rust 命令调用](https://v2.tauri.app/develop/calling-rust/)、[单实例](https://v2.tauri.app/plugin/single-instance/)。
- [rusqlite Backup API](https://docs.rs/rusqlite/latest/rusqlite/backup/index.html)、[图片解码限制](https://docs.rs/image/latest/image/struct.ImageReader.html)、[ZIP 文件写入](https://docs.rs/zip/latest/zip/write/type.SimpleFileOptions.html)。

本轮工具发现未提供 Context7 resolver/query，使用官方来源核对。以上来源说明依赖能力，项目通过项均以实际实验为准。
