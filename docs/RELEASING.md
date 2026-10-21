# 发布流程

维护者入口。用户安装与操作只看 [使用说明](USER_GUIDE.md)；文档职责见[文档维护](MAINTAINING.md)。详细执行记录在维护者的私有笔记中引用公开提交号，不作为构建输入。

<a id="release-lifecycle"></a>

## 版本迭代与放行

每版维护一份放行单，串联范围、候选基线、验证、包和发布决定；单项功能完成、合并、自动检查通过、原生验收通过、包核验通过和公开发布分别登记。放行单可保存在维护者档案，只引用证据，不复制本页规则；没有私有模板的贡献者也可按以下关卡和必填字段执行。本文不改变当前[功能范围](../CONTRIBUTING.md#功能范围与收敛原则)，流程准备不构成新增功能、安装、推送或发布授权。

### 顺序与完成条件

- [ ] **1. 确认范围**：写清本版问题、包含／不包含的内容、逐项验收条件及目标平台；标出计算、资料结构、备份、依赖和原生能力风险。未决项在开发前明确处理方式，避免边验收边决定业务口径。
- [ ] **2. 开发与专项验证**：实现、审查、适用自动检查与现行文档同步推进；保存、计算和恢复覆盖相应失败／未知路径。系统文件面板、通知、安装等高风险能力尽早做隔离原生验证，不等整版完成才发现平台限制。
- [ ] **3. 集成与功能冻结**：把本版内容集成到同一候选基线，记录完整源码 SHA、版本、schema／备份格式和平台范围；代码变更完成开发说明中的四项检查，并核对对应的两平台 CI、核心产物一致性与双向恢复结果。冻结后只修缺陷，新需求进入下一版；确需扩大范围时重新确认并再次冻结。
- [ ] **4. 正式整体验收**：在冻结基线上走通启动、读取、保存、取消、退出／重启与备份恢复；对受影响页面覆盖正常、未知、空白、读取失败和保存失败，并验证上一公开版本虚构资料的升级与旧备份恢复。各平台分别记录环境、结果和未验项，功能分支或旧候选的通过不能直接替代集成验收。
- [ ] **5. 文档与截图定稿**：主要缺陷修复后，对照实际行为完成指南、已知限制、CHANGELOG 和 Release 正文；重拍受影响且会误导使用者的截图，保留同尺寸对照和来源。生成并检查离线指南后才能制包；未变化的图片可保留原来源，不要求每版全部重拍。
- [ ] **6. 构建与候选包冻结**：从最终提交构建，工作树不得混入未提交的构建输入；按下文核验版本、身份、架构、签名状态、许可、源码来源与包散列。登记原生验收包与正式包的源码、构建模式、feature、身份及安装资源差异，完成受影响验证；只做静态核验的项目如实标注，不推定正式包已运行通过。最终包冻结后任何重建都作为新候选，重新核验交付物。
- [ ] **7. 发布决定与公开**：维护者逐平台判断放行，准备最终源码标签、Release 草稿、附件与说明；取得本次发布授权后公开并同步已放行平台的镜像。候选交付不等于公开发布，某平台暂缓不由另一平台通过代替。
- [ ] **8. 发布后回查与观察**：从公开入口回读各平台附件的大小与散列，以未登录方式核对下载和说明，并检查应用内更新的平台匹配及镜像。记录实际结果、反馈处理人和观察截止时间；建议至少覆盖发布当日与次日。遗留项进入后续计划，发现资料安全或关键主线问题时执行下文故障处置。

开发和专项验证可以交错；正式整体验收须在功能冻结后完成，截图与随包文档须在最终制包前完成，包核验与发布决定须在公开前完成。观察窗口由维护者安排，不默认开启后台监控或收集用户资料。

### 每版放行单的必填字段

记录版本／发布类型、本版范围与排除项、验收负责人、功能冻结 SHA、最终构建 SHA、上一公开版本、schema／备份兼容性、隔离身份，以及每个平台的系统／架构／构建模式、包名／SHA-256、检查结果和证据。最后列出阻断项、已接受限制、裁剪理由、维护者决定／授权、公开地址和发布后回查结果。

结果使用「通过／失败／未验证／不适用」；未验证不得勾成通过，不适用须写明依据。放行单初始为待决定，公开、镜像和回查在实际完成后分别登记。源码和包变化时保留旧结果，另记新候选及证据继承依据；不修改旧失败记录来表示新候选通过。

### 不可省略的底线与裁剪

资料丢失、错误覆盖、重复提交、静默错误计算、敏感信息暴露、无法安全升级／恢复，以及本版关键主线失败或存在关键未知，均阻断相关平台发布。Pre-release 标签和限制说明不能代替修复或验证。非关键限制须写明影响、替代路径、公开告知位置与维护者接受决定；不在支持范围内的环境明确披露，不能冒充已验。

| 版本类型 | 验证重点与可裁剪范围 |
|---|---|
| 仅在线文档修订 | 检查链接、锚点、图片、术语和状态；不需要重新执行应用测试。涉及随包内容时重新生成并核验新包，已发布附件保持不变 |
| 小型界面／文案补丁 | 适用自动检查、受影响原生页面、关键主线和相关截图；未影响的数据专项可引用同一应用代码的已有证据并说明差异 |
| 普通功能版本 | 完整执行八步，按风险追加专项；至少验证上一公开版升级、旧备份恢复及关键原生主线 |
| 计算、迁移、备份或加密变更 | 在开发中优先验证数值／旧资料、失败保护、回执、恢复与跨平台兼容，不能等截图或发布准备后才开始 |
| 新平台、依赖、构建、签名或安装方式变更 | 增加受影响环境的安装、启动、运行和包验证；构建成功不等于兼容性或安全提示流程通过 |
| 紧急修复 | 缩小范围并加快审查，保留针对性回归、关键主线、资料安全与最终包核验；逐项登记裁剪依据 |

<a id="freeze-changes"></a>

### 冻结后的修改与补验

每次修改登记「改动、影响、失效证据、补验结果」。功能冻结限制范围，候选包冻结固定交付文件；修复不要求机械重做全部验收，但必须完成受影响检查和关键主线。

| 修改内容 | 至少重新完成 |
|---|---|
| 文档、链接、截图 | 文档与引用检查；随包内容变化时重新生成离线指南、制包和核验 |
| 文案、布局、交互 | 受影响页面回归、原生抽查、关键主线及相关截图 |
| 保存、计算、模块门控、隐私 | 对应自动回归、受影响原生场景及关键主线 |
| schema、迁移、备份、恢复 | 升级／恢复专项、失败保护及涉及平台的资料往返 |
| 依赖、构建、签名、安装资源 | 重新制包、包核验及受影响的安装／启动／运行验证 |
| 新功能或明显扩大范围 | 重新确认范围、集成并再次功能冻结，再执行相应验收 |

若最终提交比受测提交只多文档／媒体，核对差异后可引用原应用验证，补做文档、离线内容与包检查；不得把引用写成重新执行。影响不明时先扩大验证，不能按改动行数判断风险。

### 多平台放行

每个平台分别列出目标支持范围、实际系统／硬件／架构、自动检查、原生主线、安装／升级、包核验、限制与发布决定。模拟运行、构建架构和最低系统配置各自记录；Mac 通过不代表 Windows 通过，Apple Silicon 通过不代表 Intel 通过。

允许平台错峰发布，但应核对另一平台当前可下载版本的备份兼容性，避免承诺尚不能完成的换机。GitHub 与 Gitee 使用同一份已放行文件并分别回读散列；检查更新须匹配实际平台附件。版本或资料格式变化后重新判断双向恢复范围，不能沿用另一版本的兼容结论。

## 1. 确认版本和范围

每次公开发布前由维护者确认版本、支持平台、签名及公证范围；公开状态以对应 GitHub Release 与附件为准，不由本机安装推定。Mac 路线为 Apple Silicon 与 Intel 通用安装包、本地临时签名、未公证，测试版本标记为 Pre-release。Windows 路线为未签名 NSIS，目标 Windows 10 1809+／11 x64；每版是否公开及已验范围见对应[版本说明](INDEX.md#当前阶段)与 Release。制作 DMG 本身不要求注册 Apple Developer。最低系统配置为 macOS 14，但目前只在 macOS 27 实测，不承诺其他系统或 Intel 可用（Intel 部分只经构建与架构检查）。

版本号保持一致：`package.json`、`package-lock.json`（开头两处）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。发布配置不重复版本号，身份必须是 `local.thingary.main`，预览和验收身份不得作为正式安装包。

代码变更后运行 `npm run build`、`npm run test:ui`、`npm run check`、`npm test`。只改交付材料时执行相应脚本、文档和包检查，引用同一应用代码提交已经完成的工程回归，不把它冒充新的测试结果。更新 CHANGELOG 和对应 Release 正文；依赖变更时重新生成许可证清单并核对全文覆盖。

发布前按[截图维护清单](images/README.md)刷新主图与功能操作图，核对 README、指南和活跃设计中的发布状态；先生成并检查离线指南再制包。发版后的在线文档修订不改变已经发布的 DMG，新增说明随下一版打包。

发版核对[第三方告知](../SOURCE_NOTICES.md)、依赖许可、对应源码与最终包的一致性。

### 升级兼容性

每次发布检查资料身份、数据库 schema／迁移、备份格式、已有素材 ID 与设置键。用前一版在隔离身份下生成虚构资料，再以同身份新包打开并重启，比对物品、心愿、账户、金额、未知值、关联、图片和已有保障；验证旧版完整备份恢复。不得在正式资料库做验收。涉及迁移时增加对应旧 schema 夹具及恢复测试，说明可逆性和降级边界。仅替换应用包应保留资料目录；较低的应用版本编号不代表数据格式降级。

schema 34/35 的金融历史导入升级检查还须覆盖：

- schema 33 → 34 后旧 ID、整数金额、未知与有效期保持；`migration.before_commit` 失败后仍为 33，两张新表均不存在，重新升级可成功。
- 旧 schema 33 完整备份及升级前恢复日志能够严格检查、恢复并升级；恢复日志兼容仅在 `recover_root` 放宽旧版本，不能放宽通用 schema／内容验证。
- 新备份往返保留外部键稳定映射／墓碑、回执请求指纹与对象修订、余额及账户 ID；新账户后盘点失败整批无写入／无回执，原请求可重试；提交失联后重启查回执无重复。
- 原账户／盘点命令的 generation、UUID、指纹、回执和故障点回归通过。不得用旧应用直接打开 schema 34 库，降级使用与旧版兼容的升级前备份。

schema 35 起新版完整备份不能被旧版应用打开，不能靠降低应用版本号回退数据格式；降级须使用升级前且与旧版兼容的备份。`x11.sql` 在事务内重建可空缴存和收入外部键 CHECK，保留既有 0、ID、修订、时间及删除状态；须验证 34→35、33→35、旧 34 回执与完整备份恢复，以及替表中途故障后旧表／全部数据完好且版本仍为 34。提交前必须执行 `PRAGMA foreign_key_check`。

schema35→40 的历史迁移回归还须覆盖：35→36 退出政策输入但保留客观事实及旧回执；36→37 新收入分类保持未分类／空引用，投资核对表为空；37→38 不自动确认假设；38→39 不自动生成资金流动或复盘来源；39→40 只新建空的目标进度表，不为旧盘点编造历史，失败提交前回滚并可重试。逐段提交前故障须回滚旧版本、DDL 与事实，随后重试成功。旧 schema35 完整备份可严格检查、恢复并升级，源备份不改写；旧规划月份与未来收入需要重新确认。降级仍须恢复与旧包兼容的升级前备份，不能直接打开 schema39 库。

## 2. 构建与制作安装包

### Mac 通用 DMG

```sh
npm ci
npm run release
sh scripts/make-dmg.sh
```

`npm run release` 以 `universal-apple-darwin` 目标构建，需先 `rustup target add x86_64-apple-darwin`。产物位于 `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`：

- `Thingary-<版本>-universal.dmg`（0.0.4 及更早为 `arm64.dmg`）
- `SHA256SUMS.txt`，仅记录 DMG 的 SHA-256，不是来源认证签名

DMG 内含「物谱.app」、Applications 快捷方式、`开始使用.html`、使用说明图片和 `许可/`（AGPL 全文、第三方声明与全文、来源和散列清单、直接内置内容告知、名称图标使用边界、对应源码入口）。离线 HTML 由唯一权威 `docs/USER_GUIDE.md` 生成，不另行维护手抄说明；图片全部为虚构演示。

`make-dmg.sh` 检查身份、x86_64 与 arm64 双架构、版本和严格签名；`distribution-notices.mjs` 从锁定依赖和 `license-overrides/manifest.json` 收集全文，缺失或散列错误即失败。后者离线运行，不在打包时下载许可证。先安装锁定 npm 依赖并准备 Cargo 缓存；补充文本来源与升级办法见 [说明](../scripts/license-overrides/README.md)。Rust 清单保守包含构建依赖，不能把清单数量当成二进制中实际链接数量。

本地临时签名能检验包的完整性，**不等于 Developer ID，也不保证 Gatekeeper 放行**。安装步骤采用 [Apple 官方的单应用允许打开方法](https://support.apple.com/zh-cn/102445)，无需全局关闭安全保护或让普通用户运行终端命令。若以后采用 Developer ID 与公证，单独依据 [Tauri 官方说明](https://v2.tauri.app/distribute/sign/macos/) 配置证书与凭据、重建包并重新验收；不沿用本路线的未公证声明。凭据不入库。

### Windows x64 NSIS 候选包

只在 Windows MSVC 环境构建，不从 Mac 交叉打包：

```sh
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run release:win
node scripts/verify-windows-package.mjs
```

`release:win` 叠加正式身份配置与 Windows release 配置，明确 `--target x86_64-pc-windows-msvc --bundles nsis --ci`。产物为 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` 下的 `.exe` 与 `SHA256SUMS.txt`。只构建／静态检查正式身份包，不启动它；原生测试另用 `npm run build:win:acceptance` 生成的 debug 隔离包。故障注入、CDP 与验收身份不得进入普通 release 构建。

NSIS 使用 `currentUser`、简体中文，不配置 Authenticode 签名。缺少 WebView2 时下载 bootstrapper，首次安装可能需要联网；未签名包可能触发 SmartScreen 或设备策略限制，静默安装不能证明真实下载后的交互首开已经通过。默认卸载保留资料，Tauri 卸载器仍提供用户主动勾选的“删除应用数据”；用户指南必须说明若保留记录不要勾选。

`prepare-windows.mjs` 使用锁定依赖的缓存离线收集许可全文，随安装放入 `许可/`，包括 AGPL、直接内置内容告知、Windows 依赖与单独的 Windows SDK BSD-3-Clause 文本。`BUILD_INFO.json` 记录版本、资料身份、完整源码 SHA、对应源码 URL 与告知散列；候选包以此提交作为来源锚点，不能引用尚未创建的版本标签。`verify-windows-package.mjs` 解开 NSIS 检查 x64 PE、身份／版本、许可资源与散列，生成 `.local/windows-package/<类型>/package-verification.json` 和安装包校验值。工作流还提取 PE 内嵌清单核对 `longPathAware=true`、`asInvoker`、版本和未签名状态。

[Windows 候选包工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)保存候选包和验收材料，artifact 保留 30 天、下载需登录 GitHub，不创建标签或 Release。release 构建在 `windows-latest` x64；隔离安装验收在 `windows-11-arm` 跑 x64 模拟，原生运行器与手工未验项详见[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。失败任务保存的 artifact 仅供诊断，不得作为已通过候选包交付。

## 3. 核验交付物

### Mac

1. 挂载 DMG 为只读，核对内容、Applications 指向、版本、身份、架构和 `codesign --verify --strict --deep`；比对挂载包与原始构建包的全部文件及符号链接。
2. 把挂载包复制到临时目录，再比对签名和文件，证明拖拽复制不会破坏应用。**不启动正式身份包，不碰真实库**。
3. 检查 HTML 图片与内部锚点；离线阅读安装、建档、盘点和备份说明。DMG 中不能出现数据库、备份、测试资料或凭据。
4. 用同代码、全新隔离身份和虚构资料走查：首次样例 → 自己的资料 → 物品 → 账户 → 完整盘点 → 备份／恢复 → 重启保留。
5. 明确记录未做的步骤。浏览器截图不能代替原生验收；本地挂载与隔离启动不能证明真实下载后的 Gatekeeper 首开、其他 Mac 或其他系统版本兼容。
6. 在最终提交上复查 CI、README、版本与 Release 正文；核对 DMG 文件大小与 SHA-256。附件从 GitHub 回读后应与本地散列一致。

### Windows

1. 在最终源码提交重新构建，检查版本、正式身份、x64 架构、未签名状态、long-path 清单、WebView2 模式、当前用户安装与随包完整许可；不启动正式身份包。
2. 从安装器解开的 payload 回读 `许可/BUILD_INFO.json`，完整源码 SHA 应等于构建输入；许可散列、NSIS 和 `SHA256SUMS.txt` 相符，包内无用户资料、夹具、备份或凭据。
3. 用同源码的已安装隔离验收包执行[固定清单](WINDOWS_ACCEPTANCE.md)，分别记录自动检查、系统排队、可见通知、人工文件／安装对话框、键盘／IME／讲述人及平台范围；未验项明确写入候选交付说明。
4. 核对 Mac 四项回归与两平台 CI、跨平台备份恢复，原生截图按相同内容尺寸对照；ARM 上的 x64 模拟不等于真实 x64 性能或兼容性。
5. 下载工作流 artifact，回读安装包文件大小与 SHA-256。候选包交付给用户验收后再决定公开发布；未经发布授权不创建标签或公开 Release，不覆盖已发布附件。

## 4. Release 草稿与公开

**国内镜像**：GitHub 在国内常常打不开，每个公开版本同步发布到 [Gitee 仓库](https://gitee.com/CoderJackZhu/thingary)：把本次授权的源码提交与版本标签推到 `gitee` 远程，在 Gitee「发行版」用同一标签创建发行版，正文用同一份 `docs/releases/v<版本>.md`，上传同一份已授权平台的安装包与 `SHA256SUMS.txt`，并核对 Gitee 上的文件散列与 GitHub 一致。仅候选交付的平台不自动执行此镜像或公开步骤。应用内检查更新会读取两处，所以 Gitee 发行版的标签必须是 `v<版本>`、不要勾选草稿。

仓库的 `Gitee mirror` 工作流在 GitHub Release 公开后自动执行上述镜像，也可手动指定已发布标签补同步；普通代码推送不会触发镜像。需配置具有 projects 权限的 `GITEE_TOKEN`，缺少时只警告并跳过，不能据工作流绿色判断附件齐全。工作流从发布标签取得源码，从工作流自身提交取得同步脚本；只推送该标签及其可达源码提交，不移动 Gitee 的 main，旧版本补同步不依赖 main 的当前位置，分支同步单独处理；附件使用 curl／HTTP 1.1 上传，单次最多等待 90 分钟，最多尝试两次，跳过已有同名附件，最后下载回读并比较 GitHub 与校验清单的散列。成功以日志 `Gitee verified` 及全部预期附件为准；延长超时不代表网络提速。镜像失败时修复后补同步同一版本，不重新构建或覆盖已发布附件。

每次发布在 `docs/releases/v<版本>.md` 维护正文，现有示例为[0.0.2 发布说明](releases/v0.0.2.md)。先推送最终源代码提交，在该提交创建 `v<版本>` 标签和 **draft Release**，上传该次已授权的 Mac DMG／Windows NSIS 安装包与各自 SHA256SUMS；公开测试版设置 Pre-release（即使版本号不带 beta 后缀），README 直接链接对应版本，不能依赖只返回正式版的 latest 入口。不要移动已经发布的标签或覆盖现有附件。自动生成的 Source code 归档应对应这个标签，保留锁文件、构建脚本、文档和依赖源码获取入口。

草稿不等于已公开。发布前核对源代码、完整许可材料和支持边界，确保 [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) 可用。取得本次发布授权后发布草稿，以未登录方式检查说明、附件和下载入口；不要把仅本机安装或只有源码附件写成“普通用户可下载”。把最终源码 SHA、标签、附件散列和验证边界登记到私有笔记。

公开仓库保留历史，移出 main 的文件仍可从历史查看。发布从公开源码标签构建，不从私有笔记仓库打包；编号重排也必须以同版本源码重新构建，不能只改附件名；版本变化不重置资料身份、schema 或备份格式。已撤下的包、元数据和对应源码私有保全，不宣称能收回他人已下载的副本。

若发现包错误，先隐藏或撤下有问题的发布，保留本地错误包和核验记录；修复后发布新补丁版本，不静默替换同版本附件。不要要求用户直接降级打开已经迁移的资料；说明恢复与旧版本兼容的升级前备份。

放行前登记故障处理负责人、触发条件、暂停分发与告知入口、受影响版本及资料保护／恢复步骤。发现资料安全或关键主线问题时优先暂停问题包分发，保全证据，判断用户影响并提供安全处理说明；不能以撤包推定已收回下载副本。修复后重新走适用关卡，以新补丁版本交付，并将漏检原因转为回归或清单检查项。

<a id="ios"></a>

## iOS（App Store）

只做上架准备，不提交审核、不发布。标识、名称、价格、账号类型、出口合规申报方式、是否保留 iPad 都由维护者决定；凡标「需维护者确认」的内容，不能由本文推定。文案草稿见 [App Store 上架文案](releases/app-store-listing.md)，隐私页在官网 `/privacy/`。Linux 容器无法编译 `src-tauri`，下列构建与签名步骤只能在维护者的 Mac 完成。

### 当前工程状态

- 工程在 `src-tauri/gen/apple/`，由 XcodeGen 的 `project.yml` 描述；当前身份是预览身份 `local.thingary.preview`、产品名 `Thingary Preview`（来自 `tauri.conf.json`，开发用）。上架用的应用标识与名称**需维护者确认**，不得沿用预览身份；`local.thingary.main` 是桌面正式资料身份，iOS 是否复用同名需维护者决定。
- 隐私清单 `thingary_iOS/PrivacyInfo.xcprivacy` 已加入，并在 `project.pbxproj` 登记为资源；`project.yml` 的 `thingary_iOS` 目录源会在 `xcodegen generate` 时自动把它作为资源。首次在 Mac 打开工程时确认 Build Phases › Copy Bundle Resources 里有它。
- iPhone 只支持竖屏（`project.yml`、`Info.plist`、`Info.ios.plist` 三处一致）。设备族 `TARGETED_DEVICE_FAMILY = "1,2"`（含 iPad）和 iPad 方向未改，见下文建议。
- 不提交个人开发团队、发行证书或描述文件。`ExportOptions.plist` 的 method 仍是 `debugging`，导出 App Store 包时用 Xcode Organizer 或另写不含团队号的本地副本。

### 1. 版本号

- `CFBundleShortVersionString` 是用户看到的版本，`CFBundleVersion` 是构建号；两者目前在 `project.yml` 与 `thingary_iOS/Info.plist` 写死为 0.0.8，与 §1 的版本清单不是同一批文件，发版时需同步。
- App Store Connect 要求同一版本下每次上传的构建号不同且递增（见 [构建版本字符串](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)）。是否沿用 `0.0.8` 形式、重新上传时如何递增，**需维护者确认**。

### 2. 构建

在 Mac 上，先 `npm ci`，再按[开发与测试](DEVELOPMENT.md#ios-开发)的 iOS 小节装好 Rust 目标和 XcodeGen：

```sh
npm run ios:check                       # 真机与模拟器目标的 cargo check
npm run ios:tauri -- ios build          # 以官方 CLI 2.12.3 生成 Release 静态库与归档，需已配置签名
```

也可在 `src-tauri/gen/apple/thingary.xcodeproj` 中选择 Any iOS Device (arm64) 后 Product › Archive。上架身份的 Tauri 配置（identifier、productName）尚未建立，建立前不要用预览身份归档。Release 构建不得带 `fault-injection` feature。

### 3. 签名

维护者在 Xcode 的 Signing & Capabilities 中选择自己的开发者团队、勾选自动签名，或手动指定发行证书与描述文件。不要把团队号、证书、描述文件或 App Store Connect API 密钥提交到仓库。账号类型（个人／组织）决定 App Store 上的卖家名称和中国大陆合规项，**需维护者确认**。注册与计划见 [Apple Developer Program](https://developer.apple.com/programs/)。

### 4. TestFlight 内测

Archive 后在 Organizer 选 Distribute App › App Store Connect › Upload。处理完成后，在 App Store Connect 的 TestFlight 中先加内部测试员；每个新构建的首次提交会要求回答出口合规问题（见下）。外部测试需要 Beta App Review。官方说明：[TestFlight 概览](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)（本文未逐页核对其细节）。TestFlight 验收按本文 §3 的 Mac 清单思路，用虚构资料走完：样例、记录、盘点、规划、备份分享与恢复、相机、相册、面容 ID、通知、断网使用。不使用真实资料。

### 5. App Store Connect 填写

| 项目 | 内容 |
|---|---|
| 应用信息 | 名称、副标题、类别、价格、可售地区：草稿见[上架文案](releases/app-store-listing.md)，均需维护者确认 |
| 隐私政策网址 | `https://thingary.jackzhu.top/privacy/`，须在提交前已部署可访问 |
| App 隐私标签 | 建议选「不收集数据」，依据见下文隐私清单核对；官方说明 [App 隐私详情](https://developer.apple.com/app-store/app-privacy-details/)（未逐页核对） |
| 年龄分级 | 建议答案见上架文案，问卷定义见 [年龄分级值与定义](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) |
| 截图 | 规格见 [截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)：该页写明 6.1 寸一组（1179×2556 或 1206×2622）至少一张为必填，6.9／6.7 寸一组缺失时由其他尺寸缩放；清单见上架文案 |
| 出口合规 | 见下文，需维护者确认 |
| 中国大陆 | 见下文，需维护者确认 |

#### 隐私清单核对（PrivacyInfo.xcprivacy）

依据：[描述 required reason API 的使用](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)——使用了需说明理由的 API，必须在隐私清单中声明被认可的理由，且 App 自身和每个动态库／SDK 各自声明。物谱的 Rust 代码与依赖被静态链接进主可执行文件，所以统一声明在 App 的清单里。理由代码的具体措辞出自我对 Apple 文档的记忆，该页在本次检查中未能取回（需 JavaScript 或子页打不开），**请在 Mac 上对照 [NSPrivacyAccessedAPITypes](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes) 原文复核**。

| 类别 | 是否使用 | 理由代码 | 代码出处 |
|---|---|---|---|
| 文件时间戳 `NSPrivacyAccessedAPICategoryFileTimestamp` | 是 | `C617.1`（读取 App 容器内文件的时间戳／大小等元数据）；`3B52.1`（读取用户通过文件选择器授予访问的文件） | `src-tauri/src/auto_backup.rs`（备份文件 mtime 与复制后还原 mtime）、`purge.rs`（清理暂存区时只保留 24 小时内的暂存选择）、`photos.rs` 与 `storage.rs`（图片校验缓存的文件戳）、`financial_import.rs`（偏好文件指纹）；`native/ios.m` 对用户所选备份／图片的 `copyItemAtURL` 与 `NSURLIsRegularFileKey`（用户经系统选择器授予的文件，随后复制到应用临时目录）。Rust 标准库的 `std::fs::metadata` 与 SQLite 的 `stat` 同样会被扫描到。 |
| 系统启动时间 `NSPrivacyAccessedAPICategorySystemBootTime` | 是 | `35F9.1`（测量 App 内事件之间经过的时间） | `std::time::Instant`：`backup_security.rs`（会话空闲超时）、`worker.rs`（变更与失败间隔）、`backup_jobs.rs`。Rust 在 Apple 平台的 `Instant` 基于单调时钟，Apple 把 `mach_absolute_time` 等归入此类；具体符号是否出现在最终二进制，是我的推断，需 Mac 上确认 |
| 磁盘空间 `NSPrivacyAccessedAPICategoryDiskSpace` | 未发现调用 | 不声明 | 代码没有调用 `statvfs`／`NSURLVolumeAvailableCapacity` 等；`native/ios.m` 中「请检查可用空间」只是失败提示文字。`fs2` 只用于文件锁（`storage.rs`），其磁盘空间函数未被调用，链接时应被剔除 |
| 用户默认设置 `NSPrivacyAccessedAPICategoryUserDefaults` | 未发现调用 | 不声明 | `native/*.m`、`gen/apple/Sources` 无 `NSUserDefaults`；偏好保存在应用资料目录的文件里。WebKit 与 UIKit 是系统框架，由系统处理 |
| 活动键盘 `NSPrivacyAccessedAPICategoryActiveKeyboards` | 未发现调用 | 不声明 | 无 `activeInputModes` |

静态扫描不等于二进制扫描：第三方 crate（`wry`、`tao`、`tauri`、`rusqlite`/SQLite、`image`、`zip`、`age`）的代码在源码层没有被逐行审读。Archive 后请用 Xcode 的 Product › Archive › Distribute 或 Organizer 的「Generate Privacy Report」，再对最终二进制 `nm`/`strings` 核对 `stat`、`fstat`、`mach_absolute_time`、`statvfs`、`NSUserDefaults`，上传后留意 App Store Connect 的 ITMS-91053 邮件，按其列出的类别补充声明。依赖自带隐私清单的 SDK 不重复声明；目前没有以 xcframework／动态库形式嵌入的第三方 SDK。

数据收集：`NSPrivacyTracking=false`，`NSPrivacyTrackingDomains` 与 `NSPrivacyCollectedDataTypes` 为空。依据（iOS 构建）：

- `src-tauri/src/update_check.rs`：`supported()` 在 iOS 返回 false，`check()` 在发请求前返回「iOS 更新由 App Store 管理」；网络请求只通过系统 `curl` 子进程（`fetch`），iOS 无此二进制，且更新模块被禁用。
- `src-tauri/src/support.rs`：只有固定链接，`open` 在 iOS 经 `UIApplication openURL` 交给系统浏览器，且拒绝 `update`；应用自身不发请求。心愿的「相关链接」是 `WishDetail.tsx` 中用户自己填写的 `<a target="_blank">`，点击后的行为（WKWebView 是否转交 Safari）**未在设备上验证**。
- `src-tauri/Cargo.toml` 无 `reqwest`／`hyper`／`ureq` 等 HTTP 客户端；`src/` 前端无 `fetch`／`XMLHttpRequest`／`WebSocket`（`src/` 中仅有 `invoke` 到本机 IPC）；`tauri.conf.json` 的 CSP 为 `default-src 'self'; … connect-src ipc: http://ipc.localhost`，WebView 不能连外网。
- PDF 导出的 WKWebView 为无脚本、无网络、非持久（`native/ios_pdf.m`，CSP `default-src 'none'`）。
- 开发时的 `devUrl` 与 `--host` 仅用于 `ios dev`，Release 归档不使用。

此外，`UIFileSharingEnabled` 与 `LSSupportsOpeningDocumentsInPlace` 为 true，使用户能在「文件」App 中看到 Documents（备份在此）；这是有意的，但会让 App 容器的 Documents 对用户可见，审核备注里说明。

#### Info.plist 与设备族建议

- 权限说明文字齐全且为中文：`NSCameraUsageDescription`（拍摄物品照片）、`NSPhotoLibraryUsageDescription`（选择物品照片）、`NSFaceIDUsageDescription`（验证机主身份解锁，生物识别信息不进入物谱）。通知没有对应的 Info.plist 键，由系统授权弹窗处理，用途说明在应用内（`src/notification-permission.ts`）。`<input capture>` 只拍照片，不涉及麦克风；未使用定位、通讯录、蓝牙，故不需其他说明键。
- 方向：iPhone 已改为只竖屏。iPad 的 `UISupportedInterfaceOrientations~ipad` 保持四方向不变——据我的记忆，iPad 支持多任务时需要四个方向，限制方向需同时设置 `UIRequiresFullScreen`（推断，未逐页核对 Apple 文档），**需维护者决定**。
- 是否保留 iPad（`TARGETED_DEVICE_FAMILY = "1,2"`）：手机界面按 390 pt 宽设计，目前没有 iPad 版式验证，也没有 iPad 截图。建议先只上 iPhone（设为 `1`），验证通过后再扩展，理由是 iPad 上架要求 iPad 截图与多任务适配，增加审核面。这是我的建议，不是 Apple 的规定。`UIRequiredDeviceCapabilities` 目前为 `arm64`、`metal`；`metal` 来自 Tauri 模板，物谱不直接使用，可由维护者决定是否保留，保留不影响现有 iPhone。

#### 出口合规（需维护者确认）

事实：iOS 版**不联网**，不使用 HTTPS，但"备份加密"是 App 自己实现的加密：`src-tauri/src/backup_crypto.rs` 使用 Rust 的 `age` 库（age-encryption.org 规范：X25519 密钥协商、ChaCha20-Poly1305 分块认证加密）对备份文件加密。它不是 iOS 系统内置的加密。

Apple 的相关说明（已核对原文）：

- [Complying with Encryption Export Regulations](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)：`ITSAppUsesNonExemptEncryption` 设为 `NO` 的条件是「不使用加密，或只使用豁免于出口合规文档要求的加密形式」，否则为 `YES`；并说明使用系统内置加密（如 URLSession 的 HTTPS）通常豁免，而专有加密不豁免。
- [Overview of export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)：「需要出口合规判定的 App 示例」包括使用标准加密算法、使用 Apple 系统内的加密功能、使用专有或非标准算法的 App；并写明「你有责任查阅 EAR 判定是否需要 BIS 的 CCATS，错误解读或错误声明豁免的责任由你承担」。法国对「安全存储」类 App 另有管制，银行与医疗类豁免，详见 ANSSI。
- [Determine and upload app encryption documentation](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)：App Store Connect 用一组问题判断是否需要文档；批准后得到密钥值写入 `ITSEncryptionExportComplianceCode`。

我的推断（非官方结论，也不是法律意见）：age 使用公开标准算法，且加密只用于用户自己的备份文件，不用于通信，因此很可能属于「使用标准加密算法」而非「专有算法」。是否因此满足 EAR 对 Category 5 Part 2 的某项豁免、是否仍要上传文档或年度自我分类报告，我无法从上述页面确定。三个可选方式：

| 选项 | 做法 | 风险与适用 |
|---|---|---|
| A 保守申报 | `ITSAppUsesNonExemptEncryption = YES`，按 App Store Connect 问卷如实回答，必要时上传加密文档取得 `ITSEncryptionExportComplianceCode` | 流程更长，但不涉及"错误声明豁免"。适合没有法务意见时。有可能需要向 BIS 提交年度自我分类报告（见上述 Apple 说明里的 [BIS 年度自我分类](https://www.bis.doc.gov/index.php/policy-guidance/encryption/4-reports-and-reviews/a-annual-self-classification)） |
| B 声明豁免 | `ITSAppUsesNonExemptEncryption = NO` | 仅当维护者确信备份加密属于豁免（例如依据 EAR 的豁免条款，需自行核对 BIS 原文）时使用；Apple 明确责任在开发者 |
| C 不写键、逐次回答 | 不在 Info.plist 写键，每个构建上传后在 App Store Connect 回答问卷 | 最稳妥的起步：不预设结论，答案留在 App Store Connect 记录；每次构建都要再答 |

建议：首个 TestFlight 构建采用 C，按问卷实际分支结果再决定是否固化为 A 或 B。本仓库**不写入** `ITSAppUsesNonExemptEncryption`。若选择「不提供加密备份」可免去此项判断，但会删减已有功能，不建议。

#### 中国大陆（需维护者确认）

- 工信部《关于开展移动互联网应用程序备案工作的通知》（工信部信管〔2023〕105号，2023-07-21）规定：未备案的 APP 不得从事互联网信息服务；应用分发平台不得为未备案 APP 提供分发服务，并须展示备案号。原文见 [gov.cn](https://www.gov.cn/zhengce/zhengceku/202308/content_6897341.htm)。
- Apple 有对应的 App Store Connect 页面 [查看中国大陆合规信息](https://developer.apple.com/cn/help/app-store-connect/manage-compliance-information/view-china-mainland-compliance-information)（说明为「常驻中国大陆的组织需要提供哪些合规信息」），本次检查无法读取其正文。具体是否要求 ICP／APP 备案号、对个人开发者与非大陆主体是否适用，**我无法从官方来源确认**（论坛中只有开发者个人说法，不作依据）。
- 选项：①不在中国大陆地区上架（取消勾选可售地区，最省事，但中文用户主要在大陆）；②按平台要求办理 APP 备案后填写备案号上架；③先只做 TestFlight。备案需要大陆主体、域名、服务器等材料，个人主体的可行性请向所在省通信管理局或阿里云／腾讯云等备案服务确认。建议维护者先读 Apple 上述页面与自己 App Store Connect 里的实际字段再定。
- 另需确认：应用若涉及金融类展示（类别选「财务」），是否有额外的金融类资质要求；物谱仅为本地记录与估算工具，不提供投资、借贷或支付服务，这是产品事实，但合规判断需维护者确认。

### 6. 提交审核前检查清单

- [ ] 维护者已确定：应用标识、名称、价格、可售地区、账号类型、iPad 取舍、出口合规方式、大陆备案策略
- [ ] 版本号与构建号已同步（`project.yml`、`Info.plist`、`Info.ios.plist` 与 §1 的版本文件），构建号递增
- [ ] `npm run build`、`npm run test:ui`、`npm run check`、`npm test` 通过；`npm run ios:check` 通过
- [ ] Release 构建不含 `fault-injection`、验收身份或开发 `devUrl`
- [ ] Archive 包含 `PrivacyInfo.xcprivacy`，隐私报告与二进制符号核对完毕，无 ITMS-91053 邮件遗漏项
- [ ] 虚构资料走完 TestFlight 验收；真机拍照、面容 ID、通知实际送达、备份分享与恢复、断网使用各有记录；未验项如实登记
- [ ] 隐私政策页已部署并可未登录访问，内容与应用实际一致；官网首页页脚有入口
- [ ] App 隐私标签、年龄分级、出口合规问卷、截图（各尺寸）、描述、关键词、支持网址已填并复核；文案没有同步、联网行情、AI 等未实现功能
- [ ] 审核备注说明：无需登录、样例入口、相机／面容 ID／通知用途、`UIFileSharingEnabled` 的原因
- [ ] 使用指南已有「iPhone 版」说明（已改为 TestFlight 阶段表述）；上架后把使用指南、官网首页与 README 里的「即将推出／TestFlight 测试中」改为 App Store 链接，`docs/INDEX.md` 与 README 状态一致
- [ ] 未经维护者授权不点「提交以供审核」；提交与发布均由维护者执行

## 平台更新与附件约定

应用按实际发布附件匹配可用更新，不以最高版本标签代替兼容性。当前 Mac 文件名使用 `Thingary-<版本>-universal.dmg`；分包可用 `arm64`／`aarch64` 或 `x86_64`／`x64` 后缀。Windows NSIS 使用 `物谱_<版本>_x64-setup.exe`（也接受 Thingary 前缀），ARM64 命名使用 `arm64`；其他约定见 `src-tauri/src/update_check.rs` 的 installer。命名约定本身不证明对应平台／架构已发布或验收。调整命名必须同步匹配规则及测试，不靠模糊扩展名猜平台。

版本说明和附件必须位于同一严格 `vX.Y.Z` 发布中，附件名称版本一致、已上传完成且非空；每个镜像单独核对兼容包、固定仓库下载地址及文件散列。仅同步说明的镜像不会成为下载来源。列表按每源最近 30 条检查；不同平台长期错开发布时应保证其最新安装包仍在此范围内。保留已发布版本与附件，不把 CI artifact、源码归档或其他架构包作为安装推荐。
