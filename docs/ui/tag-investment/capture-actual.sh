#!/bin/sh
# U17 实现截图：headless Chrome 按 12 组正常态与默认主题状态逐张输出。
# 前置：npm run dev -- --port 1429（Vite 静态与预览服务）。
# ego-browser 截图超时、/Applications/Chrome 为失效别名，故使用
# /Volumes/DATA/APPs 的真实 Chrome（本机只装一份 Chrome 的实际位置）。
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CHROME="/Volumes/DATA/APPs/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$ROOT/docs/ui/tag-investment"
PREVIEW="http://127.0.0.1:1429/visual-preview.html"
mkdir -p "$OUT"
shot() { # $1 theme $2 mode $3 screen $4 size $5 extra-query
  size_w=${4%%x*}; size_h=${4##*x}
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$size_w,$size_h" --virtual-time-budget=9000 \
    --screenshot="$OUT/actual-$1-$2-$3-$4.png" \
    "$PREVIEW?section=assets&$5" >/dev/null 2>&1
}
# 主题选择走 dataset 覆盖：预览页读取 ?theme=/&mode= 由 appearance 处理。
for theme in b c d; do for mode in light dark; do for size in 1280x800 800x600; do
  style=$([ "$theme" = b ] && echo native || { [ "$theme" = c ] && echo paper || echo bento; })
  shot "$theme" "$mode" normal "$size" "style=$style&theme=$mode&enter-tag=label-photo"
done; done; done
for mode in light dark; do
  shot b "$mode" missing 1280x800 "style=native&theme=$mode&tag-view=missing&enter-tag=label-photo"
  shot b "$mode" excluded 1280x800 "style=native&theme=$mode&tag-view=excluded&enter-tag=label-photo"
  shot b "$mode" empty 1280x800 "style=native&theme=$mode&enter-tag=label-empty"
  shot b "$mode" no-results 1280x800 "style=native&theme=$mode&enter-tag=label-photo&analysis-search=%E9%98%B2%E6%B0%B4%E5%A3%B3"
  shot b "$mode" error 1280x800 "style=native&theme=$mode&tag-view=error&enter-tag=label-photo"
done
for screen in missing empty no-results error; do
  case $screen in
    missing) q="tag-view=missing&enter-tag=label-photo";;
    excluded) q="tag-view=excluded&enter-tag=label-photo";;
    empty) q="enter-tag=label-empty";;
    no-results) q="enter-tag=label-photo&analysis-search=%E9%98%B2%E6%B0%B4%E5%A3%B3";;
    error) q="tag-view=error&enter-tag=label-photo";;
  esac
  shot b light "$screen" 800x600 "style=native&theme=light&$q"
done
shot b light entry 1280x800 "style=native&theme=light&preset-label=label-photo"
# 修订轮补验：AC04 三组合（实际渲染）+ R4 多件分段 + 同夹具 baseline 对照（设计稿同数据）。
shot b light unknown 1280x800 "style=native&theme=light&tag-fixture=unknown&enter-tag=label-photo"
shot b dark unknown 1280x800 "style=native&theme=dark&tag-fixture=unknown&enter-tag=label-photo"
shot b light zero 1280x800 "style=native&theme=light&tag-fixture=zero&enter-tag=label-photo"
shot b dark zero 1280x800 "style=native&theme=dark&tag-fixture=zero&enter-tag=label-photo"
shot b light mixed 1280x800 "style=native&theme=light&tag-fixture=mixed&enter-tag=label-photo"
shot b dark mixed 1280x800 "style=native&theme=dark&tag-fixture=mixed&enter-tag=label-photo"
shot b light baseline 1280x800 "style=native&theme=light&tag-fixture=baseline&enter-tag=label-photo"
shot b dark baseline 1280x800 "style=native&theme=dark&tag-fixture=baseline&enter-tag=label-photo"
shot b light many 1280x800 "style=native&theme=light&tag-fixture=many&enter-tag=label-photo"
shot b light held-empty 1280x800 "style=native&theme=light&tag-fixture=heldempty&enter-tag=label-photo&analysis-scope=held"
shot b dark held-empty 1280x800 "style=native&theme=dark&tag-fixture=heldempty&enter-tag=label-photo&analysis-scope=held"
ls "$OUT"/actual-*.png | wc -l
