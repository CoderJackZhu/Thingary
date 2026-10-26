#!/usr/bin/env bash
# 把已导出的 .ipa 上传到 App Store Connect；默认只做 dry-run。
#
# 用法：
#   ASC_KEY_ID=... ASC_ISSUER_ID=... bash scripts/ios-upload.sh path/to/物谱.ipa
#   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=/path/AuthKey_....p8 \
#     bash scripts/ios-upload.sh --really-upload path/to/物谱.ipa
#
# 说明：
# - 默认不执行上传，只校验 IPA 和认证变量并打印将要执行的命令。
# - --really-upload 才会调用 xcrun altool；脚本本身不提交审核。
# - 不打印密钥内容；ASC_KEY_PATH 缺失时依赖 altool 的默认搜索目录
#   （~/ .appstoreconnect/private_keys 等），脚本不主动扫描这些目录。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

REALLY_UPLOAD=0
IPA=""
TMP_DIR=""

usage() {
  cat <<'EOF'
用法：bash scripts/ios-upload.sh [--really-upload] <path-to-ipa>

默认 dry-run；只有 --really-upload 才会执行 xcrun altool 上传。
需要环境变量 ASC_KEY_ID、ASC_ISSUER_ID；ASC_KEY_PATH 可选，用于指定 .p8。
EOF
}

fail() {
  printf 'ios-upload: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

for arg in "$@"; do
  case "$arg" in
    --really-upload)
      REALLY_UPLOAD=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      fail "未知参数：$arg（用 --help 查看用法）"
      ;;
    *)
      if [ -n "$IPA" ]; then
        fail "只能指定一个 .ipa"
      fi
      IPA="$arg"
      ;;
  esac
done

if [ -z "$IPA" ]; then
  usage >&2
  exit 2
fi
[ -f "$IPA" ] || fail "找不到 IPA：$IPA"
case "$IPA" in
  *.ipa) ;;
  *) fail "文件扩展名不是 .ipa：$IPA" ;;
esac

command -v xcrun >/dev/null 2>&1 || fail "找不到 xcrun，请安装完整 Xcode"
command -v unzip >/dev/null 2>&1 || fail "找不到 unzip"

[ -n "${ASC_KEY_ID:-}" ] || fail "缺少 ASC_KEY_ID"
[ -n "${ASC_ISSUER_ID:-}" ] || fail "缺少 ASC_ISSUER_ID"

if [ -n "${ASC_KEY_PATH:-}" ]; then
  case "$ASC_KEY_PATH" in
    *.p8) ;;
    *) fail "ASC_KEY_PATH 应指向 .p8 文件。" ;;
  esac
  [ -r "$ASC_KEY_PATH" ] || fail "ASC_KEY_PATH 指向的文件不存在或不可读；脚本不会读取其内容。"
  ASC_KEY_PATH="$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)/$(basename "$ASC_KEY_PATH")"
  TMP_DIR="$(mktemp -d -t thingary-upload)"
  chmod 700 "$TMP_DIR"
  ln -s "$ASC_KEY_PATH" "$TMP_DIR/AuthKey_$ASC_KEY_ID.p8"
  export API_PRIVATE_KEYS_DIR="$TMP_DIR"
else
  note "ASC_KEY_PATH 未设置，将由 altool 在默认目录查找 AuthKey_<ASC_KEY_ID>.p8。"
fi

# 先检查包内身份，避免把预览身份当商店包上传。
unzip -t "$IPA" >/dev/null || fail "IPA 无法通过 zip 校验"
TMP_DIR="${TMP_DIR:-$(mktemp -d -t thingary-upload)}"
IPA_DIR="$TMP_DIR/ipa"
mkdir -p "$IPA_DIR"
unzip -q "$IPA" -d "$IPA_DIR"
[ -d "$IPA_DIR/Payload" ] || fail "IPA 内没有 Payload 目录"
IPA_APP="$(find "$IPA_DIR/Payload" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$IPA_APP" ] || fail "IPA 内找不到 Payload/*.app"
IPA_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$IPA_APP/Info.plist")"
[ "$IPA_ID" = "local.thingary.main" ] || fail "拒绝上传非商店身份：$IPA_ID"
IPA_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$IPA_APP/Info.plist")"
IPA_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$IPA_APP/Info.plist")"
[ -f "$IPA_APP/PrivacyInfo.xcprivacy" ] || note "警告：IPA 内没有 PrivacyInfo.xcprivacy，请先核对归档。"

ALT_ARGS=(
  xcrun altool
  --upload-app
  -f "$IPA"
  --api-key "$ASC_KEY_ID"
  --api-issuer "$ASC_ISSUER_ID"
)

if [ "$REALLY_UPLOAD" -eq 1 ]; then
  note "开始上传 物谱 $IPA_VERSION（$IPA_BUILD）到 App Store Connect；不会提交审核。"
  "${ALT_ARGS[@]}"
  note "altool 已返回。构建处理与出口合规问卷仍需在 App Store Connect 网页完成。"
else
  note "dry-run：没有上传。"
  note "包内身份：local.thingary.main，版本 $IPA_VERSION（$IPA_BUILD）。"
  # 不打印 key ID / issuer ID / key 内容，避免把认证信息写进日志。
  printf '将执行：\n  xcrun altool --upload-app -f %q --api-key <ASC_KEY_ID> --api-issuer <ASC_ISSUER_ID>\n' "$IPA"
  note "确认 Team 权限、版本号和构建号后，再加 --really-upload。"
fi
