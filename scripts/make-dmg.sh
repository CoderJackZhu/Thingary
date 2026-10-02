#!/bin/sh
# 把 `npm run release` 生成的「物谱.app」打成 dmg（拖到「应用程序」即可安装）。
# 用法：npm run release && sh scripts/make-dmg.sh
# 产物：src-tauri/target/release/bundle/dmg/Thingary-<版本>-arm64.dmg
# 未经 Developer ID 签名与公证；公开分发前的步骤见 docs/RELEASE_AUDIT.md 第 10 节。
set -eu
cd "$(dirname "$0")/.."
APP="src-tauri/target/release/bundle/macos/物谱.app"
[ -d "$APP" ] || { echo "找不到 $APP，请先运行 npm run release" >&2; exit 1; }
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")
OUT="src-tauri/target/release/bundle/dmg"
DMG="$OUT/Thingary-$VERSION-arm64.dmg"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"
ditto "$APP" "$STAGE/物谱.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "物谱 $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
echo "$DMG"
shasum -a 256 "$DMG"
