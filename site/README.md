# 产品主页

纯静态页面，无构建依赖、第三方脚本、网络字体或统计服务。`index.html` 维护中英文内容，`style.css` 维护排版与浅／深色令牌；本地 `download.js` 只负责下载平台的默认选择与切换。中英文使用原生单选按钮与 CSS 切换，可用键盘方向键选择；深浅色跟随系统，规划问题使用原生折叠项。尊重减少动态效果的系统偏好。

页面以完整应用总览和交替图文布局介绍盘点、规划、物品与回顾，复用现有五线品牌标志和虚构截图。没有复制第三方模板源码，也不依赖模板平台。截图可点击查看原图；它们是实际应用画面的展示，不是网页内可操作的应用。

## 直接下载

主按钮直接链接已发布安装附件，不先跳转 Release 页面：Mac 通用 DMG（Apple Silicon / Intel）与 Windows x64 EXE。默认根据浏览器提供的平台信息选择 Mac 或 Windows；其他系统默认展示 Mac 通用版，不声称该安装包适用于当前设备。下拉面板只保留 Mac 通用版和 Windows x64 两个真实版本，当前版本显示勾选，不提供空选项。可用鼠标、触屏、方向键与 Enter 选择，Escape、Tab 或点击外部收起。选择会同步页面上下及中英文入口，只更新下载目标，不触发下载。点击主按钮后才由浏览器下载；悬停不会发起请求。

脚本不查询设备高熵信息、不请求版本 API、不写存储、不发送平台信息。脚本禁用或未加载时保留标明平台的 Mac 与 Windows 直接链接。镜像入口仍链接 Gitee 发布列表，供 GitHub 无法访问时手动下载；它不是自动重试的附件源。

公开新版本时，核对实际 Release 附件，统一更新 `download.js`、HTML 的无脚本直链与版本文案，以及 `tests/site-download.test.mjs` 中的发布附件断言；不要猜测附件名或使用可能跳到无安装包版本的 latest 链接。

## 本地预览

直接用浏览器打开仓库内的 `site/index.html`。图片引用 `../docs/images/`，因此需保留仓库目录结构；离线可显示全部内容，下载与文档链接在点击后才访问外部网站。

检查部署后的结构时，在仓库根目录运行下列命令（输出到忽略的 `.local/`）：

```sh
mkdir -p .local/pages-preview/docs/images
cp -R site/. .local/pages-preview/
python3 - <<'PY'
from pathlib import Path
from shutil import copy2
root = Path('.local/pages-preview')
p = root / 'index.html'
p.write_text(p.read_text().replace('../docs/images/', 'docs/images/'))
for name in ['overview-light.jpg', 'overview-dark.jpg', 'wealth-light.jpg', 'planning-goals.jpg', 'annual-review.jpg', 'assets-light.jpg']:
    copy2(Path('docs/images') / name, root / 'docs/images' / name)
PY
python3 -m http.server 1430 --bind 127.0.0.1 --directory .local/pages-preview
```

打开 `http://127.0.0.1:1430/`；也可以直接打开 `.local/pages-preview/index.html`。在浏览器检查中英文、系统浅／深色、1440px 桌面及 375px／320px 手机宽度；图片应加载，页面不应横向滚动。下载入口检查平台识别、手动切换、禁用脚本回退与实际附件响应；平台纯逻辑回归为 `node --test tests/site-download.test.mjs`。

## GitHub Pages

维护者在 GitHub「Settings → Pages → Build and deployment → Source」选择 **GitHub Actions**。自定义域名在该仓库的 Pages 设置中管理，域名的 DNS 与 HTTPS 状态在发布时分别核对。

`.github/workflows/pages.yml` 在 `main` 的 `site/**`、`docs/images/**` 或该工作流变化时部署，也可手动触发；部署任务只允许 `main`。工作流复制 `site/`（含样式表与下载脚本）到站点根，统一把页面图片前缀从 `../docs/images/` 改为 `docs/images/`，再复制实际使用的六张截图。源码与部署页面都不依赖仓库外资源。自定义页面地址为 <https://thingary.jackzhu.top/>，页面的 canonical 与 Open Graph 地址保持一致。

新增图片引用时同步工作流的复制列表和上方预览命令。截图来源统一见 [截图清单](../docs/images/README.md)；页面只介绍当前已有能力，公开安装包范围以对应 Release 为准。新增功能后再同步 README 与本页，不预告未实现的能力。
