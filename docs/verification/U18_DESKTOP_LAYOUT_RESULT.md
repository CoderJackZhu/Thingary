# U18 · 桌面布局修复与导航整理 zcode 开发与自测记录

> 后续独立结论（2026-09-30）：[第一轮 Review](U18_REVIEW_RESULT.md)为 **Request changes**，R1–R7 已由作者修订（作者报告 §10），第二轮复审 P2-1/P3-1~P3-4 已再修订（作者报告 §11；本报告保留为第一轮记录）。下文 §1–§9 为作者首轮回交，其通过声明以 §10 更正为准；原生 UI 行为仍为未验项。

状态：**第二修订轮完成（复审二 P2-1 与 P3-1~P3-4 已处理，见 §11；原生 UI 行为仍为未验项），交回独立复审；未提交、未合并、未推送、未升版、未发布、未安装正式版**。业务规则唯一依据[产品设计 D24](../PRODUCT_DESIGN.md#u18-product)（U18-AC01–12），界面见[U18 设计](../ui/U18_DESKTOP_LAYOUT_DESIGN.md)，接手要求见[U18 zcode 交接](../archive/handoffs/U18_ZCODE_HANDOFF.md)。

## 1. 接手与变更边界

- 目录 `<repo>`，分支 `main`，接手 HEAD `91b7bd90d1b3218772314ec1d37cb37d838ad6bd`（开工复核与交接一致；**交付时 HEAD 不变，工作区实现未提交，HEAD 不包含 U18 实现**）。
- 接手时已有未提交 U18 材料（接手基线，非本次新增；保留、未改语义）：`README.md`、`CHANGELOG.md`、`docs/PRODUCT_DESIGN.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/ui/U16_DESIGN_SPEC.md`（modified）＋ `docs/U18_ZCODE_HANDOFF.md`、`docs/ui/U18_DESKTOP_LAYOUT_DESIGN.md`（untracked）＋ 未跟踪 `.claude/`（launch.json、settings.local.json，未读取、未改动）。
- zcode 本次新增/修改（随实现逐项补充）：
  - 预览夹具与截图入口（仅浏览器虚构预览，刷新重置；原生无此流程）：`src/wealth-preview.ts`（`?wish-fixture=layout`、`?recurring-fixture=30`）、`src/visual-preview.ts`（`?category-fixture=30`、`?open-wish=`、`?recurring-tab=`、`?scroll-to=` 参数转 sessionStorage）、`src/main.tsx`（open-wish／scroll-to 消费 effect）、`src/RecurringPage.tsx`（recurring-tab 初始 tab）。
  - 实现改动：见 §4–§6（随阶段填写）。
- 报告自身与最后测试代码状态的一致性在 §3 记录。

## 2. U18a 调查表（2026-09-30）

代码发现使用 codebase-memory MCP 图工具（项目已索引，6152 节点）＋定向读文件；复现使用 Vite 虚构预览（`npm run dev -- --port 1429`＋`visual-preview.html`，内存夹具）。以下为**已复现并核实**的根因与修复面；复现证据同尺寸保存于 `docs/ui/desktop-layout/before/`（宽度为窗口宽，浏览器渲染证据）。

| 对象 | 复现 | 根因（实际文件与接线） | 修复面 |
|---|---|---|---|
| 心愿筛选顺序 | ✅ `before/wish-detail-savings-1280x800.png` 左上分段 | `src/WishlistPanel.tsx:96` 状态数组顺序为「进行中｜已实现｜放弃｜全部」；默认 `filter:'all'`（:24），无持久化记忆；来源跳转 `focus.filter`（物品详情「查看原心愿」→achieved，main.tsx）不受影响 | 仅调数组顺序为「全部｜进行中｜已实现｜已放弃」；默认与语义不动 |
| 心愿详情金额/快捷按钮竖条 | ✅ `before/wish-detail-savings-1280x800.png` 检视器：`¥2,000` 断成「¥2,00／0」，+1/+5/+10/+100/+1% 每钮一行 | `src/desktop-polish.css:30` `.wish-detail-body{grid-template-columns:1fr 1fr}` 泄漏进 300px 检视器——`src/ui.css:207` 只覆盖 padding/overflow；攒钱模式 `.wish-funding` 是首子元素，`:has(>.wish-facts:first-child)` 单列规则不生效 → 指标/攒钱卡各占 ~130px；`.inspector-metrics strong`（app-layout.css:146）`overflow-wrap:anywhere` 逐字断金额 | `.wish-inspector .wish-detail-body` 收单列；`.wish-inspector .inspector-metrics` 改上下两行并 `white-space:nowrap`（共享类不动，资产摘要/虚拟检视器不受影响）；quick-savings 整钮换行 |
| 周期付款记录竖排/遮挡 | ✅ `before/recurring-tabs-broken-800x600.png`、`before/recurring-payments-view-800x600.png`：tabs 逐字竖排、到期行按钮三行折行、日期/金额逐字断行 | (a) `src/app-layout.css:11` `.segmented button{width:26px;height:26px}`（图标按钮用）与 `src/desktop-polish.css:175` `.recurring-tabs button` 特异性相同且后者未设 width → 「计划／付款记录」tab 常年被压成 26px 宽，文字溢出 26px 高的按钮框向上/下叠画（wealth-toolbar 在 wealth.css:4 已修过同类问题）；(b) 窄窗 `.ui-table` 表头与期次/实付日期列、`.check-in-state button`、确认按钮无 `white-space:nowrap` → 逐字竖排 | `.recurring-tabs button{width:auto;min-width:0;white-space:nowrap}`；到期/付款表日期、金额、状态列与表头 nowrap（计划名称/备注保持可换行）；`.check-in-state button` nowrap。付款区为正常文档流（`.wealth-section` grid + `ui-table` td height 为最小高），30 条记录与底部操作滚动可达，无固定高度裁切——修复后复验 |
| 分类筛选溢出 | ✅ `before/category-overflow-30-800x600.png`（仅剩半个「全部分类」可点）、`...-1280x800.png`（5 个后渐隐截断） | `src/app-layout.css:124–125,150` `.collection-toolbar>[data-component=category-filter]{overflow-x:auto;scrollbar-width:none}`＋`::-webkit-scrollbar{display:none}`＋右缘 24px 渐隐 mask——溢出分类只能靠不可见横向滚动到达；唯一共享实现 `src/TaxonomyFields.tsx` `CategoryFilter`（仅 main.tsx:892 物品列表工具条一处使用；方向键循环已有） | 重写 `CategoryFilter` 的工具条形态：按容器实测宽度排完整胶囊（含真实字体测量，ResizeObserver 处理 resize/换库）；溢出时固定「更多分类 ▾」菜单（搜索、全部/未分类固定项、勾选、键盘）；被选中但放不下的分类在更多按钮前保留一位；极窄收敛为单个「分类：X ▾」；选择不改关键词/标签/排序/视图 |
| 导航/设置/主题 | 结构核对（无故障复现必要） | 侧栏组装于 `src/main.tsx:826–831`（回顾组=时间轴+统计；底部=素材库/最近删除/设置+mode-toggle）；面包屑/页标题同文件 :832/:836；统计页区块样式靠 `.stats-section[aria-label="统计"]` 属性选择器（ui.css:262–266）；三态 `Mode='light'|'dark'|'system'` 已存在（src/appearance.ts），侧栏按钮现只 `toggledMode` 二态循环；设置外观面板与侧栏共享 App `theme/style` state（受控 props，单一来源）；`watchSystemMode`、原生 `set_appearance`（commands.rs:216）、⌘⇧D 原生菜单（lib.rs）已接线；最近删除入口行已存在于设置「资料与备份」（DataManagement.tsx:95 onTrash） | 见 §6（U18d）：统计→物品统计入物品组末尾、时间轴独立于底部设置上方、素材库/最近删除收进设置并带「设置 › X」面包屑与来源感知返回、底部三态按钮接同一 theme state |

复现覆盖说明：心愿夹具含价格 ¥2,850／已攒 ¥850／还差 ¥2,000、¥12,345,678.90、未知/零价格、长名称、已实现/已放弃；周期夹具含 0/1/30 条付款、长名称计划与长备注、本期不付状态；分类夹具含 30 个虚构分类（长中英文名、无物品分类）。默认 B 浅色为主，深色与其余主题在 U18e 逐组合核对。

## 3. 检查命令与结果

| 命令 | 日期 | 退出码 | 结果 | 对应代码状态 |
|---|---|---|---|---|
| `npx tsc --noEmit` | 2026-09-30 | 0 | 夹具、实现各阶段类型通过 | 每次实现改动后 |
| `npm run test:ui` | 2026-09-30 | 0 | **173/173**（U17 基线 166 ＋ 本次新增 `tests/category-layout.test.mjs` 7 项） | U18c–d 实现后 |
| `npm test`（cargo fault-injection） | 2026-09-30 | 0 | **226/226**（无 Rust 数据层改动） | 同上 |
| `npm run check`（fmt+clippy -D warnings） | 2026-09-30 | 0 | 通过；含 `examples/u18_fixture.rs`（夹具首轮有类型/格式错误，修复后重跑通过，见 check4） | 夹具最终版 |
| `npm run build`（tsc+vite） | 2026-09-30 | 0 | 通过（保留既有 chunk 体积提示） | U18d 实现后 |
| `git diff --check` | 2026-09-30 | 0 | 通过 | 最终工作区 |
| 隔离包构建 `npm run tauri -- build --bundles app --config .local/u18.conf.json` | 2026-09-30 | 0 | `src-tauri/target/release/bundle/macos/Possio U18 Acceptance.app`（本地签名 `-`，未公证、未安装） | 实现最终版 |
| debug 隔离包 `npm run tauri -- build --debug --bundles app --config .local/u18.conf.json` | 2026-09-30 | 见 §6 | 按 U17 先例补建 debug 验收包 | 同上 |

未改 `demo.rs`/`demo-assets.json`/`demo-finance.json` 的导入事实（夹具只在浏览器预览内存层），故未跑 `npm run test:demo`；native 夹具走独立 example 工具。

## 4. U18b 心愿与周期详情

| 改动 | 文件 | 内容 |
|---|---|---|
| 筛选顺序 | `src/WishlistPanel.tsx` | 状态分段数组改为「全部｜进行中｜已实现｜已放弃」；默认 `filter:'all'` 与来源跳转 `focus.filter` 语义不变 |
| 详情单列 | `src/ui.css` | `.wish-inspector .wish-detail-body{grid-template-columns:1fr}`（截断桌面详情页双列网格的泄漏）；`.inspector-metrics` 检视器内改上下两行并 `white-space:nowrap`（共享类不动，资产摘要/虚拟检视器不受影响）；quick-savings 整钮换行（`flex:1 0 auto;white-space:nowrap`）；`saving-summary strong` nowrap |
| 周期 tabs | `src/wealth.css` | `.recurring-tabs button{width:auto;min-width:0;white-space:nowrap}`——解除 `.segmented button{width:26px}`（app-layout.css:11）对文字按钮的命中（与 wealth-toolbar 同类修复） |
| 周期表格 | `src/wealth.css`、`src/RecurringPage.tsx` | 到期/付款表日期、分类、状态、金额列与表头 `white-space:nowrap`（计划名称/备注保持换行）；付款记录表加 `recurring-payments` 类名用于列定位 |
| 预览夹具 | `src/wealth-preview.ts` | `?wish-fixture=layout`（2,850/850、¥12,345,678.90、未知/零、长名称、已实现/已放弃）、`?recurring-fixture=30`（30 条付款含本期不付、长名称/长备注、0/1 条计划） |

证据：`docs/ui/desktop-layout/before/wish-detail-1280x820-B-light.png`（金额断行+按钮竖条）→ `after/wish-detail-1280x820-B-light.png`（金额完整、快捷按钮一行/整组换行）；`before/recurring-payments-800x600-B-light.png`（tabs 逐字竖排、按钮三行、日期金额断字）→ `after/recurring-payments-800x600-B-light.png`。18 组合中每格均含两页。

## 5. U18c 分类溢出菜单

**实现**（`src/TaxonomyFields.tsx` 重写 `CategoryFilter` 工具条形态；`src/category-layout.ts` 纯函数；`src/taxonomy.css` 样式；`src/app-layout.css` 移除 `overflow-x:auto`＋隐藏滚动条＋24px 渐隐 mask）：

- 布局决策集中在 `planCategoryLayout(width, fixed, entries, selectedId)`：先为「更多分类」预留空间；溢出时按实测宽度截取完整胶囊前缀；选中但放不进前缀的分类在更多按钮前占外显位且不重复；连「全部分类＋未分类＋更多分类」都放不下时整栏收敛为「分类：X ▾」单个选择按钮（长名换行可读）。
- 隐藏测量层以同字体/主题渲染全部胶囊，`ResizeObserver` 驱动重排；同输入同排布，不记录常用分类；筛选值/结果/分类 ID 不变。
- 「更多分类」菜单 portal 到 `body`（不被列表/检视器 overflow 裁切），含固定搜索框（名称匹配、忽略首尾空白与大小写、无结果显示「没有匹配的分类」）、全部分类/未分类固定项、全部可筛选分类（结果为 0 不隐藏）、当前项 ✓；点选后关菜单并把焦点还原到触发按钮；窗口滚动/缩放自动关闭；Esc 先关菜单（捕获级，不穿透页面返回）。
- 触发按钮可访问名称含「分类」与当前选择（如「更多分类，当前全部分类」「分类：X，打开分类菜单」）；`aria-expanded`/`aria-haspopup`；键盘 Tab 可聚焦，菜单内方向键循环、Enter 选择。
- 换库即关菜单并丢弃搜索；`error`/`onRetry` 可选 props 供分类读取失败时菜单内显式给出原因与重试（不呈现为「没有分类」）——当前接线中 taxonomy 失败在设置页处理，`CategoryFilter` 仍以 disabled 呈现加载/失败，错误重试参数已预留（主接线：`useTaxonomy.reload` 在设置页）。
- 测试：`tests/category-layout.test.mjs` 7 项（全部可见/溢出截断/选中尾项外显不重复/选中在前缀不占位/极窄 compact/尺寸变化复原不记常用/重复计算稳定）。

**证据与验证**：`before/category-overflow-800x600-B-light.png`（半个分类+渐隐截断）→ `after/category-overflow-800x600-B-light.png`（完整胶囊＋更多分类）；`after/category-menu-open-1280x820-B-light.png`（搜索＋固定项＋40 分类滚动菜单）；`after/category-compact-560x600-B-light.png`（极窄选择器）。ego-browser 交互冒烟（2026-09-30）：搜索「望远」仅过滤具体分类（固定项保留）；点选尾部分类后菜单关闭、选中项外显（pressed）且不重复、焦点回触发钮、外部提示「当前：望远镜与观鸟」；resize 后重排选中项保持可见。

**窄窗布局**：≤1190px 时分类栏独占一行（`flex-basis:100%`），右侧控件换到第二行右对齐——这是对既有工具条布局的响应式调整，依据 U18「极窄收敛」与同尺寸对照要求。

## 6. U18d 导航与三态外观 + 隔离原生证据

### 6.1 实现（导航/设置/三态）

| 改动 | 文件 | 内容 |
|---|---|---|
| 物品统计归属 | `src/main.tsx`、`src/Stats.tsx`、`src/ui.css` | 侧栏物品组末尾新增「物品统计」（`modules.stats` 门控，无新增徽标）；「回顾」分组取消；页标题与面包屑改「物品／物品统计」；`Stats` 区块 aria-label 改「物品统计」并同步 ui.css 的属性选择器（内部「统计时间范围」等局部文案不改） |
| 时间轴独立 | `src/main.tsx` | 移至侧栏底部、设置行上方（`modules.timeline` 门控），面包屑前缀改「家底」；不成为设置子页 |
| 设置子入口 | `src/SettingsView.tsx`、`src/AppearanceSettings.tsx`、`src/DataManagement.tsx` | 设置分组改为可受控（App 持 `settingsGroup`）；「设置 › 外观」新增素材库入口行；「设置 › 资料与备份」最近删除入口行已存在（沿用）；素材库/最近删除从侧栏移除 |
| 子页返回 | `src/main.tsx` | `openSubpage` 记录来源 section/滚动/分组/焦点元素；面包屑「设置」可点（始终回设置分组）；Esc 在无弹层时按来源返回；删除后「前往最近删除」等既有入口进入时返回仍回实际来源 |
| 三态外观 | `src/main.tsx`、`src/ui.css` | 底部三个等宽图标按钮（浅色/深色/跟随系统，太阳/月亮/半明半暗圆复用现有 Icon），`aria-pressed` 互斥、点击已选保持、`setTheme` 同一状态源（设置内 Segments 双向同步）；不新增第二份偏好 |

### 6.2 隔离原生证据（2026-09-30）

**已完成的原生验证**：

| 项 | 结果 |
|---|---|
| 包身份 | `Possio U18 Acceptance.app`（release＋debug 两个包）CFBundleIdentifier = `local.possio.u18.acceptance`（PlistBuddy/codesign 核对），本地签名未公证未安装 |
| 虚构资料 | `~/Library/Application Support/local.possio.u18.acceptance/library` 由 `src-tauri/examples/u18_fixture.rs` 经业务 API 写入：30 个虚构分类＋2 件物品（首/尾分类）＋6 条心愿（savings 2,850/850、大金额、未知、零、已实现、已放弃）＋3 个周期计划（31 条付款，其中 4 条本期不付）＋自动备份已生成；夹具路径隔离校验（拒绝符号链接与非隔离路径） |
| 句柄归属 | 启动后 `lsof -p <u18pid>` 对 `local.possio.main` 句柄数 **0**，仅持有 u18.acceptance 数据集；运行中的正式版进程（用户既有，早于本会话）未触碰；退出后句柄 0 |
| 启动链 | App 启动后真实运行（启动 ~20 秒后生成 U13 自动备份 `物志自动备份-2026-09-30.possio`，`auto-backup.json` 无错误）；正常退出 |

**原生 UI 行为验收未执行（工具阻塞，如实记录）**：

1. 本机（macOS 26）对本 Tauri 应用的外部 AX 树退化：`kAXWindowsAttribute`/`AXMainWindow`/System Events 均返回应用自身元素而非窗口（Finder 对照返回正常桌面窗），`AXEnhancedUserInterface`/`AXManualAccessibility` 设置于应用元素返回 -25208/-25205；release 与 debug 包表现一致。无法读取/驱动 UI 元素。
2. 本执行环境无「屏幕录制」授权：`screencapture` 输出全黑；macOS 26 已移除 `CGWindowListCreateImage`，窗口级截图无法取得。
3. 两者叠加：鼠标点击、键盘导航、菜单、三态切换、窗口缩放的原生**行为证据**无法诚实产出（盲点按坐标点击且无状态可读不作为证据）。对照：U17 会话的原生验收环境具备 AX 几何与截屏能力。
4. 受影响 AC（原生部分）：AC04/05/11 的原生鼠标尾项与键盘、AC07 的原生来源返回、AC09 的原生三态/系统跟随/重开、AC12 的原生切库与重开。这些条目的浏览器等价证据已覆盖（见 §7 矩阵），但按交接标准**原生通过不能据此宣称**；独立 Review 环境若具备 AX/截屏权限，可直接用本报告 §6.2 的包与夹具复跑。

### 6.3 U17 保护回归（浏览器冒烟，2026-09-30）

以 `?tag-fixture=baseline&enter-tag=label-photo` 驱动真实组件链：分析面包屑「物品 › 标签投入 › 摄影」→ 点「机身」开档案（面包屑「物品 › 摄影投入 › 机身」）→ 中间层返回分析（范围切换器在）→ 「物品」返回列表（入口按钮恢复、标题正常）。`exitToAssetList`、`back`、`analysisCrumb` 等代码路径未被 U18d 改动；侧栏「物品统计」不参与分析链。

## 7. U18e AC 证据矩阵

证据代号：〔自〕= 自动测试（tests/ 或 cargo）；〔浏〕= 浏览器虚构预览（同尺寸截图或 ego-browser 交互冒烟）；〔原〕= 隔离原生（identifier `local.possio.u18.acceptance`）；「部分」= 复合条件有子项未验。

| AC | 场景 | 实际结果与证据 | 结论 |
|---|---|---|---|
| AC01 | 心愿四状态与首次进入、往返 | 顺序「全部｜进行中｜已实现｜已放弃」〔浏〕before/after 截图对比；默认 `filter:'all'`、来源跳转 `focus.filter` 语义未改（代码核对＋〔自〕既有 wishlist 测试回归）；各状态结果由后端 `query_wishlist` 未改动＋226 项 cargo 回归 | **通过（浏览器＋自动；原生未执行）** |
| AC02 | 心愿金额不挤碎、按钮可点、未知不冒充零 | 〔浏〕`after/wish-detail-1280x820-B-light.png`：¥2,850/¥850/还差 ¥2,000 完整；`after/wish-detail-bigamount-1280x820-B-light.png`：¥12,345,678.90 一行；未知显示「待补充」不显示 0（WishDetail 逻辑未改＋夹具截图）；快捷按钮一行可点；攒钱/实现规则未改（226 回归） | **通过（浏览器＋自动；原生未执行）** |
| AC03 | 周期 0/1/30 条付款、长备注、视图切换 | 〔浏〕`after/recurring-payments-*.png` 18 组合：tabs 文字横排、日期/金额/状态不逐字断行、名称/备注正常换行、30 条与末尾滚动可达（正常文档流）；确认/更正/撤销展示口径未改（RecurringPage 结构未动＋cargo 回归）；〔浏〕tabs 切换 aria-pressed 验证 | **通过（浏览器＋自动；原生未执行）** |
| AC04 | 分类全集/默认/30 个/长名称，鼠标可达 | 〔浏〕`after/category-overflow-*.png`：完整胶囊＋更多分类，无半个分类；〔浏〕交互冒烟点选尾部分类成功；全部/未分类语义保留（固定项） | **通过（浏览器；鼠标可达原生未执行）** |
| AC05 | 菜单搜索/空结果/选中尾部/缩放/返回 | 〔浏〕搜索「望远」仅过滤具体分类；空结果文案在（未单独截图——搜索词「望远」有结果，无匹配态代码路径与文案核对）；选中尾项外显且不重复、焦点回触发钮；resize 后选中可见筛选不变（ego 冒烟）；〔自〕`category-layout` 7 项含尺寸变化复原 | **通过（浏览器＋自动；无匹配态截图未拍——标为缺口）** |
| AC06 | 全部资产等状态页共用规则、组合筛选与 U17 退化为 | 分类栏唯一实现在物品列表工具条（状态页共用该列表）；〔自〕226 cargo＋173 test:ui 回归；〔浏〕U17 两层返回冒烟通过（§6.3）；组合筛选/排序/视图代码未动 | **通过（自动＋浏览器）** |
| AC07 | 物品统计与时间轴导航、模块开关、来源跳转 | 〔浏〕`after/sidebar-stats-*.png`：名称/归属/面包屑一致，统计页双列布局正常（aria-label 同步）；时间轴在底部、跨模块代码未动；模块开关 `modules.stats/timeline` 门控沿用；空「回顾」标题消除（组已删除） | **通过（浏览器；原生未执行）** |
| AC08 | 设置进入素材库/最近删除、返回与恢复引导 | 〔浏〕`after/settings-appearance-1280x820-B-light.png`（素材库入口行）、`after/settings-materials-crumb-1280x820-B-light.png`（面包屑＋设置高亮）；返回代码路径 `openSubpage/backFromSubpage`＋Esc（实现层核对；浏览器点击冒烟未做——**标为缺口**）；恢复/永久删除能力未动（TrashPanel 未改） | **部分（实现核对＋截图；返回点击与删除引导冒烟未执行）** |
| AC09 | 三态互斥/保存、系统变化、B/C/D、重开 | 〔浏〕交互冒烟：三态互斥 aria-pressed 唯一、localStorage `possio.theme` 保存（light/dark/system）、点击已选保持、设置 Segments 双向同步、system 下 data-mode 解析正确；〔浏〕18 组合明暗渲染 | **部分（浏览器通过；原生系统跟随/重开未执行——工具阻塞）** |
| AC10 | 三尺寸六组合无裁切/碎裂/重叠、短窗可达 | 〔浏〕18 组合 × 4 页面同尺寸截图（`docs/ui/desktop-layout/index.html`）；心愿/周期/分类均无横向裁切、金额完整、无区块重叠；侧栏底部区域 800×600 可滚动到达（sidebar overflow-y:auto）；同尺寸 before 对照齐 B-浅三尺寸 | **通过（浏览器；原生像素未拍——阻塞）** |
| AC11 | 鼠标/滚轮/键盘、菜单不裁切、Esc、图标名称 | 〔浏〕菜单 portal 不被裁切（截图）；触发钮 aria-label 含分类与当前项；方向键/Enter/Esc 代码接线（菜单 onKeyDown＋全局 popover Esc 还原焦点）；**键盘与鼠标的实际操作冒烟未执行**（ego 只做了点击）——**标为缺口** | **部分** |
| AC12 | 隔离库/空白/错误/切库/重开 | 〔原〕隔离身份/路径/句柄验证通过、无旧库残留（全新目录）、夹具入库、启动与退出正常；空白/错误态由 `?state=` 既有入口沿用（未逐个截图）；**原生切库与重开行为未执行**（工具阻塞）；无正式库访问（lsof 证据） | **部分（隔离与数据面通过；行为面未执行）** |

## 8. 已知问题、未验项与回交

**已知问题/残余**：
1. 原生 UI 行为验收整体受阻（§6.2）——AC04/05/07/09/11/12 的原生子项未执行，包与夹具已就绪可复跑。
2. AC05「没有匹配的分类」空结果、AC08 返回点击、AC11 键盘实际操作未单独冒烟（代码接线核对＋空态文案核对）。
3. 素材库页 page-header「素材库」与卡片内标题「素材库」重复为既有行为，未在本次范围内处理。
4. `?recurring-tab=` 等截图入口为开发专用（sessionStorage 驱动，原生不触发）；随实现保留在 dev-only 代码路径。

**before 证据完整性更正（2026-09-30）**：§2 调查时的首轮复现截图（含 1280×800 非标准尺寸）证明了原始缺陷；随后 U18e 清理旧尺寸时按标准三尺寸批量「重拍」的 before 实际是**修复后代码**的渲染（证据污染，发现于交付前抽查）。已用「临时文件交换」方式重拍：12 个实现文件从 HEAD 原版取出（不动 git 状态，不 stash/reset），仅加回 open-wish/scroll-to 两个纯预览辅助 effect，重启预览后重拍 `before/` 12 张标准图（已抽查确认呈现原始缺陷：筛选全部在末位、检视器双列挤压、tabs 竖排、分类遮罩），随后恢复实现文件——恢复后 `git diff --stat` 与重拍前逐行一致（19 files / +548 / −117）且 `npx tsc --noEmit` 通过。before 目录现仅保留原版状态的 12 张标准图。

**临时系统偏好**：未修改任何系统偏好（原生行为受阻，未走到系统明暗切换步骤）。

**恢复的临时更改**：无。U18 隔离 App 已退出；正式版进程全程未触碰。

**下一步（交回 Review）**：回交摘要见 §9。

## 9. 回交摘要（待独立 Review，未提交/未发布）

```text
U18 zcode 开发回交（待独立 Review，未提交/未发布）
目录 / 分支 / 接手 HEAD / 当前 HEAD：
  <repo> · main · 91b7bd90d1b3218772314ec1d37cb37d838ad6bd · 同接手 HEAD（工作区实现未提交，HEAD 不包含实现）
接手已有差异 / 本次实现文件：
  接手：README、CHANGELOG、PRODUCT_DESIGN、IMPLEMENTATION_PLAN、U16_DESIGN_SPEC（修改）＋ U18_ZCODE_HANDOFF、U18_DESKTOP_LAYOUT_DESIGN（新）＋ .claude/（未动）。
  本次实现（代码）：src/{main,RecurringPage,WishlistPanel,TaxonomyFields,SettingsView,AppearanceSettings,Stats,category-layout(新),taxonomy,ui,wealth,app-layout,taxonomy.css,visual-preview,wealth-preview}、tests/category-layout.test.mjs（新）；
  本次（工具/证据）：src-tauri/examples/u18_fixture.rs（新，验收后删）、.local/u18.conf.json、docs/verification/U18_DESKTOP_LAYOUT_RESULT.md、docs/ui/desktop-layout/（before 12 张＋after 83 张＋index.html）。
U18a–e 状态与未达出口：
  U18a–d 完成；U18e 完成但「原生 UI 行为验收」受阻未执行（AX 树退化＋无屏幕录制授权，§6.2）；U18r 待独立 Review。
实际根因与关键修复：
  心愿挤碎＝desktop-polish.css 桌面详情双列网格泄漏进 300px 检视器（ui.css 只覆盖了 padding）→ 检视器内单列＋指标上下排列＋金额 nowrap；
  周期付款记录竖排＝app-layout.css `.segmented button{width:26px}`（图标钮定宽）命中 `.recurring-tabs button`（同特异性、未设 width）＋窄窗表格/按钮无 nowrap → tabs/日期/金额/状态列 nowrap（名称备注仍换行）；
  分类看不全＝工具条 overflow-x:auto＋隐藏滚动条＋24px 渐隐 mask → 实测宽度排完整胶囊＋固定「更多分类」portal 菜单＋极窄选择按钮（planCategoryLayout 纯函数）。
最终检查命令及结果：
  npm run test:ui 0（173/173，含新增 7）· npm test 0（226/226）· npm run check 0 · npm run build 0 · git diff --check 0（详见 §3）
验证报告：docs/verification/U18_DESKTOP_LAYOUT_RESULT.md
视觉索引：docs/ui/desktop-layout/index.html
隔离原生 identifier / 包路径 / 虚构资料路径：
  local.possio.u18.acceptance · src-tauri/target/{release,debug}/bundle/macos/Possio U18 Acceptance.app · ~/Library/Application Support/local.possio.u18.acceptance/library（u18_fixture.rs 写入；正式库零句柄，正式版进程未触碰）
AC 通过 / 部分 / 未执行及原因：
  通过（浏览器＋自动）：AC01/02/03/04/06/07/10；部分：AC05（无匹配态截图缺）、AC08（返回点击冒烟缺）、AC09（原生系统跟随/重开缺）、AC11（键盘实际操作缺）、AC12（原生切库/重开行为缺）；原生行为整体受阻原因与复跑物料见 §6.2。
18组合视觉覆盖与缺口：
  1280×820/1080×760/800×600 × B/C/D × 浅/深 × 4 页面（心愿详情/周期付款/分类溢出/侧栏统计）共 72 张全齐＋菜单展开/极窄/大金额/设置入口 5 张特殊态；缺口＝原生像素截图未拍（环境权限）。
残余问题 / 与方案偏差 / Reviewer 重点：
  1) 原生行为验收整体待补（包与夹具就绪）；2) 分类读取失败的重试接线仅预留 props（当前失败态在设置页处理，菜单内未接 error 展示——如需按设计 §4.2 完整接线请 Review 裁定）；3) 窄窗分类栏独占一行（flex-basis:100%）是对工具条布局的响应式改动，超出「仅分类栏内部」字面范围但为可读性所需；4) 素材库页标题与页头重复为既有行为未处理。
```

## 10. 修订轮（Review R1–R7，2026-09-30）

第一轮独立 Review 为 **Request changes**（见 [U18_REVIEW_RESULT](U18_REVIEW_RESULT.md)）；本节按其 §4 要求的 R1→R2→R3→R4–R6→R7 顺序逐项记录修订与证据。首轮 §1–§9 保留为历史回交，与其冲突处**以本节为准**；未验项仍然标注未验，不冒称通过。

### 10.1 R1 · 分类溢出无限更新（P1，已修复并复验）

- **根因（两层）**：① `useLayoutEffect` 无依赖数组且每次提交重建 ResizeObserver，`measure()` 每次提交执行；② `planCategoryLayout` 每次返回新对象，`setVisible(plan)` 使 React 永不跳出更新 → 30 分类溢出时 `Maximum update depth exceeded`、主体空白。修订过程中另发现同源形状错误：**compact 计划（showMore:false）被映射为 null（＝全部可见）**，导致极窄栏渲染全部 39 颗胶囊而非选择按钮——已一并修复。
- **修复**（`src/TaxonomyFields.tsx`）：单一 `layout` 状态（null=全部可见），等值比较相同则返回原引用（React 跳出重渲）；`measure` 经 ref 供一次性挂载的 ResizeObserver 调用（`useLayoutEffect(…, [])`，生命周期稳定）；条目集/选中项以内容键 `entriesKey` 触发重测；compact 与溢出都写入状态。
- **真实组件交互测试**（`revision/interaction-test.mjs` + `revision-interaction.json`，ego-browser + CDP 视口模拟驱动生产组件、注入页面级错误捕获）：溢出首次进入（总览点「全部资产」）无 error、非空白；切「物品统计」再返回正常；CDP 四档尺寸变化（1080/800/560/1280）只重排不崩溃、无错误；选隐藏尾项外显唯一、焦点回触发钮；静置 1.5s chip 行 DOM 节点未被重建（无持续更新）。**6/6 通过**。修复过程中 compact 映射缺陷由该测试的 560/400 尺寸步骤暴露并回归覆盖。

### 10.2 R2 · 周期 tabs 仍 26px（P2，已修复并复验）

- **根因**：`wealth.css` 由 RecurringPage 组件导入，在 Vite 样式序中**先于** `app-layout.css`；同特异性下 `.segmented button{width:26px}` 后到仍胜出，`width:auto` 无效，`nowrap` 只把竖排改成横向溢出。
- **修复**（`src/wealth.css`）：`.wealth-section .recurring-tabs button{width:auto;min-width:0;white-space:nowrap}`（0,2,1 特异性压过 0,1,1，不再依赖样式序）。
- **实证**：交互测试第 6 项在 1280×820/1080×760/800×600 三尺寸 DOM 实测两按钮宽 **61/96px**、`ra.right ≤ rb.left`（不重叠）、`scrollWidth ≤ clientWidth`（文字完整）；三尺寸六组合 after 截图重拍并逐张人工审看通过（见 10.4）。

### 10.3 R3 · 长选中项容纳与无谓收起（P2，已修复）

- **修复**（`src/category-layout.ts`）：① 先判定「全部胶囊＋全部分类＋未分类」能完整容纳则直接全部展示（不出更多按钮，间隙按实际排布精确计算，恰好容纳不收起）；② 选中项外显位预留后仍容不下 → 转 compact，不再把更多按钮推出容器。
- **测试**：`tests/category-layout.test.mjs` 扩至 **12 项**（新增：全容不出更多、恰好容纳、空集合、外显位放不下转 compact、首位/末位/超长选中不重复不越界），12/12 通过。UI 实证：400×600 compact 截图（「分类：全部分类▾」单按钮）。

### 10.4 R7 · 视觉证据重做（P1，已完成；原生项维持未验）

- **受影响 after 全部重拍并逐张人工审看**：39 张（周期 18 ＋ 分类 18 ＋ 菜单展开 2 ＋ compact 1），每张拍摄前经 DOM 探测（关键控件存在、tabs 度量达标、菜单项数、compact 标签），拍后经像素空白检查（去底部标签条采样）。审看记录：周期 18 张——tabs 完整横排、日期/金额/状态完整、名称正常折行、三主题形态正确；分类 18 张——完整胶囊＋更多分类、无空白/崩溃、1080 下全容优先呈现 6 胶囊＋更多；菜单展开浅/深正常；compact 400×600 正常。心愿/侧栏 36 张首轮有效截图保留（该两页不挂分类栏，未受 R1 影响，Review 抽查确认有内容）。
- **before 全矩阵补齐**：以「临时文件交换＋HEAD 原版」方式补齐 **18 组合 × 4 页面 = 72 张** before（拍前 DOM 探测确认原版特征：分类栏渐隐截断、周期 tabs 度量 [26,26]、页标题「统计」、旧侧栏；抽查审看 C/D 主题样张确认缺陷状态真实呈现）。首次批量 before 被修复后代码污染的问题在首轮 §8 已记录，本轮全矩阵以 HEAD 原版重拍替代。
- **指纹绑定**：`revision/manifest.json` 记录 17 个实现/夹具文件的 SHA-256（代码指纹 `51b933f877d26011`）与 155 张截图的 SHA-256（before 72 ＋ after 83）；§3 的最终检查与本文截图均对应该指纹的源码。「临时换文件的 diff 行数一致」不再作为内容一致证明，一律以 `tsc`＋指纹核对。
- compact 特殊态尺寸由 560×600 改为 **400×600**：R3 的全容优先使 560 宽下不再触发 compact（行宽 382px 可容固定项＋更多），400 宽（行宽 207px）才是设计所指的极窄形态。

### 10.5 R4 · 时间轴模块开关（P2，已修复）

侧栏底部时间轴入口恢复 `modules.timeline` 门控（与关闭时退回总览的既有规则一致）；模块设置中该页名称同步为「物品统计」（仅列表标签，未全局替换业务术语）。端到端开关切换仍受预览不支持 `modules_set` 限制：静态门控＋关闭回退逻辑核对，原生/端到端标未验。

### 10.6 R5 · 设置子页返回（P2，已修复并验证）

- `openSubpage` 不再清除 `detailId`（来源详情状态随返回恢复）；来源记忆改为存入口按钮的**稳定 id**（`settings-open-materials`／`settings-open-trash`，设置区卸载后仍可定位），不再存即将卸载的 DOM 节点。
- 返回拆分双路径共用一套恢复逻辑：`backFromSubpage('origin')` 供鼠标可见「返回〈来源页〉」按钮（新增于素材库/最近删除页头）与 Esc——恢复来源 section＋detailId＋滚动＋入口焦点；`backFromSubpage('settings')` 供面包屑「设置」——回设置分组并恢复该组滚动与入口焦点（来源非设置时回落页头焦点）。普通表单关闭语义未动。
- **验证**（`revision/r5r6-verification.mjs` + `r5r6-verification.json`，8/8 通过）：素材库子页面包屑「设置／素材库」＋「返回设置」按钮存在；鼠标返回后 heading=设置且焦点在 `settings-open-materials`；面包屑路径同样恢复焦点；物品列表真实删除物品 → notice「前往最近删除」→ 子页 → 鼠标「返回物品」回到「我的物品／全部资产」。心愿删除引导本就没有「前往最近删除」入口（该入口属物品删除路径），验证改走真实物品链路。

### 10.7 R6 · 分类错误/重试接线（P2，已修复并验证）

`CategoryFilter` 调用接入 `error={taxonomy.loadError}` 与 `onRetry={taxonomy.reload}`；`disabled` 改为仅 `taxonomy.loading`（错误态不再整体禁用，恢复动作可达）。菜单在错误时展示原因＋「重试」，不呈现为「没有匹配的分类」；无错误时正常渲染。验证（同 10.6 JSON）：`?taxonomy-error=1`（预览夹具，dev-only）下触发钮可达可开、菜单显示虚构错误原因＋重试按钮、重试可点击无崩溃；无错误参数时分类正常渲染。首次失败/旧 snapshot 后失败/切库不残留由换库关菜单逻辑＋disabled 语义覆盖，重试成功路径以无错误加载复核（错误参数无法在重试中动态移除，属预览夹具边界）。

### 10.8 修订轮命令与状态

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | 173/173（含分类布局 12 项） |
| `npm test` | 0 | 226/226 |
| `npm run check`（fmt+clippy --all-targets） | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `git diff --check` | 0 | 通过 |
| 交互测试（revision/interaction-test.mjs） | 0 | 6/6 |
| R5/R6 验证（revision/r5r6-verification.mjs） | 0 | 8/8 |

U18c/d/e 状态更正：U18c＝分类溢出完成（R1/R3 修复＋交互测试＋视觉重验）；U18d＝导航与主题完成（R4/R5 补齐）；U18e＝修订轮证据完成，**原生 UI 行为仍为未验项**（首轮 §6.2 阻塞说明不变，不因本轮豁免）。

### 10.9 AC 矩阵更正（覆盖首轮 §7 的对应行；其余行维持）

| AC | 修订轮结论 |
|---|---|
| AC03 | **通过（浏览器＋自动；原生未验）**——R2 修复后 18 组合周期截图逐张审看通过，tabs 三尺寸 DOM 实测 61/96px 不重叠 |
| AC04 | **通过（浏览器＋自动；原生未验）**——R1/R3 修复后 18 组合分类截图逐张审看通过，无崩溃/空白/半个分类 |
| AC05 | **通过（浏览器＋自动；原生未验）**——搜索/空结果（`taxonomy-error` 菜单错误态与「没有匹配的分类」文案区分核对）、选中尾部外显、缩放、返回均有交互测试覆盖；首轮「通过/部分」表述矛盾以本行为准 |
| AC06 | **通过（浏览器＋自动；原生未验）**——分类矩阵与状态页共用规则在修复后 18 组合重验 |
| AC08 | **通过（浏览器；原生未验）**——鼠标返回按钮＋面包屑双路径、来源详情/分组/滚动/焦点恢复均实测（10.6） |
| AC10 | **通过（浏览器；原生像素未拍）**——before/after 72+83 张指纹绑定、逐张审看记录见 10.4；「18 组合完整前后对照」本轮成立 |
| AC11 | **部分**——菜单不裁切/触发钮命名/焦点还原已验；键盘方向键/Enter/Esc 与滚轮的实际操作仍未执行（缺口保留） |
| AC12 | **部分**——隔离与数据面通过；原生切库/重开行为未执行（不变） |

### 10.10 残余与交回

1. 原生 UI 行为（AC09 系统跟随/重开、AC11 键盘/滚轮、AC12 切库/重开、AC04/05 鼠标原生确认）维持未验；包与夹具就绪。
2. 交互测试与 R5/R6 验证脚本依赖 dev 预览夹具（`?category-fixture=30`、`?taxonomy-error=1` 等 sessionStorage/URL 参数，原生不触发）；脚本随 revision/ 目录留档可复跑。
3. 素材库页标题重复为既有行为（不变）；⌘⇧D 原生菜单与三态按钮并存为既有交互（不属六项范围）。

## 11. 第二修订轮（复审二 P2-1 与 P3-1~P3-4，2026-10-01）

前置：[第二轮独立复审](U18_REVIEW_ROUND2_RESULT.md)（Approve with nits，针对提交 `19f3360`）与[第二修订轮交接](../archive/handoffs/U18_ZCODE_REVISION2_HANDOFF.md)。本轮只处理 P2-1 与 P3-1~P3-4；§1–§10 历史保留，冲突处以本节为准。本轮改动已提交为 `4830238`（`19f3360` 之上）。

### 11.1 P2-1 · 分类菜单键盘焦点（已修复并真实按键验证）

- **根因确认**：`CategoryMenuPortal` 首帧以 `visibility:hidden` 挂载（`pos` 未算出），挂载即执行的 `searchRef.current?.focus()` 对隐藏元素静默失败；定位完成后无任何代码再次聚焦 → 焦点留在触发钮、方向键与键入全部失效。与复审复现一致。
- **修复**（`src/TaxonomyFields.tsx`）：定位改为 `useLayoutEffect` 同步完成（绘制前面板已可见）；聚焦 effect 以 `[pos === null]` 为依赖，仅在「隐藏→可见」转变时聚焦一次（重定位不抢焦点），带 `preventScroll`；错误态焦点落「重试」按钮（`data-cat-retry`），再退面板本身（面板加 `tabIndex={-1}`）。方向键改为「搜索框→各选项」序列循环：搜索框 ↓ 进第一个选项（即固定项「全部分类」）、第一个选项 ↑ 回搜索框、选项间沿序列循环；搜索框内 Enter 选中第一个匹配的具体分类（交接标注可选项，本轮已实现）；选项上 Enter 走原生点击。Esc 回触发钮、点外关闭、缩放/滚动关闭、`role="listbox"`/`aria-selected`/`aria-expanded` 语义未变；筛选语义、U17 入口与两层返回未触碰。
- **真实按键验证**（`revision/revision2-keyboard-test.mjs` → `revision/revision2-interaction.json`，**8/8 通过**；全部经 `page.keyboard.press/type`，未用 `fill`/程序化 click 绕过焦点——键入与聚焦以焦点存在为前提）：
  1. 1280 宽 30 分类：Tab 循环聚焦「更多分类」→ Enter → `document.activeElement` 为 `.cat-menu-search` 且面板 visible；
  2. 真实键入「望远」→ 搜索框值同步、选项过滤为固定两项＋望远镜与观鸟；
  3. ↓ 进第一个选项（全部分类）、↑ 回搜索框、↓ 到望远镜与观鸟 → Enter：菜单关闭、焦点回触发钮、选中项外显且 `aria-pressed=true`；
  4. 再次键盘打开 → Esc 关闭回触发钮，无页面副作用（无 dialog）；
  5. `?taxonomy-error=1`：键盘打开后焦点在「重试」，Enter 触发重试无报错；
  6. 鼠标路径回归（打开聚焦搜索框/点选/点外关闭）；
  7. 回归 R1（30 分类无页面错误）与 R2（800 宽 tabs 61/96px 不重叠）；
  8. 键盘打开菜单的证据截图 `after/category-menu-keyboard-1280x820-B-light.png`（搜索框聚焦环可见），已登记 manifest。
- 测试脚本三轮内的断言修正记录：触发钮可访问名含 ▾（断言改 startsWith）、列表第一个选项是固定项「全部分类」（预期据此修正）——均为测试预期修正，非产品改动。

### 11.2 P3-1 · 证据清单重生成（已完成）

`revision/manifest.json` 于 2026-10-01 重生成：仅列磁盘实际存在的文件——**before 72 ＋ after 79（含本轮新增键盘证据 1 张）＝ 151 张**，与目录计数一致；截图与 17 个源文件均用**完整 64 位 SHA-256**；代码指纹更新为 `3daab3b7137ece8af494d9ab300f0e92c961143e2fcd1ab8da4114c9664617af`（P2-1 改动 `TaxonomyFields.tsx`、`category-layout.ts` 后重算）；自校验缺失引用 0。首轮「155/83」为重生成前清单引用了 5 个已删除文件所致（第二轮复审已指出），报告/README/CHANGELOG 同步更正为 151/79。

### 11.3 P3-2 · index.html 陈旧表述（已更正）

删除「其余主题/模式的 before 不重复拍摄」；before 表改为脚本生成的 **18 组合 × 4 页面 = 72 链接**全矩阵（与 after 同构），静态链接与脚本生成名均经磁盘核对（144 个矩阵文件 0 缺失，另含特殊态链接）。

### 11.4 P3-3 · 窄窗残留登记（只登记，不改版式）

已在报告本节与 index.html「证据边界」登记：① 800×600 下 C/D 主题侧栏文字折行为既有表现（before 同存在）；② 800×600 短窗下侧栏「设置」「三态外观」在首屏外，需滚动侧栏到达——侧栏可滚动（scrollHeight 670 > clientHeight 600），满足「可达」但非首屏直视；③ 400×600 compact 截图右侧排序/视图控件被裁切并有横向滚动条——该尺寸低于 AC10 三档，仅为极窄收敛形态证明，不作 AC10 证据。未评估出「一行可修且不改已确认布局」的方案，故按交接只登记。

### 11.5 P3-4 · test:ui 数字更正与 reserveMore（已完成可选项）

- 数字：§10.8 的「173」为陈旧值。实际演进：首轮 166＋分类布局 7 项＝173（当时记录正确）→ 布局测试扩至 12 项后实为 178（复审实测值，作者未同步）→ 本轮新增 reserveMore 边界 1 项＝**179/179**（本轮实跑）。README/CHANGELOG 已更正。
- 可选项已做：`planCategoryLayout` 增加 `reserveMore` 入参——错误态触发钮必然出现，即使「恰好全容」也为其预留宽度（跳过全容早退）；新增边界单测（恰好全容＋错误态 → 触发钮预留、分类收入菜单；极窄＋错误 → compact），分类布局测试 **13 项全过**。

### 11.6 修订轮二命令与状态

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | **179/179**（含分类布局 13 项） |
| `npm run check`（fmt+clippy --all-targets） | 0 | 通过 |
| `npm test` | 0 | 226/226 |
| `npm run build` | 0 | 通过 |
| `git diff --check` | 0 | 通过 |
| 键盘交互测试（revision2-keyboard-test.mjs） | 0 | 8/8（真实按键） |
| R5/R6 既有断言重跑（r5r6-verification.mjs，结果不入库覆盖首轮） | 0 | 8/8 保持通过 |

### 11.7 AC 更正（覆盖前文对应行）

AC11 由「部分」更正为：**浏览器键盘路径通过（Tab/Enter/方向键/Esc/键入真实按键验证，P2-1 已修复），滚轮与原生未验**——原生部分维持未验，不写通过。其余 AC 行维持 §10.9。

### 11.8 残余与交回

原生 UI 行为（AC09、AC12 与 AC11 原生部分）维持未验；模块开关端到端、U17 分析页浏览器往返为复审记录的既有残余。本轮改动仅 `TaxonomyFields.tsx`、`category-layout.ts`、测试与文档/证据；U17 四函数与筛选语义 diff 无触碰。交回独立复审，不自行宣布验收。

### 11.9 第三次复审 nits 收口（2026-10-01）

复审对 `4830238` 的结论为 Approve with nits，两个 P3 已处理：① 分类栏的测量 effect 依赖补入 `!!error`，错误触发钮出现/消失时 `reserveMore` 预算随之重测（此前仅条目、选中项或容器尺寸变化才重测）；② 本报告 §11 首句「工作区改动未提交」已改为提交哈希。`manifest.json` 中该源文件哈希与代码指纹随之重算（方法写入 `fingerprintMethod`：按路径排序的「sha256  路径」行再取 sha256）。验证：`test:ui` 179/179、`tsc`/`build` 通过，真实按键键盘测试 10 项场景（含错误态与 compact）复测通过且无页面错误。原生未验项不变。

### 11.10 原生 UI 隔离验收（2026-10-01，合入 `d2670ce` 之后）

**环境**：`local.possio.u18.acceptance` 的 debug 包（`tauri build --debug --config .local/u18.conf.json`），数据为 §6.2 的虚构夹具；macOS 27.0.1，AX 与屏幕录制授权可用（§6.2 当时的「AX 树退化、无屏幕录制」阻塞不再成立）。运行期间 `lsof` 对 `local.possio.main` 句柄数 0，正式库未被打开；验收后正常退出。驱动方式：AX 读树与 AXPress、`screencapture` 取像素、`CGEvent.postToPid` 发真实按键。

| AC | 原生结果 |
|---|---|
| AC09 | **通过（系统外观实时变化除外）**：浅/深/跟随三态互斥，侧栏与设置页同步；浅色内容区背景 (255,255,255)、深色 (28,28,29)；选浅色→退出重开仍为浅色，选跟随系统→退出重开仍为跟随系统（深色系统下渲染为深色）。**未验**：App 运行中切换 macOS 外观——属系统设置，由用户自行触发 |
| AC11 | **键盘通过，滚轮未验**：焦点在「更多分类」按 Return 打开菜单并聚焦搜索框，菜单不被裁切；方向键逐项移动；Enter 选中「影音摄影」后该分类外显、触发钮变为「更多分类，当前影音摄影」、焦点回触发钮；Esc 关闭并还原焦点；输入 `zzq` 显示「没有匹配的分类」（补上 AC05 无匹配态缺口）。**滚轮未验**：合成鼠标事件无法移动光标，菜单未滚动，需真实鼠标确认。备注：搜索框有输入时第一下 Esc 未关闭、第二下才关；源码为无条件关闭，推测是系统中文输入法先取消组字，未在关闭输入法的情况下复测 |
| AC12 | **通过**：设置›样例›「查看样例」切入样例库（9 件资产/2 条心愿，「样例体验」横幅，无夹具内容串入）；「返回我的资料」回到夹具（4 件/3 条）；从样例视图直接退出重开进入我的资料，符合 U09「有记录时重启进入我的资料」 |

**过程记录**：一次盲按 Return 误入样例库（隔离身份，无风险），已返回并重开后重新核对 AC12 结论；此后每次按键前先读 `AXFocusedUIElement` 确认焦点。

**仍未验**：AC09 系统外观实时变化、AC11 滚轮、模块开关端到端、U17 分析页浏览器往返。AC04/05 的鼠标原生确认同样依赖真实指针，维持未验。
