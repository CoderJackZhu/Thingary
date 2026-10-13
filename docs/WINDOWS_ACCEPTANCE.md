# Windows 候选版验收

本页维护 Windows 的固定验收方法与支持边界；逐次结果、截图和日志另行保存。使用者安装见[使用指南](USER_GUIDE.md#windows-install)，构建见[开发说明](DEVELOPMENT.md#windows-validation)，候选包核验与发布见[发布流程](RELEASING.md)。

## 当前范围

源码版本为 **0.0.7 候选**，目标 Windows 10 1809+／Windows 11 x64，尚无公开 Windows Release。Mac 公开版仍为 0.0.6；Windows 接入不改变 schema 40、`.thingary` 格式、整数分、未知值、稳定 ID 或业务导航。

检查结果统一维护在[开发说明](DEVELOPMENT.md#windows-validation)。源码接入与 Mac 自动检查不代表 Windows 原生运行、可见通知、人工安装与文件对话框、微软拼音、讲述人、Windows 10 或真实 x64 通过；每次按实际结果登记，不从脚本存在推定完成。

自动工程检查使用 GitHub `macos-latest`／`windows-latest`；NSIS release 构建使用 `windows-latest` x64，已安装隔离包验收使用标准托管 `windows-11-arm`，x64 程序经 Windows 模拟运行。运行器系统与模拟架构必须写入结果，不能冒充真实 x64 设备、性能测试或所有 Windows 版本的验收。[运行器官方范围](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)可能调整，每次以实际任务环境为准。

## 数据隔离与准备

1. 检查分支、完整源码 SHA、工作树与候选版本。所有数据和图片均为虚构，不使用个人档案或真实备份，**不得打开或写入 `local.thingary.main`**。
2. 在 Windows 准备 Node.js 22、Rust stable MSVC x64、C++ Build Tools／Windows SDK、WebView2 与 PowerShell 7。安装锁定依赖并准备 Cargo 缓存，许可收集必须能离线完成。
3. 使用 `npm run build:win:acceptance` 构建 `local.thingary.win.acceptance` 的 debug NSIS。其标题为“物谱 · Windows 验收”，带 fault-injection 和仅 loopback 的 CDP 9227；只用于本次虚构验收，不是普通安装包。
4. 核对 `%LOCALAPPDATA%\local.thingary.win.acceptance`、`%APPDATA%\local.thingary.win.acceptance` 均未存在。若已有结果先保全，不让脚本删除或覆盖它们；换干净用户／环境或在确认仅为本次虚构数据后另行准备。
5. 安装后核对开始菜单 `Thingary Windows Acceptance` 快捷方式、AUMID、安装目录 `许可/BUILD_INFO.json` 的身份／源码 SHA／版本／许可散列一致，才启动。正式身份 release 候选包只构建与静态核验。

## 自动工程与包核验

| 检查 | 合格条件 |
|---|---|
| 四项回归 | 两平台分别执行 `npm run build`、`test:ui`、`check`、`test`，结果与源码 SHA 对应 |
| 双向备份 | `ci.yml` 互换虚构 `.thingary`，恢复后 schema、57 张表计数与 8 个托管原图 SHA-256 全部一致；Mac→Windows 和 Windows→Mac 各自通过 |
| Windows 文件边界 | 短暂／持续占用、明确错误保全、恢复清理顺序、中文／长路径、reparse point／junction 拒绝与故障恢复回归通过 |
| 图片 | JPEG／PNG／WebP、方向、损坏与解码限界；HEIC／HEIF 明确拒绝，不静默丢图 |
| 安装包静态检查 | x64 PE、版本／身份、许可全文与散列、源码锚点、`longPathAware`、`asInvoker`、未签名，包内没有资料或测试夹具 |

在 Windows 执行：

```sh
node scripts/verify-windows-package.mjs --acceptance
pwsh -NoProfile -File scripts/windows-native-acceptance.ps1
```

脚本先安装隔离包再检查已安装窗口；生成 `.local/windows-native-acceptance/summary.json`、分项结果、日志与截图。输出目录必须全新，可用 `-ArtifactRoot` 指定新目录；可用 `-FixtureArchive` 指定另一平台生成的虚构完整备份。脚本失败时保留失败证据，不把 `status=failed` 的附件当已验包。静默流程覆盖默认安装与卸载，不能证明交互勾选框、SmartScreen 或手工原生选择器已经通过。

脚本检查保存／取消／重启、第二次启动不产生重复主实例、恢复夹具界面、实际通知排队／移除与系统历史送达、默认卸载每个数据文件散列不变及重装。恢复夹具的表计数与图片散列和 UI 可见内容分别核对；生成截图不等于人工视觉复核通过。

## 原生交互与同尺寸对照

使用安装后的隔离包，每项分别记录环境、预期、实际、证据和未验范围。

- 首次样例 → 空个人库 → 物品保存／取消 → 账户／完整盘点 → 收入／资金流动／投资核对 → 目标／报告 → 备份／恢复 → 重启核对。金额未知和日期未知保持空白，明确零保持零，图片与关系不丢失。
- 原生选择器逐项核对选图、`.thingary`、`.xlsx`、文件夹及另存为，成功、取消、中文路径与不可访问路径；打开备份目录及更新检查，含断网分支。
- 窗口首次尺寸、记忆、最大化／最小化不覆盖普通尺寸；第二次启动只有一个主实例；多屏与 100%／125%／150% 缩放分别核对。
- Ctrl+N／E／F／Shift+F／,／Shift+D／A／Z、Ctrl 点击／Shift 点击和 Escape。文本框的全选／撤销与右键剪贴板菜单有效；页面背景不出现浏览器菜单；F5、Ctrl+R／P／加减号不触发浏览器刷新、打印或缩放。
- Windows 空闲 X／Alt+F4 退出；物品编辑确认、页面拥有表单／功能设置／数据任务提示先完成或取消、保存过程中等待。已保留未知回执可以退出，重启后核对原请求，不重放输入。
- 微软拼音分别在搜索、金额相邻文字和表单名称中组合输入，检查 Enter／Escape 不误提交／误关闭；讲述人检查标题、标签、对话框、错误与焦点顺序。未经实际操作不能以按键模拟替代 IME／无障碍验收。
- 三种外观 × 浅／深，Windows 与 Mac 在相同逻辑内容尺寸 1600×1000 和 800×600 对照，另抽查 900×720；记录 DPI 和窗口实际内容区。覆盖正常、未知、空白、读取失败、保存失败；表格内部滚动、按钮焦点、字体和滚动条无截断。截图需稳定后人工检查，WebView 的 DOM 图不冒充系统桌面捕获。

## 系统通知

通知只在开始菜单快捷方式 AUMID 与已安装包身份一致时验收；未安装 `tauri dev` 不作为通过证据。

1. 用 fault-injection 验收入口将虚构提醒设为约两分钟后（自动脚本使用 20 秒缩短等待），读取真实系统计划队列，核对 Group `thingary` 与 16 字符 Scheduled.Id；退出调度进程后仍在队列。这个步骤只证明排队与保留。自动脚本继续在应用关闭后等待截止，核对相同 Group／Tag 的真实系统通知历史、内容及待发项移除；系统历史证据仍不等于肉眼确认桌面可见。
2. 退出应用，等待截止时刻，人工确认可见 Toast／通知中心内容、时间与身份。截图记录系统状态；此项独立于 `AddToSchedule` 成功。
3. 更改／删除提醒或关闭相关模块，原排队项移除，不重复；重启及重装后不留下重复通知。
4. 系统关闭通知时出现明确提示，业务开关与提醒日期仍保存；重新开启后对账。盘点提醒按新完整盘点重新计时，不完整盘点不计。
5. 日期分别用本地上午 9 点排期，抽查跨夏令时日期；系统时区更改后重新打开应用检查对账结果。过去日期不补发。

## 安装、卸载与换机

- 交互安装检查当前用户、简体中文、无需提升权限和开始菜单入口。对新下载文件检查 SmartScreen 流程；已缓存或工作流内生成的文件不能证明下载首开。
- 在缺少 WebView2 的干净环境验证安装器在线下载成功；断网时明确失败，不把已有 WebView2 的成功推定为 bootstrapper 已验。
- 默认卸载保留资料与自动备份，同身份重装后可读取。人工确认卸载器存在“删除应用数据”选项且默认不勾选；使用者若要保留记录不可勾选。删除分支仅用额外虚构副本验证，不影响当前验收证据。
- 正式资料目标为 `%LOCALAPPDATA%\local.thingary.main\`，验收仅核对对应验收身份的路径。Mac 路径保持 Application Support；Windows 主资料不进入 Roaming，不修改系统全局长路径设置。
- Mac 与 Windows 换机使用兼容版本的完整 `.thingary` 备份，分别核对记录、整数金额、未知值、关系与原图。窗口、主题、模块与通知偏好留在本机，不从备份推定迁移。

## 候选交付与公开判断

交付包含安装包、SHA-256、完整源码 SHA、对应许可及检查结果，分别列出已验、失败与未验。artifact 来自[Windows 工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)，保留 30 天、需登录；失败产物只用于排错。用户在 Windows 完成实际验收后再决定是否公开发布；脚本通过不自动创建 0.0.7 标签、Release 或替换 Mac 0.0.6 附件。
