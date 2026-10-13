# 界面截图与维护

## 当前定位与导航截图

2026-10-13 按[定位、导航与首次使用设计](../POSITIONING_NAVIGATION_DESIGN.md)更新下表图片。源码基线为 `main / 9de8af2`（第 1–6 步交互已提交，第 7 步只同步文档与媒体），没有推送或发布新包。

这些图片来自 **Codex 内置浏览器的内存虚构预览**，不读取任何原生资料库，不证明原生保存、系统文件或完整无障碍验收。Ego Lite 页面操作可用，但其截图及备用 Chrome CDP 截图接口超时，因此截图改用内置浏览器。JPEG 为实际 **1440×1000 CSS 像素**视口捕获后直接转换，未拼改界面、文字或数字；浅色／深色使用 Bento。报告 PNG 为 1280×720。

公共复现入口为 `npm run dev -- --port 1429` 后的 `/visual-preview.html`；以下列出全部查询参数。总览视图在页面上明确选择“综合”。所有金额、日期和未知均保留夹具的真实展示与纯计算结果。

| 当前文件 | 查询参数／实际状态 |
|---|---|
| `overview-light.jpg`、`overview-dark.jpg` | `section=overview&plan-basic=saved&capabilities=real&plan-core=confirmed&style=bento&theme=light|dark`；综合总览、已保存目标与单一紧凑说明 |
| `assets-light.jpg` | `section=assets&style=bento&theme=light`；全部物品，侧栏三入口、列表状态分段，价格／日期未知保留 |
| `first-item-form.jpg` | 同上，点新增物品；填虚构“我的笔记本电脑”、价格 5000，日期留空、补充更多收起；拍后关闭不保存 |
| `planning-goals.jpg` | `section=planning&plan-basic=saved&capabilities=real&plan-core=confirmed&style=bento&theme=light`；目标标签、已保存条件与结论、大额计划 |
| `planning-detail.jpg` | 同上，切到测算详情；需求、轨迹与详情内容，不去除缺项或假设提示 |
| `planning-trial.jpg` | 同上，切到试算；心愿影响、职业入口和临时资金续航 |
| `start-choice.jpg` | `section=overview&started=first-use&state=empty&wealth=empty&style=bento&theme=light`；未开始虚构资料，辅助模块复选框默认勾选 |
| `planning-report-current.png` | `section=planning&plan-basic=saved&capabilities=real&plan-core=partial&style=bento&theme=light`；打开当前报告，默认隐私，结论旁保留 1 项影响事项提示 |
| `overview-to-goals.gif` | 与浅色总览相同的一次页面操作：总览 → 侧栏账户与盘点 → 侧栏目标。三张实际截图各停留 4 秒，总长 **12 秒**；是内存虚构页面演示，不是原生盘点保存录像 |

同尺寸前后对照及物品正常／空白／筛选无结果／读取失败、规划未设置／已设置／投入未知／读取失败／待确认回执、宽窄明暗和复选框键盘焦点的完整证据另存维护者档案。公开目录仅保留使用指南需要的图片。

## 保留的原生截图

未列在上表的既有 JPEG 保留 2026-10-13 原生捕获来源：独立身份 `local.thingary.remediation.acceptance20261013`，全部虚构资料，未打开正式资料库。WebView 内容区 1440×1000 逻辑点，含 32 点标题栏的实际窗口 JPEG 为 1440×1032；只捕获应用窗口并去除阴影。原始应用可执行文件 SHA-256 为 `827f3cf37f8fa032108ac0e274cee42100bd8a8d0a6e4128166108498df4929a`，来源基线为 `4408f7d24bc61eb7c6172e7626b7656610b280b9` 加当时未提交的界面改动。该旧包不代表本轮源码。

原生常规图使用该身份的样例库：10 件物品、5 个在用账户，2026-10-13 完整盘点金融净资产 350,700 元；目标、费用与假设待核对如实保留。首次盘点图使用同一身份的独立虚构个人资料库，日常银行卡首次余额 10,000 元。以下文件没有本轮重新拍摄，涉及旧入口时以当前正文与上表为准。

| 保留文件 | 原始捕获状态 |
|---|---|
| `wealth-light.jpg` | 账户与盘点概览，净资产、结构与显示范围 |
| `stats-light.jpg`、`stats-dark.jpg` | 物品统计全部时间，浅／深色 |
| `planning-yearly.jpg` | 测算详情展开逐年快照，51 行数据未抽样 |
| `career-trial.jpg` | 职业变化输入与无法保住原目标的示例；旧宿主在目标更多工具区域，当前入口已移至试算 |
| `finance-records.jpg` | 收支记录收入栏、全部期间 |
| `expenses-year.jpg` | 重要支出全部年份与待补提示 |
| `finance-review.jpg`、`planning-review.jpg` | 财务复盘本期复盘，两文件来自同一次捕获 |
| `planning-report.jpg` | 旧当前报告默认隐私；README 和报告指南改用上表的新 PNG |
| `subscription-detail.jpg` | 虚构关联订阅，120 元/月，已确认付款与服务期 |
| `first-snapshot-form.jpg`、`first-snapshot-result.jpg` | 首次盘点提交前及保存后概览，10,000 元 |
| `backup-settings.jpg` | 数据管理入口；截图本身不证明本轮执行备份恢复 |

`install-flow.svg` 沿用现有安装示意，安装流程没有改变。

## 更新检查

1. 核对当前源码、实际包、图片引用和来源；只用虚构资料，原生验收不得进入正式资料库。
2. 同组主题、尺寸与资料保持一致，等待页面读取、主题过渡和布局稳定，逐张查看真实捕获。
3. 保留影响理解的假设、未知与缺项；浏览器、原生和真人理解反馈分别登记。
4. 更新本清单的文件、尺寸、基线与参数；不以改文件名代替重拍。
5. 执行 `node scripts/offline-guide.mjs <临时输出目录>`，核对图片引用、来源清单哈希和内部链接。

维护职责见[文档维护](../MAINTAINING.md)，运行与验收边界见[开发说明](../DEVELOPMENT.md)。
