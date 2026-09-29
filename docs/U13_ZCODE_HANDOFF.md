# U13 · zcode 默认自动备份交接

更新：2026-09-29。本文件只维护接手基线、代码入口、风险与启动 Prompt；业务规则以[产品设计 D20](PRODUCT_DESIGN.md#d20--默认自动备份2026-09-29-用户确认u13)为准，技术接线以 [ADR-001 第 24 节](decisions/001-local-desktop.md#24-u13--默认自动备份技术契约2026-09-29)为准，**历史交接文件**：zcode 已完成 U13a/b，Claude 完成原生验收与复核并随 1.14.0 发布，结果见 [U13 记录](verification/U13_AUTO_BACKUP_RESULT.md)。阶段状态只在[实施计划 U13](IMPLEMENTATION_PLAN.md#u13--默认自动备份2026-09-29zcode-实现claude-复核随-1140-发布)更新。

## 1. 基线与授权

- 工作目录：`/Users/jackzhu/Code/Own/Possio`，分支 `main`。交接文档随提交进入 main；开工先记录实际 HEAD。
- 已存在未跟踪 `.claude/`：不修改、不清理、不提交；根 `.gitignore` 由用户维护，不改。不 reset/clean，不覆盖他人差异。
- 用户已确认方案并指定交给 zcode：按 U13a→U13b→U13c 顺序实现、测试、写文档和隔离原生验收，每步达到出口即继续，不需要逐步请示。影响业务语义的新取舍（D20 没写到的）停下来报告。
- **不提交、不合并、不推送、不升版、不安装/发布、不改全局配置，不委派其他 agent。** 停在审阅交付，由 Claude 复核（U13d）。
- **不打开正式 `/Applications/物志.app`，不读写 `~/Library/Application Support/local.possio.main/`。** 原生验收用独立 identifier `local.possio.u13.acceptance` 与虚构资料，先确认构建配置、运行身份和资料路径再操作。

开工执行：`pwd`、`git branch --show-current`、`git rev-parse HEAD`、`git status --short`。

## 2. 阅读顺序

1. [README](../README.md)、[AGENTS](../AGENTS.md)：约束与命令。
2. [产品设计 D20](PRODUCT_DESIGN.md#d20--默认自动备份2026-09-29-用户确认u13)：8 条规则与验收 ①–⑪。另读 12.2、D14（样例不参与备份）。
3. [ADR-001 第 24 节](decisions/001-local-desktop.md#24-u13--默认自动备份技术契约2026-09-29)：路径、改动检测、tick 顺序、函数、命令、界面、测试清单。**照此实现，不另起设计。**
4. [T18 备份恢复记录](verification/T18_BACKUP_RESTORE_RESULT.md)：现有备份/恢复协议与原生验收方法（只参考方法）。
5. [原生验收方法](verification/U12_TOPBAR_SEARCH_RESULT.md) 中隔离身份的构建与驱动方式。

## 3. 已核对的代码入口

| 位置 | 现状 | 本次要做 |
|---|---|---|
| `src-tauri/src/backup.rs` `Store::backup(Some(&dest))` | 快照→逐文件校验→打包→复验→`persist_noclobber(dest)`；目标已存在报 `EXISTS` | **不改它**。自动备份先写 `.partial` 目标，成功后 `fs::rename` 覆盖当天文件 |
| `src-tauri/src/worker.rs` | 单线程串行 worker；`Libraries { real, demo, demo_mode, .. }`；`with_state` 在回复后调用 `sync_reminders()`（用 `generation + total_changes` 判断有无写入，可照抄思路） | 加 `track_backup_changes()` 与 `auto_backup_tick(policy)`；只看 `real` |
| `src-tauri/src/worker.rs` `has_personal_records` | 判断我的资料有无记录（含最近删除） | 空库判断直接复用 |
| `src-tauri/src/storage.rs` | `atomic_write`、`sync_dir`、`Store.root`（= `app_data_dir/library`）、`generation()` | 设置文件用 `atomic_write` |
| `src-tauri/src/lib.rs` | `setup` 中 `app.manage(worker::Worker::start(app_data_dir/library))`；`generate_handler!` 注册命令；⌘W 只隐藏窗口，App 仍运行 | 在 manage 之后启动 `possio-auto-backup` 线程；注册新命令；**不在退出事件里等待备份** |
| `src-tauri/src/commands.rs` `create_backup` / `inspect_backup` / `restore_backup` | `on_main` 调原生面板，`spawn_blocking` + `w.call_personal(..)` | 新命令照同样写法；恢复复用 `restore_backup` |
| `src-tauri/native/images.m` `possio_pick_backup_open` 与 `native_images.rs` `pick_backup_open` | NSOpenPanel 选文件 | 仿写 `possio_pick_folder` 选文件夹 |
| `src/DataManagement.tsx` | 资料管理卡片：备份、恢复（candidate 确认块 + `restore()`）、CSV、最近删除 | 新增“自动备份”分区，恢复复用 candidate 与 `restore()` |
| `src/ModuleSettings.tsx` | 已有开关样式 | 开关复用它的样式类 |
| `src/visual-preview.ts`（约 283 行起按 `command` 分支模拟） | 浏览器预览的命令模拟 | 加新命令模拟与 `?autobackup=never|ok|error|extra-error` |

## 4. 必须处理的风险

- **退出不能变慢**：不在退出或 `ExitRequested` 中触发或等待备份。强退后只能留下 `.` 开头的临时文件，下次 `run` 开始时清掉。
- **样例隔离**：改动检测和备份只针对 `real`；样例模式下定时照常备份我的资料（有标记时），但不能因样例写入产生标记。
- **不误删用户文件**：清理只删匹配 `^物志自动备份-\d{4}-\d{2}-\d{2}\.possio$` 的文件；额外位置同样。`inspect_auto_backup` 必须拒绝任何含 `/`、`..` 或不匹配的名称。
- **失败不破坏旧份**：`.partial` 失败即删，当天已有的正式文件不动；标记保留以便重试；按退避时间重试，不要每 30 秒重复失败。
- **额外复制不阻塞界面**：`copy_extra` 在定时线程执行，不放进 worker；外接盘未连接只记错误。
- **测试不 sleep**：空闲阈值、退避、日期都通过 `policy` 参数注入。
- 故障注入 feature 只用于测试；普通构建不带。

## 5. 验证与交付

每步先跑定向测试，U13c 最后全量一次：

```sh
npm run build
npm run test:ui
npm run check
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --lib --tests -- --test-threads=1
git diff --check
```

原生验收（U13c）用 `local.possio.u13.acceptance`，D20 ①–⑪ 每项写操作步骤、实际结果、截图或文件列表。其中需要实测：改动后约 2 分钟出现文件（`ls -l` 取时间）；备份进行中 ⌘Q 后无 `.possio` 损坏、重启约 30 秒后补做；手工放入 9 份旧日期文件与一个无关文件验证只留 7 份且无关文件在；删除 .app 后重装仍能在设置看到并恢复；额外位置选一个临时文件夹、再把它改名模拟不可用。验证 ②时可临时用测试 policy 或如实等待，不得改正式阈值后忘记还原。

新建 `docs/verification/U13_AUTO_BACKUP_RESULT.md`，截图放 `docs/ui/auto-backup/`（1280×820 与 800×600 浅深色，改前/改后同尺寸）。更新实施计划 U13 表状态、README 当前状态、USER_GUIDE 备份章节、CHANGELOG（“未发布”条目）。工具阻塞时完成其余部分并准确标“未验证”。交付时给出分支、HEAD、变更清单、检查结果与剩余风险，停下等待复核。

## 6. 可直接复制的启动 Prompt

```text
请在 /Users/jackzhu/Code/Own/Possio 接手 U13「默认自动备份」。先完整阅读 docs/U13_ZCODE_HANDOFF.md，再按其第 2 节顺序读取 README、AGENTS、PRODUCT_DESIGN 的 D20、ADR-001 第 24 节。

用户已确认方案，授权你按 U13a（后端）→ U13b（设置界面）→ U13c（隔离原生验收与文档）顺序完成，每步达到实施计划 U13 表中的出口后继续，不需要逐步等待批准。业务规则以 PRODUCT_DESIGN D20 为准，技术接线严格按 ADR-001 第 24 节（文件路径、改动检测放在 worker 的 with_state 之后且只看 real、tick 判断顺序、auto_backup.rs 的 run/prune/list/copy_extra、六个命令、文件夹面板、界面分区、测试清单）；与实际代码不符时按实际代码修正 ADR 并说明，不要另起设计，D20 没写到的业务取舍停下来报告。

重点：退出不能等待备份；样例写入不能触发备份；清理只删匹配“物志自动备份-YYYY-MM-DD.possio”的文件；失败不破坏旧备份并按退避重试；额外位置复制不在 worker 线程；测试通过注入 policy 而不是 sleep。复用现有 Store::backup、restore_backup、DataManagement 的恢复确认块和 ModuleSettings 开关样式，不新增依赖或视觉体系。

开工先记录 pwd、分支、HEAD、git status；保留现有改动，不 reset/clean，不修改 .gitignore 和 .claude/。只用临时虚构数据和隔离身份 local.possio.u13.acceptance，不打开正式 /Applications/物志.app，不访问 local.possio.main。不要委派、不改全局配置。

完成后写 docs/verification/U13_AUTO_BACKUP_RESULT.md（D20 验收 ①–⑪ 逐项证据与未验项）、docs/ui/auto-backup/ 同尺寸浅深色截图，更新实施计划 U13、README、USER_GUIDE、CHANGELOG（未发布）。最后停在审阅：不提交、合并、推送、升版、安装或发布。
```
