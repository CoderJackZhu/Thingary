# T22 自用正式版结果（已 review，含 §7 更正）

日期：2026-09-27。执行契约：[T22 交接](../handoffs/T22_SELF_USE_RELEASE_GPT.md)。本报告只记录 T22 已完成的本地工作；未合并 main、未配置远程或推送，也未实施签名、公证或 P1。

## 1. 起点、执行者与改动

- 工作目录 `/Users/jackzhu/Code/Own/Possio`；从最新本地 `main` 的完整 SHA `126b3c397e9274e5f8e262a47da0564cf987f373` 创建 `codex/t22-self-use-release`。起点 `git status` 仅 `?? .gitignore`，其 SHA256 为 `b93631bb68425b2904975118807e90b07d9647b7734cfb2c1842ff09253f21b9`；未修改、暂存或提交。最终完整 SHA 以交回消息中的 `git rev-parse HEAD` 为准（提交文件不能包含其自身的 SHA）。
- 实际执行者：本会话 Codex，系统仅标识 GPT-6 系列；没有可核实的 Sol/Astra 子型号或推理档位，不冒称已完成 Astra 独立审查。单执行者串行，无子代理、后台循环或全局配置更改。数据身份与发布配置留给 Claude review。
- 改动：`src-tauri/tauri.release.conf.json`、`package.json`、`index.html`、`src/DataManagement.tsx` 及对应已有测试、`docs/USER_GUIDE.md`、本报告及 `t22/` 的读回脚本和两张截图、README、实施计划。未修改默认 `src-tauri/tauri.conf.json`、业务规则、schema 或恢复协议。

## 2. 身份隔离与正式包

| 项 | 结果 |
|---|---|
| 默认配置 | `Possio Preview` / `local.possio.preview` / `0.0.1` /「物志 · 开发预览」保持原样；`git diff -- src-tauri/tauri.conf.json` 为空。 |
| T22 正式覆盖 | `物志` / `local.possio.app` / `1.0.0` /「物志」；`npm run release` 无 `--debug` 或 feature。 |
| 正式产物 | `src-tauri/target/release/bundle/macos/物志.app`；安装到 `/Applications/物志.app`。提交后最终构建再次安装并确认两个主程序 SHA256 相同；最后一次构建的哈希以交回消息为准。 |
| macOS 元数据及关于窗口 | 安装包 Info.plist：`CFBundleIdentifier=local.possio.app`、`CFBundleShortVersionString=1.0.0`、`CFBundleDisplayName=物志`；原生「关于物志」显示 `Version 1.0.0 (1.0.0)`，见[截图](t22/official-about.png)。 |
| 隔离 debug 验证 | `npm run tauri -- build --debug --config .local/t06b.conf.json --bundles app` 通过；该隔离包仍是 `local.possio.t06b.preview`，未指向正式库。普通 dev/debug 默认配置仍为预览身份。 |

Tauri CLI 对用户指定的 `local.possio.app` 输出“以 `.app` 结尾不推荐，因为与 macOS 包扩展名冲突”的警告；构建、安装、启动、单实例和重开均未见异常，按交接保留该 identifier。安装时只替换同名的本轮初次构建包；没有触碰其他 App 或资料库。

纯净性检查：`dist` 只有 `index.html`、一个 CSS、一个 JS；没有 `visual-preview`、`t06-preview` 页面或脚本。`rg` 扫描 `dist` 和安装包资源、`strings` 扫描主程序，均未发现 `fault-injection`、`possio.qa.`、`import_demo`、两种预览页名。生产前端移除了唯一的 `possio.qa.` 专用分支。Demo 导入位于 Cargo example，正式 App 包只有主程序与图标，没有 example 可执行文件。`fault-injection` 仅在测试命令中显式启用，`npm run release` 未启用；默认配置中的 CSP 保持不变。

## 3. 正式身份无资料检查

启动前 `~/Library/Application Support/local.possio.app/` 不存在。安装后原生窗口 1080×760 显示「0 件物品」和「从第一件物品开始」，见[空库截图](t22/official-empty.png)。只读 SQL 检查资产、心愿、维护、保障、附件及业务审计/请求表均为 0，`PRAGMA integrity_check=ok`；默认分类 6、渠道 7 是应用初始资料。没有在正式身份写入虚构资产。

按 ⌘Q 后首个 PID `51776` 消失。用 `sandbox-exec` 禁止 IP 入站和出站启动安装包，第二个 PID `52847` 的窗口仍显示 0 件；`lsof -nP -a -p 52847 -i` 无 IP socket（退出码 1 表示无匹配），按 ⌘Q 后 PID 消失。再正常打开同一安装包，仍是 0 件欢迎页，退出后无 T22 正式进程。最后复核 `local.possio.app` 的 `assets` 总数和未删除数均为 0。

原生操作使用 T21 已验证的 AX 辅助工具；用户确认前台可切换后才启动。每次键盘注入前工具均要求目标 App 在前台且 AX 窗口存在，否则停止。禁网测试针对 App 进程的 IP 流量，不代表整机断网。

## 4. 临时身份功能复测

在 `.local/` 中保留两份**不入库**的覆盖文件；均先合并正式配置再覆盖临时 identifier：`local.possio.t22.check` 和 `local.possio.t22.restore`。两个身份启动前目录均不存在。它们的 App 与资料都没有复制或迁移到正式身份。

