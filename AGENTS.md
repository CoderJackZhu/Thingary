# Thingary 贡献辅助规则

物谱是本地使用的 macOS 应用，个人物品档案与金融净资产盘点并重。当前业务范围与语义以 [PRODUCT_RULES](docs/PRODUCT_RULES.md) 为准，参与流程见 [CONTRIBUTING](CONTRIBUTING.md)。

## 开始工作

- 检查工作目录、分支、完整 HEAD 和工作树，保留其他人的改动与未跟踪文件。
- 先读相关现行文档：[文档索引](docs/INDEX.md)、[开发与测试](docs/DEVELOPMENT.md)、[架构说明](docs/ARCHITECTURE.md)。
- 使用 codebase-memory-mcp 图工具发现代码；未索引时先索引。配置、Markdown 和字符串可直接检索。
- 库／框架的具体用法优先查 Context7，工具不可用时查官方文档。

最新用户决定优先于旧文档；修改前读取实际文件，不把准备工作当作实现授权。

## 数据与改动边界

- **开发、测试与验收不得打开或写入正式资料库 `local.thingary.main`**。使用开发预览 `local.thingary.preview`、临时目录或独立验收身份，数据必须虚构。
- 不提交真实档案、图片、序列号、数据库、备份或凭据。
- 金额用整数分，日期用 `YYYY-MM-DD`；未知不等于零，引用采用稳定 ID。
- 普通表单关闭不存草稿；已提交但结果未知的回执应保留并核对。
- 故障注入 feature 只用于测试，不带入普通应用。
- 不自行扩展产品范围、改变既定导航或数据语义；新增界面复用现有组件、SVG 和 `src/theme.css` 令牌。
- 根目录 `.gitignore` 由维护者管理，不代为修改。

## 检查与交付

代码改动运行适用检查：

```sh
npm run build
npm run test:ui
npm run check
npm test
```

涉及界面提供同尺寸对照，并覆盖正常、未知、空白与错误状态；浏览器证据不代表原生功能已验。纯文档改动检查引用、锚点、术语与交付依赖。

修改行为时同步相应当前文档，职责见 [MAINTAINING](docs/MAINTAINING.md)。详细执行记录另行保存，不添加一轮一份的报告到公开 docs。

提交只包含任务相关文件。未经用户授权不推送、发布、安装或改变仓库可见性；名称、版本和正式包发布由维护者决定。
