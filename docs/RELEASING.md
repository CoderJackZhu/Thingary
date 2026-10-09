# 发布流程

维护者入口。用户安装与操作只看 [使用说明](USER_GUIDE.md)；文档职责见[文档维护](MAINTAINING.md)。详细执行记录在维护者的私有笔记中引用公开提交号，不作为构建输入。

## 1. 确认版本和范围

当前公开版本为 **0.0.2、Apple Silicon Mac、本地临时签名、未公证**；GitHub 必须标记为 Pre-release。后续发布先确定版本与支持范围；制作 DMG 本身不要求注册 Apple Developer。最低系统配置为 macOS 14，但只在 macOS 27 实测，不承诺其他系统或 Intel 可用。

版本号保持一致：`package.json`、`package-lock.json`（开头两处）、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。发布配置不重复版本号，身份必须是 `local.thingary.main`，预览和验收身份不得作为正式安装包。

代码变更后运行 `npm run build`、`npm run test:ui`、`npm run check`、`npm test`。只改交付材料时执行相应脚本、文档和包检查，引用同一应用代码提交已经完成的工程回归，不把它冒充新的测试结果。更新 CHANGELOG 和对应 Release 正文；依赖变更时重新生成许可证清单并核对全文覆盖。

发布前按[截图维护清单](images/README.md)刷新主图与功能操作图，核对 README、指南和活跃设计中的发布状态；先生成并检查离线指南再制包。发版后的在线文档修订不改变已经发布的 DMG，新增说明随下一版打包。

发版核对[第三方告知](../SOURCE_NOTICES.md)、依赖许可、对应源码与最终包的一致性。

### 升级兼容性

每次发布检查资料身份、数据库 schema／迁移、备份格式、已有素材 ID 与设置键。用前一版在隔离身份下生成虚构资料，再以同身份新包打开并重启，比对物品、心愿、账户、金额、未知值、关联、图片和已有保障；验证旧版完整备份恢复。不得在正式资料库做验收。涉及迁移时增加对应旧 schema 夹具及恢复测试，说明可逆性和降级边界。仅替换应用包应保留资料目录；较低的应用版本编号不代表数据格式降级。

## 2. 构建与制作安装包

```sh
npm ci
npm run release
sh scripts/make-dmg.sh
```

产物位于 `src-tauri/target/release/bundle/dmg/`：

- `Thingary-<版本>-arm64.dmg`
- `SHA256SUMS.txt`，仅记录 DMG 的 SHA-256，不是来源认证签名

DMG 内含「物谱.app」、Applications 快捷方式、`开始使用.html`、使用说明图片和 `许可/`（GPL 全文、第三方声明与全文、来源和散列清单、直接内置内容告知、名称图标使用边界、对应源码入口）。离线 HTML 由唯一权威 `docs/USER_GUIDE.md` 生成，不另行维护手抄说明；图片全部为虚构演示。

`make-dmg.sh` 检查身份、arm64 架构、版本和严格签名；`distribution-notices.mjs` 从锁定依赖和 `license-overrides/manifest.json` 收集全文，缺失或散列错误即失败。后者离线运行，不在打包时下载许可证。先安装锁定 npm 依赖并准备 Cargo 缓存；补充文本来源与升级办法见 [说明](../scripts/license-overrides/README.md)。Rust 清单保守包含构建依赖，不能把清单数量当成二进制中实际链接数量。

本地临时签名能检验包的完整性，**不等于 Developer ID，也不保证 Gatekeeper 放行**。安装步骤采用 [Apple 官方的单应用允许打开方法](https://support.apple.com/zh-cn/102445)，无需全局关闭安全保护或让普通用户运行终端命令。若以后采用 Developer ID 与公证，单独依据 [Tauri 官方说明](https://v2.tauri.app/distribute/sign/macos/) 配置证书与凭据、重建包并重新验收；不沿用本路线的未公证声明。凭据不入库。

## 3. 核验交付物

1. 挂载 DMG 为只读，核对内容、Applications 指向、版本、身份、架构和 `codesign --verify --strict --deep`；比对挂载包与原始构建包的全部文件及符号链接。
2. 把挂载包复制到临时目录，再比对签名和文件，证明拖拽复制不会破坏应用。**不启动正式身份包，不碰真实库**。
3. 检查 HTML 图片与内部锚点；离线阅读安装、建档、盘点和备份说明。DMG 中不能出现数据库、备份、测试资料或凭据。
4. 用同代码、全新隔离身份和虚构资料走查：首次样例 → 自己的资料 → 物品 → 账户 → 完整盘点 → 备份／恢复 → 重启保留。
5. 明确记录未做的步骤。浏览器截图不能代替原生验收；本地挂载与隔离启动不能证明真实下载后的 Gatekeeper 首开、其他 Mac 或其他系统版本兼容。
6. 在最终提交上复查 CI、README、版本与 Release 正文；核对 DMG 文件大小与 SHA-256。附件从 GitHub 回读后应与本地散列一致。

## 4. Release 草稿与公开

每次发布在 `docs/releases/v<版本>.md` 维护正文，现有示例为[0.0.2 发布说明](releases/v0.0.2.md)。先推送最终源代码提交，在该提交创建 `v<版本>` 标签和 **draft Release**，上传 DMG 与 SHA256SUMS；公开测试版设置 Pre-release（即使版本号不带 beta 后缀），README 直接链接对应版本，不能依赖只返回正式版的 latest 入口。不要移动已经发布的标签或覆盖现有附件。自动生成的 Source code 归档应对应这个标签，保留锁文件、构建脚本、文档和依赖源码获取入口。

草稿不等于已公开。发布前核对源代码、完整许可材料和支持边界，确保 [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) 可用。取得本次发布授权后发布草稿，以未登录方式检查说明、附件和下载入口；不要把仅本机安装或只有源码附件写成“普通用户可下载”。把最终源码 SHA、标签、附件散列和验证边界登记到私有笔记。

公开仓库保留历史，移出 main 的文件仍可从历史查看。发布从公开源码标签构建，不从私有笔记仓库打包；编号重排也必须以同版本源码重新构建，不能只改附件名；版本变化不重置资料身份、schema 或备份格式。已撤下的包、元数据和对应源码私有保全，不宣称能收回他人已下载的副本。

若发现包错误，先隐藏或撤下有问题的发布，保留本地错误包和核验记录；修复后发布新补丁版本，不静默替换同版本附件。不要要求用户直接降级打开已经迁移的资料；说明恢复与旧版本兼容的升级前备份。
