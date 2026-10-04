#!/bin/sh
# 把 `npm run release` 生成的「物谱.app」打成 dmg（拖到「应用程序」即可安装）。
# 用法：npm run release && sh scripts/make-dmg.sh
# 产物：src-tauri/target/release/bundle/dmg/Thingary-<版本>-arm64.dmg
# 首发路线：本地临时签名、未公证；说明与核验见 docs/RELEASING.md。
set -eu
cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/物谱.app"
[ -d "$APP" ] || { echo "找不到 $APP，请先运行 npm run release" >&2; exit 1; }
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")
IDENTITY=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Contents/Info.plist")
EXECUTABLE=$(/usr/libexec/PlistBuddy -c "Print CFBundleExecutable" "$APP/Contents/Info.plist")
[ "$IDENTITY" = "local.thingary.main" ] || { echo "拒绝打包隔离或预览身份：$IDENTITY" >&2; exit 1; }
[ "$(lipo -archs "$APP/Contents/MacOS/$EXECUTABLE")" = "arm64" ] || { echo "arm64 安装包需要纯 arm64 应用" >&2; exit 1; }
node -e 'const fs=require("fs");const v=process.argv[1];if(v!==JSON.parse(fs.readFileSync("package.json")).version||v!==JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json")).version)throw Error("应用版本与源码不一致")' "$VERSION"
codesign --verify --strict --deep "$APP"
OUT="src-tauri/target/release/bundle/dmg"
DMG="$OUT/Thingary-$VERSION-arm64.dmg"
TEMP_DMG="$OUT/.Thingary-$VERSION-$$.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"; rm -f "$TEMP_DMG"' EXIT
mkdir -p "$OUT"
ditto "$APP" "$STAGE/物谱.app"
ln -s /Applications "$STAGE/Applications"
node scripts/offline-guide.mjs "$STAGE"
node scripts/distribution-notices.mjs "$STAGE/许可"
cp LICENSE THIRD_PARTY_LICENSES.md "$STAGE/许可/"
cat > "$STAGE/许可/许可与源码.txt" <<EOF
物谱 Thingary $VERSION

程序代码按 GPL-3.0-or-later 授权。完整许可证见 LICENSE。
本版本对应源码（含构建说明及锁定依赖）在同一 GitHub Release 的 Source code 附件：
https://github.com/CoderJackZhu/Thingary/releases/tag/v$VERSION
https://github.com/CoderJackZhu/Thingary/tree/v$VERSION
第三方依赖的声明、作者信息与许可证全文见 THIRD_PARTY_NOTICES.txt；
逐份许可证的来源与 SHA-256 见 license-inventory.json。

名称「物谱」「Thingary」及应用图标的使用权保留，不在 GPL 授权范围内。
再发布修改版请换用自己的名称与图标，避免与官方版本混淆。
第三方许可证文本遵循其原有许可。

首发只提供 Apple Silicon Mac 安装包；未经 Developer ID 签名与 Apple 公证。
首次打开与资料保护步骤见安装包根目录「开始使用.html」。
本安装包不包含任何用户资料或数据库。
EOF
codesign --verify --strict --deep "$STAGE/物谱.app"
hdiutil create -volname "物谱 $VERSION" -srcfolder "$STAGE" -format UDZO "$TEMP_DMG" >/dev/null
mv "$TEMP_DMG" "$DMG"
shasum -a 256 "$DMG" | sed "s|  $OUT/|  |" > "$OUT/SHA256SUMS.txt"
echo "$DMG"
cat "$OUT/SHA256SUMS.txt"
