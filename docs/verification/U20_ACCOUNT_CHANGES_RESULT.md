# U20 · 账户变化与盘点比较验证报告

日期：2026-10-02。范围：[产品设计 17.14](../PRODUCT_DESIGN.md#u20-product)、[U20 设计](../ui/U20_ACCOUNT_CHANGES_DESIGN.md)。**所有数据为虚构；本轮未读写正式库数据，未启动 `/Applications/物谱.app`。** 实现在 Mac 本机完成（区别于 U19 的 Linux 云端），全部检查在 macOS 原生执行。

## 1. 基线与改动

- 基线：main `f3ced53`（接手时工作区干净）。U20a–U20d 连续推进，未提交、未推送、未升版。
- 实际改动文件：
  - `src/wealth.ts`：新增 Compare/AccountHistory 类型与纯函数 `defaultRange`／`sortRows`／`cellText`；导出既有 `code()`；`import './asset'` 改为 `'./asset.ts'`（node 测试需显式扩展名，运行行为不变）。
  - `src/WealthChanges.tsx`（新）：「变化」分段组件；自己请求 `wealth_compare`/`wealth_account_history`，沿用 live 标志防竞态；`NOT_FOUND` 时回到默认区间并提示；历史按账户在当前数据版本内缓存。
  - `src/WealthPage.tsx`：分段改为 概览｜账户｜变化｜盘点记录；概览「与上次比较」卡加「看哪些账户带来变化 →」链接（带同一对日期）；`NetChart` 加可选 `label`（默认值不变）。其余逻辑未动。
  - `src/wealth.css`：控件行、排序分段（`.wealth-section` 前缀对抗 app-layout.css 的 26px 图标按钮，同 U18 经验）、行标签、展开按钮、展开历史底色、≤900px 隐藏 `col-kind`/`col-rate`。
  - `src/wealth-preview.ts`：预览实现 `wealth_compare`/`wealth_account_history`（规则与 Rust 一致）；新增 `?wealth=one`、`?wealth=compare-error`、`?wealth-fixture=compare`；`?wealth=missing` 从「改概览输出」改为「改底层数据」，使概览与比较共用同一份缺口。
  - `src-tauri/src/wealth.rs`：从 `wealth_summary` 抽出 `net_of` 与 `structure_of`（见 §4.1）；新增 `Compare*`/`HistoryRow`/`AccountHistory` 结构体与只读方法 `wealth_compare`、`wealth_account_history`。
  - `src-tauri/src/commands.rs`：`wealth_compare`、`wealth_account_history` 命令（spawn_blocking + `w.call`，WORKER 文案「暂时无法读取账户变化／账户历史」）；`src-tauri/src/lib.rs` 注册。capabilities 未改（现有 wealth 命令也未登记，已核对）。
  - `src-tauri/tests/wealth.rs`：新增 6 项测试；`src-tauri/examples/u20_fixture.rs`（新）：隔离验收夹具；`tests/wealth-changes.test.mjs`（新）：3 项前端测试。
  - `.local/u20.conf.json`：本机未入库配置（identifier `local.possio.u20.acceptance`，标题「物谱 · U20 隔离验收」）。

## 2. 命令与结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm run build`（tsc + vite） | 通过 | 仅既有的 chunk 大小提示 |
| `npm run test:ui` | 192/192 | 含新增 `tests/wealth-changes.test.mjs` 3 项 |
| `npm test`（cargo，含 fault-injection） | 38 个套件全部 0 failed | wealth 套件 18 项含新增 6 项 |
| `npm run check`（fmt --check + clippy -D warnings） | 通过 | 期间修复了新文件的 fmt 与 clippy 告警 |
| `npm run test:demo` | 2/2 | `demo-finance.json` 未改动，例行核对 |

## 3. W-AC01–W-AC09 逐条

| 编号 | 结论 | 证据 |
|---|---|---|
| W-AC01 | 通过 | Rust `u20_w_ac01_ac02_compare_reconciles_and_structures_by_kind`（金额按 17.14.6 写死：净资产 325,000→336,000 分即 +1,100,000、+338（3.38%）；逐账户 −800,000／+1,500,000／+200,000／+200,000；合计 = 净资产变化；房贷 `uncounted`）。界面：原生截图 `native-changes-default-1280.png`（夹含 W-AC04 账户故合计 +¥21,000 ＝ 11,000＋10,000，逐账户金额与文档一致）、浏览器 `changes-light-1280.png`（预览夹具数字不同，同样逐行可对账） |
| W-AC02 | 通过 | Rust 断言现金 1515→1239、投资 6061→6342、公积金 2424→2419，两端合计各 10000；金额 20000000→21500000。界面：结构表在浏览器与原生均按类型渲染、两端各 100%；**原生夹具多一个基金账户，占比与 17.14.6 的五账户样例不同（12.0/61.6/2.9/23.5），精确数字以 Rust 断言为准** |
| W-AC03 | 通过 | Rust `u20_w_ac03_unknown_endpoint_blocks_reconciliation`（未知不当 0、无对账行、已知合计 +19,000、缺失名单）；浏览器 `state-missing-1280.png`（缺 1 个账户：虚构储蓄卡，已知账户变化合计 +¥32,900）；原生 `native-changes-missing-scope-1280.png`（缺 1 个账户：信用卡，+¥10,000） |
| W-AC04 | 通过 | Rust `u20_w_ac04_account_opened_inside_the_range_counts_from_zero`（起点 `not_open`、tag `new`、按 0 参与影响 +1,000,000，对账仍成立 +2,100,000）；原生与浏览器均显示「新增账户」标签、起点「未启用」、无变化率 |
| W-AC05 | 通过 | Rust `u20_w_ac05_scope_change_blocks_the_rate_and_the_reconciliation`（group `scope_changed`、不进合计、整体无变化率）；原生选择 2026-09-20 为终点后显示「计入范围变化」标签、指标「—」、原因行「终点盘点缺 1 个账户；有账户改变了计入设置」 |
| W-AC06 | 通过 | 原生：概览「与上次比较」对比 2026-08-31、+¥21,000（+6.46%），变化分段默认日期 2026-08-31→2026-09-28，金额一致；点击链接后日期已选好（AX 树取证），`native-overview-link.png`。浏览器 `overview-before-1280.png`／`changes-via-link-1280.png` |
| W-AC07 | 通过 | 原生 `native-changes-expanded-1280.png`：展开证券账户显示 3 次已知金额趋势与表格（8/31 ¥200,000 —；9/20 ¥208,000 +¥8,000；9/28 ¥215,000 +¥7,000，升序）。未知留空不画 0：浏览器夹具中 9 月那次证券账户未知，展开图该月只有虚线标记（`changes-expanded-1280.png`） |
| W-AC08 | 通过（浏览器）；原生未验 | `state-one-1280.png`：只有一次盘点时「至少两次盘点后可以比较」且单账户历史可展开；`state-compare-error-1280.png`：局部「变化读取失败：…」＋重新读取，不渲染 ¥0，其他分段不受影响。原生未验：错误态需故障注入（不进普通构建），单次盘点需另建夹具身份 |
| W-AC09 | 部分 | 浏览器矩阵 3 尺寸（1280×820／1080×760／800×600）× 4 主题组合（默认浅/深、清新原生浅/深）共 12 张，均无横向裁切、金额完整；800×600 下类型/变化率列隐藏。原生 800×600 窗口截图无横向滚动，AX 树取证账户表「投资账户」类型格已不在树中（display:none）而结构表类型行保留。键盘：原生真实空格键切换展开行（展开↔收起，AX 标签取证）；浏览器 Playwright 键盘 Enter 展开/收起 ✓。**键盘切换日期未验**：日期是原生 `<select>`（与应用其余下拉一致），macOS 浏览器自动化中方向键不改变其值（平台行为），原生 App 内的键盘路径未测 |

## 4. 实现口径说明（与设计的偏差点，均为内部取舍，未改业务口径）

1. **`structure_of` 跳过未知金额**：设计要求「从 `wealth_summary` 原样抽出」。原内联代码把未知金额按 0 计入该类型槽位；抽出版本跳过未知条目。对 `wealth_summary` 不可观察（它只喂完整盘点，完整盘点的计入条目金额都已知，已有测试全部通过佐证）；对比较则是 17.14.4.4「未知不当 0」的正确落地。
2. **tag 优先级**：账户「起点未启用」且「终点已停用」（整个生命周期在区间内）时，单 tag 字段按「新增账户」优先。17.14.4.5 未定义此组合。
3. **`?wealth=missing` 预览行为**：由「只在概览输出上标记不完整」改为「把最近一次盘点的第一个已知金额置为未知」，概览与比较共用同一份缺口；概览显示与之前一致，且修正了此前 change_cents 残留的不一致。
4. **原生夹具**：含 6 个账户与 3 次盘点（8/31 全知、9/20 信用卡未知＋房贷临时计入、9/28 全知＋基金账户 10,000），一次建档覆盖 W-AC01/03/04/05/06/07 的界面核对；默认区间与概览一致。

## 5. 视觉证据

目录 [`docs/ui/u20/`](../ui/u20/)。浏览器截图均为 Chromium 无头、页面视口（visual-preview.html，1280×820 等尺寸）；原生截图均为 `screencapture -l<windowID>` 窗口级截图，**无整屏截图**。

| 文件 | 内容 |
|---|---|
| `changes-light-1280.png` / `changes-dark-1280.png` | 默认区间，浅/深（预览夹具：+¥32,400 对账成立、新增账户、房贷不计入） |
| `changes-{light,dark,native-light,native-dark}-{1280,1080,800}.png` | W-AC09 尺寸 × 主题矩阵（12 张） |
| `changes-expanded-1280.png` | 展开证券账户：趋势线（未知月只有虚线）＋历史表 |
| `state-one-1280.png` / `state-empty-1280.png` | 只有一次盘点；没有账户 |
| `state-missing-1280.png` | 终点不完整：未知行、原因行、已知账户变化合计＋缺失账户 |
| `state-compare-error-1280.png` | 读取失败＋重新读取 |
| `state-scope-1280.png` / `state-kind-sort-1280.png` | 计入范围变化＋缺失并存；按类型排序 |
| `overview-before-1280.png` / `changes-via-link-1280.png` | 概览链接与进入后的日期 |
| `native-changes-default-1280.png` | 原生默认区间：+¥21,000（+6.46%）、按影响排序、合计＝净资产变化 ✓ |
| `native-changes-expanded-1280.png` | 原生展开证券账户（W-AC07） |
| `native-changes-missing-scope-1280.png` | 原生 9/20 终点：未知＋计入范围变化＋已知合计（W-AC03/05） |
| `native-changes-narrow-800.png` | 原生 800×600（类型/变化率列隐藏由 AX 树取证） |
| `native-overview-link.png` | 原生概览「看哪些账户带来变化 →」与一致金额（W-AC06） |

## 6. 隔离与安全边界

- **未启动 `/Applications/物谱.app`，未读写正式库数据。** 正式应用（pid 29382）由用户本人于 2026-10-02 16:18 启动并全程运行，本工作未对其进行任何操作（未读取、未写入、未退出）。
- **`lsof` 口径说明**：交接要求「原生验收前后 lsof 确认对 `local.possio.main` 句柄数为 0」。因用户自身的正式应用正在运行，全机句柄数不可能为 0；改为核对本轮启动的验收进程（pid 56204）：运行期间 `lsof -p 56204` 对 `local.possio.main` 句柄数为 **0**，仅持有 `local.possio.u20.acceptance`（9 个句柄）；退出后无任何进程持有 `local.possio.u20` 路径。
- 验收包 `Possio U20 Acceptance.app`（identifier `local.possio.u20.acceptance`）由当前源码 + `.local/u20.conf.json` 构建；夹具经业务 API 写入（`u20_fixture` 带路径守卫，拒绝非隔离路径与符号链接）。
- 原生驱动：`scripts/native-acceptance/ax.swift`（AX 读树/AXPress、CGEvent 真实键盘鼠标、setsize）＋ `screencapture -l` 窗口截图。宿主终端的辅助功能与屏幕录制权限本轮均可用。
- 所有截图仅含应用窗口或页面，无整屏内容。

## 7. 已知问题与未验项

| 项 | 状态 | 说明 |
|---|---|---|
| 键盘切换日期 | 未验 | 浏览器自动化无法驱动 macOS 原生 `<select>` 菜单（方向键不改值）；原生 App 内未测。展开行键盘已验（原生空格、浏览器 Enter） |
| W-AC08 原生 | 未验 | 错误态需故障注入 feature（不进普通构建）；单次盘点态需另一份空夹具身份。浏览器证据已有 |
| 选中盘点被删除的回退 | 代码路径有，未动态取证 | `NOT_FOUND` 回默认区间并提示；Rust 层已断言已删除盘点报 `NOT_FOUND`（`u20_compare_rejects_reversed_ranges_and_deleted_check_ins`）。浏览器与原生都未在打开状态下动态删除盘点再观察 |
| 原生窄窗滚动 | 工具限制 | 合成滚轮事件未能滚动原生页面（PageDown 可用）；列隐藏与布局由 AX 树＋窗口截图取证 |
| 原生结构占比数字 | 与 17.14.6 不同 | 原生夹具多了基金账户（W-AC04 需要）；精确占比数字以 Rust 断言为准 |
| VoiceOver／系统外观实时切换 | 未验 | 沿用历轮边界，需本人操作 |

## 8. 交接状态

- U20a–U20d 全部完成；工作区保留全部改动（未提交）。**停在审阅**：由用户带回 Claude 复核；提交、升版、安装、发布均未做，等待授权。
- 复跑方法：浏览器部分 `npm run dev -- --port 1429` 打开 `/visual-preview.html`（参数见截图索引）；原生部分按[原生验收补做 §5](NATIVE_ACCEPTANCE_20261001_RESULT.md)（构建用 `.local/u20.conf.json`，夹具 `cargo run --manifest-path src-tauri/Cargo.toml --release --example u20_fixture -- "$HOME/Library/Application Support/local.possio.u20.acceptance/library"`）。

## 9. Claude 复核（2026-10-02）

- **看了什么**：完整差异（后端 `wealth_compare`／`wealth_account_history` 与 `net_of`／`structure_of` 抽取、命令注册、`WealthChanges.tsx`、`WealthPage.tsx`、`wealth.ts`、预览模拟、测试）、26 张截图的尺寸（全部为窗口或页面尺寸，没有整屏）与主要原生截图。
- **独立复跑**：`npm run build`、`npm run test:ui`（192/192）、`npm run check`、`npm test`（0 失败，wealth 新增 6 项全过）、`git diff --check` 全部通过。
- **口径核对**：对账在 `reconciled` 时按构造必然成立，不一致报 `WEALTH_COMPARE_MISMATCH`；未知不当 0；`not_open`／`closed` 按 0；`scope_changed` 不进合计；`structure_of` 跳过未知对 `wealth_summary` 不可观察（它只用完整盘点）。测试金额与 17.14.6 一致且写死。
- **复核修改（两处，前端）**：①「至少两次盘点」状态下的账户历史表用无 key 的 `<>` 包裹列表项，React 会报重复 key 警告，改为 `<Fragment key>`；② 展开历史里负债的「与前次」原来只写 `+¥2,000`，与主表「欠款 −¥2,000」写法不一致、容易误读，改为同样带「欠款」前缀。修改后 build 与 test:ui 192 项复跑通过。
- **zcode 提出的三点**：`lsof` 改为核对验收进程本身（对正式库 0 句柄）——接受，用户自己运行正式应用不违反隔离；`structure_of` 跳过未知——符合 17.14.4 第 4 条；「起点未启用且终点已停用」的 tag 取舍——该组合两端都在区间外，按 17.14 第 3 条整行不输出，实际走不到，无需取舍；`?wealth=missing` 改为改底层数据——只影响浏览器预览，使概览与比较一致，接受。
- **切库**：切换样例／我的资料与恢复备份都会整页重载，不存在旧资料金额残留到新资料的竞态。
- **结论**：可以合入。未验项（日期选择的键盘路径、W-AC08 原生、动态删除盘点的回退）维持第 7 节的记录。
