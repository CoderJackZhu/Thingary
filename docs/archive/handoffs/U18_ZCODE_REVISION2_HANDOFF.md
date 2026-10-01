# U18 · zcode 第二修订轮交接

2026-09-30 · 交接材料已准备，开发未启动。执行者 zcode；本文是任务指派与修复方案，不授权修改运行环境、发版或安装。前置：[第二轮独立复审](../../verification/U18_REVIEW_ROUND2_RESULT.md)（Approve with nits）、[第一轮复审](../../verification/U18_REVIEW_RESULT.md)、[作者报告 §10](../../verification/U18_DESKTOP_LAYOUT_RESULT.md)、[首次交接](U18_ZCODE_HANDOFF.md)。

## 1. 基线与权限

- 起点：`main` 提交 `19f3360`（未发布）。重新核对实际状态，不回退到本文快照。
- 范围只限第二轮复审的 P2-1 与 P3-1~P3-4；不扩展 U18 六项范围，不改已确认的侧栏状态导航与页面分区，不碰 U17 的 `enterAnalysis/exitToAssetList/back/analysisCrumb`。
- 禁止打开 `/Applications/家底.app` 或旧版 App，禁止读写 `~/Library/Application Support/local.possio.main/`；浏览器预览与原生只用虚构数据，原生仅用身份 `local.possio.u18.acceptance`（夹具 `src-tauri/examples/u18_fixture.rs`）。
- 不修改 `.gitignore`、`.claude/`；未经当次授权不提交、推送、升版、发布、安装正式包、清理旧产物；不委派其他 agent。

## 2. 问题分析

### P2-1 分类菜单键盘不可用（必修）
根因：`CategoryMenuPortal`（`src/TaxonomyFields.tsx`）首次渲染样式为 `visibility:hidden`（`pos` 未算出），而聚焦搜索框的 `useEffect(..., [])`（约 182 行）在此刻执行；隐藏元素无法获得焦点，调用静默失败。之后 `pos` 设置使面板可见，但没有任何代码再次聚焦。连锁后果：焦点留在触发钮，方向键处理（`onKeyDown` 挂在面板上）收不到事件，键入文字也到不了搜索框。鼠标路径、Esc 关闭并回焦点均正常。

修复方案（最小）：
1. 用 `useLayoutEffect` 先定位（同步读取面板尺寸与触发钮矩形并 `setPos`），待 `pos` 非空、面板可见后再聚焦搜索框：`useEffect(() => { if (pos) searchRef.current?.focus({ preventScroll: true }); }, [pos === null])`，保证只在首次可见时聚焦一次，不因后续重定位抢焦点。
2. 方向键：搜索框内 ↓ 进入第一个选项，↑ 从第一个选项回到搜索框；选项间循环保持既有逻辑。Enter 在选项上选中并关闭；搜索框内 Enter 选中第一个匹配项（可选，先不做则在报告说明）。
3. 保持：Esc 先关菜单并回触发钮；点外部关闭；窗口缩放/滚动关闭；`error` 状态下菜单焦点落在「重试」按钮（没有搜索框可聚焦时回退到面板内第一个可聚焦元素，否则聚焦面板本身并 `tabIndex={-1}`）。
4. 触发钮 `aria-expanded`、菜单 `role="listbox"`/选项 `aria-selected` 语义不变。

### P3-1 证据清单不符
manifest 有 5 个不存在的文件引用，数量声称 155/after 83，实为 150/after 78；哈希截断。修复：重新生成 `revision/manifest.json`：仅列磁盘上实际存在的 before 72 + after 78（若本轮新增截图则如实增加），哈希用完整 64 位 SHA-256，代码指纹重新计算（P2-1 会改 `TaxonomyFields.tsx`），`screenshotCount` 与目录实际计数一致；报告与 README/CHANGELOG 中的 155/83 同步更正。

### P3-2 index.html 陈旧表述
删除/改写第 46 行「其余主题/模式的 before 不重复拍摄」；before 表补全为与 after 相同的 18 组合×4 页面链接（可沿用 after 的脚本生成方式），并检查所有链接文件存在。

### P3-3 窄窗残留登记
不强行改版式。在报告与 index.html「证据边界」中如实登记：800×600 下 C/D 主题侧栏折行为既有（before 已存在）；短窗下「设置/三态外观」需滚动侧栏到达（实测：sidebar `scrollHeight 670 > clientHeight 600`，滚动可达）；400×600 compact 下右侧控件被裁切，低于常规窗口，不属 AC10 三档范围。若执行中发现代码层一行可修（如 compact 下工具区允许换行），须先评估不改变已确认布局，再决定，不确定则只登记。

### P3-4 其他小项
- 报告 §10.8、CHANGELOG、README 中 `test:ui` 数字按实际重跑结果更正（当前 178；以本轮重跑为准）。
- 可选：`showTrigger` 由 `error` 触发而未计入宽度时，在全容判定中把 `more` 宽度计入（`planCategoryLayout` 增加 `reserveMore` 入参或外层传入 `fixed.more` 预留），并补一条边界单测；做了要补测试，不做则在报告说明为极端边缘。

## 3. 必须补的验证（不得再用 fill/click 绕过焦点）

