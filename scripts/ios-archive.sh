#!/usr/bin/env bash
# 构建 App Store 用的 iOS 归档并导出 .ipa；不上传、不提交审核。
#
# 用法：
#   APPLE_TEAM_ID=<TEAM_ID> bash scripts/ios-archive.sh
#   APPLE_TEAM_ID=<TEAM_ID> IOS_BUILD_NUMBER=42 bash scripts/ios-archive.sh
#   APPLE_TEAM_ID=<TEAM_ID> \
#     ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=/path/AuthKey_....p8 \
#     bash scripts/ios-archive.sh
#
# 认证：不设置 ASC_* 时使用本机 Xcode 已登录账号的自动签名；设置时必须三项齐全。
# 输出：src-tauri/target/ios/物谱.xcarchive 与 src-tauri/target/ios/export/*.ipa
# 本脚本不打印任何密钥内容，也不把 Team ID、密钥 ID 或 Issuer ID 写入日志。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

CONFIG_FILE="src-tauri/tauri.appstore.conf.json"
PROJECT="src-tauri/gen/apple/thingary.xcodeproj"
SCHEME="thingary_iOS"
EXPORT_TEMPLATE="src-tauri/gen/apple/ExportOptions.appstore.plist"
GEN_INFO="src-tauri/gen/apple/thingary_iOS/Info.plist"
BUNDLE_ID="local.thingary.main"
PRODUCT_NAME="物谱"
OUT_DIR="${IOS_OUTPUT_DIR:-src-tauri/target/ios}"
ARCHIVE_PATH="$OUT_DIR/物谱.xcarchive"
EXPORT_DIR="$OUT_DIR/export"

AUTH_SET=0
INFO_BACKUP=""
TMP_DIR=""

fail() {
  printf 'ios-archive: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

case "$OUT_DIR" in
  ""|/*|..|../*|*/..*)
    fail "IOS_OUTPUT_DIR 必须是仓库内的相对目录（默认 src-tauri/target/ios）。"
    ;;
esac

cleanup() {
  status=$?
  trap - EXIT
  if [ -n "$INFO_BACKUP" ] && [ -f "$INFO_BACKUP" ]; then
    cp "$INFO_BACKUP" "$GEN_INFO" || true
    rm -f "$INFO_BACKUP"
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

[ -f "$CONFIG_FILE" ] || fail "缺少 $CONFIG_FILE"
[ -f "$PROJECT/project.pbxproj" ] || fail "缺少 $PROJECT；先按开发说明运行 xcodegen"
[ -f "$EXPORT_TEMPLATE" ] || fail "缺少 $EXPORT_TEMPLATE"
[ -f "$GEN_INFO" ] || fail "缺少 $GEN_INFO"
command -v xcodebuild >/dev/null 2>&1 || fail "找不到 xcodebuild，请安装完整 Xcode"
command -v xcodegen >/dev/null 2>&1 || fail "找不到 xcodegen，请先安装（brew install xcodegen）"
command -v unzip >/dev/null 2>&1 || fail "找不到 unzip"

if [ -z "${APPLE_TEAM_ID:-}" ]; then
  fail "缺少 APPLE_TEAM_ID。请提供朋友 Apple 开发者账号的 Team ID；本脚本不会伪造团队。"
fi
if ! [[ "$APPLE_TEAM_ID" =~ ^[A-Za-z0-9]{10}$ ]]; then
  fail "APPLE_TEAM_ID 格式不对：应为 10 位字母或数字。"
fi
export APPLE_DEVELOPMENT_TEAM="$APPLE_TEAM_ID"

AUTH_ARGS=()
if [ -n "${ASC_KEY_ID:-}" ] || [ -n "${ASC_ISSUER_ID:-}" ] || [ -n "${ASC_KEY_PATH:-}" ]; then
  AUTH_SET=1
  missing_auth=""
  [ -n "${ASC_KEY_ID:-}" ] || missing_auth="$missing_auth ASC_KEY_ID"
  [ -n "${ASC_ISSUER_ID:-}" ] || missing_auth="$missing_auth ASC_ISSUER_ID"
  [ -n "${ASC_KEY_PATH:-}" ] || missing_auth="$missing_auth ASC_KEY_PATH"
  if [ -n "$missing_auth" ]; then
    fail "API 密钥认证变量不完整，缺少：${missing_auth# }。三项必须同时设置，或全部不设置以使用 Xcode 账号。"
  fi
  case "$ASC_KEY_PATH" in
    *.p8) ;;
    *) fail "ASC_KEY_PATH 应指向 .p8 文件。" ;;
  esac
  [ -r "$ASC_KEY_PATH" ] || fail "ASC_KEY_PATH 指向的文件不存在或不可读；脚本不会读取其内容。"
  ASC_KEY_PATH="$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)/$(basename "$ASC_KEY_PATH")"
  AUTH_ARGS=(
    -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID"
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
  )
  # Tauri 的 xcode-script 也读取这三个变量；仅在值齐全时导出。
  export APPLE_API_KEY="$ASC_KEY_ID"
  export APPLE_API_ISSUER="$ASC_ISSUER_ID"
  export APPLE_API_KEY_PATH="$ASC_KEY_PATH"
fi

if [ -n "${IOS_BUILD_NUMBER:-}" ]; then
  case "$IOS_BUILD_NUMBER" in
    ''|*[!0-9]*) fail "IOS_BUILD_NUMBER 必须是正整数。" ;;
  esac
  if [ "$IOS_BUILD_NUMBER" -le 0 ]; then
    fail "IOS_BUILD_NUMBER 必须大于 0。"
  fi
