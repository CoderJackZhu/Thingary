# 开发与测试

本文面向贡献者。使用软件请从[使用指南](USER_GUIDE.md#download)开始；行为口径见[业务规则](PRODUCT_RULES.md)，提交与文档职责见[贡献指南](../CONTRIBUTING.md)和[文档维护](MAINTAINING.md)。本页维护当前验证入口和边界，逐轮执行日志另行归档。

## 准备环境

Mac 需要 Xcode 命令行工具、Node.js 22 与 npm、Rust stable。Windows 需要 Node.js 22、Rust stable 的 MSVC 工具链与 `x86_64-pc-windows-msvc` 目标、Visual Studio Build Tools 的“使用 C++ 的桌面开发”工作负载（MSVC 编译器与 Windows SDK），以及 Microsoft Edge WebView2 Runtime。Windows 原生验收脚本另外需要 PowerShell 7（`pwsh`）。使用仓库锁文件，不随意升级依赖。

CI 在 `macos-latest` 与 `windows-latest` 运行同样的四项自动检查，Windows 使用 Git Bash 作为 npm 脚本 shell，保证通配符行为一致。macOS 构建链接原生框架，Windows 使用原生文件对话框、Rust 图片预览与 WinRT 通知；两平台共用业务与资料格式。前端构建不能代替完整应用构建或原生验收。Windows 目前是 0.0.7 候选实现，目标 Windows 10 1809+／11 x64，运行与发布边界见[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run tauri -- dev
```

开发应用标题为「物谱 · 开发预览」，身份 `local.thingary.preview`。开发、测试和验收一律使用虚构资料、临时目录或独立身份，**不得打开或写入正式资料库 `local.thingary.main`**。样例库不是自己的资料，正式安装包也不是测试环境。

## 自动检查

在仓库根目录执行适用检查：

```sh
npm run build
npm run test:ui
npm run check
npm test
```

| 命令 | 覆盖范围 |
|---|---|
| `npm run build` | Rust 核心 WASM 构建、TypeScript 类型检查与 Vite 前端构建 |
| `npm run test:ui` | 前端纯逻辑、真实组件处理器及部分渲染／布局约束；不是原生 UI 自动化 |
| `npm run check` | cargo fmt 与启用测试故障注入的 clippy |
| `npm test` | 独立计算核心及 Rust 领域、存储、迁移、回执与恢复测试；临时虚构资料 |
| `npm run check:engine-source` | 不重建，核对已提交 WASM 的源码／锁文件散列、二进制散列和接口 |
| `npm run test:engine-parity` | 同一虚构输入的原生 / WASM 结果及 ABI 所有权检查 |
| `npm run test:demo` | 独立样例导入工具 |

故障注入 feature 只用于测试，不进入普通应用。检查结果按本次实际执行登记；测试文件存在、历史通过或源码提交不代表当前工作树已通过。文案／样式核对受影响页面与断点；表单验证保存、取消、未知与失败；计算运行对应数值和调用链回归。纯文档检查链接、锚点、术语和离线交付依赖。

<a id="v124-validation"></a>

### 四项补充范围与统一验收

当前候选源码已集成账户扩充、存钱目标、加密备份和年度回顾，资料结构经 schema 40→41→42 迁移。当前候选停在待 review 阶段。先完成全部功能和必要配套，再 review 并收口修复，固定候选后才做最终统一验收；已有开发验证记录予以保留，不当作最终统一验收或界面冻结。Windows 等平台矩阵仍未完成。使用隔离身份和虚构资料，禁止读取正式资料库。

专项入口：`src-tauri/tests/account_kinds.rs` 检查双表迁移、回滚与未知结构拒绝；`savings_goals.rs` 检查保存回执、来源缺项、恢复、永久删除和备份／表格；`annual_review.rs` 检查同一读取事务、模块关闭、范围变化、旧年份超过24条、修订失效与只读。前端口径与隐私回归见 `tests/account-kinds.test.mjs`、`savings-goals*.test.mjs` 和 `annual-review*.test.mjs`。当前集成候选按本页四项命令验证；较早独立功能检查的计数不能代替集成结果。虚构浏览器覆盖三种外观明暗、窄窗、正常／未知／空白／错误和隐私复制；它们不能替代四项集成后的统一原生验证。

<a id="windows-validation"></a>

### Windows 候选实现与验证

V1–V4 的 Windows 补验源码为 `68adfe77ba6720c1ce894a0046b754257521d4ed`（0.0.7，schema 42）。Windows 11 Pro 原生 x64、150% 缩放下，全新隔离身份的构建、包核验与完整安装验收脚本通过；Rust 许可文本缺失 0。构建、1,241 项 UI、格式／Clippy 与 865 项 Rust 回归通过，4 项按规则忽略。原生补验覆盖四类账户默认值、真实 schema 40 库正常升级及旧备份恢复、目标关联账户永久清除保护、策略缺失／损坏暂停、含明文暂存的受保护 ACL、八次密钥轮换后的最近七份保留、年度来源与隐私、首次完整盘点询问卡和提示不遮挡。三风格明暗两尺寸共 12 张原生图通过；心愿和盘点提醒在应用关闭后进入系统通知历史。Mac 端虚构明文与加密备份在该安装应用恢复后，账户／盘点／目标行内容及计数一致；该 Mac 夹具没有图片，不能据此证明非空图片跨平台恢复。

OneDrive 虚构目录中的额外密文副本散列一致；Windows 生产后端实测目标文件被占用时保留旧成品、失败状态独立，释放后重试成功。原生加密恢复检查完成后取消会话，暂存已清理且原库代际不变；在该时点强退，重启清理遗留暂存且原库与策略不变。进行中的加密／解密取消、发布／替换中强退、磁盘不足、升级中强退，以及云同步、原生文件／密钥保存对话框和 OneDrive 文件恢复仍未验证。Windows→Mac 当前候选恢复、Windows 10、真正缺少 WebView2 的联网／断网机器、多屏及 100%／125% 缩放、SmartScreen、通知拒绝／系统关闭、可见 toast、其他提醒类型、完整实体键盘／讲述人／输入法和 Excel 原生导入回执矩阵也未完成。以上是指定范围的阶段结果，不代表 V1–V4 全矩阵通过、界面冻结或可发布；详细过程证据另行保存。

整合 Rust 规划核心及关于页更新入口的受测源码为 `fb94e192dd1c4e3766e59574b21c8c41d19a26ec`（0.0.7 候选）。[核心 CI](https://github.com/CoderJackZhu/Thingary/actions/runs/38597178419) 四任务与 [Windows 包及原生自动流程](https://github.com/CoderJackZhu/Thingary/actions/runs/38597178389) 两任务均成功：两平台构建、UI 各 1,145 项、格式／Clippy、Rust Mac 747 项／Windows 754 项通过，分别忽略 3／4 项测试；15 类原生／WASM 运算、5 类缺字段拒绝及产物散列校验通过。双向恢复的 schema 40、57 张表计数和 8 个原图 SHA-256 完全一致。Windows 目标离线告知包含 301 项 Rust、4 项 npm 与独立 SDK 告知，无缺失。隔离安装后的保存重启、关窗保护、通知排期／系统历史、卸载重装和物品外观矩阵通过；环境为 Windows 11 ARM64 下的 x64 模拟。

虚构浏览器已核对 Windows 下载、空列表、缺包、单源及错误提示；截图接口超时，未取得关于页本轮同尺寸图片对照。关于页真实外部链接／查询、新核心整页交互与取消，以及整合版本的通知点击和实体关窗抽查仍待真实 Windows 补验。此前实体验收与自动脚本结果分别保留，不能以旧包或 CDP 合成按键替代新版本实体证据。步骤与判定见 [Windows 清单](WINDOWS_ACCEPTANCE.md#主分支整合后的复验)。

当前 0.0.7 候选源码已接入 Windows 图片／文件选择、文件占用重试与长路径、窗口／Ctrl 交互、WinRT 定时提醒和 NSIS 打包。Windows 接入基线为 schema 40；当前候选的账户类型和存钱目标补充已升至 schema 42，备份容器格式不变，升级兼容性须按当前源码重新验证。Windows 界面与数据语义复用 Mac；当前公开 Mac 包仍为 0.0.6，尚未创建 0.0.7 标签或 Windows Release。

两平台 CI 分别执行构建、完整 UI 回归、格式／Clippy 与 Rust 回归；容量测试默认忽略，安装身份的通知集成测试由原生验收任务单独执行。每份候选包的通过状态、测试数量、运行器系统与源码 SHA 以对应工作流日志和 artifact 摘要为准；逐次证据另行保存。工作流配置、验收脚本存在或另一平台通过，不能推定该候选包已通过。

`ci.yml` 的两平台检查分别生成虚构完整备份；后续 `cross_restore` 互换备份并严格比较恢复前后的 JSON，含 schema、57 张表的计数及 8 个托管原图 SHA-256。此检查不使用正式资料，不改变备份格式；只有实际任务成功才算该次往返通过，表计数与散列也不能代替界面操作、文件对话框或用户内容逐项核对。

[Windows 候选包工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)分别构建正式身份 release 候选包与隔离 debug 验收包。release 任务使用 `windows-latest` x64，正式身份只构建和静态检查，不启动；验收任务使用标准托管 `windows-11-arm`，运行 x64 应用的系统模拟，不能据此声称真实 x64 硬件已验。运行器范围见 [GitHub 托管运行器说明](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。工作流 artifact 保留 30 天，下载需登录 GitHub，不自动发布 Release。

原生验收从已安装的 `local.thingary.win.acceptance` 开始，核对安装目录 `许可/BUILD_INFO.json`、源码 SHA、版本、许可散列与快捷方式 AUMID 后才启动。`scripts/windows-native-acceptance.ps1` 和 `scripts/windows-native-ui.mjs` 自动检查窗口、保存／取消／重启、单实例、恢复夹具、实际通知排队／移除与应用退出后的系统历史送达、默认静默卸载保留及重装，并生成结果和同尺寸截图。排队与系统历史送达检查不证明通知已在桌面可见；完整手工安装对话框、原生文件对话框、微软拼音、讲述人、其他缩放与 Windows 10 仍需分别验收；真实 x64 的已验范围见本节补验结论。完整步骤与证据要求唯一维护于[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。

### 0.0.6 发布验证

前端构建、1,085 项 UI 测试、格式／Clippy 和 596 项 Rust 测试通过，3 项既有容量测试按规则忽略。新增盘点提醒、差距提醒、目标进度与主动检查更新的回归随全套检查通过；schema 39→40 回滚、重试及备份恢复使用临时虚构资料测试。通用包正式身份、版本、双架构、严格签名、只读挂载与复制一致性通过；离线指南图片和内部链接完整。发布前隔离原生走查因 UI 工具超时未完成；发布后用户打开独立身份后补验 schema 39→40：旧 56 张表内容一致，只新增 goal_progress，空库无点，首次打开样例目标生成 1 个点。设置内检查更新真实显示 0.0.6 已是最新版本；后端真实读取两处均为 0.0.6、没有不可达来源。规划轨迹、压力／市场／矩阵／收益顺序图已补拍。系统通知送达、完整键盘／输入法、VoiceOver、Intel 和真实下载首开未验，不由自动检查推定通过。详情见[版本说明](releases/v0.0.6.md)。

### 0.0.5 发布后文档与截图收尾

0.0.5 已作为 Pre-release 公开，源码为 `v0.0.5`；工程回归与通用包静态核验见[版本说明](releases/v0.0.5.md)。发布后用同源码、全新隔离身份走查浅／深总览、账户与盘点、收支记录、财务复盘、目标、详情主按钮、试算、报告默认隐私和空库起步；确认顶层导航不带返回链接，报告保留 6 项影响提示，新增物品日期为空、补充更多收起，关闭表单没有新增记录。更新原生截图及 12 秒三帧演示，来源与实际尺寸见[截图清单](images/README.md)。

本轮只改文档与媒体，没有应用代码或格式变化；重新生成离线指南并检查图片、链接与内部跳转。新指南不替换已经发布的 DMG。完整持久化、备份恢复、键盘／输入法、VoiceOver、Intel、其他系统和下载首开的验证边界沿用原记录，不由截图走查推定通过。

### 0.0.4 发布验证

本轮构建、1,059 项 UI 测试、格式／Clippy 和 578 项 Rust 测试通过，3 项既有容量测试按原规则忽略。新增 36→37、37→38 提交前故障回滚与重试测试；总览待关注的来源完整性只检查已启用模块，回归覆盖隐藏来源及已启用来源真实失败。样例横幅说明图标的拉伸已修正并原生复验。

全新隔离身份完成 v0.0.3 原生生成虚构资料、schema35→39 直接升级、重启、旧完整备份原生恢复及恢复后重启；50 张旧事实表、236 行旧字段与 8 个原图／16 个缓存图片一致。另完成样例→空个人库→取消／保存物品→账户→完整盘点→手动备份／恢复→重启保留，未知金额和日期保持为空。发布截图为真实原生捕获，来源见[截图清单](images/README.md)。完整键盘／输入法、VoiceOver、其他系统、通知送达和下载后 Gatekeeper 首开仍未验；交付状态见[0.0.4 说明](releases/v0.0.4.md)。未启动正式身份包或访问正式库。

### 定位、导航与首次使用验证

定位、导航与首次使用调整（物品状态并入列表、规划页内三标签、起步选择、表单与术语简化）已在当前源码实施，不改变 schema、备份／Excel、模块默认值或计算口径。物品状态分段与标题回归在 `collection-navigation`；规划视图、修正聚焦与阻断在 `planning-detail-navigation`／`planning-current-report`；起步载荷、存储失败及总览视图意图消费在 `start-choice`；表单折叠与默认空日期在 `asset-editor-layout`；来源返回在 `planning-source-navigation`。每步分别运行构建、UI、格式／Clippy 与 Rust 检查；最终 UI 1,057 项通过，Rust 576 项通过、3 项容量测试按原规则忽略。

浏览器使用内存虚构资料，核对同尺寸前后、物品正常／空白／筛选无结果／读取失败、规划未设置／已设置／投入未知／读取失败／待确认回执、1280／820 明暗布局、报告限制数量、起步模块失败与两条主路径、职业确认项键盘焦点。公开媒体来源见[截图清单](images/README.md)。统计来源经全局搜索打开物品时保留真实返回；显式侧栏目标入口清除它。基线与当前均未复现旧“目标返回物品统计”的报告，原操作路径未知，不按推测改变导航。

原生使用用户确认全部为虚构资料的 `local.thingary.preview` debug 包，未打开正式库。已验证物品起步与勾选隐藏辅助模块、仅名称／日期未知保存、重启保留物品／物品视图／模块偏好、账户空页转到数据管理导入、未设置目标的独立试算、虚构目标设置保存及重启、测算详情与修正回目标、默认隐私报告、职业确认项焦点抽查。原生未验：起步复选框取消分支及账户起步卡、故障注入与全部来源修正组合、报告有影响项的数量提示、心愿转购入的本轮完整原生闭环、完整键盘／输入法和 VoiceOver。浏览器与处理器回归不替代这些未验项；旧原生记录不推定本轮全矩阵通过。

### 临时目录残留导致样例测试失败

若历史样例测试因临时同级目录残留损坏资料而报“已有数据但缺少指针”，先保留现场，再用全新临时根目录重跑；不删除不明目录，不到正式库修复测试。

```sh
thingary_test_tmp=$(mktemp -d -t thingary-tests)
env TMPDIR="$thingary_test_tmp" npm test
```

## 浏览器预览

### 关于与帮助入口验证

平台更新接入：构建、1,104 项 UI 和全量 710 项 Rust 通过，3 项既有容量测试忽略；最终下载排序与中文地址兼容补充后，格式／Clippy 和 13 项更新模块回归通过。覆盖 Mac／Windows 互不误提示、架构与版本、跨镜像通用包优先、附件缺失、异常地址、中文文件名及 Gitee 两种附件结构。虚构浏览器核对直接下载、备用来源、打开失败、查询失败、缺包及单源状态，前后同为 1440×1000，另核对 900×720 浅色。独立原生实际查询当前 Mac 可用版本 0.0.6，Gitee 成功、GitHub 未连接并披露限制；实际新版本文件下载、Windows 原生、完整键盘／输入法和 VoiceOver 未验。发布附件约定见[发布流程](RELEASING.md#平台更新与附件约定)。

当前直接展示方案：移除关于弹窗与二层按钮，版本与检查更新按钮同行，结果紧接该行显示；维护者名字打开 GitHub 主页，底部 Star 提示打开项目页，不自动点赞。关于／帮助菜单进入这一页，更新菜单定位版本行，不自动联网。构建、1,101 项 UI、格式／Clippy 及 705 项 Rust 通过，3 项既有容量测试忽略。独立虚构身份原生验证直接按钮、真实检查结果、维护者主页链接、浅深布局及逻辑 900×720 窄窗口；本次前后图实际均 2560×1400。版本不可用、忙态、新版本、失败重试及链接失败由组件回归覆盖；原生网络故障注入、完整键盘／输入法、VoiceOver 和 Intel 未验。下述弹窗记录为已替代方案，不作当前操作说明。

2026-10-14 早先的弹窗方案（已由直接展示方案替代）：应用菜单「关于物谱」／「检查更新…」和设置内关于按钮共用关于弹窗，版本、更新结果和帮助许可在原处显示，数据管理移除更新区域。构建、1,101 项 UI、格式／Clippy和705项Rust测试通过，3项既有容量测试仍忽略。独立虚构身份原生复现旧跳转，并验证设置及两种原生菜单入口、手动检查显示0.0.6已是最新、关闭保留目标／帮助页面、弹窗打开时设置快捷键不改变背景，以及数据管理没有更新区域。帮助页修复前后同一虚构资料和外观，固定独立身份的启动窗口偏好后，实际截图均2560×1400；最初不同高度的图保留，未用于同尺寸声明。打开不主动联网由组件调用回归验证；网络失败／重试和版本不可用沿组件回归，未原生注入错误。原生全键盘／输入法、VoiceOver、Intel及新版本下载／安装流程未验。

更早的入口方案（历史验证，已替代）：关于窗口、设置中的帮助汇总、帮助菜单与备份／更新定位曾接入。构建、1,088 项 UI 测试、格式／Clippy 和 597 项 Rust 测试通过，3 项既有容量测试仍忽略。内存虚构预览覆盖宽窄、浅深、空资料、版本不可用、链接打开失败、离线许可展开及备份／更新标题焦点；左下角本地状态圆点已改为整行居中并核对。独立虚构身份原生确认关于窗口名称／版本／维护者、帮助菜单进入设置、更新与备份区域定位，未触发检查更新或备份恢复。外部浏览器真实访问、VoiceOver 和完整键盘路径未在该次验收，圆点最后的样式修正只做了浏览器核对。该次源码与文档变更没有替换当时的正式安装包。

关于页 Windows 更新预览可加 `update-platform=windows`；`update=available|none|unavailable|partial|error` 覆盖可下载、空列表、缺包、单源及失败，均为虚构发布信息。关于页版本失败预览可加 `support-version=error`；外部链接在预览中始终拒绝打开，展示可复制地址，不访问真实网站。

```sh
npm run dev -- --port 1429
```

访问 <http://127.0.0.1:1429/visual-preview.html>。页面仅使用内存虚构资料，刷新重置，不包含于普通发布构建；预览保存提示不证明原生持久化或系统文件能力。

| 参数／入口 | 用途 |
|---|---|
| `?state=empty`、`?state=error`、`?state=save-error` | 空白、读取失败、保存失败 |
| `?wealth=empty|first|error` | 账户与盘点状态 |
| `?section=overview&started=first-use&state=empty` | 未开始的虚构资料与起步卡；可加 `module-write-error`／`module-read-error` 注入模块写入／读取失败，模块仅在预览内存中更新 |
| `?section=planning&plan-basic=saved|unknown|negative|blank&capabilities=real` | 已保存通用规划、投入未知／负值、基础未填；真实纯计算 |
| `?section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed` | 当前目标、大额计划、计算详情与真实报告入口 |
| `?plan=error`、`?plan-profile=empty` | 规划读取失败／没有已保存规划 |
| `?plan-core=occurred|partial|overdue` | 已发生接续、付款缺项与过期待核对 |
| `?section=planning&plan-debt=normal|unknown|empty|error|changed|zero|saved` | 已有贷款直接还款安排 |
| `?movement=populated|error` | 资金流动列表与读取失败；预览拒绝流动写入 |
| `?import-kind=incomes&import=normal|unknown|empty|error` | 收入导入展示状态 |
| `?state=components&style=bento&theme=light` | 共用表单、菜单、日期／月份控件 |
| `style=native|olive|bento`、`theme=light|dark` | 三种外观的浅／深组合 |
| `?section=overview&receipt-recovery=account`（可加 `state=unresolved` 或 `plan-wealth=off`） | 重启总览的虚构回执核对、失败保留与模块关闭恢复 |
| `?section=finance-records&income-default-error` | 收入默认值读取失败仍可填写，缴存未知不补零 |

### 规划核算与实际发生预览

当前规划共用 `PlanningSources` 和真实 `buildBasicCapabilities`。未知投入仍可反求需求，预测保持缺项；临时投入不回写其他消费者。资金起点、事件付款、盘点吸收、剩余贷款、费用包含与受限资金分别检查，不用未知零值绕过校验。

`tests/planning-core.test.mjs`、`planning-basic-ledger-integration.test.mjs`、`planning-basic-consumers-integration.test.mjs`、`planning-coverage-consumers.test.mjs` 覆盖账本与共享结果；`src-tauri/tests/plan_profile.rs` 和 `planning_basic.rs` 覆盖事务、引用、事实保全、旧回执与恢复。旧政策／职业阶段夹具应显示待重新设置，不能重新进入旧估算路径。

### 金融导入解析与报告组件

外部表格只接受 Excel `.xlsx`。`spreadsheet.rs` 将受控工作表规范化为内部 CSV 文本，继续复用纯解析器；没有外部 CSV、OCR、银行格式转换或资金流动回导。解析器契约与虚构样例见[解析器说明](../src-tauri/src/financial_import_parser/README.md)。

`src-tauri/tests/financial_import.rs`、`financial_import_parser.rs`、`spreadsheet.rs`、`finance_export.rs` 和 `tests/financial-import.test.mjs` 覆盖外部键、同日冲突、未知／零、整批回滚、旧备份迁移、回执重放、删除可用性、中文路径、Excel 行号及恶意公式／ZIP／范围拒绝。覆盖声明与历史总额参考仍仅有纯解析能力，未接入产品。

容量测试默认跳过，独立串行运行；需要测量时用 `/usr/bin/time -l` 包裹测试进程，区分预览、提交、取消和构建峰值：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features fault-injection --test financial_import maximum_ -- --ignored --nocapture --test-threads=1
```

总计 20 MiB／5 万行、5 万账户及已有 5 万账户的重复预览与取消已在 Apple M4／16 GiB、macOS 27 的 debug 测试进程通过。此测量没有既定产品耗时／内存阈值，不代表其他机型或 release 应用性能达标；分页不能缩减后端完整校验，取消不得留下写入。

独立报告预览 `/planning-report-preview.html` 仅展示固定虚构 v1 状态。真实当前报告入口另见[当前报告验证](#current-report-validation)，基准／比较与原生打印 PDF 未接入。组件契约与回归见[报告说明](../src/planning-report/README.md)和 `tests/planning-report.test.mjs`。

### 职业变化情景原型

`/career-preview.html` 使用虚构现金流比较空窗、降低投入或换工作。普通目标页的职业试算共用通用模型；关闭丢弃临时条件，不保存职业路线，不恢复政策待遇、资格或停续缴计算。

职业入口与常驻资金续航已做同源码独立身份的核心原生验证：三种问题切换、空窗收支、未知恢复投入、负净投入失败提示、月初付款与底线、关闭焦点返回、保存基础条件后重取值，以及重启保留已保存条件／清空临时输入。1440 宽与 900 宽原生窗口已抽查，无须展开外层工具区域；不将系统可见高度限制称为严格 900×720 对照。读取失败注入、完整键盘／输入法和 VoiceOver 尚未在这条路径覆盖。公积金周期缴存／提取尚未接入，原生通过不扩大该能力范围。

## 当前功能验证入口

<a id="finance-workspace-validation"></a>

### 财务工作区接入与联合验收

当前源码的财富入口为账户与盘点、收支记录和财务复盘，规划仅保留目标。`finance_sources` 在同一读取事务中返回期间事实，关闭来源不读取；收入、资金流动和目标分别门控，旧配置继承只执行一次。模块偏好规则见[架构说明](ARCHITECTURE.md#module-preferences)。

前端回归入口为 `tests/finance-*.test.mjs`；Store 回归在 `src-tauri/tests/finance_sources.rs`、`plan_income.rs`、`expenses.rs`、`investment_review.rs`、`planning_flow.rs` 与 `financial_import.rs`。核对完整盘点、收入分类、区间端点、互斥流动来源、切库、迟到响应、来源返回和未知回执；不要把独立切片测试当联合验证。

隔离原生已覆盖收入／支出／转账、账户／完整盘点、投资核对及失效重确认、系统备份保存／选择／恢复、Excel 导出／收入导入与重启。日期与年份控件、普通来源返回及保存焦点也已抽查；完整键盘、全部系统输入法和通知实际送达仍未完整覆盖。公开版本、本机安装与本轮源码验证分别记录，不能互相替代。

### 通用规划基础联合验收

五步主要条件在内存编辑（净投入可跳过），最终 setup 一次事务保存；后续分区修改只改对应条件。回归 `planning-basic-ui`、`planning-basic-service-integration`、`planning-fourq-components`、`planning-debt` 与 `planning-component-runtime`；Rust 重点为 `plan_profile.rs`、`planning_basic.rs` 和 `tests/helpers/planning_migration.rs`。旧政策输入退出，真实资产、收入、付款、附件、稳定 ID 和历史回执继续保全。

需求与预测门控独立，完整预算／零终点判据、收益上下调 200 bps、月初付款顺序、引用去重与模型标注共用现行账本。风险与来源回归见 `tests/plan-risk.test.mjs` 和 `source-provenance.test.mjs`；来源与许可另见 [SOURCE_NOTICES](../SOURCE_NOTICES.md)。

### 收入分类与投资区间接入验证

`income-classification`、`income-records`、`investment-review-host`、`planning-followup-ui` 与 Store 的 `plan_income`、`investment_review`、`planning_flow` 测试覆盖分类事实、手填／明细互斥、区间重叠、更正／删除／恢复失效及旧请求兼容。独立损益组件可运行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract
```

假设四字段、资金流动、关联来源、端点更正、失效重确认、完整备份／Excel 与重启已做隔离核心原生验证。端点更正和资金流动更正应使用不同受控原因，不改变保存前依据校验；备注更正不应撤销确认。原生故障注入与完整操作矩阵不由 Store 测试推定。

<a id="current-report-validation"></a>

### 当前规划报告预览与验证边界

2026-10-13 目标首页与当前报告可读性更新已通过构建、1,020 项 UI 测试、Rust 格式／Clippy 和 576 项 Rust 测试（3 项容量测试按原规则忽略）。虚构浏览器核对了五步设置、正常／未知／空白／假设读取失败、隐私／完整报告和 1280×720／820×720 布局。本轮未做原生保存重启、完整键盘／输入法或 VoiceOver 验收；旧原生通过记录不替代这次界面改动的验收。假设只读预览参数 `assumptions=confirmed|unconfirmed|needs_review|error` 是虚构展示，预览仍拒绝原生假设确认写入。

2026-10-13 后续复核移除页头重复报告入口，统一操作对齐与工具栏尺寸，并修正出生年月、详情返回及未来收入入口文案。追加回归覆盖详情进入／返回／卸载与零月龄／旧年龄参考／未知；1,022 项 UI 测试通过。虚构浏览器验证 1280×720 同尺寸对照、820×720 报告、侧栏切换及真实跨页来源保留。原生交互验收限制沿上述说明。

“查看当前报告”使用同一批已保存来源与领域能力，经 v1 校验生成独立只读快照。普通刷新不替换正文；切库、恢复、规划关闭或离开目标使其失效。未知投入不补零；影响计算的遗漏或未确认假设限制结论。只展示列明的账户资金、结构化条件、需求与已有确定性输出，不造逐月趋势、逐项购买结果或历史比较。

回归在 `planning-report-current-adapter.test.mjs`、`planning-current-report.test.mjs` 和 `planning-report.test.mjs`：快照脱离来源、错误和上下文失效、未知／零／负、费用遗漏、未来收入基准、稳定别名、隐私及复制失败重试。真实入口默认隐私，无打印／PDF；完整与隐私都从同一快照投影，不把隐藏金额留在 DOM／可访问文本或复制输出。

隔离原生已验证隐私／完整金额与盘点一致、隐私摘要的真实剪贴板回读、Tab 模态循环、Escape 返回、三主题明暗稳定窄窗截图及重启不保留报告。快切主题的过渡帧不作为常态表面缺陷；截图前等待主题与页面稳定。目标网格宽度修复后的 900×720 原生窗口无整页横滚，表格保留内部滚动。收入保存的禁用触发按钮回退页标题已原生复验。旧前后图 Retina 比例不同，不称严格同像素对照；浏览器 DOM 矩阵也不冒充截图验收。

### 加密备份验证（未发布源码）

当前集成源码使用 age 0.12.1、关闭默认特性，以标准 X25519 恢复密钥加密外层，内层 ZIP／SQLite 格式不变。新增依赖许可全文经既有 override 与离线告知脚本收集；材料完整不替代维护者对分发许可的判断。受限头解析、完整流认证、私有暂存权限与失败清理分别由低层测试核对，不能从浏览器画面推定通过。

Rust 入口包括 `src-tauri/tests/backup_security.rs`、`auto_backup.rs`、`backup_staging.rs`、`backup_copy_epoch.rs`、`backup_pipeline.rs` 和模块内嵌测试，覆盖策略选择与异常暂停、密钥验证／轮换、首备结果、目标目录无明文、冻结会话、代际发布及取消。`v1234_integration.rs` 用临时虚构资料核对 schema 42、新账户类型、目标关系和年度事实经标准 age 解密与恢复后的结果，以及只读恢复回执。`examples/v1234_acceptance_fixture.rs` 仅接受显式隔离根目录，拒绝非空目录重新创建，已有验收资料只读检查使用 `--inspect`。前端回归在 `tests/backup-security.test.mjs`、`finance-data-management.test.mjs` 和 `data-management.test.mjs`；运行中取消须等原 promise 清理后才解除互斥，恢复最终提交不提供取消。

已有 Apple Silicon 隔离普通构建的开发验证记录覆盖账户／目标保存、未知盘点回退、删除恢复、重启持久化、年度隐私摘要复制、恢复密钥文件保存与验证、手动／自动／额外密文、标准 age CLI 双向互通及加密恢复。原生大文件读取取消和独立小型测试卷空间不足均保留旧好成品并清理临时文件；启动清理用孤儿夹具复验，不等于所有强退时点都已实测。该 Mac 记录不覆盖 Windows；Windows 单向恢复、ACL、MSVC 链接与占用重试的后补结果见[Windows 验证](#windows-validation)。当前候选双向恢复、Windows 长路径专项，以及所有导出／恢复强退时点、真实容量上限、Intel、macOS 14、完整键盘／输入法和 VoiceOver 仍未验证，不以已实现或自动检查替代。上述记录保留为开发验证证据；最终统一验收等待本轮 review 与全部修复收口后执行。

## 样例与原生验收

`npm run demo:import` 只用于独立开发预览。`src-tauri/examples/` 的夹具有各自身份保护，调用前检查；不得把正式包或真实备份复制成夹具。代理操作不能代替真实用户的理解与完成度。

界面变更核对 1440×1000 与 900×720、三主题明暗、正常／未知／空白／错误，以及保存、取消、焦点和键盘。涉及原生文件、持久化或通知时，另用隔离身份验证相应边界。全矩阵在阶段集成或发布前集中执行，小改动按影响范围复验，未验范围明确登记。

盘点提醒（`checkin_reminder`）、目标页差距提醒和目标进度记录（`goal_progress`，schema 40）的 Mac 发布验证与后补的隔离升级结果见上方“0.0.6 发布验证”；系统通知实际送达及这些新增功能的完整原生保存／重启／备份矩阵仍未闭环。Windows 按本页独立验证边界记录，不沿用 Mac 结果；Rust 回归在 `src-tauri/tests/checkin_reminder.rs`、`goal_progress.rs`，前端在 `tests/checkin-reminder.test.mjs`、`plan-saving-hint.test.mjs`、`goal-progress*.test.mjs`。

Mac 当前只在 Apple Silicon、macOS 27 实测；Mac 正式包为 Apple Silicon 与 Intel 通用包，Intel 部分只经构建与架构检查。Windows 候选源码的自动与原生验证边界另见[Windows 验证](#windows-validation)，不沿用 Mac 的通过记录。macOS 14 最低打包目标不是兼容验收；Intel、VoiceOver、显示缩放、完整键盘、全部输入法组合与通知送达仍不能宣称完成。豆包拼音仅在支出名称验证组合、Space 提交和 Escape 顺序，不推广为所有表单通过。

### README 与使用指南截图

公开截图均使用虚构资料。来源、尺寸与复现路径只维护在[截图清单](images/README.md)，照片内容更新不能仅改名或由浏览器图替代原生能力证明。纯文档更新检查链接／锚点／图片，生成离线指南并核对内部跳转：

```sh
node scripts/offline-guide.mjs <临时输出目录>
```

<a id="planning-engine-validation"></a>

### 当前规划核心接入验收（未发布源码）

2026-10-14 当前工作树的构建、1,098 项 UI 测试、格式／Clippy 和 705 项 Rust 测试通过，3 项既有容量测试仍按原配置忽略。其中独立核心 debug／release 各 106 项通过；15 类原生／WASM 运算与 5 类必填字段缺失拒绝对照通过。源码／锁文件与产物散列、ABI 所有权、分批路径一致性及取消／迟到结果另有回归。开发启动自动生成核心；CI 在生成前检查已提交产物，防止过期 WASM 被构建覆盖后误判通过。

本次用独立身份、全新目录与虚构资料，在真实 macOS WKWebView 验证同步 WASM、异步原生命令、81 路径按 40／40／1 分批汇总、必填字段拒绝、明确零和迟到取消。实际产品页验证投入修改取消、未知保存及预测阻断、已知投入保存与重启、1,000 条市场路径完成、2 万条运行时切回概览、压力参数与收益顺序说明。默认隐私报告保留当前公开核心版本标识，金额继续隐藏；任意自由文本版本仍脱敏。Escape 关闭只读报告后返回触发入口。隐私报告版本修复前后使用同一虚构计划、外观和原生窗口，截图实际均为 3200×1866；此对照只验证本次修复，不代表规划 UI 已完成独立设计。

重建范围只覆盖 Rust 计算核心，TypeScript 仍承担资料编译、产品门控与展示。历史目标进度未记录核心版本，不能保证跨版本数值可直接比较。历史来源、旧版本及整个产品的 AGPL 记录保留，详见[来源告知](../SOURCE_NOTICES.md)。本轮没有验收系统通知、原生 PDF、完整键盘／输入法、VoiceOver、Intel、最低系统兼容、签名公证或真实下载首开；源码验收不代表正式包已发布或安装。

## Rust 规划核心

修改计算库后运行 `npm run build:engine`；首次需要 `rustup target add wasm32-unknown-unknown`。`npm run build` 与 `npm run dev` 都会先构建 WASM；`tauri dev` 的前置开发命令同样触发此构建。生成的 `src/planning-engine-wasm.ts` 随源码保存，不手工编辑；原生应用通过 path dependency 编译同一库。

```sh
npm run test:engine
npm run test:engine-parity
npm run check:engine-source
npm run check:engine
```

`test:engine-parity` 使用虚构数据比较原生 dispatch 与真实 WASM 输出，并验证内存所有权与拒绝路径；它不等同于 macOS WebView／IPC 的完整交互验收。CI 在重建前执行 `check:engine-source`，核对已提交产物的源码与二进制散列；此检查不调用 Cargo、不覆盖产物，不要求 Rust 编译器版本相同。`check:engine` 则需要与生成产物一致的 Rust 工具链。模块设计及来源边界见[核心说明](../crates/planning-engine/README.md)。

## 构建应用

```sh
npm run tauri -- build --bundles app
```

上述 `--bundles app` 用于 Mac，默认产物 `src-tauri/target/release/bundle/macos/Thingary Preview.app` 使用开发预览身份。Windows 默认开发运行可使用上方 `npm run tauri -- dev`；安装验收包在 Windows 上运行以下命令：

```sh
npm run build:win:acceptance
node scripts/verify-windows-package.mjs --acceptance
pwsh -NoProfile -File scripts/windows-native-acceptance.ps1
```

构建前需先 `npm ci` 和 `cargo fetch --locked --manifest-path src-tauri/Cargo.toml`，供离线许可收集。验收脚本要求验收身份的 Local／Roaming 目录不存在，输出也必须是新目录；不自动清除已有资料。重跑使用新的验收身份及输出目录，保全原有虚构证据与资料。验收配置使用 debug／fault-injection，只在 loopback 开启 CDP 9227，供脚本读取安装后的 WebView；这不是正式包，不可用于个人资料或作为公开安装包。Windows 系统通知须使用安装后匹配 AUMID 的包，不能用 `tauri dev` 证明有效。

若默认身份已有资料，三步使用同一个新身份（后缀 1–32 位小写字母、数字或连字符，首位须为字母或数字）：

```sh
npm run build:win:acceptance -- --identity local.thingary.win.acceptance.run-20261016a
node scripts/verify-windows-package.mjs --acceptance --identity local.thingary.win.acceptance.run-20261016a
pwsh -NoProfile -File scripts/windows-native-acceptance.ps1 -Identity local.thingary.win.acceptance.run-20261016a -ArtifactRoot .local/windows-native-acceptance-run-20261016a
```

后缀同步区分安装名称、开始菜单快捷方式、通知 AUMID、Local／Roaming 与静态核验目录；脚本仍拒绝已有资料及输出。CDP 端口保持 9227，同一时间只运行一个验收实例。原生窗口助手临时采用目标窗口的 DPI 上下文并恢复调用线程状态，避免 125%／150% 下重复缩放；矩阵仍须同时核对物理客户区和 WebView 的实际 CSS 尺寸，不用截图缩放代替。通知诊断只接受这一隔离命名空间，仅 fault-injection 构建提供，不触及其他身份的通知。

正式候选包由维护者在 Mac 运行 `npm run release`、Windows 运行 `npm run release:win`；版本、签名、公证、支持平台和公开附件按[发布流程](RELEASING.md)核验，不由源码检查推定。

源码与现行文档只在本仓库维护。修改行为同步 PRODUCT_RULES，修改操作同步 USER_GUIDE，修改实现取舍同步 ARCHITECTURE；设计状态由 INDEX 导向唯一规格。外部贡献者无需访问私有过程记录即可构建、测试或理解约束。
