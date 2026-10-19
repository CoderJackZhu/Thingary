# 产品主页

纯静态页面，无构建依赖、第三方脚本、网络字体或统计服务。`index.html` 维护中英文内容，`style.css` 维护排版与浅／深色令牌；本地 `download.js` 只负责下载平台的默认选择与切换。中英文使用原生单选按钮与 CSS 切换，可用键盘方向键选择；深浅色跟随系统，规划问题使用原生折叠项。尊重减少动态效果的系统偏好。

页面以完整应用总览和交替图文布局介绍盘点、规划、物品与回顾，复用现有五线品牌标志和虚构截图。没有复制第三方模板源码，也不依赖模板平台。截图可点击查看原图；它们是实际应用画面的展示，不是网页内可操作的应用。

## 直接下载

主按钮直接链接已发布安装附件，不先跳转 Release 页面：Mac 通用 DMG（Apple Silicon / Intel）与 Windows x64 EXE。默认根据浏览器提供的平台信息选择 Mac 或 Windows；其他系统默认展示 Mac 通用版，不声称该安装包适用于当前设备。下拉面板只保留 Mac 通用版和 Windows x64 两个真实版本，当前版本显示勾选，不提供空选项。可用鼠标、触屏、方向键与 Enter 选择，Escape、Tab 或点击外部收起。选择会同步页面上下及中英文入口，只更新下载目标，不触发下载。点击主按钮后才由浏览器下载；悬停不会发起请求。

脚本不查询设备高熵信息、不请求版本 API、不写存储、不发送平台信息。脚本禁用或未加载时保留标明平台的 Mac 与 Windows 直接链接。镜像入口仍链接 Gitee 发布列表，供 GitHub 无法访问时手动下载；它不是自动重试的附件源。

公开新版本时，核对实际 Release 附件，统一更新 `download.js`、HTML 的无脚本直链与版本文案，以及 `tests/site-download.test.mjs` 中的发布附件断言；不要猜测附件名或使用可能跳到无安装包版本的 latest 链接。

## 使用指南与快速上手

`docs/QUICKSTART.md` 和 `docs/USER_GUIDE.md` 是内容的唯一来源，旧路径与显式锚点继续保留，已发布应用的 GitHub 链接仍能找到原文。网站生成 `/quickstart/` 一页上手说明、`/guide/` 帮助中心及八个主题页：安装、账户、规划、物品、备份、日常操作、更新、常见问题。首页与站内的帮助入口均指向本站。主题页侧栏与页内目录可在窄屏使用，不需要先阅读完整长文。

`/guide/#backup` 等英文锚点与自动生成的中文标题锚点会跳转到对应主题；禁用脚本后仍能在全部章节目录找到相应链接。正文和图片全部在站内，阅读无需连接 GitHub。下载、问题反馈、版本原文与开发参考仍属于外部链接；本站托管可达性与附件下载可达性需分别验证，不能把自定义域名等同于国内镜像。

`help.css` 复用主页的色彩令牌；`scripts/guide-renderer.mjs` 是网站构建使用的纯 JavaScript 渲染器。它只处理项目文档中约定的 Markdown 子集（标题、段落、链接、图片、代码、列表、引用、表格、显式锚点），不渲染任意原始 HTML。新增顶级指南章节时需要同时在 `scripts/build-site.mjs` 中归入一个主题；遗漏会让构建失败，不会静默丢失内容。

## 本地预览

在仓库根目录使用 Node 22 或更新版本，无需安装依赖：

```sh
node scripts/build-site.mjs .local/pages-preview
node --test tests/site-guide.test.mjs tests/site-download.test.mjs
python3 -m http.server 1430 --bind 127.0.0.1 --directory .local/pages-preview
```

打开 `http://127.0.0.1:1430/`，检查首页、`/quickstart/`、`/guide/` 和主题页。完整站点应通过 HTTP 预览，以支持目录网址；直接打开源码 `site/index.html` 只适合主页样式预览，生成的帮助页在构建后才存在。可将第一个参数换成独立临时目录，输出包含所有使用到的本地图片，不复制真实资料或内部验收文档。

在浏览器检查中英文、系统浅／深色、1440px 桌面及 375px／320px 手机宽度；图片应加载，页面不应横向滚动。检查帮助侧栏、页内目录、旧锚点和禁用脚本回退。下载入口检查平台识别、手动切换、禁用脚本回退与实际附件响应。

## GitHub Pages

维护者在 GitHub「Settings → Pages → Build and deployment → Source」选择 **GitHub Actions**。自定义域名在仓库的 Pages 设置中管理，DNS、HTTPS 与国内实际可达性在发布时分别核对。

`.github/workflows/pages.yml` 在 `main` 的 `site/**`、指南 Markdown、`docs/images/**`、生成器、站点测试或该工作流变化时部署，也可手动触发；部署任务只允许 `main`。工作流先检查渲染结果中所有本地链接、图片及锚点，再执行与本地相同的生成器。自定义页面地址为 <https://thingary.jackzhu.top/>，canonical 与 Open Graph 地址保持一致。

新增截图引用会在构建时自动收集复制，不需要手动维护复制列表。截图来源统一见 [截图清单](../docs/images/README.md)；页面只介绍当前已有能力，公开安装包范围以对应 Release 为准。
