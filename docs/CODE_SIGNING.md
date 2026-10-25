# Windows 代码签名政策（SignPath Foundation）

本文是申请 SignPath Foundation 免费 Windows 代码签名的公开政策与准备清单。签名接入的技术步骤、验签脚本和回退方案见 [SIGNING.md](SIGNING.md)；版本冻结与发布放行见 [RELEASING.md](RELEASING.md#release-lifecycle)。

**当前状态：已于 2026-10-25 在 SignPath Foundation 官网提交申请，等待审核；尚未获得签名。** 本文不表示签名已经生效；已发布安装包是否签名，以对应版本的 Release 说明和实际验签结果为准。

## 当前状态

- 维护者已向 SignPath Foundation 发邮件询问，并于 2026-10-25 在官网提交了正式申请，等待审核；尚未获得签名。
- 本仓库当前公开的 Windows x64 NSIS 安装包仍是**未签名**包，SmartScreen 或 Windows 11 智能应用控制可能提示或拦截。
- 仓库没有保存任何签名证书、PFX、私钥、密码或 SignPath API token。
- 未获批准不阻塞现有发布；启用签名后按 [RELEASING.md](RELEASING.md#release-lifecycle) 重新验包并更新说明。

## 签名范围

签名只覆盖同时满足以下条件的 Windows x64 产物：

1. `Thingary_<版本>_x64-setup.exe`（NSIS 安装包）；
2. 该安装包内的 `thingary.exe`（应用 payload）。

并且：

- 由 `CoderJackZhu/Thingary` 仓库的 GitHub Actions 在 GitHub 托管的 Windows x64 运行器上构建；
- 构建输入是本仓库的公开提交，来自版本标签 `v*` 或维护者触发的正式发布构建；
- 产物经过本仓库的包内容核验与验签脚本检查。

不签：

- macOS DMG（仍为本地临时签名、未公证）、Android APK（使用项目自己的发布密钥）、iOS 包；
- 开发者在本地、其他 CI、fork、PR 分支或第三方转存／镜像中重新构建的文件；
- 用户提交的 exe、驱动、安装器或其他二进制；
- 任何包含真实用户资料、备份、数据库、照片、序列号或凭据的产物。

Gitee 镜像只分发 GitHub Release 中的同一份文件，不重新打包或重新签名；签名启用后也沿用同一份已签名文件。签名不改变版本号、资料格式或应用功能；签名后文件散列会变化，必须重新生成 `SHA256SUMS.txt` 和 winget 清单。

## 谁可以批准签名

- 签名请求必须由本仓库维护者指定的**签名审批人**批准。授权名单待维护者填写（建议写 GitHub 用户名或组织团队名，并与 SignPath 中的角色对应）。
- 外部贡献者、PR 作者、fork 维护者、镜像维护者和下载用户不能批准签名。
- 审批人必须在批准前核对：请求来自本仓库、对应的工作流运行、提交或标签、版本号、产物名称与摘要，以及产物确实由该次 CI 构建。无法核对或来源不明的请求应拒绝。
- 签名审批与发布放行是两道独立检查；批准签名不等于授权公开发布。

## 签名内容与来源限制

- 只签本仓库 GitHub Actions 产出的 Windows 安装包及其 payload，不签其他来源。
- 签名请求只从本仓库的工作流发起，不从本机、个人脚本、PR fork 或第三方 CI 发起。
- 签名后的产物不得再被重新打包、替换或修改；如需改名，必须确认 Authenticode 签名仍有效，并重新生成校验文件。
- SignPath API token 只存放在 GitHub Actions secrets，不写入仓库、日志、构建产物或文档。证书和私钥不进入本仓库。

## 隐私说明

- 签名流程只向 SignPath 提交待签名的构建产物和必要的构建元数据（例如仓库、提交或标签、工作流运行、产物摘要）。
- 不提交用户资料库、完整备份、照片、序列号、账户信息、凭据或任何真实个人数据。开发、测试和验收只使用虚构样例；构建产物只包含应用、许可与构建信息。
- 应用本身的数据处理与联网行为见[隐私与资料安全](USER_GUIDE.md#privacy)和[安全政策](../SECURITY.md)。签名服务是独立第三方，其自身隐私政策适用于 SignPath 处理的数据。
- 仓库历史与构建日志不得包含令牌、证书、密码或用户资料。

## 联系方式

- 一般问题、申请状态和签名范围疑问：通过仓库 Issues <https://github.com/CoderJackZhu/Thingary/issues>。
- 安全或凭据问题：按[安全政策](../SECURITY.md)私下报告，不要公开贴出令牌、证书或可利用细节。
- 审批人名单、SignPath 组织／项目／策略标识：待维护者填写。

## 获批后的公开声明

只有签名实际启用并通过验签后，才在 README、Release 说明或关于页写“已签名”。届时按 SignPath 的要求保留署名声明：

```text
Free code signing provided by SignPath.io, certificate by SignPath Foundation.
```

在此之前不要写“已签名”“已通过 SignPath”或类似表述。

## 需要改的自动化构建位置

以下只给位置与建议，供后续接入；当前工作流仍保持未签名。

### `windows-package.yml`

- **触发与矩阵（约第 25–42 行）**：release 矩阵的 `signing: unsigned` 改为 `signed`，acceptance 矩阵保持 `unsigned`。`THINGARY_WINDOWS_SIGNING_STATUS` 与 `EXPECTED_WINDOWS_SIGNATURE` 已由矩阵派生，改矩阵即可，但两者必须一致。
- **PR 来源限制（约第 4–15、47–50 行）**：工作流也会在 `pull_request` 上运行并 checkout PR head。签名步骤必须只对受信任的版本标签或维护者手动触发的正式发布构建运行，不能让 PR 作者通过修改工作流或产物获得签名。建议给签名步骤加 job／step 级 `if`，PR 构建保持 unsigned。
- **构建顺序（约第 78–85 行）**：现在 `npm run release:win` 一次完成 payload 构建和 NSIS 打包。签名需要拆成：先只构建 payload（`--no-bundle`），把 `thingary.exe` 提交 SignPath 并取回；替换 payload 后再打 NSIS；最后提交安装包签名。不能只签安装包。
- **改名与校验（约第 82–85、120–132 行）**：`normalize-windows-installer.mjs` 会把安装包改成公开名称并重写校验值。签名会改变文件散列，必须在签名后重新生成 `SHA256SUMS.txt`，不能沿用签名前的值；确认改名不破坏 Authenticode 签名。
- **验签（约第 90–115 行）**：签名后同时核验 payload 和安装包，`verify-windows-signature.ps1` 使用 `-Expected Signed`；按实际证书决定是否加 `-ExpectedSubjectContains` 和 `-RequireTimestamp`。`BUILD_INFO.json` 的 `signing_status` 必须是 `signed`。
- **权限与凭据（约第 17–18 行）**：按 SignPath GitHub Action 的要求补 `permissions`（例如读取工作流／运行信息），`SIGNPATH_API_TOKEN` 只通过 `secrets` 传入；不要把 token 放在 env 的明文或 artifact 中。
- **产物上传（约第 120–132 行）**：上传签名后的安装包、校验值、验签输出和包核验 JSON；不要用未签名文件覆盖同名产物。

### `release-draft.yml`

- **Windows job 环境（约第 198–202 行）**：正式发布时把 `THINGARY_WINDOWS_SIGNING_STATUS` 改为 `signed`、`EXPECTED_WINDOWS_SIGNATURE` 改为 `Signed`；两者必须与实际验签和 `BUILD_INFO.json` 一致。
- **构建顺序（约第 232–246 行）**：与上一个工作流相同，先构建并签 payload，再打 NSIS，最后签安装包；现有注释已描述这个顺序，接入后同步更新注释和步骤名。
- **winget 清单（约第 247–259 行）**：必须在签名和重新生成校验值之后生成，否则清单记录的是未签名文件的 SHA-256。
- **产物上传（约第 268–276 行）**：上传已签名安装包和新的 `SHA256SUMS.txt`；草稿附件步骤沿用现有逻辑，不需要重新打包。
- **权限与来源（约第 29–34、204–210 行）**：保持只从本仓库标签或手动指定标签构建；按 SignPath Action 要求补权限，token 只放 secrets。

### 相关脚本与配置

- `src-tauri/tauri.windows.release.conf.json` 的 `beforeBuildCommand` 会运行 `prepare-windows.mjs`；签名构建需设置 `THINGARY_WINDOWS_SIGNING_STATUS=signed`，使 `BUILD_INFO.json` 的 `signing_status` 与实际一致。
- `scripts/verify-windows-package.mjs` 已支持 `unsigned`／`signed` 状态，签名后继续用它核验包内容和 `BUILD_INFO.json`。
- `scripts/verify-windows-signature.ps1` 已支持 payload 与安装包双验签；签名后不要只验安装包。
- `scripts/generate-winget-manifest.mjs` 在签名后运行，避免沿用未签名散列。
- 不新增本地签名脚本、私钥或证书；签名只通过 CI 和 SignPath 完成。

## 待维护者补充

- 签名审批人名单，以及他们在 SignPath 中的角色。
- SignPath 组织 ID、项目、签名策略和产物配置的实际名称；建议名称见 [SIGNING.md](SIGNING.md)。
- 是否在官网首页页脚增加本政策链接；目前只有 README 入口。
- 正式申请的提交日期与结果；获批后补充证书主体、时间戳要求和启用日期。

## 申请检查表

| 检查项 | 当前情况 | 结论／待办 |
|---|---|---|
| OSI 认可的许可证 | AGPL-3.0-or-later，见 [LICENSE](../LICENSE) | 符合 |
| 仓库公开 | `CoderJackZhu/Thingary` 公开仓库 | 符合 |
| 可下载的已发布版本 | v0.0.8 Release 提供 Windows x64 安装包与 `SHA256SUMS.txt` | 符合 |
| 自动化构建 | GitHub Actions 构建，但签名步骤尚未接入 | 部分符合；见上文“需要改的自动化构建位置” |
| 项目主页政策链接 | README 已链接本文；官网首页页脚暂无 | 部分符合；网站页脚待维护者决定是否补 |
| SignPath 正式申请 | 2026-10-25 已在官网提交 | 等待审核；收到回复后按下文改构建流程 |
| 签名审批人名单 | 未指定 | 待维护者填写 |
| SignPath 组织／项目／策略／产物配置 | 未配置 | 待维护者填写 |
| 仓库内签名密钥／证书／token | 无 | 符合；以后只放 Actions secrets |
| 签名后验签 | 尚未执行 | 待签名启用后按 [SIGNING.md](SIGNING.md) 执行 |
| 公开说明同步 | 当前统一写“申请中／未签名” | 签名启用后更新 README、Release 与使用指南 |

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-25 | 初稿：申请准备、签名范围、审批、隐私与检查表；尚未提交申请，尚未启用签名。 |