`check` 原生流程：空库 → 新增仅有名称的 `T22 虚构相机` → 详情 → 同 ID 更正为 `T22 虚构相机（更正）` → 移入最近删除 → 从最近删除确认恢复 → 详情显示原状态「使用中」。同一资产 ID 为 `e364ae64-d916-4662-a62a-3f55e69e67f3`，最终 revision 4、未删除、未知金额保持 `NULL`。金额字段的 AX 标签匹配不明确，未将该输入尝试计为金额更正；T22 要求的同记录更正由名称和 revision 证实。

在 `check` 的「设置 › 资料管理」保存 `/tmp/possio-t22/物志备份-20260927-0010.possio`，原生提示“已保存并校验”；随后导出 `/tmp/possio-t22/物志资产表-20260927.csv`，原生提示 1 件。在新的 `restore` 空库（先以只读 SQL 确认资产 0）选择同一备份，检查摘要为 1 件、格式版本 12、图片 0，确认替换后 UI 出现同一更正资产。

独立[读回脚本](t22/verify_readback.py)验证备份清单唯一 SQLite 的大小与 SHA256、完整性和外键；按 13 列 CSV 契约将每行与备份只读 SQL 对照，1 行相同；恢复库与备份 **25 张表全部行一致**，外键异常 0。执行方式：`python3 docs/verification/t22/verify_readback.py --backup /tmp/possio-t22/物志备份-20260927-0010.possio --csv /tmp/possio-t22/物志资产表-20260927.csv --restored-library "$HOME/Library/Application Support/local.possio.t22.restore/library"`，退出码 0。两个临时 App 均已按 ⌘Q 退出；两个临时库各保留一件虚构资产，供复核，不入库。

## 5. 文档与检查

[使用说明](../USER_GUIDE.md)面向非技术用户：安装与未认证开发者提示、正式资料位置、真实资料首次录入后**立即完整备份并异地保存**、备份恢复、CSV 与最近删除的区别、未签名公证/无自动备份/兼容与辅助功能限制。README 已登记入口；实施计划标记 T22「待 Claude review」。

| 检查 | 本轮预检查结果 |
|---|---|
| `npm run test:ui` | 退出 0，83/83 通过。 |
| `npm test` | 退出 0，Rust 103/103 通过（23 组）；ImageIO 的 HEIC 测试需在受限文件沙箱外运行。 |
| `npm run test:demo` | 退出 0，2/2 通过。 |
| `npm run check` | 退出 0，fmt + Clippy。 |
| `npm run build` | 退出 0，49 modules；正式入口三文件。 |
| 隔离 debug App 构建 | 退出 0，`Possio T06b Preview.app`。 |
| `npm run release` | 退出 0，`物志.app`。 |
| `git diff --check` | 退出 0；提交后按交接 §5 再跑完整顺序。 |

初次在受限文件沙箱内执行 `npm test`，HEIC ImageIO 用例报 `IMAGE_CORRUPT`；同一用例在系统允许的执行环境中单独重跑通过，随后完整 Rust 103 项通过。此失败未改动 fixture 或生产解码代码，不能当成正式包图片失败。交回前最终提交之后再按交接 §5 顺序运行完整检查，最终 SHA 与结果在交回消息中列明。

## 6. 剩余边界

- T21 已接受的 AC40 未实测项仍未改变：VoiceOver、运行中系统外观切换、显示缩放、Dock 固定后重启；macOS 14、Intel 未实测。未签名公证、无自动备份和远程更新。
- T22 未在正式身份执行任何有资料写入的功能流程；完整备份/空库恢复/CSV 由两份临时身份验证。正式库目前是空库，开始录入真实资料后应立即完整备份并异地保存。
- 原生金额更正不在本轮已确认的复测证据中；未对金额逻辑、schema 或恢复协议做猜测性修改。

## 7. Claude review 与更正（2026-09-27）

复核属实：默认配置未改、正式配置独立；`dist` 与主程序无测试入口；正式库原为空库；临时身份的[读回脚本](t22/verify_readback.py)复跑 exit 0（25 张表一致）。移除 `possio.qa.*` 排除只影响测试构建的恢复提示计数，正式版不产生该类键，接受。

**更正 1：identifier。** 交接指定的 `local.possio.app` 以 `.app` 结尾（Tauri 已告警）。复核发现 macOS 把资料文件夹 `~/Library/Application Support/local.possio.app` 识别为应用程序包（`mdls kMDItemKind = 应用程序`，`com.apple.application-bundle`），用户在访达里会看到一个“App”而不是资料文件夹。趁正式库仍为空，改为 **`local.possio.main`**：`npm run release` 无告警，Info.plist `CFBundleIdentifier=local.possio.main`，重新 `ditto` 安装到 `/Applications/物志.app`（review 更正提交 `3d97f3b` 的最终 release 构建已重新安装，构建与安装主程序 SHA256 前缀均为 `e0cd88db8e6fa490`）；首次启动显示「0 件物品／从第一件物品开始」后 ⌘Q 退出、无残留进程；新资料文件夹 `kMDItemKind = 文件夹`，`integrity_check=ok`、资产 0。旧的空 `local.possio.app` 文件夹（0 件资产）已移到废纸篓。前文 §2–3 中的 `local.possio.app` 为更正前记录。

**更正 2：使用说明措辞。** 「新增物品」改为界面实际的「全部资产 › 新增资产（或 ⌘N）」；「从完整备份恢复」改为界面实际的「从备份恢复 › 选择备份…」；资料路径改为 `local.possio.main`。

review 更正提交后的完整检查见交回消息；结论：**T22 达到出口**，正式版可以开始录入真实资料（先读使用说明，录入后立即完整备份并异地保存）。
