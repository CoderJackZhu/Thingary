# 发布流程

维护者入口。用户安装与操作只看 [使用说明](USER_GUIDE.md)；任务状态见 [实施计划](IMPLEMENTATION_PLAN.md#public-distribution)，首发核验见 [交付验证记录](verification/FIRST_PUBLIC_RELEASE_20261004_RESULT.md)。

## 1. 确认版本和范围

首发使用 **2.6.1、Apple Silicon Mac、本地临时签名、未公证**。这是用户已选的分发路线；制作 DMG 不要求注册 Apple Developer。最低系统配置为 macOS 14，但只在 macOS 27 实测，不承诺其他系统或 Intel 可用。

版本号保持一致：`package.json`、`package-lock.json`（开头两处）、`src-tauri/Cargo.toml`、`Cargo.lock`、`src-tauri/tauri.conf.json`。发布配置不重复版本号，身份必须是 `local.thingary.main`，预览和验收身份不得作为正式安装包。

代码变更后运行 `npm run build`、`npm run test:ui`、`npm run check`、`npm test`。只改交付材料时执行相应脚本、文档和包检查，引用同一应用代码提交已经完成的工程回归，不把它冒充新的测试结果。更新 CHANGELOG 和对应 Release 正文；依赖变更时重新生成许可证清单并核对全文覆盖。

## 2. 构建与制作安装包

```sh
npm ci
npm run release
sh scripts/make-dmg.sh
```

产物位于 `src-tauri/target/release/bundle/dmg/`：

- `Thingary-<版本>-arm64.dmg`
- `SHA256SUMS.txt`，仅记录 DMG 的 SHA-256，不是来源认证签名

DMG 内含「物谱.app」、Applications 快捷方式、`开始使用.html`、使用说明图片和 `许可/`（GPL 全文、第三方声明与全文、来源和散列清单、名称图标使用边界、对应源码入口）。离线 HTML 由唯一权威 `docs/USER_GUIDE.md` 生成，不另行维护手抄说明；图片全部为虚构演示。

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

首发正文维护在 [2.6.1 Release 说明](releases/v2.6.1.md)。先推送最终源代码提交，在该提交创建 `v2.6.1` 标签和 **draft Release**，上传 DMG 与 SHA256SUMS；不要让标签指向未包含交付材料的旧提交。自动生成的 Source code 归档应对应这个标签，保留锁文件、构建脚本、文档和依赖源码获取入口。

在私有仓库中准备草稿不等于公开。确认公开时将**整个保留历史**纳入范围；发布前不得把只有本机安装记录或只有源码附件的状态写成“普通用户可下载”。公开后启用 [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)，发布草稿并以未登录方式检查 Release 附件、说明和下载入口，更新实施计划与验证记录。

若发现包错误，先隐藏或撤下有问题的发布，保留本地错误包和核验记录；修复后发布新补丁版本，不静默替换同版本附件。不要要求用户直接降级打开已经迁移的资料；说明恢复与旧版本兼容的升级前备份。
