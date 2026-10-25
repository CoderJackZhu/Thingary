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

每次公开发布前由维护者确认版本、支持平台、签名及公证范围；公开状态以对应 GitHub Release 与附件为准，不由本机安装推定。Mac 路线为 Apple Silicon 与 Intel 通用安装包、本地临时签名、未公证，测试版本标记为 Pre-release。Windows 路线为未签名 NSIS，目标 Windows 10 1809+／11 x64；对外只宣称 **Windows 11 x64 已实测**，Windows 10 尚未实机验证；当前仅提供 x64 安装包，ARM64 走系统模拟。每版是否公开及已验范围见对应[版本说明](INDEX.md#当前阶段)与 Release。制作 DMG 本身不要求注册 Apple Developer。最低系统配置为 macOS 14，但目前只在 macOS 27 实测，不承诺其他系统或 Intel 可用（Intel 部分只经构建与架构检查）。

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

`release:win` 叠加正式身份配置与 Windows release 配置，明确 `--target x86_64-pc-windows-msvc --bundles nsis --ci`。产物为 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` 下的 `.exe` 与 `SHA256SUMS.txt`。构建后用 `scripts/normalize-windows-installer.mjs` 把 Tauri 按产品名生成的 `物谱_<版本>_x64-setup.exe` 统一改名为公开使用的 `Thingary_<版本>_x64-setup.exe`，并重写校验值；README、下载页、winget 和应用内更新都依赖这个固定 ASCII 名称。只构建／静态检查正式身份包，不启动它；原生测试另用 `npm run build:win:acceptance` 生成的 debug 隔离包。故障注入、CDP 与验收身份不得进入普通 release 构建。

NSIS 使用 `currentUser`、简体中文，当前不配置 Authenticode 签名。缺少 WebView2 时下载 bootstrapper，首次安装可能需要联网；未签名包可能触发 SmartScreen 或设备策略限制，静默安装不能证明真实下载后的交互首开已经通过。默认卸载保留资料，Tauri 卸载器仍提供用户主动勾选的“删除应用数据”；用户指南必须说明若保留记录不要勾选。

`prepare-windows.mjs` 使用锁定依赖的缓存离线收集许可全文，随安装放入 `许可/`，包括 AGPL、直接内置内容告知、Windows 依赖与单独的 Windows SDK BSD-3-Clause 文本。`BUILD_INFO.json` 记录版本、资料身份、完整源码 SHA、对应源码 URL、告知散列与 `signing_status`（默认 `unsigned`；签名路线传 `--signing-status signed`）；候选包以此提交作为来源锚点，不能引用尚未创建的版本标签。`verify-windows-package.mjs` 解开 NSIS 检查 x64 PE、身份／版本、许可资源与散列，生成 `.local/windows-package/<类型>/package-verification.json` 和安装包校验值。工作流还提取 PE 内嵌清单核对 `longPathAware=true`、`asInvoker` 与版本；签名状态由 `scripts/verify-windows-signature.ps1` 分别检查程序文件与安装包，当前默认 `-Expected Unsigned`。

[Windows 候选包工作流](https://github.com/CoderJackZhu/Thingary/actions/workflows/windows-package.yml)保存候选包和验收材料，artifact 保留 30 天、下载需登录 GitHub，不创建标签或 Release。release 构建在 `windows-latest` x64；隔离安装验收在 `windows-11-arm` 跑 x64 模拟，原生运行器与手工未验项详见[Windows 验收清单](WINDOWS_ACCEPTANCE.md)。失败任务保存的 artifact 仅供诊断，不得作为已通过候选包交付。发布用标签还会由 `release-draft.yml` 在同一标签构建 Windows NSIS 并附到草稿；该草稿仍不公开，公开前按本页核验。

winget 清单由 `scripts/generate-winget-manifest.mjs` 生成，目录、验证与提交步骤见 [packaging/winget/README.md](../packaging/winget/README.md)。当前 `0.0.8` 清单已生成但未提交；下一版定为 `0.1.0`，`release-draft.yml` 会在标签构建时从最终安装包生成 `winget-manifests` artifact，Release 公开后再下载并提交，避免沿用旧 SHA。

SignPath 接入后，签名顺序必须是：先构建并签 `thingary.exe`，再打 NSIS，最后签安装包；不能只签安装包。`windows-package.yml` 只把 release 矩阵的 `signing` 改为 `signed`，acceptance 保持 `unsigned`；`release-draft.yml` 同时把 `THINGARY_WINDOWS_SIGNING_STATUS` 改为 `signed`、`EXPECTED_WINDOWS_SIGNATURE` 改为 `Signed`（两者必须一致）。按实际签名主体决定是否加 `-ExpectedSubjectContains` 与 `-RequireTimestamp`，并重新核验 `BUILD_INFO.json` 的 `signing_status` 与实际文件一致。详细接入步骤、所需配置与回退方案见 [Windows 签名接入](SIGNING.md)；公开政策、审批与申请检查表见 [Windows 代码签名政策](CODE_SIGNING.md)。

<a id="microsoft-store"></a>

### 微软商店（MSIX）

2026-10-25 起准备 Microsoft Store 的 MSIX 路线；它和上面的 NSIS 路线并行，不替换 NSIS。商店对 MSIX 重新签名，不需要购买代码签名证书；EXE／MSI 路线才需要自行购买受信任 CA 的代码签名证书。当前流程只产出**未签名的 x64 候选包**，设计为由 `windows-latest` 生成并做静态结构校验；**尚未在真实 Windows 上安装、未提交 Partner Center、未通过商店认证**。认证后由商店签名并分发，应用内不自行更新。

个人开发者账号在 <https://storedeveloper.microsoft.com> 注册，需要政府证件与自拍验证；中国大陆能否注册尚未确认。应用名「物谱」已保留。产品标识是公开信息，不是密钥，可以写进仓库：

| 项目 | 值 | 用途 |
|---|---|---|
| Identity Name | `CoderJackZhu.3513028683F74` | MSIX `Identity/@Name`，必须与 Partner Center「应用标识」逐字一致 |
| Publisher | `CN=BE6E0613-B500-4B85-B8F0-44A3FA29EB8C` | MSIX `Identity/@Publisher`，必须与 Partner Center 逐字一致 |
| PublisherDisplayName | `CoderJackZhu` | MSIX `Properties/PublisherDisplayName` |
| Package Family Name | `CoderJackZhu.3513028683F74_0yc8cf5cay4hg` | 仅文档、注册表与真机核对使用；身份或发布者改变后会变 |
| Store ID | `9N0Z2JF21D6D` | 商店链接 <https://apps.microsoft.com/detail/9N0Z2JF21D6D> |

`Name` 或 `Publisher` 一旦提交就不能随意改：商店把它当作另一个应用，已有安装、评分和更新关系不会自动迁移。当前模板 `packaging/msix/Package.appxmanifest` 只放占位符，`scripts/pack-msix.ps1` 填入上面的默认值；`PARTNER_CENTER_IDENTITY_NAME`、`PARTNER_CENTER_PUBLISHER`、`PARTNER_CENTER_PUBLISHER_DISPLAY_NAME` 可覆盖。变量存在但为空、发布者不是单个 `CN=` 值、身份名不合法时脚本直接失败，不猜值。不得把证书、`.pfx`、私钥、Partner Center 口令或 Apple 密钥写进仓库或日志；测试自签证书只在本机临时生成。

#### 版本号与提交

- 商店要求四段 `主.次.修订.0`，第四段对商店必须为 `0`。`package.json` 的 `X.Y.Z` 映射为 `X.Y.Z.0`（`0.1.0` → `0.1.0.0`）；带 `-beta` 等后缀的版本不能直接映射，必须先定成三段数字版本。
- 同一源码版本只产出一个商店包。每次向商店提交的版本必须高于上一次**已提交**的版本；只改商店包而没有应用变化时，提升第三段（patch）并同步 `package.json`、`Cargo.toml`、`tauri.conf.json` 和标签。只改 NSIS 的版本不需要重新提交商店包，但不要把同一版本的 MSIX 内容换成不同构建。
- 商店包和 NSIS 包共用同一 `package.json` 版本和资料身份 `local.thingary.main`；MSIX 的包身份（`Identity`）与资料身份是两个东西，不要混用。
- 上传的是**未签名**的 `.msix`。工作流只生成 artifact，不附到 GitHub Release、不签名、不安装。未经维护者授权不提交、不发布；未签名的 MSIX 也不作为普通用户下载提供。

```sh
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
npm run tauri -- build --config src-tauri/tauri.release.conf.json \
  --config src-tauri/tauri.windows.release.conf.json --no-bundle \
  --target x86_64-pc-windows-msvc --ci
node scripts/prepare-windows.mjs --identity local.thingary.main \
  --output .local/distribution/msix-notices --packaging msix
pwsh -NoProfile -File scripts/pack-msix.ps1 \
  -NoticesDir .local/distribution/msix-notices -OutputDir .local/msix
```

打包用 Windows SDK 的 `MakeAppx.exe`（`makeappx pack`／`unpack`），不依赖 `winapp` CLI。产物在 `.local/msix/`：`Thingary_<版本>_x64.msix`、`SHA256SUMS.txt`、`msix-verification.json` 与填好的 `AppxManifest.xml`。`msix-verification.json` 记录身份、发布者、四段版本、`Windows.Desktop`／最低版本、x64 PE、许可文件、源码提交和未签名状态；脚本用 `MakeAppx.exe pack` 打包，再 `unpack` 后逐文件比对散列并解析清单。这些只是结构检查，不等于安装、启动或认证通过。同样的步骤只能在 [MSIX 工作流](../.github/workflows/msix-package.yml)（只在手动触发或 `v*` 标签时运行）的 `windows-latest` 上运行；macOS 不运行 `winapp`／`MakeAppx`，也不交叉产出 MSIX。本次准备只在本机做了静态与工程检查，没有实际触发该工作流；首次运行的日志、`MakeAppx` 输出与 `msix-verification.json` 必须由维护者核对后才能当作通过。

商店包的身份与版本检查、`runFullTrust` 说明、隐私与截图等提交材料见 [Microsoft Store 上架文案](releases/microsoft-store-listing.md) 与 [商店提交清单](releases/store-submission-checklist.md)。提交步骤由维护者在 Partner Center 执行：新提交 → 包 → 上传未签名 MSIX → 认证说明（`runFullTrust` 理由）→ 商店列表／隐私／年龄分级／截图 → 提交认证。认证通过后商店签名并上架；随后从商店安装，按 [Windows 验收清单的 MSIX 小节](WINDOWS_ACCEPTANCE.md#msix-microsoft-store) 复验，不能把 CI 结构检查当作真机通过。

认证常见失败：`Identity`／`Publisher` 与 Partner Center 不一致；版本不是四段、第四段非 0 或不高于上次提交；`runFullTrust` 理由不足；降低 `MinVersion` 后在缺少 WebView2 的系统上启动失败；上传了自签或已签名包；图标尺寸／透明度或清单资源不合法；商店文案承诺了应用内更新、联网行情等商店包没有的行为；隐私政策不可访问。以实际认证报告为准，不凭记忆补规则。

#### 支持范围与 WebView2

商店包的 `TargetDeviceFamily` 是 `Windows.Desktop`，`MinVersion` 为 `10.0.22000.0`（Windows 11），`MaxVersionTested` 为 `10.0.26100.0`。**商店版只声明 Windows 11**；NSIS 版仍是 Windows 10 1809+／11 x64（Windows 10 未实机验证）。

原因是 MSIX 不能在启动时联网安装 WebView2：NSIS 的 `downloadBootstrapper` 属于 Tauri 的 NSIS／MSI 打包器，对本仓库自己的 MSIX 流程不生效。Windows 11 通常自带 Evergreen WebView2 Runtime；企业精简镜像、策略移除或损坏时仍可能缺失，此时应用无法启动，商店包也不会自行修复。可选方案是把固定版本 WebView2 作为应用内容打包（体积、许可与更新负担大，未做），或在真机验证后另行支持 Windows 10；在完成这些之前不要降低 `MinVersion`，也不要在商店文案里写 Windows 10 可用。缺失 Runtime 的干净环境仍按 [N2](WINDOWS_ACCEPTANCE.md#n1n12-固定清单) 验证，不能用已有 Runtime 的机器推定。

#### 已知差异（MSIX 与 NSIS）

以下差异来自 Windows 的包模型，**除注明外均未在真机验证**；提交前必须逐项确认，不能只写“应该没问题”。

| 项目 | NSIS 版 | MSIX 版（预期） | 处理 |
|---|---|---|---|
| 资料库路径 | `%LOCALAPPDATA%\local.thingary.main\library` | 清单关闭了写入虚拟化，与 NSIS 相同的真实路径（待真机复验，M3） | 真机核对写入落在真实目录、包内没有副本；默认虚拟化下曾落在包存储里并随卸载消失 |
| 同步设置 | `%APPDATA%\local.thingary.main\sync` | 同一真实路径 | 真机核对同步配置保存、读取，与 NSIS 版共用同一份设置 |
| 自动备份 | 资料库同目录 `auto-backups` | 同一真实路径，随卸载保留 | 真机核对生成、轮换、恢复；额外自动备份目录由用户选择，已验证可写与不可写目录的提示 |
| 手动备份／换机 | `.thingary` 导出／导入 | 功能不变（NSIS ↔ MSIX 双向完整备份已在 Sandbox 验证，逐表逐行一致） | 换版仍只用完整备份；不要直接复制资料目录 |
| 卸载 | 默认保留资料 | 关闭虚拟化后应同样保留资料（默认虚拟化下实测会删除，已据此改清单，待复验 M5） | 商店描述仍建议提示用户卸载前先导出完整备份 |
| 应用内检查更新 | 读取 Gitee／GitHub 公开版本列表 | 已按包身份禁用（`GetCurrentPackageFullName`），由商店更新 | 真机确认没有检查入口、启动不联网、商店更新生效 |
| 单实例 | 每用户一个主实例 | 实测：NSIS 与 MSIX 同时存在时，启动 NSIS 会被运行中的 MSIX 实例接管 | 两种安装共用同一份资料和同一个实例；不建议并装，换版请先卸载旧的，并用完整备份搬运 |
| 通知 | 启动时登记未打包 AUMID／`LocalServer32` 激活 | MSIX 的 AUMID 是 `包族名!App`，包身份由系统注册 | **高风险**：现有未打包注册在 MSIX 下可能无效或需要另写路径；必须真机验证三类提醒的送达与点击，失败则修复后再提交 |
| 文件选择 | `rfd`／系统文件面板 | 全信任桌面进程，预期不变 | 选图、备份、xlsx、文件夹、另存为各验成功与取消，中文／带空格路径 |
| 报告打印／导出 PDF | WebView2 打印对话框 | 预期不变 | 真机打开打印预览并“另存为 PDF”，核对分页与内容 |

**卸载与资料安全（已决定，待真机复验）**：真机验证（2026-10-26，Windows Sandbox）确认：MSIX 默认把 `%LOCALAPPDATA%`／`%APPDATA%` 的写入重定向到包私有存储，卸载包会删除资料库、图片和包内自动备份；重装的 MSIX 还会读到 NSIS 的真实资料目录。决定：清单关闭写入虚拟化（`desktop6:FileSystemWriteVirtualization=disabled`，需要受限能力 `unvirtualizedResources`，提交时要在 Partner Center 写理由），让商店版和 NSIS 一样使用真实的 `%LOCALAPPDATA%\local.thingary.main`：卸载保留资料，两种安装共用一份资料库和一个运行实例。`pack-msix.ps1` 会校验这两项。**提交商店包前必须在 Windows 11 真机或 Sandbox 复验 M3、M5、M9**（资料落在真实目录、卸载后仍在、并装只有一个实例），并在 Store 提交页为 `unvirtualizedResources` 写理由：应用把用户的本地资料库放在 `%LOCALAPPDATA%\local.thingary.main`，需要与未打包的安装版共用并在卸载后保留，避免用户丢失个人财务资料。

#### `runFullTrust` 认证理由（英文草稿）

提交认证时把下面这段按实际包核对后填入；不要声称未实现的能力：

> Thingary is a local-first desktop application built with Tauri and the Evergreen WebView2 Runtime. The `runFullTrust` capability is required because the app is a Win32 desktop process that stores its SQLite library and images in the user's local application data, opens and saves user-chosen files through the standard Windows file pickers, renders a printable report in its own WebView2 window, and optionally copies backups to a folder the user selects. The app does not install services, drivers, or browser extensions; it runs `asInvoker` and never requests administrator rights. It does not include ads, analytics, or telemetry, and it does not transmit personal data to the developer. Network access is limited to an optional WebDAV sync that the user configures and enables, and the Store build does not check for updates in-app because updates are delivered by the Microsoft Store. Removing `runFullTrust` would prevent the desktop process from starting.

#### 真机安装测试（自签证书，只在本机生成）

商店会签名，日常不需要自签。只在真实 Windows 11 上验证安装行为时，用**临时**证书，私钥不导出、不提交：

```powershell
$publisher = 'CN=BE6E0613-B500-4B85-B8F0-44A3FA29EB8C'
$cert = New-SelfSignedCertificate -Type Custom -Subject $publisher `
  -KeyUsage DigitalSignature -FriendlyName 'Thingary MSIX test' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
Export-Certificate -Cert $cert -FilePath .local\msix\Thingary-test.cer
$trustedPeople = 'Cert:\CurrentUser\TrustedPeople'
if (-not (Test-Path $trustedPeople)) { New-Item -Path $trustedPeople -Force | Out-Null }
Import-Certificate -FilePath .local\msix\Thingary-test.cer -CertStoreLocation $trustedPeople
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' |
  Sort-Object FullName -Descending | Select-Object -First 1
& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint .local\msix\Thingary_0.1.0_x64.msix
Add-AppxPackage -Path .local\msix\Thingary_0.1.0_x64.msix
Get-AppxPackage -Name 'CoderJackZhu.3513028683F74' | Format-List Name,PublisherId,Version,PackageFamilyName,InstallLocation
```

证书 Subject 必须与清单 `Publisher` 完全一致，否则签名或安装会失败。若 `Add-AppxPackage` 仍报证书不受信任，可把测试证书导入 `Cert:\LocalMachine\TrustedPeople`（需要管理员，仅限测试机），不要关闭整机安全保护。自签包只用于本机验收；不要上传到 Partner Center。测试后删除临时证书与包（`Remove-AppxPackage`、删除 `Cert:\CurrentUser\My` 与 `TrustedPeople` 中的测试证书），并按 [Windows 验收清单](WINDOWS_ACCEPTANCE.md#msix-microsoft-store) 记录未验项。Windows 10 的旁加载策略、Developer Mode 与证书信任要求可能不同，本流程只按 Windows 11 记录。

## 3. 核验交付物

### Mac

1. 挂载 DMG 为只读，核对内容、Applications 指向、版本、身份、架构和 `codesign --verify --strict --deep`；比对挂载包与原始构建包的全部文件及符号链接。
2. 把挂载包复制到临时目录，再比对签名和文件，证明拖拽复制不会破坏应用。**不启动正式身份包，不碰真实库**。
3. 检查 HTML 图片与内部锚点；离线阅读安装、建档、盘点和备份说明。DMG 中不能出现数据库、备份、测试资料或凭据。
4. 用同代码、全新隔离身份和虚构资料走查：首次样例 → 自己的资料 → 物品 → 账户 → 完整盘点 → 备份／恢复 → 重启保留。
5. 明确记录未做的步骤。浏览器截图不能代替原生验收；本地挂载与隔离启动不能证明真实下载后的 Gatekeeper 首开、其他 Mac 或其他系统版本兼容。
6. 在最终提交上复查 CI、README、版本与 Release 正文；核对 DMG 文件大小与 SHA-256。附件从 GitHub 回读后应与本地散列一致。

### Windows

1. 在最终源码提交重新构建，检查版本、正式身份、x64 架构、签名状态、long-path 清单、WebView2 模式、当前用户安装与随包完整许可；不启动正式身份包。
2. 从安装器解开的 payload 回读 `许可/BUILD_INFO.json`，完整源码 SHA 应等于构建输入；许可散列、NSIS 和 `SHA256SUMS.txt` 相符，包内无用户资料、夹具、备份或凭据。
3. 用同源码的已安装隔离验收包执行[固定清单](WINDOWS_ACCEPTANCE.md)，分别记录自动检查、系统排队、可见通知、人工文件／安装对话框、键盘／IME／讲述人及平台范围；未验项明确写入候选交付说明。
4. 核对 Mac 四项回归与两平台 CI、跨平台备份恢复，原生截图按相同内容尺寸对照；ARM 上的 x64 模拟不等于真实 x64 性能或兼容性。
5. 下载工作流 artifact，回读安装包文件大小与 SHA-256。候选包交付给用户验收后再决定公开发布；未经发布授权不创建标签或公开 Release，不覆盖已发布附件。

## 4. Release 草稿与公开

**国内镜像**：GitHub 在国内常常打不开，每个公开版本同步发布到 [Gitee 仓库](https://gitee.com/CoderJackZhu/thingary)：把本次授权的源码提交与版本标签推到 `gitee` 远程，在 Gitee「发行版」用同一标签创建发行版，正文用同一份 `docs/releases/v<版本>.md`，上传同一份已授权平台的安装包与 `SHA256SUMS.txt`，并核对 Gitee 上的文件散列与 GitHub 一致。仅候选交付的平台不自动执行此镜像或公开步骤。应用内检查更新会读取两处，所以 Gitee 发行版的标签必须是 `v<版本>`、不要勾选草稿。

仓库的 `Gitee mirror` 工作流在 GitHub Release 公开后自动执行上述镜像，也可手动指定已发布标签补同步；普通代码推送不会触发镜像。需配置具有 projects 权限的 `GITEE_TOKEN`，缺少时只警告并跳过，不能据工作流绿色判断附件齐全。工作流从发布标签取得源码，从工作流自身提交取得同步脚本；只推送该标签及其可达源码提交，不移动 Gitee 的 main，旧版本补同步不依赖 main 的当前位置，分支同步单独处理；附件使用 curl／HTTP 1.1 上传，单次最多等待 90 分钟，最多尝试两次，跳过已有同名附件，最后下载回读并比较 GitHub 与校验清单的散列。成功以日志 `Gitee verified` 及全部预期附件为准；延长超时不代表网络提速。镜像失败时修复后补同步同一版本，不重新构建或覆盖已发布附件。

每次发布在 `docs/releases/v<版本>.md` 维护正文，现有示例为[0.0.2 发布说明](releases/v0.0.2.md)。先推送最终源代码提交，在该提交创建 `v<版本>` 标签和 **draft Release**，上传该次已授权的 Mac DMG／Windows NSIS 安装包与各自 SHA256SUMS；公开测试版设置 Pre-release（即使版本号不带 beta 后缀），README 直接链接对应版本，不能依赖只返回正式版的 latest 入口。不要移动已经发布的标签或覆盖现有附件。自动生成的 Source code 归档应对应这个标签，保留锁文件、构建脚本、文档和依赖源码获取入口。

**Windows 签名声明按实际状态写。** SignPath Foundation 的申请表要求下载页写明使用它签名，但当前申请被要求补充公开声誉材料、暂未通过（见 [CODE_SIGNING](CODE_SIGNING.md)），所以现在的 Release 正文**不写**任何 SignPath 声明，只如实写"安装包未签名"。申请重新进入审核后写：`Windows installer code signing: free code signing provided by SignPath.io, certificate by SignPath Foundation (application in progress; until approved the installer is unsigned).`；获批并验签通过后改为 `Free code signing provided by SignPath.io, certificate by SignPath Foundation.`。不要写没有发生的事。

草稿不等于已公开。发布前核对源代码、完整许可材料和支持边界，确保 [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) 可用。取得本次发布授权后发布草稿，以未登录方式检查说明、附件和下载入口；不要把仅本机安装或只有源码附件写成“普通用户可下载”。把最终源码 SHA、标签、附件散列和验证边界登记到私有笔记。

公开仓库保留历史，移出 main 的文件仍可从历史查看。发布从公开源码标签构建，不从私有笔记仓库打包；编号重排也必须以同版本源码重新构建，不能只改附件名；版本变化不重置资料身份、schema 或备份格式。已撤下的包、元数据和对应源码私有保全，不宣称能收回他人已下载的副本。

若发现包错误，先隐藏或撤下有问题的发布，保留本地错误包和核验记录；修复后发布新补丁版本，不静默替换同版本附件。不要要求用户直接降级打开已经迁移的资料；说明恢复与旧版本兼容的升级前备份。

放行前登记故障处理负责人、触发条件、暂停分发与告知入口、受影响版本及资料保护／恢复步骤。发现资料安全或关键主线问题时优先暂停问题包分发，保全证据，判断用户影响并提供安全处理说明；不能以撤包推定已收回下载副本。修复后重新走适用关卡，以新补丁版本交付，并将漏检原因转为回归或清单检查项。

<a id="ios"></a>

## Android（GitHub APK）

- **应用 ID 与名称**：正式版是 `local.thingary.main`，应用名「物谱」；开发预览是 `local.thingary.preview`、「Thingary Preview」，两者可同时安装。构建时用环境变量 `THINGARY_ANDROID_APPLICATION_ID`、`THINGARY_ANDROID_APP_LABEL` 切换（`release-draft.yml` 的 Android 步骤已设为正式值）；不设置就是预览身份。Kotlin 插件类固定在源码包 `local.thingary.preview` 下，Rust 通过 `crate::android::PLUGIN_PACKAGE` 注册，不随应用 ID 变化——不要把它改回读 `identifier`。
- **发布密钥**：用一把专用密钥，离线备份，丢失后无法更新已安装的版本；不要和本地预览密钥（`.local/signing/`）混用。GitHub secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`；缺失时 Android 步骤自动跳过。
- **本地验证**：`THINGARY_ANDROID_APPLICATION_ID=local.thingary.main THINGARY_ANDROID_APP_LABEL=物谱 npm run android:build -- --target aarch64`，再用 `aapt2 dump badging` 核对包名与名称，装机后确认能进首页。
- **安装提示**：国产安卓系统可能对未备案或未知来源应用弹提示或拦截；那是系统策略，不是应用故障。附件只从本仓库 Release 下载，并用 `SHA256SUMS.txt` 核对。
- 产物名为 `Thingary-<版本>-android.apk`，随 Release 草稿附上，公开前仍按上文「多平台放行」逐项核对。

## iOS（App Store）

先 TestFlight 内部测试，再准备海外区上架；**未经 Jack 明确授权，不提交 App Store 审核**。商店文案见 [App Store 上架文案](releases/app-store-listing.md)，审核风险与备注草稿见 [App Store 审核风险评估](releases/app-store-review-notes.md)，隐私页在官网 `/privacy/`。

2026-10-21 已定：使用 Jack 朋友的 Apple 开发者个人账号；Bundle ID 为 `local.thingary.main`；名称「物谱」，被占用时用「物谱 Thingary」；仅 iPhone、竖屏、免费；不在中国大陆销售（尚未备案）。账号密码、证书、描述文件和团队配置只保存在本机，不提交仓库。**App 记录必须在 App Store Connect 网页创建**（据目前了解，公开 API 不能创建应用记录）；API 密钥可以上传构建和开启内部测试，提交审核仍需 Jack 单独放行。以朋友账号发布时，App Store 上显示的开发者是他们（或其法律实体），不是 Jack。

### 当前工程状态

- 工程在 `src-tauri/gen/apple/`，由 XcodeGen 的 `project.yml` 描述。默认开发身份保持 `local.thingary.preview`、产品名 `Thingary Preview`。上架时额外合并 `src-tauri/tauri.appstore.conf.json`，只覆盖 `identifier` 和 `productName`，不改变桌面配置。
- 隐私清单 `thingary_iOS/PrivacyInfo.xcprivacy` 由 `thingary_iOS` 目录源自动加入 Copy Bundle Resources；每次重建工程和打包后仍需检查目标资源与包内文件。`Externals` 仅通过 `libapp.a` 链接，不作为目录源，避免 XcodeGen 把编译产物静态库误复制进 App 资源。
- Release 链接另需 rustup 的 `llvm-tools` 组件：Xcode 27 的 SwiftPM 在 Release 配置下把 Tauri Swift 包的 `@_cdecl` 导出编译为局部符号，`swift-rs` 用 `llvm-objcopy` 恢复为全局符号；缺少时 Rust 静态库链接会报 `_log_stdout`、`_on_webview_created`、`_run_plugin_command` 未定义。原因与复现见[开发与测试](DEVELOPMENT.md#ios-开发)。
- `TARGETED_DEVICE_FAMILY = 1`，不包含 iPad；`project.yml` 与 `thingary_iOS/Info.plist` 已移除 iPad 方向，iPhone 竖屏与 `src-tauri/Info.ios.plist` 一致。
- 工程使用 `CODE_SIGN_STYLE = Automatic`，不固定 Team。发布用的 `ExportOptions.appstore.plist`（method 为 `app-store-connect`；原来调试用的 `ExportOptions.plist` 不动）；团队 ID 由脚本从环境变量 `APPLE_TEAM_ID` 临时注入，不写进仓库。
- `scripts/ios-archive.sh` 负责可重复的商店归档：读取 `tauri.appstore.conf.json`，生成 Xcode 工程，`xcodebuild archive`（自动签名＋`-allowProvisioningUpdates`），核对归档身份／版本／`PrivacyInfo.xcprivacy`，再用 `xcodebuild -exportArchive` 导出 `.ipa`。可选 `IOS_BUILD_NUMBER` 临时改写并恢复源 `Info.plist`。API 密钥认证使用 `ASC_KEY_ID`、`ASC_ISSUER_ID`、`ASC_KEY_PATH`；三项缺一即明确失败，也可全部不设以使用本机 Xcode 账号。
- `scripts/ios-upload.sh` 只在上传阶段使用：默认 dry-run，校验 IPA 身份、版本、构建号和隐私清单后打印命令；只有显式 `--really-upload` 才调用 `xcrun altool --upload-app`。脚本不提交审核，也不读取密钥内容。
- 归档脚本只向 `src-tauri/target/ios/` 写归档和导出产物；上传脚本只在临时目录解包检查。两者都不含任何真实 Team ID、Key ID、Issuer ID 或密钥值。签名归档、上传和 TestFlight 验证完成前，不得把产物写成已发布。

### 1. 版本号

`CFBundleShortVersionString` 与桌面版本一致；iOS 当前暂停公开分发，生成工程仍为 0.0.8；恢复时同步到当前源码版本（0.1.0）并重新生成。**每次上传前**由维护者分配高于 App Store Connect 已上传值的构建号，使用 CLI `--build-number` 后核对归档 `Info.plist` 的 `CFBundleVersion`；不能仅凭命令参数推定最终值（参见 [Apple 构建版本字符串](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion)）。版本维护仍按本文 §1。

### 2. 构建与无签名检查

在 Mac 上，按[开发与测试](DEVELOPMENT.md#ios-开发)装好完整 Xcode、模拟器运行时、Rust 目标、rustup 的 `llvm-tools` 组件与 XcodeGen。首次克隆后创建被忽略的输出目录，再生成工程：

```sh
rustup component add llvm-tools
npm ci
mkdir -p src-tauri/gen/apple/Externals src-tauri/gen/apple/assets
(cd src-tauri/gen/apple && xcodegen generate)
npm run build
npm run test:ui
npm run check
npm test
npm run ios:check
```

上架构建（需已登录朋友账号且获得证书／描述文件权限；`APPLE_DEVELOPMENT_TEAM` 为本机环境变量）：

```sh
npm run ios:tauri -- ios build --config src-tauri/tauri.appstore.conf.json --export-method app-store-connect
```

每次上传加上维护者选定的 `--build-number <递增值>`。完成包核查后，在 `src-tauri/gen/apple` 重新运行 `xcodegen generate`，并核对 `git diff`，恢复可提交工程的默认预览身份；CLI 会按本次配置改写生成工程，不能把商店身份和本机签名配置误提交为开发默认值。

也可以直接用仓库脚本完成同样的归档和导出（推荐，输出在 `src-tauri/target/ios/`）：

```sh
APPLE_TEAM_ID=<10 位 Team ID> IOS_BUILD_NUMBER=<递增值> bash scripts/ios-archive.sh
# 使用 App Store Connect API 密钥时（三项齐全；不设置则用本机 Xcode 账号）：
APPLE_TEAM_ID=<Team ID> IOS_BUILD_NUMBER=<递增值> \
  ASC_KEY_ID=<Key ID> ASC_ISSUER_ID=<Issuer ID> ASC_KEY_PATH=<AuthKey_xxx.p8> \
  bash scripts/ios-archive.sh
```

脚本会临时注入商店身份和 `ExportOptions.plist` 的 Team ID，核对归档与 IPA 的 Bundle ID、版本、构建号和隐私清单；`IOS_BUILD_NUMBER` 只临时改写源 `Info.plist`，结束时恢复。上传先 dry-run：

```sh
ASC_KEY_ID=<Key ID> ASC_ISSUER_ID=<Issuer ID> ASC_KEY_PATH=<AuthKey_xxx.p8> \
  bash scripts/ios-upload.sh src-tauri/target/ios/export/物谱.ipa
# 维护者确认后：在命令末尾加 --really-upload（本流程不自动执行）
```

不要把真实 Team ID、Key ID、Issuer ID 或 `.p8` 内容写进文档、提交或日志。

Tauri 通过 [JSON Merge Patch](https://v2.tauri.app/develop/configuration-files/#extending-the-configuration) 合并配置；归档后检查 Bundle ID、名称、版本、构建号、设备族和隐私清单。不启动商店身份来做开发验收，不打开正式资料库。Release 不启用 `fault-injection`。

无签名设备归档用于包检查和 Privacy Report，不能上传或用作 TestFlight 包：

```sh
npm run ios:tauri -- ios build --config src-tauri/tauri.appstore.conf.json --no-sign --archive-only
```

模拟器取证保持默认预览身份。若 CLI 因 SDK／runtime 小版本不同报告模拟器 SDK 未安装，保持 `ios:dev` 运行，在另一终端明确指定已安装设备构建：

```sh
npm run ios:dev -- "Thingary Store iPhone 17 Pro Max" --no-watch
# 另一终端；先用 xcrun simctl list devices available 获取 SIM_UDID
xcodebuild -project src-tauri/gen/apple/thingary.xcodeproj -scheme thingary_iOS \
  -configuration debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIM_UDID" \
  -derivedDataPath "$HOME/Thingary-store-build" CODE_SIGNING_ALLOWED=NO build
```

#### 当前无签名验证边界（2026-10-22）

Xcode 27.1（27A9275）、iOS 27.0 runtime、iPhone 17 Pro Max（1320×2868）：`xcodegen generate` 和明确 destination 的模拟器 Debug 构建通过，Copy Bundle Resources 与 `.app/PrivacyInfo.xcprivacy` 均已核实；图标 18 个条目尺寸齐全、1024 图无 alpha 或预制圆角。截图使用新建模拟器、默认 `local.thingary.preview`：前四张来自「先看看样例」，第五张手工新增虚构装饰画并使用模拟器自带瀑布照片；原图与证据在仓库外；不运行商店身份，不访问正式资料库。

设备 Debug 与 Release 无签名归档均已通过。此前 Release 缺 `_log_stdout`、`_on_webview_created`、`_run_plugin_command` 的链接失败已定位并修复：

- 根因在工具链而不在生成工程：失败发生在预构建脚本调用的 `cargo build --release --target aarch64-apple-ios`（Rust 静态库链接）阶段，早于 Xcode 链接 App；`project.yml` 删除 `Externals` 目录源只影响 App 资源复制，与该失败无关。Debug 的 Tauri Swift 静态库把三个导出符号编译为全局 `T`；Release 的 SwiftPM 产物把它们编译成局部 `t`（`nm` 可见），`swift-rs` 依靠 rustup `llvm-tools` 的 `llvm-objcopy` 恢复为全局符号。本机原先未安装该组件，构建脚本输出 `cargo:warning=swift-rs: llvm-objcopy not found …` 后跳过恢复，Rust 链接失败。
- 修复为 `rustup component add llvm-tools`；未升级 Rust 依赖、未改生成工程的链接方式、未放宽链接检查。安装后同一命令构建成功，`nm` 显示三个符号恢复为 `T`。

```sh
# 设备 Debug 与 Release（无签名，只做包核查；后一次覆盖前一次的归档目录）
npm run ios:tauri -- ios build --debug --config src-tauri/tauri.appstore.conf.json --no-sign --archive-only
npm run ios:tauri -- ios build --config src-tauri/tauri.appstore.conf.json --no-sign --archive-only
```

Release 归档为 `物谱.app`（28.7 MB）：包含 `PrivacyInfo.xcprivacy`，标识 `local.thingary.main`、名称「物谱」、设备族 `[1]`、仅竖屏，版本／构建号保持 0.0.8，资源目录没有 `libapp.a`；未安装或启动。核查后重新运行 `xcodegen generate`，提交的生成工程恢复预览身份 `local.thingary.preview`／`Thingary Preview`。

Release 二进制的隐私核对（`nm`／`strings`／`otool`／dSYM 符号化）：

- 包内清单声明文件时间戳（`C617.1`、`3B52.1`）、系统启动时间（`35F9.1`）与磁盘空间（`E174.1`）；`NSPrivacyTracking=false`，无收集数据类型。
- **磁盘空间（DiskSpace）在 Release 中仍有引用**：`nm -u` 有 `_statfs`、`_fstatfs`，没有 `_statvfs`／`_fstatvfs`。调用来自内置 SQLite 3.53.2（`rusqlite 0.40.2` 的 `bundled` → `libsqlite3-sys 0.38.2`）：`unixOpen` 在 Apple 上每次打开数据库都会调用 `fstatfs`；`autolockIoFinderImpl` 与 `proxyTransformUnixFile` 使用 `statfs`。`fs2` 只用于 `src-tauri/src/storage.rs:410` 的文件锁，其 `statvfs` 在 Release 已被剔除，Debug 中的 `statvfs` 是未使用包装的链接残留。Jack 已确认补充，清单声明 `E174.1`（检查是否有足够空间写入文件，例如打开和写入数据库、保存备份）。
- **活动键盘（ActiveKeyboards）未发现访问**：Release 主二进制（含 `__objc_methname`）没有 `activeInputModes`／`UITextInputMode`；只有 Debug 未做 dead-strip 时保留的 `objc2-ui-kit` 选择器绑定，仓库与 `wry`／`tao`／`tauri` 源码均无调用。
- Xcode Organizer 的 Generate Privacy Report **未生成**：该动作只在 Organizer GUI 提供（无 `xcrun`／`xcodebuild` 等价命令），本机 Accessibility 未授权且无法截图，归档无签名；是否受签名限制尚未验证，待签名后（或由 Jack 在 Xcode 手动执行）再核对。

尚未安装或启动商店身份。签名前仍需生成并核对隐私报告。

### 3. 签名、账号与 App 记录

Jack 将开发者账号加入 Xcode，或在本机登录朋友账号。选择对应 Team，Automatic signing 已在工程配置；通过本机环境变量 `APPLE_DEVELOPMENT_TEAM` 传入 Team ID。个人账号中被邀请的 App Store Connect 用户能否操作证书／描述文件需以账号实际权限为准，不能仅凭能登录 Connect 推定可签名。

Bundle ID 与 App 记录按以下顺序在网页完成，不能靠公开 API 代替：

1. **注册 Bundle ID**：用账号持有人登录 Apple Developer → Certificates, Identifiers & Profiles → Identifiers → `+` → App IDs → App，显式填写 `local.thingary.main`。只在需要时添加能力；当前工程没有额外 entitlements。
2. **创建 App 记录**：App Store Connect → Apps → `+` → New App，平台选 iOS，名称「物谱」（占用则「物谱 Thingary」），主要语言简体中文，SKU 由维护者自定，Bundle ID 选上一步注册的值。应用记录、协议、税务和银行信息都在朋友的账号下；公开 API 不能创建 App 记录。
3. **确认账号权限**：Jack 需要足够的 App Manager／Developer 角色来上传构建和操作 TestFlight；证书、描述文件、协议与审核邮件归账号持有人。不要让模型或仓库保存账号密码、证书私钥、`.p8` 内容或签名口令。
4. **书面同意**：取得朋友同意用其账号发布「物谱」的书面记录；App Store 显示的开发者是他们（或其法律实体），不是 Jack。审核联系邮箱、协议更新和账号安全事件也由账号持有人处理。

尚未获得 Team 时，继续无签名构建和截图；签名归档、App 记录创建、上传与 TestFlight 状态保持待办，不填写假团队号，不把无签名归档当作发行包。

### 4. TestFlight 内测与真机记录

签名 Archive 后在 Organizer 选 Distribute App › App Store Connect › Upload，或用 `scripts/ios-upload.sh` 先 dry-run 再由维护者显式上传。构建处理完成并完成出口合规问卷后，先加入 TestFlight 内部测试组：内部测试只面向账号团队成员（最多 100 人），通常不需要 Beta App Review；确认构建可用后再申请外部测试。外部测试（最多 10,000 人）需要 Beta App Review，审核通过前不要把它当作已公开测试。不发起 App Store 审核。操作参考 [TestFlight 概览](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)。

在 Jack 的 iPhone 上安装 TestFlight 包，用「先看看样例」或独立的虚构资料验收。未获准访问正式资料库；若手机已有正式资料，先由 Jack 确认隔离方案再安装。逐项记录构建号、iPhone／iOS 版本、操作、结果和截图（证据存仓库外）：

| 项目 | 验收内容 |
|---|---|
| 照片 | 相机拍照、相册多选、HEIC 原件与缩略图 |
| 隐私 | 面容 ID 锁屏、后台切换时模糊遮挡 |
| 通知 | 盘点提醒、保修到期、周期付款三类授权、排程和实际送达 |
| 文件 | 备份分享到「文件」，从「文件」恢复并核对资料 |
| 报告 | 规划报告 PDF 导出、系统分享、打开内容 |
| 表单 | 键盘弹出后可滚动、可见并操作保存／取消（[#21](https://github.com/CoderJackZhu/Thingary/issues/21)） |

模拟器截图、交叉编译和前端检查均不能代替这些真机结果。

### 5. App Store Connect 填写

| 项目 | 内容 |
|---|---|
| 应用信息 | 名称「物谱」（占用则「物谱 Thingary」）、免费、海外区，取消中国大陆；其余文案见[上架文案](releases/app-store-listing.md) |
| 隐私政策网址 | `https://thingary.jackzhu.top/privacy/`，须在提交前已部署可访问 |
| App 隐私标签 | 建议选「不收集数据」，依据见下文隐私清单核对；官方说明 [App 隐私详情](https://developer.apple.com/app-store/app-privacy-details/)（未逐页核对） |
| 年龄分级 | 建议答案见上架文案，问卷定义见 [年龄分级值与定义](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) |
| 截图 | 规格见 [截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)：该页写明 6.1 寸一组（1179×2556 或 1206×2622）至少一张为必填，6.9／6.7 寸一组缺失时由其他尺寸缩放；清单见上架文案 |
| 出口合规 | 首次上传如实回答并截图交 Jack 确认；当前不写 `ITSAppUsesNonExemptEncryption`，按下文出口合规说明准备 |
| 中国大陆 | 已定不上架；在「价格与销售范围」取消勾选并留存结果 |

#### 隐私清单核对（PrivacyInfo.xcprivacy）

依据：[描述 required reason API 的使用](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api)——使用了需说明理由的 API，必须在隐私清单中声明被认可的理由，且 App 自身和每个动态库／SDK 各自声明。物谱的 Rust 代码与依赖被静态链接进主可执行文件，所以统一声明在 App 的清单里。2026-10-22 已对照 Apple 的 [NSPrivacyAccessedAPITypeReasons](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons) 原文核对下列三个理由代码；声明范围仍需与归档内实际使用一致。

| 类别 | 是否使用 | 理由代码 | 代码出处 |
|---|---|---|---|
| 文件时间戳 `NSPrivacyAccessedAPICategoryFileTimestamp` | 是 | `C617.1`（读取 App 容器内文件的时间戳／大小等元数据）；`3B52.1`（读取用户通过文件选择器授予访问的文件） | `src-tauri/src/auto_backup.rs`（备份文件 mtime 与复制后还原 mtime）、`purge.rs`（清理暂存区时只保留 24 小时内的暂存选择）、`photos.rs` 与 `storage.rs`（图片校验缓存的文件戳）、`financial_import.rs`（偏好文件指纹）；`native/ios.m` 对用户所选备份／图片的 `copyItemAtURL` 与 `NSURLIsRegularFileKey`（用户经系统选择器授予的文件，随后复制到应用临时目录）。Rust 标准库的 `std::fs::metadata` 与 SQLite 的 `stat` 同样会被扫描到。 |
| 系统启动时间 `NSPrivacyAccessedAPICategorySystemBootTime` | 是 | `35F9.1`（测量 App 内事件之间经过的时间） | `std::time::Instant`：`backup_security.rs`（会话空闲超时）、`worker.rs`（变更与失败间隔）、`backup_jobs.rs`。Rust 在 Apple 平台的 `Instant` 基于单调时钟，Apple 把 `mach_absolute_time` 等归入此类；Debug 与 Release 主二进制均检测到 `_clock_gettime` |
| 磁盘空间 `NSPrivacyAccessedAPICategoryDiskSpace` | 是（Release 仍有引用） | `E174.1`（检查是否有足够磁盘空间写入文件） | 内置 SQLite 3.53.2（`rusqlite 0.40.2` 的 `bundled` → `libsqlite3-sys 0.38.2`）：`unixOpen` 在 Apple 上每次打开数据库调用 `fstatfs`（`sqlite3.c:46946`）；`autolockIoFinderImpl`（`46181`）与 `proxyTransformUnixFile`（`48371`）调用 `statfs`。Release 主二进制的 `nm -u` 有 `_statfs`、`_fstatfs`，无 `_statvfs`／`_fstatvfs`。`fs2` 只用于 `src-tauri/src/storage.rs:410` 的文件锁，其未使用的 `statvfs` 包装在 Release 已被剔除；Debug 中的 `statvfs` 是未使用包装的链接残留 |
| 用户默认设置 `NSPrivacyAccessedAPICategoryUserDefaults` | 未发现调用 | 不声明 | `native/*.m`、`gen/apple/Sources` 无 `NSUserDefaults`；偏好保存在应用资料目录的文件里。WebKit 与 UIKit 是系统框架，由系统处理 |
| 活动键盘 `NSPrivacyAccessedAPICategoryActiveKeyboards` | 否（Release 未引用） | 不声明 | Debug 主二进制曾有 `activeInputModes` 字符串；Release 主二进制（`strings`、`__objc_methname`）为 0，只有 Debug 未做 dead-strip 时保留的 `objc2-ui-kit` 选择器绑定；仓库与 `wry`／`tao`／`tauri` 源码均无调用 |

静态扫描不等于二进制扫描：第三方 crate（`wry`、`tao`、`tauri`、`rusqlite`/SQLite、`image`、`zip`、`age`）的代码在源码层没有被逐行审读；Release 归档已用 `nm -u`／`strings`／`otool` 与 dSYM 符号化核对上表。Archive 后在 Xcode Organizer 中按住 Control 点击归档，选择「Generate Privacy Report」。报告汇总包内清单的声明，**不会自动替二进制补报漏掉的 API**；上传后留意 App Store Connect 的 ITMS-91053 邮件，按其列出的类别补充声明。依赖自带隐私清单的 SDK 不重复声明；目前没有以 xcframework／动态库形式嵌入的第三方 SDK。

数据收集：`NSPrivacyTracking=false`，`NSPrivacyTrackingDomains` 与 `NSPrivacyCollectedDataTypes` 为空。依据（iOS 构建）：

- 没有账号体系，开发者不运营接收用户资料的服务器，也没有广告、统计或第三方分析 SDK。
- `src-tauri/src/update_check.rs`：`supported()` 在 iOS 返回 false，`check()` 在发请求前返回「iOS 更新由 App Store 管理」；iOS 不检查更新。
- `src-tauri/src/support.rs`：只有固定链接，`open` 在 iOS 经 `UIApplication openURL` 交给系统浏览器，且拒绝 `update`；应用自身不发起支持页请求。心愿的「相关链接」是 `WishDetail.tsx` 中用户自己填写的 `<a target="_blank">`，点击后的行为（WKWebView 是否转交 Safari）**未在设备上验证**。
- PDF 导出的 WKWebView 为无脚本、无网络、非持久（`native/ios_pdf.m`，CSP `default-src 'none'`）。
- 开发时的 `devUrl` 与 `--host` 仅用于 `ios dev`，Release 归档不使用。
- **可选 WebDAV 同步**：默认关闭，只有用户配置服务器并主动开启后才连接用户自己的服务器；开发者不接收快照，也不提供账号或共享服务。快照加密，设备名等清单元数据为明文。手机端同步页仍属实验性，真实云盘与真机验证未完成；不能把源码存在同步路径写成该平台已完整验证。网络传输本身不属于 required-reason API，不因此新增隐私清单类别。

App 隐私标签拟选「不收集数据」，依据是开发者不接收数据；提交前仍需按 Apple 的定义核对用户自备服务器传输是否被视为收集。不要沿用旧版「iOS 版不联网」的绝对表述。

#### Info.plist 与设备族

权限说明保留中文：相机拍摄物品照片、相册选图、面容 ID 验证机主身份、局域网连接用户自备的 WebDAV 服务器。通知使用系统授权，无对应 Info.plist 用途键。仅 iPhone、仅竖屏；不再要求 iPad 方向或截图。`UIRequiredDeviceCapabilities` 保持 `arm64`、`metal`。最低系统为 iOS 16.0（`project.yml` 的 `deploymentTarget`），提交前按实际支持范围复核。`UIFileSharingEnabled` 与 `LSSupportsOpeningDocumentsInPlace` 为 true，使用户能在「文件」App 中看到／恢复 Documents 里的备份；这是有意的，但会让 App 容器的 Documents 对用户可见，审核备注里说明。

#### 出口合规（首次上传后由 Jack 确认答案）

应用默认离线，但可选的 WebDAV 同步会连接用户自备服务器；不能写成“iOS 版不联网”。Rust `age` 库用公开的 X25519、ChaCha20-Poly1305 与 scrypt 保护用户自己的备份和同步快照，属于应用内实现，不是只调用 Apple 的系统加密；传输层由用户配置的 WebDAV 服务器与系统网络提供，建议只使用 HTTPS。

建议按以下事实回答，最终由维护者／合规确认：

- “是否使用加密”：**是**。仅用于保护用户自己的资料、用户创建的备份，以及用户自选服务器之间的传输；不提供 VPN、不提供第三方保密通信服务。
- 是否属于豁免：**不能仅因为使用标准算法就选豁免**。按当前应用内 age 实现，更稳妥的初步判断是按“使用非豁免加密”准备，按 App Store Connect 实际问卷提交自分类报告或其他要求的文档。若合规确认符合豁免条件，才可把 `ITSAppUsesNonExemptEncryption` 设为 `false`；确认前不要写成豁免，也不要编造文档编号。
- 首次上传在 App Store Connect 按实际问题如实回答，把**问题、选项和答案截图贴进 PR**，交 Jack 确认后再决定是否写入 `ITSAppUsesNonExemptEncryption`。当前不写该键。

参考 [出口合规概览](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)和[判定与上传加密文档](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)。若实际问卷要求补充文档，按平台流程处理。

#### 销售范围

2026-10-21 已定先 TestFlight，之后免费在海外区上架，不包含中国大陆（尚未备案）。在 App Store Connect 的「价格与销售范围」取消中国大陆；实际后台设置尚需登录后执行和截图确认。以后若要增加中国大陆，另行处理备案与平台要求，不能沿用本次海外区决定。

### 6. 提交审核前检查清单

- [x] 已确定标识、名称、免费、海外区（排除中国大陆）、朋友的个人账号、仅 iPhone；出口合规先逐次回答，Jack 确认后再固化键
- [ ] 已取得 Team 权限、在 Apple Developer 注册 Bundle ID、在 App Store Connect 网页创建 App 记录，并实际完成价格与销售范围设置
- [ ] 版本号与构建号已同步（`project.yml`、`Info.plist`、`Info.ios.plist` 与 §1 的版本文件），构建号递增
- [x] 本轮 `npm run build`、`npm run test:ui`（1630 项）、`npm run check`、`npm test`、`npm run ios:check` 全部通过；后续上传前重新执行
- [ ] Release 构建不含 `fault-injection`、验收身份或开发 `devUrl`
- [ ] `scripts/ios-archive.sh` 在真实 Team 下完成归档并导出 `.ipa`；归档身份、构建号、隐私清单和 `ExportOptions.plist` 已核对
- [ ] Archive 包含 `PrivacyInfo.xcprivacy`，隐私报告与二进制符号核对完毕，无 ITMS-91053 邮件遗漏项
- [ ] 虚构资料走完 TestFlight 内测；真机拍照、面容 ID、通知实际送达、备份分享与恢复、断网使用各有记录；未验项如实登记
- [ ] 隐私政策页已部署并可未登录访问，内容与应用实际一致；官网首页页脚有入口
- [ ] App 隐私标签、年龄分级、出口合规问卷、截图（各尺寸）、描述、关键词、支持网址已填并复核；文案说明可选 WebDAV 默认关闭，没有把同步写成已稳定或把应用写成从不联网，也没有联网行情、AI 等未实现功能
- [ ] 审核备注说明：无需登录、样例入口、相机／相册／面容 ID／通知用途、局域网 WebDAV 用途、`UIFileSharingEnabled` 的原因；见[审核风险评估](releases/app-store-review-notes.md)
- [ ] 使用指南已有「iPhone 版」说明（已改为 TestFlight 阶段表述）；上架后把使用指南、官网首页与 README 里的「即将推出／TestFlight 测试中」改为 App Store 链接，`docs/INDEX.md` 与 README 状态一致
- [ ] 未经维护者授权不点「提交以供审核」；提交与发布均由维护者执行

## 平台更新与附件约定

应用按实际发布附件匹配可用更新，不以最高版本标签代替兼容性。当前 Mac 文件名使用 `Thingary-<版本>-universal.dmg`；分包可用 `arm64`／`aarch64` 或 `x86_64`／`x64` 后缀。Windows NSIS 使用 `物谱_<版本>_x64-setup.exe`（也接受 Thingary 前缀），ARM64 命名使用 `arm64`；其他约定见 `src-tauri/src/update_check.rs` 的 installer。命名约定本身不证明对应平台／架构已发布或验收。调整命名必须同步匹配规则及测试，不靠模糊扩展名猜平台。

版本说明和附件必须位于同一严格 `vX.Y.Z` 发布中，附件名称版本一致、已上传完成且非空；每个镜像单独核对兼容包、固定仓库下载地址及文件散列。仅同步说明的镜像不会成为下载来源。列表按每源最近 30 条检查；不同平台长期错开发布时应保证其最新安装包仍在此范围内。保留已发布版本与附件，不把 CI artifact、源码归档或其他架构包作为安装推荐。
