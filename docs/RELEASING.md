# 发布流程

维护者用。从改版本号到发布安装包的步骤；自用安装的细节（停应用、暂存比对、回退副本）见 [CHANGELOG](../CHANGELOG.md) 里各次安装记录与 [T22 记录](verification/T22_SELF_USE_RELEASE_RESULT.md)。

## 1. 发版前

1. 版本号四处保持一致：`package.json`、`package-lock.json`（开头两处）、`src-tauri/Cargo.toml`（`Cargo.lock` 跟着变）、`src-tauri/tauri.conf.json`。发布配置 `tauri.release.conf.json` 不写版本，沿用基础配置。
2. 跑通门禁：`npm run build && npm run test:ui && npm run check && npm test`。
3. 更新 [CHANGELOG](../CHANGELOG.md)；依赖有变化时重新生成第三方许可证清单：`node scripts/third-party-licenses.mjs`。

## 2. 打包

```sh
npm run release            # 生成 src-tauri/target/release/bundle/macos/物谱.app
sh scripts/make-dmg.sh     # 打成 src-tauri/target/release/bundle/dmg/Thingary-<版本>-arm64.dmg，并输出 SHA-256
```

dmg 里是应用本身加「应用程序」快捷方式，用户拖入即可安装。

## 3. 签名与公证（公开分发建议做）

没有 Developer ID 签名与公证的包，别人首次打开会被 macOS 拦截（README 已写明绕过方法），但这对普通用户不友好，也让「来源可信」无从谈起。需要一个付费的 Apple Developer 账号（**这一步必须由你本人操作**，凭据不要放进仓库）。

按 [Tauri 官方文档](https://v2.tauri.app/distribute/sign/macos/)：

1. 在 Apple Developer 创建 **Developer ID Application** 证书，导入钥匙串；`security find-identity -v -p codesigning` 查到证书名称。
2. 设置环境变量后再打包，Tauri 会在构建时自动签名并公证应用：
   - 签名：`APPLE_SIGNING_IDENTITY`（证书名称）。
   - 公证二选一：`APPLE_ID`、`APPLE_PASSWORD`（专用密码）、`APPLE_TEAM_ID`；或 `APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`。
3. 然后照常 `npm run release`、`sh scripts/make-dmg.sh`。
4. 验证：`codesign --verify --strict --deep 物谱.app`、`spctl --assess --type execute -vv 物谱.app`、`xcrun stapler validate 物谱.app`。

这条路径没有实际走过（目前没有证书），第一次做时请逐步核对，并把结果补进本文。当前自用版使用本地临时签名，不能用于公开分发。

## 4. 发布

1. 推送并打标签：`git tag v<版本> && git push origin main v<版本>`（推送与公开仓库由你决定，见[发布前盘点第 10 节](RELEASE_AUDIT.md)）。
2. 在 GitHub 创建 Release，附上 dmg、SHA-256，说明「仅 Apple Silicon、macOS 27 验证」及是否已公证。