else
  note "提示：未设置 IOS_BUILD_NUMBER，将沿用 Info.plist 中的 CFBundleVersion；重复上传会被 App Store Connect 拒绝。"
fi

mkdir -p src-tauri/gen/apple/Externals src-tauri/gen/apple/assets
note "生成 Xcode 工程（默认开发身份仍是 local.thingary.preview）..."
(cd src-tauri/gen/apple && xcodegen generate)

if [ -n "${IOS_BUILD_NUMBER:-}" ]; then
  INFO_BACKUP="$(mktemp -t thingary-info-plist)"
  cp "$GEN_INFO" "$INFO_BACKUP"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $IOS_BUILD_NUMBER" "$GEN_INFO"
  note "已临时设置归档构建号；脚本结束时会恢复源 Info.plist。"
fi

# Tauri 的 xcode-script 通过这个变量取得上架身份与产品名；Xcode 工程本身仍保持预览身份。
TAURI_CONFIG="$(cat "$CONFIG_FILE")"
export TAURI_CONFIG

case "$ARCHIVE_PATH" in
  "$OUT_DIR"/*) ;;
  *) fail "输出路径异常：$ARCHIVE_PATH" ;;
esac
rm -rf "$ARCHIVE_PATH" "$EXPORT_DIR"
mkdir -p "$OUT_DIR"

note "开始 xcodebuild archive（自动签名；不会上传）..."
XCODE_ARGS=(
  -project "$PROJECT"
  -scheme "$SCHEME"
  -configuration Release
  -destination "generic/platform=iOS"
  -archivePath "$ARCHIVE_PATH"
  -allowProvisioningUpdates
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID"
  CODE_SIGN_STYLE=Automatic
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"
  PRODUCT_NAME="$PRODUCT_NAME"
)
if [ "$AUTH_SET" -eq 1 ]; then
  XCODE_ARGS+=("${AUTH_ARGS[@]}")
fi
xcodebuild "${XCODE_ARGS[@]}" archive

[ -d "$ARCHIVE_PATH" ] || fail "xcodebuild 没有生成归档：$ARCHIVE_PATH"
[ -d "$ARCHIVE_PATH/Products/Applications" ] || fail "归档里没有 Products/Applications"
APP_PATH="$(find "$ARCHIVE_PATH/Products/Applications" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$APP_PATH" ] || fail "归档里找不到 .app"
ARCHIVED_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"
[ "$ARCHIVED_ID" = "$BUNDLE_ID" ] || fail "归档身份是 $ARCHIVED_ID，不是 $BUNDLE_ID；检查 tauri.appstore.conf.json 是否被 Tauri 读到。"
[ -f "$APP_PATH/PrivacyInfo.xcprivacy" ] || fail "归档缺少 PrivacyInfo.xcprivacy"
ARCHIVED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_PATH/Info.plist")"
ARCHIVED_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Info.plist")"
if [ -n "${IOS_BUILD_NUMBER:-}" ] && [ "$ARCHIVED_BUILD" != "$IOS_BUILD_NUMBER" ]; then
  fail "归档构建号是 $ARCHIVED_BUILD，不是指定的 $IOS_BUILD_NUMBER"
fi
note "归档核对通过：$BUNDLE_ID，版本 $ARCHIVED_VERSION（$ARCHIVED_BUILD），隐私清单在包内。"

TMP_DIR="$(mktemp -d -t thingary-ios)"
EXPORT_OPTIONS="$TMP_DIR/ExportOptions.plist"
cp "$EXPORT_TEMPLATE" "$EXPORT_OPTIONS"
/usr/libexec/PlistBuddy -c 'Delete :teamID' "$EXPORT_OPTIONS" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :teamID string $APPLE_TEAM_ID" "$EXPORT_OPTIONS"
/usr/libexec/PlistBuddy -c 'Set :method app-store-connect' "$EXPORT_OPTIONS"
plutil -lint "$EXPORT_OPTIONS" >/dev/null || fail "生成的 ExportOptions.plist 无效"

note "开始 xcodebuild -exportArchive..."
mkdir -p "$EXPORT_DIR"
EXPORT_ARGS=(
  -exportArchive
  -archivePath "$ARCHIVE_PATH"
  -exportPath "$EXPORT_DIR"
  -exportOptionsPlist "$EXPORT_OPTIONS"
  -allowProvisioningUpdates
)
if [ "$AUTH_SET" -eq 1 ]; then
  EXPORT_ARGS+=("${AUTH_ARGS[@]}")
fi
xcodebuild "${EXPORT_ARGS[@]}"

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' -print -quit)"
[ -n "$IPA" ] || fail "导出目录里没有 .ipa：$EXPORT_DIR"
unzip -t "$IPA" >/dev/null || fail "导出的 .ipa 无法通过 zip 校验"
IPA_DIR="$TMP_DIR/ipa"
mkdir -p "$IPA_DIR"
unzip -q "$IPA" -d "$IPA_DIR"
[ -d "$IPA_DIR/Payload" ] || fail "IPA 内没有 Payload 目录"
IPA_APP="$(find "$IPA_DIR/Payload" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$IPA_APP" ] || fail "IPA 内找不到 Payload/*.app"
IPA_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$IPA_APP/Info.plist")"
[ "$IPA_ID" = "$BUNDLE_ID" ] || fail "IPA 身份是 $IPA_ID，不是 $BUNDLE_ID"
[ -f "$IPA_APP/PrivacyInfo.xcprivacy" ] || fail "IPA 缺少 PrivacyInfo.xcprivacy"

note "IPA：$IPA"
shasum -a 256 "$IPA"
note "未上传。需要上传时先看 scripts/ios-upload.sh 的 dry-run 输出；只有显式 --really-upload 才会执行。"
