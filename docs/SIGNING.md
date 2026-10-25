# Windows 代码签名接入（SignPath）

本文只覆盖 Windows 的 Authenticode 签名；macOS 的 Developer ID 与公证是另一条路线，见[发布流程](RELEASING.md)。公开的签名政策、审批与申请检查表见 [Windows 代码签名政策](CODE_SIGNING.md)。

## 当前状态

- 已向 SignPath Foundation 发邮件询问免费签名，截至 2026-10-25 尚无回应，尚未在正式申请页提交。
- 公开 Windows 包仍是**未签名** NSIS；SmartScreen 可能提示，智能应用控制可能直接拦截。
- 仓库已准备好签名状态元数据与验签脚本，但**没有**接入真实签名服务，也没有保存任何证书或令牌。
- SignPath 是否批准不阻塞发布；未签名路线可以继续。批准后再加签名步骤，不重做打包流程。

## 签名目标

一次合格的 Windows 发布必须同时签两个文件：

1. `thingary.exe`（应用 payload）
2. `Thingary_<版本>_x64-setup.exe`（NSIS 安装包）

**不能只签安装包。** 安装包里的 payload 仍是未签名文件，智能应用控制、企业策略和部分安全软件仍会拦截。签名顺序必须是：

```text
构建 payload
  → 签 thingary.exe
  → 用已签名的 payload 打 NSIS
  → 签 NSIS 安装包
  → 分别验签
```

Tauri 的 `signCommand` 可以在打包过程中签 payload；如果使用 SignPath 的远程签名，建议用 `tauri build --no-bundle` 构建、签 payload、再 `tauri bundle --bundles nsis`，最后签安装包。具体命令以接入时的 Tauri/SignPath 文档为准。

## 需要准备的配置

以下名称是建议值，最终以 SignPath 项目和 GitHub Action 的输入为准：

| 类型 | 名称 | 用途 |
|---|---|---|
| GitHub secret | `SIGNPATH_API_TOKEN` | 提交签名请求；只放在 Actions secrets，不写入仓库或日志 |
| GitHub variable/secret | `SIGNPATH_ORGANIZATION_ID` | SignPath 组织 ID |
| GitHub variable | `SIGNPATH_PROJECT_SLUG` | SignPath 项目 |
| GitHub variable | `SIGNPATH_SIGNING_POLICY_SLUG` | 签名策略 |
| GitHub variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | 产物配置（payload / installer 两个请求） |

同时建议在 README 或本文保留 SignPath Foundation 要求的一行声明：

```text
Free code signing provided by SignPath.io, certificate by SignPath Foundation.
```

不要把证书、PFX、密码、API token 或签名产物提交到仓库。签名请求只从标签或受保护分支的 CI 构建发起，不从本机临时包发起。

## 接入后的工作流改动

### 1. 构建与签名顺序

在 `windows-package.yml` 的 release 路线和 `release-draft.yml` 的 Windows job 中：

1. 构建 payload（`tauri build --no-bundle` 或等价的 Tauri 配置）。
2. 调用 SignPath 签 `thingary.exe`，等待完成并取回已签名文件。
3. 用已签名 payload 打 NSIS。
4. 调用 SignPath 签安装包。
5. 运行验签脚本，两个文件都必须通过。

两个签名请求可以复用同一个 artifact configuration，也可以分开配置；关键是**安装包必须在 payload 签名之后生成**。

### 2. 状态开关

当前两个工作流都通过环境变量控制状态：

```yaml
env:
  THINGARY_WINDOWS_SIGNING_STATUS: unsigned
  EXPECTED_WINDOWS_SIGNATURE: Unsigned
```

签名接入后改为：

```yaml
env:
  THINGARY_WINDOWS_SIGNING_STATUS: signed
  EXPECTED_WINDOWS_SIGNATURE: Signed
```

`windows-package.yml` 的 acceptance 矩阵必须保持 `signing: unsigned`，只把 release 矩阵改成 `signed`。验收包不能使用正式签名身份。

### 3. 验签

新增脚本 `scripts/verify-windows-signature.ps1` 已同时检查 payload 和安装包：

```powershell
pwsh -NoProfile -File scripts/verify-windows-signature.ps1 `
  -Payload src-tauri/target/x86_64-pc-windows-msvc/release/thingary.exe `
  -Installer src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Thingary_<版本>_x64-setup.exe `
  -Expected Signed `
  -ExpectedSubjectContains "SignPath Foundation" `
  -RequireTimestamp
```

- `-ExpectedSubjectContains` 和 `-RequireTimestamp` 按 SignPath 实际证书与时间戳配置决定；不确定时先不加，只要求 `Status = Valid`。
- `BUILD_INFO.json` 的 `signing_status` 必须是 `signed`，且与实际验签结果一致。
- 签名后安装包 SHA-256 会变化，必须重新生成 `SHA256SUMS.txt` 和 winget 清单，不能沿用签名前的值。

## 验收与发布检查

签名接入后，除原有 Windows 验收外，还要记录：

- payload 与安装包的 `Get-AuthenticodeSignature` 状态、签名主体、时间戳。
- 从公开 Release 下载后，SmartScreen 是否仍提示；签名不保证立刻建立信誉。
- 安装、开始菜单、卸载保留资料、重装后资料仍在。
- `BUILD_INFO.json`、`SHA256SUMS.txt`、winget 清单与实际安装包 SHA 一致。
- 签名后的包不能再用“未签名”文案；README、发布说明、用户指南要同步。

## 如果 SignPath 不批准

不影响继续发布未签名版本。可选替代：

1. **Microsoft Store MSIX**：Store 代签，免费；但 Tauri 需要第三方 MSIX 打包，且要测容器文件路径。
2. **Azure Artifact Signing**：约 $9.99/月，个人资格受地区限制。
3. **OV 代码签名证书**：约 $150–300/年，当前阶段不建议。
4. **继续未签名 + 校验和 + 安装排查**：成本最低，但 SmartScreen 和智能应用控制限制仍在。

不要为了消除提示而建议用户关闭整机安全保护；这比未签名更危险。
