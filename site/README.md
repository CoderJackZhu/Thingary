# 产品主页

纯静态页面，无构建依赖、外部脚本、字体或统计服务。中英文使用原生单选按钮与 CSS 切换，可用键盘方向键选择；深浅色跟随系统。

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

打开 `http://127.0.0.1:1430/`；也可以直接打开 `.local/pages-preview/index.html`。在浏览器检查中英文、系统浅／深色、1440px 桌面及 375px／320px 手机宽度；图片应加载，页面不应横向滚动。

## GitHub Pages

维护者先在 GitHub「Settings → Pages → Build and deployment → Source」选择 **GitHub Actions**。本任务只准备工作流，不开启或发布 Pages。

`.github/workflows/pages.yml` 在 `main` 的 `site/**`、`docs/images/**` 或该工作流变化时部署，也可手动触发；部署任务只允许 `main`。工作流复制 `site/` 到站点根，统一把页面图片前缀从 `../docs/images/` 改为 `docs/images/`，再复制实际使用的六张截图。源码与部署页面都不依赖仓库外资源。页面地址为 <https://coderjackzhu.github.io/Thingary/>。

新增图片引用时同步工作流的复制列表和上方预览命令。截图来源统一见 [截图清单](../docs/images/README.md)；页面只介绍当前已有能力，公开安装包范围以对应 Release 为准。新增功能后再同步 README 与本页，不预告未实现的能力。