新增/扩展 `docs/ui/desktop-layout/revision/interaction-test.mjs`（沿用 ego-browser 环境；无法运行时说明原因，并用等价真实按键脚本代替，脚本同样入库）：
1. 1280 宽、30 分类：Tab 聚焦「更多分类」→ Enter：断言 `document.activeElement` 是 `.cat-menu-search`。
2. 键入「望远」：搜索框值随之变化，选项被过滤。
3. ↓ 进入第一个选项；Enter 选中；菜单关闭、焦点回触发钮、选中项外显且 `aria-pressed=true`。
4. 再次打开，Esc 关闭并回触发钮；不穿透到页面（页面级 Esc 无副作用）。
5. `?taxonomy-error=1`：键盘打开后焦点在「重试」或面板，Enter 触发重试无报错。
6. 鼠标路径回归（点开后焦点同样进入搜索框；选项点击、点外部关闭）。
7. 回归：R1（30 分类无 Maximum update depth）、R2（tabs 三档不重叠）、R5、R6 既有断言全部重跑并保持通过；结果写入新的 `revision/revision2-interaction.json`，不覆盖首轮 JSON。

单元/组件层面：`category-layout` 测试保持 12 项通过（若做 P3-4 可选项则新增并说明）。

## 4. 命令与出口

```sh
npm run test:ui        # 应全过（当前 178）
npm run check          # fmt + clippy，仅 Mac
npm test               # Rust 226，仅 Mac
npm run build
git diff --check
```

重拍规则：P2-1 不改变视觉，无需重拍矩阵；但必须新增一张「键盘打开后菜单可见且搜索框聚焦」的 1280×820 B 浅证据，并在 manifest 中登记。若任何改动影响视觉，受影响组合须重拍并逐张人工审看（检查非空白）。原生 UI 仍为未验项：如环境具备则补 AC11 键盘/滚轮，否则继续标未验，不得写成通过。

文档同步：在 [U18_DESKTOP_LAYOUT_RESULT.md](../../verification/U18_DESKTOP_LAYOUT_RESULT.md) 追加「§11 第二修订轮」逐项记录（不改 §1–§10 历史，冲突处以 §11 为准）；更新实施计划 U18 状态、CHANGELOG、README 的相关数字；AC11 行改为「浏览器键盘路径通过，原生未验」等如实表述。完成后交回独立复审，不自行宣布验收。

## 5. 给 zcode 的启动 Prompt

```text
你是 zcode，接手 Possio（家底）U18「桌面布局修复与导航整理」第二修订轮。

先读（按序）：docs/verification/U18_REVIEW_ROUND2_RESULT.md、docs/U18_ZCODE_REVISION2_HANDOFF.md（本任务的完整方案，以它为准）、docs/verification/U18_DESKTOP_LAYOUT_RESULT.md §10、AGENTS.md。起点 main 提交 19f3360；先 pwd / git branch --show-current / git rev-parse HEAD / git status --short 并核对实际状态。

任务：只处理复审的 P2-1 与 P3-1~P3-4。
1. P2-1（必修）：src/TaxonomyFields.tsx 的分类菜单打开后焦点应进入搜索框。根因是面板首次渲染为 visibility:hidden，聚焦 effect 此时执行而失败。按交接文档 §2 方案：定位完成、面板可见后再聚焦一次；搜索框 ↓ 进第一个选项、↑ 回搜索框；Esc 回触发钮、错误态焦点落在「重试」。不得改变既有筛选语义、U17 分析入口与两层返回、已确认的侧栏与页面分区。
2. P3-1：重新生成 docs/ui/desktop-layout/revision/manifest.json，只列实际存在的截图，完整 64 位 SHA-256，数量与目录一致；同步更正报告/README/CHANGELOG 中 155/83 的数字。
3. P3-2：修正 docs/ui/desktop-layout/index.html 陈旧表述，before 表补全并核对所有链接文件存在。
4. P3-3：在报告与 index.html 证据边界中如实登记窄窗残留，不强行改版式。
5. P3-4：更正 test:ui 数字；可选项按交接文档说明处理并在报告写明取舍。

验证：按交接文档 §3 用真实按键（Tab/Enter/方向键/Esc/键入）写入 revision/interaction-test.mjs 并产出 revision/revision2-interaction.json；不得用 fill 绕过焦点。重跑 R1/R2/R5/R6 既有断言。运行 npm run test:ui、npm run build、git diff --check；Mac 上另跑 npm run check、npm test。新增一张键盘打开菜单的 1280×820 B 浅证据并登记 manifest。原生未验项继续标未验，不写成通过。

约束：禁止打开 /Applications/家底.app 或任何旧版 App，禁止读写 ~/Library/Application Support/local.possio.main/；原生只用隔离身份 local.possio.u18.acceptance；只用虚构数据；不修改 .gitignore、.claude/；不提交、不推送、不升版、不发布、不安装、不清理旧产物、不委派其他 agent。

交回：在 U18_DESKTOP_LAYOUT_RESULT.md 追加「§11 第二修订轮」，逐项记录修复与证据，更新 U18 实施计划状态，交独立复审，不自行宣布验收。
```
