# 产品审查已确认问题修复（2026-10-03）

本轮按用户授权只修已确认问题与改名遗漏。范围、规则与验收见[产品设计 D32](../PRODUCT_DESIGN.md#d32-product)，任务状态见[实施计划](../IMPLEMENTATION_PLAN.md#product-audit-fixes)。修复验证完成；用户随后授权「没问题就提交推送安装」。已升为 2.6.1，提交后重跑检查与正式包安装核验待执行；当前已安装正式版仍为 2.6.0。

## 1. 修复结果

| 问题 | 修复 | 验证 |
|---|---|---|
| 总览读取失败后空白 | 从物品列表或分类资料取得同一资料库身份；列表失败显示原因和重试，独立总览仍可读取汇总。来源跳转及返回仍校验身份 | `state=error`：错误与重试可见，金融净资产仍为 ¥350,000；点击重试后持续故障仍有反馈；从近期记录打开指定财富盘点成功 |
| 保存反馈在滚动区底部 | 提示移到顶部操作栏下方、表单滚动区之外，保留实时状态播报 | 1280×720：提示 top=94、bottom=135.80；800×600：top=90、bottom=131.80。修改的名称保留；普通关闭后无对话框、无草稿确认 |
| 财富概览缺排除标记 | 清单显示当前账户设置的「不计入净资产」；负债汇总注明计入范围 | 房贷 −¥800,000 显示排除标记，计入负债仍为 ¥5,000；不改计算 |
| 备份／CSV／本地资料说明 | 完整备份列出财富、支出、计划、付款与虚拟资产；分别说明两类 CSV、导入边界与额外备份副本 | 浏览器展开帮助核对全文；未执行真实备份、恢复或云盘操作 |
| 心愿分类显示「全部」 | 卡片与详情统一为「未分类」 | 虚构书桌心愿两处均核对通过 |
| 主题单选组键盘行为 | 选中项进入 Tab 顺序，方向键循环选择和移动焦点，Home／End 到首／末项 | 左右／上下、两端循环、Home／End、Tab 离开组、Enter 选择实测通过；每步仅一项选中且可 Tab 到达 |
| 关于面板旧文案 | 同步 D30 中文副标题和英文口号，Cargo 描述同时涵盖物品与金融净资产 | 开发预览包构建与签名检查通过；二进制包含新中英文文案，不含旧副标题与口号 |
| 现行文档过期 | 索引更新为已安装 2.6.0；使用说明修正入口、总览分段名称和迁移边界；公开发布清单引用当前安装状态 | 相对链接与新增锚点检查；旧 CHANGELOG、历史报告及散列种子按 D31 保留 |

## 2. 同尺寸视觉证据

截图不提交版本库。本机原审查证据位于 `/tmp/thingary-audit-20261003/`，本轮位于 `/tmp/thingary-fixes-20261003/`；临时目录可能被系统清理，以下路径及复跑步骤供本机审阅。

| 场景 | 修改前 | 修改后 | 尺寸 |
|---|---|---|---|
| 总览列表故障 | `27-overview-load-error.png` | `01-overview-error-after.png` | 1280×720 |
| 保存失败 | `26-save-error.png` | `02-save-error-after.png` | 1280×720 |
| 财富排除口径 | `25-wealth-account-scope.png` | `06-wealth-scope-after.png` | 1280×720 |
| 心愿分类 | `13-wishlist.png` | `07-wishlist-category-after.png` | 1280×720 |
| 备份展开说明 | `29-backup-explainer.png` | `05-backup-help-after.png` | 1280×720 |

另补 `03-save-error-800-after.png`（800×600），及清新原生、纸本档案、柔和卡片各浅／深共六种组合的保存失败截图；各组合提示均在可见区域。所有截图已逐张查看。源码和截图 SHA-256 在本轮目录的 `manifest.json`；键盘与其他五种主题的断言结果在 `browser-checks.json`。

## 3. 工程检查

- `npm run test:ui`：192 项通过。
- `npm test`：241 项 Rust 测试通过，使用独立临时虚构目录。
- `npm run check`：fmt 与 Clippy 通过。
- `npm run build`：类型检查与前端构建通过；既有大 chunk 提醒仍在。
- `npm run tauri -- build --bundles app`：构建 `Thingary Preview.app`，身份 `local.thingary.preview`；严格签名检查通过。仅检查开发包，不启动、不安装。
- 日志保存在本轮临时目录的 `ui-tests.log`、`rust-tests.log`、`check.log`、`preview-build.log`；本轮代码接手 HEAD 为 `f5d9a886c30c47c998796db62cd5f1d27908c562`，具体未提交源码指纹见 manifest。

## 4. 浏览器复跑

运行 `npm run dev -- --port 1429`，用独立的浏览器预览页打开：

1. `/visual-preview.html?theme=light&style=bento&section=overview&state=error`：核对错误、重试和可用汇总，点近期记录的财富盘点来源。
2. `/visual-preview.html?theme=light&style=bento&section=assets&state=save-error`：双击 MacBook，点编辑，修改名称后保存；在 1280×720 和 800×600 核对提示与输入，然后普通关闭。
3. 切到财富概览，核对房贷的排除标记与负债金额；心愿清单打开书桌心愿，核对卡片与详情分类。
4. 设置 › 外观：用方向键、Home、End、Tab、Enter 验证选择与焦点；设置 › 资料与备份展开帮助核对范围。
5. 保存失败场景改 `style=native|paper|bento`、`theme=light|dark`，完成六组合。外观切换动画结束后再操作其他入口。

## 5. 验证边界

浏览器使用内存虚构资料，不能证明 SQLite 持久性、系统通知、VoiceOver 或原生键盘路径。本轮原生部分仅完成开发预览包构建、签名与二进制文案核对，没有启动正式应用、读取正式库或修改 `/Applications/物谱.app`。Ego Lite 截图持续超时，截图与交互改用应用内浏览器完成。

产品方向建议暂不实施；不修改根 `.gitignore`。上述为修复阶段的验证边界，后续 2.6.1 安装仅做包级核验，不启动正式应用、不打开或写入正式库。
