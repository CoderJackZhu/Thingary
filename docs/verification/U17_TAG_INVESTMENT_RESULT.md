# U17 · 标签投入分析 zcode 开发与自测记录

状态：**修订轮完成（独立 Review R1–R4 已修复、证据已补），等待原对话复审；未提交、未合并、未推送、未安装正式版**。业务规则唯一依据[产品设计 D23](../PRODUCT_DESIGN.md#u17-product)，界面见[U17 设计](../ui/U17_TAG_INVESTMENT_DESIGN.md)，技术契约[ADR-001 §25](../decisions/001-local-desktop.md#u17-technical)。独立 Review 原始发现见[U17_REVIEW_RESULT](U17_REVIEW_RESULT.md)（不修改其历史记录；本报告按其修订 Prompt 逐项回填）。

## 1. 基线与变更边界

- 目录 `<repo>`，分支 `main`，接手 HEAD `6cc4189ecbed56a6b0301abd2cb9a86bc307c6b4`（与交接一致；交付时 HEAD 不变，**工作区实现未提交，HEAD 不包含 U17 实现**）。
- 接手时已有文档差异（保留、未改动语义）：README、CHANGELOG、PRODUCT_DESIGN、IMPLEMENTATION_PLAN、FUNCTIONAL_SPEC、USER_GUIDE、ADR-001、U16_DESIGN_SPEC、U17_TAG_INVESTMENT_DESIGN（新）、U17_ZCODE_HANDOFF（新）、未跟踪 `.claude/`（未动）。
- zcode 新增改动：
  - 后端：`src-tauri/src/tag_investment.rs`（新，只读聚合）、`commands.rs`（命令 `tag_investment_view`）、`lib.rs`（模块与注册）、`demo.rs`（样例标签事实）、`demo-assets.json`（`label` 字段）。
  - 前端：`src/tag-investment.ts`（新，类型与纯展示辅助）、`src/TagInvestment.tsx`（新，子视图组件）、`src/main.tsx`（入口、两层返回、顶栏、⌘A 守卫、切库失效、预览截图入口）、`src/visual-preview.ts`（预览内存实现与夹具）、`src/ui.css`（组件样式）。
  - 测试：`src-tauri/tests/tag_investment.rs`（新，10 项）、`tests/tag-investment.test.mjs`（新，10 项）。
  - 证据与工具：`docs/ui/tag-investment/`（mockup.html、design/ 35 张、actual- 27 张、index.html、capture-design.mjs、capture-actual.sh、native/ 12 张）；`.local/u17.conf.json`（隔离配置）；`src-tauri/examples/u17_fixture.rs`（验收夹具工具，未提交）。
- 报告自身与最后测试代码一致：最终检查（§3）在最后一次代码改动（ui.css 的 tag-scope 按钮样式）之后执行。

## 2. 实现核对（ADR 25.6）

| 接线 | 实际结果（与 ADR 25.6.1 一致） |
|---|---|
| 标签存储与筛选 | `named_choices(kind='label')` + `asset_preferences.payload.$.label_id`；筛选白名单校验（`catalog.rs` `Query.label`），分析入口仅选中具体标签 ID 时出现（`main.tsx` `.analysis-entry`） |
| 命令与库身份 | `commands::tag_investment_view`（`spawn_blocking`+`Worker::call`，随样例/我的资料切换）；响应 `generation` 来自 `Store::generation()`；同库失效用 `page` 对象更新驱动重查，未新建计数表 |
| 两层返回 | 列表→分析（保存 `collectionRef` 滚动）→详情（保存分析 `viewScroll`/`focusAsset`）→分析（重查+恢复）→列表（恢复滚动与筛选）；`source.ts` 的 `beginReturn` 未被占用，不影响既有来源跳转 |
| 顶栏/快捷键 | 分析激活时 `topbarFor` 只返回搜索（无 `newRecord`/`menu`），`set_page_menu` 禁用 ⌘N；⌘A 在 `selectAllRef` 直接返回；Esc 先详情回分析、再分析回列表（均有源码断言与原生验证） |
| 修改刷新 | 既有保存回调的 `refresh()` 使 `page` 更新，分析以其为依赖重查；标签改名/停用经 `possio-choices-changed` 刷新名称 |
| 样例与预览 | `demo.rs::import_one` 经 `change_choices`+`options.preferences` 写入「摄影」标签（确定性请求 ID）；`prepare()` 的 marker 保证既有样例库不被改写；浏览器预览 `visual-preview.ts` 内存实现共享 `demo-assets.json` 事实 |

- 接口与 ADR 25.5 冻结契约一致；唯一偏差：items 不携带图标引用（U17 表格无图标列，视觉稿与实现一致），已在 ADR 注明。
- 无 schema 迁移、无新依赖、无新业务表；`Cargo.toml`/`package.json` 未改。

## 3. 命令与结果（2026-09-30）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | 160/160（含 U17 新增 10 项） |
| `npm test`（fault-injection） | 0 | 226/226（含 `tag_investment` 10 项） |
| `npm run check`（fmt+clippy -D warnings） | 0 | 通过，无警告 |
| `npm run build`（tsc+vite） | 0 | 通过（保留既有大块体积提示） |
| `npm run test:demo` | 0 | 2/2（样例含标签事实后仍通过） |
| `git diff --check` | 0 | 通过 |
| `cargo build --example u17_fixture` | 0 | 夹具工具构建通过 |

### 3b. 修订轮命令与结果（2026-09-30，最终代码状态）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm run test:ui` | 0 | 166/166（含 R1–R4 与乱序执行测试共 6 项新增/重写） |
| `npm test` | 0 | 226/226 |
| `npm run check` | 0 | 通过 |
| `npm run build` | 0 | 通过 |
| `npm run test:demo` | 0 | 2/2 |
| `git diff --check` | 0 | 通过 |

## 4. AC 证据矩阵

| AC | 数据层（Rust） | 前端/浏览器 | 原生 | 结论 |
|---|---|---|---|---|
| AC01 范围与基准 | `ac01_…`：历史 4 件 ¥36,000/¥5,000/¥31,000、排行镜头/机身/旧机身/配件、当前持有 3 件 ¥31,000 回收 0 | 预览正常态截图 | 历史、当前持有（夹具含缺失态，已知 ¥36,200/¥31,200 与 D23 AC03 数字一致） | **通过** |
| AC02 维护/售出去重 | `ac02_…`：两笔维护 600+400 只加一次；售出只减一次；`expense_view` 与 generation 读取前后不变 | — | 支出页投影无重复由 `expenses`/`insights` 回归（226 全过）覆盖 | **通过（自动证据）** |
| AC03 缺失语义与补录 | `ac03_…`：已知 ¥36,200/¥31,200、缺失计数 (1,1,2)、完整值 null、不完整组排后按已知降序、补录后 ¥36,600 完整 | 已知部分截图 | 分析含缺失态：行内「已知 ¥9,790 · 待补录」、占比 — | **通过** |
| AC04 五种状态 | `ac04_…`：空/全排除/全未知/全零/混合各自计数与标志断言 | 实现：空、全排除；设计稿：全未知/全零/混合 | 未逐一在原生构造 zero/all-unknown/mixed 夹具 | 首轮：自动+浏览器；修订轮补三组合实现截图+渲染断言 → **通过**（§7b.1） |
| AC05 仅 statistics 排除 | `ac05_…`：排除镜头后 3 件 ¥21,000/¥16,000；total/daily/timeline 开关不改资格 | — | — | **通过（数据层）** |
| AC06 更正/撤销/负净 | `ac06_…`：更正 ¥6,000 后净 ¥30,000；撤销后回收 0 且当前持有含该件；单件回收超投入净 −¥20 | — | — | **通过（数据层）** |
| AC07 标签身份与删除恢复 | `ac07_…`：改名保留 ID、停用可分析、删除后 `LABEL` 错误、不合并同名（`CHOICE_NAME` 既有约束）、改标签整体转移、独立删除维护不复活 | — | 删除镜头后：移出该行，已知 ¥21,200/净 ¥16,200 | **通过** |
| AC08 全量与搜索 | `ac08_…`：103 件完整响应、同额稳定 ID、搜索字段齐全 | 搜索只缩明细断言（测试 4） | 搜索「备用」：明细 1/1、汇总仍全部 4 件 | **通过** |
| AC09 刷新/失效/备份 | 晚响应守卫（组件 ticket 成功与失败均校验，测试 7） | 切库清空断言（测试 6） | 原生：详情往返刷新 ✓、范围快速切换 ✓、样例↔我的资料切换清空无残留 ✓（样例分析、切回）、重开持久 ✓；备份创建成功（410KB，解包核验 7 件 + 摄影 标签）；**恢复链路未完成**：文件选择面板不接受 AX 键盘/选择驱动（⌘⇧G、类型选择、行 AXPress、Return 均不生效），替换自动备份文件被列表校验拒绝（显示「暂无备份」） | 首轮：部分（恢复面板受阻）；修订轮以 AX 几何+坐标点击完成恢复集成链 → **通过**（§7b.3） |
| AC10 失败/溢出/日期 | `ac10_…`：注入 9e18 分 → `OVERFLOW`；售出状态不一致 → `SALE`；非法 scope/日期 → `QUERY`/`DATE` | 读取失败截图（原因+重试，不显示部分汇总） | 故障注入仅在测试构建 | **通过（自动+浏览器）** |
| AC11 视觉与键盘 | — | 索引：B/C/D × 浅/深 × 1280×800/800×600 12 组设计/实现对照 + 默认主题状态补齐（27 张实现） | 原生：⌘F 聚焦并搜索 ✓、⌘N 无动作 ✓、⌘A 不进批量 ✓、Esc 详情→分析→列表 ✓、面包屑两级 ✓；比例只用数字+横条不用颜色 ✓；**原生三主题截图未拍**（浏览器对照已覆盖） | 首轮：部分；修订轮补拍原生三主题 6 张 + 同夹具对照 → **通过**（§7b.4） |

## 5. 视觉证据

- 设计稿 `docs/ui/tag-investment/mockup.html`（静态，可交互切换主题/状态/窗口；`?capture=1&…` 截图模式）+ `design/` 35 张。
- 实现 `actual-*.png` 27 张（浏览器虚构预览，统一样例「摄影」标签：Fujifilm X100V ¥9,790＋维护 ¥300、随身录音设备 ¥1,000 日期待补充）。
- 索引 index.html：35 行、62 链接全部有效；每组注明对照说明（数据来源差异、窄窗折行）。
- 工具记录：ego-browser 的 `Page.captureScreenshot` 全部 CDP 超时（连 about:blank），`/Applications/Google Chrome.app` 为指向未挂载卷的失效别名；实际使用 ZCode 内置浏览器（IAB，设计稿截图）与 `/Volumes/DATA/APPs/Google Chrome.app` headless CLI（`capture-actual.sh`，实现截图）。设计稿截图脚本 `capture-design.mjs` 记录了这一切换。

## 6. 原生证据与资料隔离

- 隔离身份 `local.possio.u17.acceptance`（`.local/u17.conf.json`，窗口 1280×800，无故障注入）；debug bundle 位于 `src-tauri/target/debug/bundle/macos/Possio U17 Acceptance.app`（本地签名，未公证、未安装）。
- 虚构资料 `~/Library/Application Support/local.possio.u17.acceptance/library`：由 `src-tauri/examples/u17_fixture.rs` 经业务 API 写入（D23 基准五件 + 无标签两件；金额以分计 1,200,000 等）。
- **正式库保护**：全程未打开/读写 `local.possio.main`；启动前 `lsof` 发现用户既有的正式版进程（01:29 启动的 `/Applications/家底.app`，早于本会话）持有正式库句柄——非本次操作，未触碰；U17 进程 `lsof` 核对对正式库句柄数为 0。备份/恢复演练只用 `/tmp/possio-u17/backup.possio`（已核验 7 件，不入库；`~/Documents` 误存的字面名文件与被替换的自动备份文件均已清理）。
- 原生操作：Swift AX 工具（`AXManualAccessibility` + AXPress/AXValue/CGEvent，临时编译于 /tmp，不入库）驱动：列表→筛选标签→查看投入分析、范围切换、搜索（AXValue 直写触发 React onChange）、行→详情、Esc/面包屑两层返回、删除→刷新、设置→样例切换→重开、⌘F/⌘N/⌘A。截图 12 张（`native/`）。

## 7. 自检重点与残余问题

- **缺失不冒零**：`has_known_*` 三标志区分未知与确定零（数据层 ac03/ac04 + 组件「待补录」主值）。
- **占比分母**：完整且 T>0 才计算；搜索/分段不改分母（原生搜索截图：明细 1/1、汇总 4 件）。
- **跨页**：103 件夹具断言完整响应与汇总全量。
- **售出回收**：单列不抵扣；回收超投入净投入为负不截零（ac06）。
- **两层返回**：Esc 层级与面包屑原生验证；详情改价后返回重查（`refresh()` 驱动）。
- **竞态**：组件 ticket 对成功与失败响应都校验（测试 7）；读取中修改由 `page` 依赖重查，原票据作废（`version` 变化触发 effect 重新发请求）。
- **⌘N/⌘A**：分析中无新增动作、无批量选择（原生验证 + 源码断言）。
- **未知回执/普通关闭未改坏**：全部编辑器与回执流程未触碰；226 项 Rust 测试与 160 项 UI 测试全过。
- **残余问题（修订轮后）**：
  1. ~~AC09 恢复交互未完成~~ → 已解决：AX 几何 + CGEvent 坐标点击完成全链（§7b.3）；该驱动方式依赖窗口未被遮挡，复审复现时需保持 App 前台。
  2. ~~AC11 原生三主题截图未拍~~ → 已补拍 6 张（§7b.4）。
  3. ~~AC04 三组合无实现截图~~ → 已补浅/深 6 张 + 渲染断言（§7b.1）。
  4. 保存面板把 POSIX 路径存成字面文件名——系首轮驱动方式所致，非产品缺陷；已清理。
  5. 新增已知限制：`R1 渲染断言` 测试经 tsc 预编译到 `node_modules/.cache/u17-render`（不入库、随跑随建）；其为组件级 SSR 断言，不覆盖 useEffect 内的请求时序（该部分由 `requestTagView` 执行测试覆盖）。

## 7b. 修订轮：R1–R4 修复与证据补齐（2026-09-30，依据 U17_REVIEW_RESULT）

### 修复明细（逐 R 编号）

| R | 修复位置 | 行为/渲染测试（tests/tag-investment.test.mjs） | 结果 |
|---|---|---|---|
| R1 未知维护冒零 | `src/tag-investment.ts`（`purchaseSummaryText`/`maintenanceSummaryText`/`maintenanceCellText`）+ `src/TagInvestment.tsx`（摘要行与明细单元格三处改用统一函数） | `R1 维护分项：…`（4 态文案执行断言）、`R1 明细维护单元格…`、`R1 渲染断言：内存 DTO 夹具真实渲染组件…`（tsc 预编译 + renderToStaticMarkup，断言「维护 待补录」且无「维护 ¥0」冒零） | 通过 |
| R2 停用标签无入口 | `src/tag-investment.ts`（`labelFilterOptions`）+ `src/main.tsx`（筛选下拉映射全部选项并标注「（已停用）」，移除 enabled 过滤） | `R2 停用标签保留在筛选选项并标注`（执行断言 + main.tsx 守卫） | 通过；原生复验见 §6b |
| R3 侧栏不退出分析 | `src/main.tsx` `browseStatus` 增加 `setAnalysis(null)` | 浏览器行为复验（见下） | 通过 |
| R4 切范围不重置分段 | `src/tag-investment.ts`（`analysisAfterScopeChange`：scope+shown 重置 TAG_PAGE_SIZE，保留关键词/列表上下文）+ `src/main.tsx` `analysisScope` 调用 | `R4 切范围重置明细分段并保留关键词…`（执行断言）；浏览器 150 件行为复验（见下） | 通过 |

### 行为复验（浏览器虚构预览，ZCode 内置浏览器驱动真实 DOM 点击）

- **R3-a**：进入分析（baseline 夹具）→ 点侧栏「使用中」→ 分析区消失、列表 6 行、页头/高亮一致为「使用中」。
- **R3-b**：分析内开详情 → 点侧栏「已退役」→ 分析与详情同时消失、显示列表；随后 Esc 不返回已退出的分析/详情（DOM 断言 analysis=false、detail=false）。
- **R4**：`?tag-fixture=many`（150 件）→ 加载更多至「已显示 150/150」→ 切「当前持有」→ 「已显示 100/共 130」；切回历史全部 → 「已显示 100/共 150」。两范围均重置首段。

### 乱序响应：执行测试（替换原源码正则断言）

`src/tag-investment.ts` 新增 `requestTagView(send, alive, …)`（模式同 `source.ts openSourceRequest`），组件 `useEffect` 改用该编排。测试 `乱序响应（执行测试）…` 以真实延迟 Promise 验证四场景：旧成功晚于新成功 → `late`；旧失败晚于新成功 → `late`；当前票据失败 → `failed` 带信息；失效后晚失败 → `late`。原「源码正则」测试已删除，`requestTagView` 断言为执行级。

### 单位统一（Review §2.5）

Rust 夹具全部改为 D23 元基准（12000 元 → `Some("1200000")` 分等），断言同步 ×100：基准购入 ¥3,500,000 分、累计 ¥3,600,000 分、净 ¥3,100,000 分；AC03 补录后 ¥3,660,000 分；AC08 批量为 `i*10000` 分、同额 ¥9,999,900 分。本报告 §4 首轮矩阵中的「¥36,000/¥31,200」等描述按分计值对应的元金额应读为 ¥36,000 元 = 3,600,000 分（首轮 Rust 断言为分值 36000 分 = ¥360，同比缩放检验算法；本轮已按原金额重写并全部通过）。原生夹具 `u17_fixture.rs` 首轮即为正确元基准，非缺陷。

### 验收工具隔离边界（Review §2.7）

`src-tauri/examples/u17_fixture.rs`：所有模式在 `Store::open` 之前校验——拒绝符号链接（`symlink_metadata`）、`canonicalize` 后要求路径包含 `local.possio.u17.acceptance`；负向验证：`u17_fixture /tmp/definitely-not-isolated` 以 panic（exit 101）拒绝，隔离路径放行并打印 `isolation-checked`。

### AC 证据补齐（对 Review §2 逐项）

1. **AC04 → 通过**：三组合实现截图（浅/深）`actual-b-*-unknown/zero/mixed-1280x800.png` + 渲染断言（R1 渲染测试覆盖未知态）+ 既有数据层断言。unknown 夹具含费用未知维护记录（R1 复现态）。
2. **AC07 → 通过**：原生复验（重建含修复的隔离包）——选项管理停用「摄影」后，筛选下拉出现「摄影（已停用）」（AXMenuItem 断言），选中并进入分析成功：截图；只读 SQL 核验 `enabled=0`。
3. **AC09 → 通过（本轮补齐集成链）**：备份创建（410KB）→ UI 删除「镜头」（分析移出该行）→ 设置「从备份恢复」选择备份 → 「检查备份」→「恢复…」→「确认替换当前资料」→ 应用重载 → 只读 SQL：7 件、镜头在库、摄影 `enabled=1`（停用被回滚至备份时点）→ 重进分析：镜头回归、已知 ¥36,200、净 ¥31,200：截图。面板驱动方式：AXPress/Return/⌘⇧G/双击均无效，最终以 AX 几何 + CGEvent 坐标点击完成（焦点窗口置前后），未绕过任何校验。
4. **AC11 → 通过（原生补拍）**：隔离 App 内 B/C/D × 浅/深 6 张分析页原生截图 `native/ac11-native-{b,c,d}-{light,dark}.jpg`（每张截图前以 AX 树断言「摄影」标题与「物品投入明细」在场）；同夹具对照：设计稿与实现均使用 D23 摄影基准四件（`actual-b-*-baseline-1280x800.png` 与 mockup normal）。

## 8. 回交摘要

```text
U17 zcode 修订轮回交（R1–R4 已修复、证据已补，等待复审，未提交/未发布）
目录：<repo>
分支 / 接手 HEAD / 当前 HEAD：main / 6cc4189ecbed56a6b0301abd2cb9a86bc307c6b4 / 6cc4189ecbed56a6b0301abd2cb9a86bc307c6b4（实现未提交）
接手已有文档与本次新增改动：接手差异=README/CHANGELOG/PRODUCT_DESIGN/IMPLEMENTATION_PLAN/FUNCTIONAL_SPEC/USER_GUIDE/ADR-001/U16_DESIGN_SPEC/U17 设计与交接文档；新增=tag_investment.rs(聚合+命令)、demo 标签事实、tag-investment.ts/TagInvestment.tsx/main.tsx 接线、预览实现、2 个测试文件、tag-investment 证据目录、u17.conf.json、u17_fixture example
已完成阶段 / 尚未达到出口的阶段：U17a–d + 修订轮（R1–R4 修复、AC 证据补齐）完成；复审由原 Codex 对话进行
验证报告：docs/verification/U17_TAG_INVESTMENT_RESULT.md
视觉索引：docs/ui/tag-investment/index.html
最终测试命令与结果（修订轮，见 §3b）：test:ui 166/166；npm test 226/226；check 通过；build 通过；test:demo 2/2；git diff --check 通过（2026-09-30）
隔离原生 identifier / 包路径 / 虚构资料路径：local.possio.u17.acceptance / src-tauri/target/debug/bundle/macos/Possio U17 Acceptance.app / ~/Library/Application Support/local.possio.u17.acceptance/library
AC 通过 / 部分 / 未执行及原因：AC01–11 全部通过（修订轮补齐 AC04/07/09/11，见 §7b；AC09 恢复链以 AX 几何+坐标点击完成，复审复现需保持 App 前台）
业务或技术偏差 / 已知风险：items 不带图标引用（ADR 已注明）；无 schema/依赖变化；渲染测试依赖 tsc 预编译产物（node_modules/.cache，不入库）；首轮面板字面文件名为工具产物已清理
待 Reviewer 重点核对：R1 渲染断言路径（tests/.render 输出与 SSR 归一化）、R2/R3/R4 行为测试与浏览器复验记录、requestTagView 执行测试四场景、AC07/09/11 原生新证据、demo.rs marker 对既有样例库的保护
```

（首轮回交摘要原文保留如下）
```text
U17 zcode 开发回交（待独立 Review，未提交/未发布）
