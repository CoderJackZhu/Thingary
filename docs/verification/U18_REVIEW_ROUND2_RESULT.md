# U18 · 第二轮独立复审（修订轮 19f3360）

2026-09-30 · **Approve with nits**：R1–R7 全部关闭；新增 1 个 P2（分类菜单键盘不可用）与若干 P3 证据/文档瑕疵，随下一次修订提交处理，不阻断本轮方向。

审查对象：`main` 提交 `19f3360`（基线 `91b7bd9` 之上单个未发布提交）。第一轮结论见 [U18_REVIEW_RESULT](U18_REVIEW_RESULT.md)，作者修订记录见 [U18_DESKTOP_LAYOUT_RESULT §10](U18_DESKTOP_LAYOUT_RESULT.md)。

## 1. 独立验证范围

- 已跑：`npm ci`、`npm run test:ui`（**178/178**，报告 §10.8 写 173 为陈旧数字，差额为分类布局新增用例）；Vite `--port 1429` + headless Chromium（Playwright 直接驱动生产组件）实测 R1/R2/R5/R6；manifest 哈希核对；截图抽看。
- 未跑：Rust 226、`npm run check`、`npm run build`（Linux 环境，Rust 仅 Mac）；原生 UI；作者的 ego-browser 脚本（无 taskSpace API，用等价脚本替代）。全程未接触正式库或任何已安装 App。

## 2. R1–R7 核销

| 项 | 结论 | 独立证据 |
|---|---|---|
| R1 | 关闭 | `?category-fixture=30`：1920 宽总览→全部资产无 Maximum update depth、非空白；1280/1080/800/560/400/300/1920/1000–1002 宽连续缩放只重排无页面错误，≤400 进入 compact；菜单选隐藏尾项后外显唯一、焦点回触发钮；800 宽直接进入、尾项已选再缩放均正常。代码：`TaxonomyFields.tsx:325` 等值跳出，observer 一次性挂载经 ref 取最新 measure |
| R2 | 关闭 | `?recurring-fixture=30&recurring-tab=payments` 三档（1280/1080/800）两按钮均 61×94px、间隙 2px 不重叠、`scrollWidth==clientWidth` |
| R3 | 关闭 | `category-layout.ts` 的全容量算式与真实排布一致，恰好容纳不收起；超长选中转 compact；300/400 宽实测 compact 单按钮 |
| R4 | 关闭（静态） | `main.tsx:900` 有 `modules.timeline &&`；`modules.ts:6` stats 名「物品统计」；预览无 `modules_set`，开关端到端原生未验 |
| R5 | 关闭 | 设置→外观→素材库：鼠标「返回设置」、面包屑、Esc 均回设置且焦点在 `settings-open-materials`；资料与备份→最近删除返回后焦点在 `settings-open-trash`；物品详情删除→「前往最近删除」→「返回物品」回「我的物品 / 全部资产」无页面错误。U17 四个函数在提交 diff 中无改动，相关测试通过；浏览器中未实跑分析页往返 |
| R6 | 关闭 | `?taxonomy-error=1`：分类行有未禁用的「更多分类」，菜单显示错误原因＋「重试」，点击无报错 |
| R7 | 基本关闭（P3-1/2） | before 72、after 78 张实际存在；manifest 中实现文件哈希与 HEAD 一致；抽看 6 张（分类 800 D 深、1280 C 浅，周期 800 C 浅，菜单展开，compact，800 侧栏前后）非空白且内容正确 |

## 3. AC 独立结论

AC01/02 本轮未改动、抽查正常；AC03/04/05/06/08 通过（浏览器）；AC07 静态通过（开关原生未验）；AC09 未验（原生）；AC10 部分（见 P3-3）；AC11 **部分且有缺陷（P2-1）**；AC12 部分（浏览器错误重试通过，切库/重开原生未验）。

## 4. 新发现

### P2-1 · 分类菜单打开后焦点不进菜单，键盘不可用
位置 `src/TaxonomyFields.tsx:182`（`useEffect(() => { searchRef.current?.focus(); }, [])`）与 `:239`（首次挂载样式为 `visibility:hidden`，定位后才可见）。隐藏元素不能获得焦点，`focus()` 静默失败。

复现：`?category-fixture=30`→总览点「全部资产」→Tab 到「更多分类」按 Enter（或鼠标点）→等 800ms：`document.activeElement` 仍是触发钮；↓ 不移动焦点（方向键处理挂在面板上）；键入「电」搜索框仍空。鼠标路径不受影响，Esc 关闭并回触发钮是对的。作者交互测试用 `page.fill`，绕过了焦点，因此未发现。

### P3-1 · 证据清单与实物不符
manifest 与报告声称 155 张（after 83），实际 after 只有 78 张；manifest 引用 5 个不存在的文件：`after/category-overflow-30-1080x760.png`、`after/category-overflow-30-800x600.png`、`after/recurring-payments-view-800x600.png`、`after/recurring-tabs-broken-800x600.png`、`after/wish-detail-savings-800x600.png`。截图哈希只保留 12 位、文件指纹 16 位，作为指纹偏短。

### P3-2 · index.html 陈旧表述
`docs/ui/desktop-layout/index.html:46` 称「其余主题/模式的 before 不重复拍摄」，但 before 已补齐 72 张；before 表只链 12 张 B 浅图。

### P3-3 · 窄窗残留未在文档登记
800×600 下 C/D 主题侧栏文字折行（既有，before 已存在）且「设置」「三态外观」落在首屏外需滚动；400×600 compact 截图右侧排序/视图控件被裁切并有横向滚动条。AC10 要求「短窗底部导航与控件可达」，至少须登记边界。

### P3-4 · 其他
报告 §10.8 的 test:ui 数字陈旧；无错误时「更多分类」按钮宽度未计入全容判定，仅在「恰好全容 + 出现错误触发钮」的极端边缘可能多出一个按钮宽度（`TaxonomyFields.tsx:370`）。

## 5. 残余风险

1. 原生：AC09 系统跟随/重开、AC11 键盘/滚轮、AC12 切库/重开未验；P2-1 说明浏览器键盘路径此前也未被真实覆盖。
2. 模块开关（R4）仅静态核对。
3. U17 分析页往返未在浏览器中实跑。
4. after 截图矩阵用默认夹具，30 分类的像素证据仅早期几张与交互测试数据。
5. `check`/`build`/Rust 226 未独立复跑，采信作者记录。
