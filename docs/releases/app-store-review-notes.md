# App Store 审核风险评估与提交备注（iOS）

本文件是提交 App Store 前的审核风险清单和审核备注草稿，不是已提交记录，也不代表 Apple 已认可任何判断。基于 2026-10-25 的源码、[发布流程](../RELEASING.md#ios)、[上架文案](app-store-listing.md)与 iOS 工程核对；**本次没有签名、上传、运行 TestFlight，也没有在真机验证**。凡标注“待验”的项目，在完成前都不能写成已通过。

## 1. 当前事实与边界

- 应用名「物谱」，Bundle ID `local.thingary.main`，仅 iPhone、竖屏、免费；开发预览仍是 `local.thingary.preview`。
- 本地优先：无账号、无开发者运营的云端、无广告、无统计、无第三方 SDK；物品、账户、备份等资料默认只在本机。
- 可选 WebDAV 同步：默认关闭，只连接用户自己配置的服务器；快照加密，设备名等清单元数据为明文；不做自动合并，冲突由用户选择。手机端同步页仍属实验性，真实云盘与真机验证未完成。
- 加密：Rust `age` 用于用户自己的备份与同步快照（X25519、ChaCha20-Poly1305，口令派生使用 scrypt）；不是只调用 Apple 系统加密。传输层取决于用户配置的 WebDAV 服务器与系统网络栈，建议只使用 HTTPS。
- 权限：相机拍物品照片、相册选图、面容 ID 可选应用锁、本地通知提醒；新增局域网 WebDAV 用途说明。通知没有对应的 Info.plist 用途键。
- 当前工程与发布脚本：`scripts/ios-archive.sh`（归档并导出 IPA）、`scripts/ios-upload.sh`（默认 dry-run，显式 `--really-upload` 才上传）。两者都不含真实 Team ID、Key ID、Issuer ID 或 `.p8`。

## 2. 逐条风险评估

### 2.1 App 完整性（Guideline 2.1）

**判断：代码与工程具备可运行基础，但尚未达到可提交状态。**

证据与理由：

- 不是空壳或网页套壳：有本地数据库、账户盘点、规划计算、物品档案、备份／恢复、加密备份、PDF 报告和本机通知等实际功能。
- 首次打开提供虚构样例，审核员不需要登录或测试账号即可看到主要界面。
- 但发布流程明确记录：真机拍照、相册多选、HEIC、面容 ID、后台模糊、三类通知实际送达、备份经「文件」分享与恢复、PDF 分享、键盘弹出后的表单操作等仍未验证；签名归档、App 记录、上传和 TestFlight 也未完成。

需要补的材料：

- [ ] Team ID、Bundle ID 注册、App Store Connect 应用记录。
- [ ] 签名归档与上传后的 TestFlight 构建；按[真机验收表](../RELEASING.md#ios)逐项记录构建号、iPhone／iOS 版本、结果和仓库外截图。
- [ ] 至少一台真机走完：样例 → 空白资料 → 物品拍照 → 账户盘点 → 备份／恢复 → 重启保留。只用虚构数据，不打开正式资料库。
- [ ] 崩溃、无网络、云盘不可达、权限被拒绝时的可恢复路径；不能有白屏或死循环。

### 2.2 最低功能（Guideline 4.2 Minimum Functionality）

**判断：通过风险较低，但仍需用真机证据支撑。**

- 应用提供的是本地记录与测算，不是单一静态页面、广告页或外部网站入口。账户盘点、目标测算、物品档案、备份恢复和报告导出构成可独立使用的完整流程。
- 没有登录、订阅、付费墙或必须联网才能使用的核心路径；默认离线可用，可选同步关闭时不影响主要功能。
- 审核备注应直接告诉审核员从「先看看样例」开始，并列出 3–4 个可操作入口，避免审核员只看到空白页或样例而误判为演示壳。

需要补的材料：

- [ ] 审核备注中的样例路径与主要功能步骤（见第 4 节英文草稿）。
- [ ] 截图必须来自真实应用画面，不能用设计稿或网页预览代替。

### 2.3 数据收集与隐私（Guideline 5.1.1）

**判断：按“开发者不收集数据”方向准备是合理的，但必须把“默认离线”和“可选同步”说清楚，不能写成“从不联网”。**

- 没有账号体系，开发者不运营接收用户资料的服务器；没有广告、统计、跟踪或第三方分析 SDK。`PrivacyInfo.xcprivacy` 当前声明 `NSPrivacyTracking=false`，`NSPrivacyCollectedDataTypes` 为空。
- 可选 WebDAV 同步由用户填写服务器地址与凭据，数据发送到用户自己选择的服务端；开发者不接收、不访问。快照加密，但设备名等清单元数据为明文，这一点应在隐私说明中保留，不能宣称“全链路无明文元数据”。
- 资料默认保存在应用容器；删除 App 会删除本机资料，用户可通过完整备份自行留存。`UIFileSharingEnabled` 与 `LSSupportsOpeningDocumentsInPlace` 为 true，是为了让用户在「文件」App 中取得备份；审核备注要说明这是有意设计，不是把全部资料无条件公开。
- 面容 ID 只用于本机应用锁，生物识别信息不进入物谱；相机与相册仅用于用户主动选择的物品照片；通知为本机提醒。
- App 隐私标签拟选「不收集数据」（Data Not Collected）。这是基于“开发者不接收数据”的理解，提交前仍需对照 Apple 的定义和实际构建再确认；如果 Apple 或合规认为用户自备服务器的传输也算开发者收集，则应按实际调整，不能硬填“不收集”。

需要补的材料：

- [ ] 隐私政策页 `https://thingary.jackzhu.top/privacy/` 已部署、未登录可访问，内容与当前构建一致。
- [ ] 隐私政策明确写出：本地存储、可选 WebDAV、加密快照、明文元数据、备份与删除方式、联系方式。
- [ ] 权限用途字符串与实际行为一致；拒绝相机／相册／面容 ID／通知后应用仍可使用其他功能。
- [ ] 上传后留意 App Store Connect 的 ITMS-91053 邮件，按实际类别补充 `PrivacyInfo.xcprivacy`。

### 2.4 元数据准确性（Guideline 2.3）

**判断：当前上架文案存在需要先修正的绝对化表述。**

[上架文案](app-store-listing.md)里“没有账号，资料默认只在你的手机里，不联网”和宣传文本中的“不联网”容易被理解为应用从不访问网络；但源码已有默认关闭的可选 WebDAV 同步。审核员若发现设置里有同步页，可能按元数据不准确处理。

建议改成：

- 宣传文本／描述：`没有账号，资料默认只保存在你的手机里；可选的 WebDAV 同步默认关闭，只连接你自己配置的服务器。`
- 保留“没有联网行情、没有 AI、没有开发者运营的云端、没有广告和统计”等可核实表述。
- 不要把“默认不联网”简写成“不联网”，也不要把可选同步写成已默认启用或已真机验证。
- 截图只展示真实 iPhone 界面；应用仅 iPhone、竖屏，不需要 iPad 截图。
- 支持网址、隐私政策网址、营销网址在提交前必须可访问；年龄分级按问卷实际填写，当前建议 4+，但不得把规划结果描述为投资建议。
- 应用名「物谱」被占用时用「物谱 Thingary」，不要使用他人商标或竞品名。

需要补的材料：

- [ ] 按上面句子修正文案，并由维护者复核字数限制。
- [ ] 截图、预览、描述、关键词与实际构建逐项对照；删掉未实现或未验证的功能描述。
- [ ] 确认 App Store Connect 中的销售范围已取消中国大陆，并留存截图。

## 3. 可选同步与用户自备服务器怎么向审核说明

审核不需要开启同步，也不应被要求提供真实服务器或凭据。建议在审核备注中写明：

- 应用完整支持离线使用，首次打开即可用虚构样例体验；同步不是核心功能的必要条件。
- WebDAV 同步默认关闭。开启后只连接用户自己填写的服务器地址，使用用户自己的凭据；开发者不提供同步服务、不建立账号、不接收快照。
- 快照在离开设备前用用户口令加密；设备名等清单元数据为明文。冲突不自动合并，由用户选择保留哪一边。
- 如果审核人员需要验证同步，请使用其自己的测试 WebDAV 服务器和虚构资料；仓库和提交材料不包含任何共享服务器、账号或密钥。
- 手机端同步仍属实验性，真实云盘与真机验证未完成；在完成前不要把同步写成稳定卖点或默认能力。

## 4. 出口合规与加密

**当前 `Info.plist` 不写 `ITSAppUsesNonExemptEncryption`。** 这样做会保留首次上传时的出口合规问卷，避免在未确认前把豁免写成既定事实。

建议按以下事实回答，最终由维护者／合规确认后固化为键或上传文档：

- 问题“是否使用加密”：**是**。应用内使用标准算法保护用户自己的备份与同步快照：X25519、ChaCha20-Poly1305，口令派生使用 scrypt；传输使用用户配置的 WebDAV 服务器与系统网络能力，建议 HTTPS。
- 用途：仅用于保护用户自己的资料、用户自己创建的备份，以及用户自选服务器之间的传输；不提供 VPN、不提供第三方保密通信服务、不做加密挖矿或支付。
- 是否属于豁免：**不能仅因为“用的是标准算法”就选豁免。** 当前是应用内实现的 age 加密，不是只调用 Apple 系统加密；更稳妥的初步判断是按“使用非豁免加密”准备，按 App Store Connect 实际问卷提交自分类报告或其他要求的文档。若维护者／合规确认符合豁免条件，才可把 `ITSAppUsesNonExemptEncryption` 设为 `false`；在确认前不要设成 `false`，也不要编造文档编号。
- 如果问卷要求上传文档，按 Apple 流程提交；提交后在 PR／放行单记录问题、选项、答案和截图，不把密钥或账号信息写进仓库。

参考：[出口合规概览](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)、[判定与上传加密文档](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation)。

## 5. 隐私清单与 Info.plist 核对

### PrivacyInfo.xcprivacy

当前包内清单声明：

| 类别 | 理由代码 | 说明 |
|---|---|---|
| 文件时间戳 `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1`、`3B52.1` | 备份／图片／导入文件的容器内时间戳，以及用户经文件选择器授予的文件 |
| 系统启动时间 `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | 应用内经过时间、超时与重试间隔 |
| 磁盘空间 `NSPrivacyAccessedAPICategoryDiskSpace` | `E174.1` | SQLite 打开数据库时检查可用空间 |
| 用户默认设置 `NSPrivacyAccessedAPICategoryUserDefaults` | 未声明 | 未发现调用；偏好保存在资料目录文件 |
| 活动键盘 `NSPrivacyAccessedAPICategoryActiveKeyboards` | 未声明 | Release 未发现调用 |

- `NSPrivacyTracking=false`，`NSPrivacyTrackingDomains` 与 `NSPrivacyCollectedDataTypes` 为空。
- 网络访问本身不属于需要 reason code 的 required-reason API；可选 WebDAV 不改变“开发者不收集数据”的清单结构，但隐私标签仍需按实际口径确认。
- 这些结论沿用 2026-10-22 的 Release 归档符号核对；本次没有重新构建或重新扫描二进制。签名后仍需在 Xcode Organizer 生成 Privacy Report，并核对包内清单。

### Info.plist / 工程

| 项目 | 当前值 | 判断 |
|---|---|---|
| 相机 | `NSCameraUsageDescription` | 有，文案与拍物品照片一致 |
| 相册 | `NSPhotoLibraryUsageDescription` | 有；只读选图，不需要 `NSPhotoLibraryAddUsageDescription` |
| 面容 ID | `NSFaceIDUsageDescription` | 有；本机应用锁，生物识别信息不进入应用 |
| 局域网 | `NSLocalNetworkUsageDescription` | 已补；用于用户自备的局域网 WebDAV 服务器 |
| 通知 | 无 Info.plist 用途键 | 正确；使用系统通知授权 |
| 文件共享 | `UIFileSharingEnabled=true`、`LSSupportsOpeningDocumentsInPlace=true` | 有意开启，便于在「文件」中取得／恢复备份；审核备注需说明 |
| 最低系统 | iOS 16.0 | 与工程 `IPHONEOS_DEPLOYMENT_TARGET` 一致；提交前按实际支持范围复核 |
| 设备 | `TARGETED_DEVICE_FAMILY=1`、仅竖屏 | 仅 iPhone；不提供 iPad 截图 |
| 出口合规键 | 未写 `ITSAppUsesNonExemptEncryption` | 见第 4 节；确认前不写 |

## 6. 审核备注草稿（App Store Connect，英文）

> Thingary is a local-first personal inventory and net-worth planner. It does not require an account, a login, or a developer-operated server. On first launch you can open the built-in fictional sample library and try the main screens without creating data.
>
> Core features work offline: item records and photos, account balances and check-ins, planning calculations, backups/restore, and PDF report export. Camera and photo-library access are used only when the user adds item photos. Face ID is used only for the optional app lock; biometric data never enters the app. Notifications are local reminders. `UIFileSharingEnabled` is intentional so users can retrieve their backup files from the Files app.
>
> Optional WebDAV sync is off by default. If enabled, it connects only to a server URL and credentials the user enters; the developer does not operate a sync service, receive snapshots, or have an account system. Snapshots are encrypted with the user's passphrase; device-name and similar manifest metadata are plaintext. The reviewer does not need to enable sync to review the app. If sync must be tested, please use your own test WebDAV server with fictional data; no shared server or credentials are provided.
>
> The app contains no ads, analytics, tracking, or third-party SDKs. Encryption is used only to protect the user's own backups and sync snapshots; see the export-compliance answer for details.
>
> Support: https://thingary.jackzhu.top/guide/ · Privacy: https://thingary.jackzhu.top/privacy/

## 7. 提交前阻断项

- [ ] 取得 Team 权限，注册 Bundle ID `local.thingary.main`，在 App Store Connect **网页**创建应用记录（公开 API 不能创建应用记录）。
- [ ] 用 `APPLE_TEAM_ID` 完成签名归档和导出；`ExportOptions.plist` 的 method 已改为 `app-store-connect`。
- [ ] 用 `scripts/ios-upload.sh` 先 dry-run，再由维护者显式上传；不在本任务中上传。
- [ ] TestFlight 内部测试通过后再申请外部测试；外部测试需要 Beta App Review。
- [ ] 真机验收表逐项完成，未验项如实登记，不用模拟器或构建成功代替。
- [ ] 生成 Privacy Report，确认无 ITMS-91053 遗漏；确认 App 隐私标签。
- [ ] 出口合规问卷答案经维护者／合规确认，再决定是否写 `ITSAppUsesNonExemptEncryption`。
- [ ] 修正上架文案中的绝对化“不联网”表述，确认隐私政策页和支持页可访问。
- [ ] 以朋友账号发布时，开发者显示为他们；取得书面同意，账号协议、税务、银行和审核邮件都由账号持有人处理。
- [ ] 未经 Jack 明确授权，不点“提交以供审核”，不发布。
