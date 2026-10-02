# U20 · 账户变化与盘点比较：开发方案

日期：2026-10-02。状态：**方案已确认，未实现。** 进度只在[实施计划 U20](../IMPLEMENTATION_PLAN.md#u20)维护。

业务规则、口径、状态与验收样例 W-AC01–W-AC09 的唯一来源是[产品设计 17.14](../PRODUCT_DESIGN.md#u20-product)（决策 W-D01–W-D05 已确认）。本文件只写界面与技术落地，不重复口径；两者冲突时以产品设计为准，并先回报，不自行取舍。

## 1. 范围

**做：** 财富页新增「变化」分段（两次盘点的逐账户比较、按类型的结构比较、可展开的单账户历史）；概览「与上次比较」卡片加一个进入链接；两个只读后端命令；浏览器预览与测试。

**不做：** schema 迁移、写操作与回执；侧栏或其他页面改动；账户分段的「变化」小链接（W-D04）；转账配对、收益归因、结构趋势图（W-D05）；外币；导出。概览其余布局不动。

## 2. 界面

### 2.1 入口与分段

- `WealthPage` 的 `Tab` 增加 `'changes'`，分段顺序 **概览｜账户｜变化｜盘点记录**（`segmented`，沿用现有按钮与 `aria-pressed`）。
- 概览「与上次比较」卡片：当 `lastComplete?.compared_to` 存在时，说明行下方加一个文字按钮「看哪些账户带来变化 →」（`link-cell` 样式），点击切到「变化」并带上同一对日期（起点＝`compared_to` 对应的 point，终点＝`lastComplete`）。没有可比日期时不显示该按钮。
- 顶栏搜索：现有逻辑「在概览／盘点记录输入搜索会切到账户分段」同样适用于「变化」分段（输入关键词即切到账户），不在「变化」里另做搜索。
- 选中的分段与日期只存在组件状态里，不写偏好；从别的页回来回到默认（沿用现有财富页行为）。

### 2.2 「变化」分段布局

文字线框见产品设计 17.14.3。组件要点：

1. **区间选择**：两个原生 `<select>`（`aria-label` 为「起点盘点」「终点盘点」），选项为全部盘点日期，不完整的标「（不完整）」；「与上次」按钮恢复默认区间。起点必须早于终点：改动后若不满足，自动把另一端调到相邻的合法日期，不弹错误。
2. **指标行**（`ui-metrics`，三格）：金融净资产变化（带变化率，条件见口径 3、8）、资产变化、负债变化。不可对账时三格显示「—」，下方说明原因（「终点盘点缺 1 个账户」「有账户改变了计入设置」）。
3. **账户表**（`ui-table`）：列为 账户（名称＋平台小字）｜类型｜起点｜终点｜变化｜对净资产｜变化率｜展开。
   - 负债的金额写「欠 ¥5,000」，变化列写「欠款 −¥2,000」，对净资产列写「+¥2,000」（W-D02）。
   - 「未启用」「已停用」「未知」以文字显示在对应金额格；「新增账户」「已停用」「计入范围变化」以小标签显示在名称下方。
   - 排序 `segmented`［按影响｜按类型］：按影响＝对净资产影响的绝对值降序，未知排最后；按类型＝资产类型顺序（与 `assetKinds`、`liabilityKinds` 一致）再按账户位置。只在前端排序，不重新请求。
   - 表尾：可对账时「合计（计入净资产） +¥11,000 ＝ 净资产变化 ✓」；不可对账时「已知账户变化合计 +¥19,000」并列出缺失账户名。
   - 「不计入净资产」单独一个小节，同样的列，不进合计。计入范围变化的行放在计入组内并带标签，不进合计。
4. **结构比较**（`ui-table`，资产按类型）：类型｜起点金额与占比｜终点金额与占比｜占比变化（百分点，两位小数）。任一端不完整时标题旁标「仅已知部分」。
5. **单账户历史**：行尾展开按钮（`aria-expanded`，键盘可用）在该行下方插入一行，内容为
   - 小趋势图：复用 `NetChart`，把历史行映射为 `Point`（`net_cents`＝金额，`complete`＝金额已知），未知只画虚线标记、不画 0。为此给 `NetChart` 加可选 `label` 属性替换写死的「金融净资产趋势」可访问名称，默认值保持原文，不影响概览。
   - 表格：日期｜金额｜与前次｜状态（录入／未变／未知）｜计入。
   - 首次展开时请求 `wealth_account_history`，同一账户在当前数据版本内缓存；读取失败只在该展开行显示错误与重试。
6. **说明**：标题旁 `Info`（ⓘ）写「变化含存取、转账、消费与估值，不等于投资收益；按盘点当时的类型和计入设置计算」。

### 2.3 状态

按产品设计 17.14.5：没有账户／没有盘点沿用财富页引导；只有一次盘点显示「至少两次盘点后可以比较」（若有账户，仍提供账户列表供展开历史）；读取失败显示「变化读取失败」＋「重新读取」，不渲染 ¥0，不影响其他分段；当前选中的盘点被删除或变化时（`NOT_FOUND`）回到默认区间并提示。

### 2.4 尺寸与主题

- 1280×820、1080×760、800×600，四个主题组合中至少「清新原生」浅／深与默认主题浅／深。
- 窗口宽度 ≤ 900 时隐藏「类型」「变化率」两列（`col-kind`、`col-rate`），变化率仍可在展开历史中看到；金额不截断、不横向滚动整页。表格可以在自身容器内横向滚动作为最后手段，但 800×600 下默认列必须放得下。
- 只用现有 tokens、`ui-card`、`ui-metrics`、`ui-table`、`segmented`、`Info`、`NetChart`；不加依赖、不加新颜色。新增样式写在 `wealth.css`。

## 3. 技术方案

### 3.1 后端（`src-tauri/src/wealth.rs`，不新文件、不迁移）

先抽出共用函数，避免与 `wealth_summary` 两套算法：

- `fn net_of(s: &Snapshot) -> Result<(i64, i64)>`：返回计入范围内已知的 (资产, 负债)。`wealth_summary` 改为调用它，行为不变。
- `fn structure_of(s: &Snapshot, side: &str) -> Result<Vec<Share>>`：从 `wealth_summary` 里现有的按类型统计原样抽出。`wealth_summary` 改为调用它，行为不变。

新增：

```rust
pub struct CompareCell {
    /// entered | unchanged | missing | not_open | closed
    pub state: String,
    pub amount_cents: Option<String>,   // entered/unchanged 有值；not_open/closed 为 None 但按 0 参与
    pub counted: Option<bool>,          // 有盘点行时为当时的设置
}
pub struct CompareRow {
    pub account_id: String, pub name: String, pub institution: String,
    pub side: String, pub kind: String,           // 优先取终点行，其次起点行
    pub from: CompareCell, pub to: CompareCell,
    pub change_cents: Option<String>,             // 账户自身方向：to − from；任一端 missing 为 None
    pub effect_cents: Option<String>,             // 资产＝change；负债＝−change
    pub rate_hundredths: Option<i64>,             // 仅资产且起点已知金额 > 0
    /// counted | uncounted | scope_changed
    pub group: String,
    /// new（起点 not_open）| closed（终点 closed）| None
    pub tag: Option<String>,
}
pub struct CompareEnd { pub snapshot_id: String, pub date: String, pub complete: bool, pub missing: usize }
pub struct StructurePair { pub kind: String, pub from_cents: Option<String>, pub from_share: Option<i64>, pub to_cents: Option<String>, pub to_share: Option<i64> }
pub struct Compare {
    pub generation: String,
    pub from: CompareEnd, pub to: CompareEnd,
    /// 两端完整且没有 scope_changed 行时为 true；此时下面三项与变化率才有值
    pub reconciled: bool,
    pub net_change_cents: Option<String>,
    pub assets_change_cents: Option<String>,
    pub liabilities_change_cents: Option<String>,
    pub net_rate_hundredths: Option<i64>,         // 起点净资产 > 0 时
    pub known_effect_cents: String,               // counted 组已知 effect 之和，总有值
    pub missing_names: Vec<String>,               // 任一端为 missing 的计入组账户名
    pub rows: Vec<CompareRow>,                    // 后端按账户 position 输出；排序交给前端
    pub structure: Vec<StructurePair>,            // 资产，按 ASSET_KINDS 顺序，两端并集
}
pub fn wealth_compare(&self, from: &str, to: &str) -> Result<Compare>;
```

规则落地（与产品设计 17.14.4 一一对应）：

1. 两个 id 都要是未删除的盘点，否则 `NOT_FOUND`；`from.date < to.date`，否则 `Error::new("WEALTH_COMPARE_RANGE", "起点盘点须早于终点")`。
2. 单元格：有盘点行且金额非空 → 该行的 `state`（`entered`／`unchanged`）；有行无金额 → `missing`；没有行时，账户 `opened_on > date` → `not_open`，`closed_on <= date` → `closed`，其余（应盘未盘）→ `missing`。
3. 两端都是 `not_open`／`closed` 的账户不输出行（区间外的账户）。软删除的账户不出现（它们从未进过盘点）。
4. `group`：两端都有行且 `counted` 不同 → `scope_changed`；否则取存在的那一端的 `counted`（两端都有则相同）→ `counted`／`uncounted`。
5. `not_open`、`closed` 按 0 参与 `change`／`effect`；`missing` 使 `change`、`effect`、`rate` 为 `None`。
6. `reconciled` 时，`net_change = net(to) − net(from)`（用 `net_of`），并核对它等于 counted 组 `effect` 之和；不相等说明实现有误，返回 `Error::new("WEALTH_COMPARE_MISMATCH", "账户变化与净资产变化对不上，请反馈")`，不要静默或改用其中一个数。
7. 金额累加用 `i64::checked_add`（沿用 `sum`），溢出给 `WEALTH_OVERFLOW`；比率用现有 `hundredths`。
8. `structure`：两端各自 `structure_of(.., "asset")`，按类型配对；某端没有该类型时金额与占比为 `None`。

```rust
pub struct HistoryRow { pub snapshot_id: String, pub date: String, pub state: String, pub amount_cents: Option<String>, pub counted: bool, pub change_cents: Option<String> }
pub struct AccountHistory { pub generation: String, pub account: Account, pub rows: Vec<HistoryRow> }
pub fn wealth_account_history(&self, account: &str) -> Result<AccountHistory>;
```

- 账户不存在或已删除 → `NOT_FOUND`。只列该账户有盘点行的、未删除的盘点，按日期升序。
- `change_cents` 与列表中紧邻的前一行比较，两行金额都已知才有值（不跨过未知去找更早的值）；负债按账户自身方向（欠款）计算，界面另行解释。
- 单条 SQL 取该账户全部行（`fin_snapshot_entries JOIN fin_snapshots`），不逐次调用 `snapshot()`。

### 3.2 命令

`commands.rs` 新增 `wealth_compare(from: String, to: String)` 与 `wealth_account_history(account: String)`，形状与 `wealth_snapshot` 相同（`spawn_blocking` ＋ `w.call`，错误文案「暂时无法读取账户变化」）。`lib.rs` 的 `invoke_handler` 注册。应用自定义命令不需要改 `capabilities/main.json`（现有 wealth 命令也未登记），实现时核对一次。

### 3.3 前端

- `src/wealth.ts`：新增与 3.1 对应的类型；纯函数 `defaultRange(points: Point[]): { from: string; to: string } | null`（返回 snapshot id：有 `lastComplete.compared_to` 时用这一对；否则有 ≥2 个盘点时用最后两个；否则 `null`）、`sortRows(rows, mode)`、`cellText(cell, side)`。这些纯函数放在 `wealth.ts` 以便 node 测试直接导入。
- 新文件 `src/WealthChanges.tsx`：「变化」分段组件，props `{ summary: Summary; accounts: Account[]; initial?: { from: string; to: string } | null }`。自己请求 `wealth_compare`，沿用 `live` 标志防竞态与 `retry` 模式；`summary.generation` 变化时丢弃缓存的历史。
- `src/WealthPage.tsx`：分段、概览链接、把 `initial` 传给 `WealthChanges`；`NetChart` 加可选 `label`。其余逻辑不动。
- `src/wealth-preview.ts`：为浏览器预览实现 `wealth_compare` 与 `wealth_account_history`，规则与 Rust 一致，数据取自现有 `demoFinance` 快照；`?wealth=error` 时两者也报错，新增 `?wealth=compare-error` 只让 `wealth_compare` 报错以便取证局部错误，`?wealth=one` 只保留最近一次盘点。

### 3.4 不改

schema、备份格式、`wealth_summary` 的输出（只做函数抽取）、盘点录入、账户表单、侧栏、概览其他卡片、`demo-finance.json` 的已有数据（如需新增样例账户以覆盖 W-AC04，只追加，不改已有金额，并跑 `npm run test:demo`）。

## 4. 测试

- **Rust**（`src-tauri/tests/wealth.rs` 追加，沿用文件里的 `open`、`yuan` 等辅助函数）：W-AC01–W-AC05 的数据层断言，金额以产品设计 17.14.6 为唯一来源，测试里直接写死期望值，不调用被测函数自身来算期望；另加 `from>=to` 报 `WEALTH_COMPARE_RANGE`、已删除盘点报 `NOT_FOUND`、`wealth_account_history` 的升序与「未知不跨越」、`wealth_summary` 输出在抽取前后一致（用已有测试覆盖即可，确认未改动）。
- **前端**（新增 `tests/wealth-changes.test.mjs`）：`defaultRange` 的三种情况、`sortRows` 两种模式与未知排最后、`cellText` 的负债与未启用／已停用／未知文案。
- **全套**：`npm run build`、`npm run test:ui`、`npm test`、`npm run check`；若改了样例数据加 `npm run test:demo`。

## 5. 取证与验收

- 浏览器预览（`npm run dev -- --port 1429`，`/visual-preview.html`）：W-AC09 的尺寸与主题矩阵，加正常、只有一次盘点（新增 `?wealth=one`，只保留最近一次盘点）、不完整（`?wealth=missing`）、读取失败（`?wealth=compare-error`）、空（`?wealth=empty`）五种状态；改前（概览）与改后同尺寸截图。**只截应用窗口或页面，不截整屏。**
- 隔离原生：身份 `local.possio.u20.acceptance`（`.local/u20.conf.json`，仿照 `.local/u19a.conf.json`），用虚构数据按 W-AC01–W-AC07 建档核对；`lsof` 确认对 `local.possio.main` 句柄数为 0。可用 `scripts/native-acceptance/ax.swift` 驱动，做法见[原生验收补做第 5 节](../verification/NATIVE_ACCEPTANCE_20261001_RESULT.md)；需要宿主终端有辅助功能与屏幕录制权限，没有就如实记为未验。
- 结果写入 `docs/verification/U20_ACCOUNT_CHANGES_RESULT.md`：基线提交、命令与结果、W-AC 逐条证据或未验原因、截图索引。没做的不写成通过。

## 6. 任务拆分

| 阶段 | 内容 | 出口 |
|---|---|---|
| U20a 预览稿 | 先只做前端与 `wealth-preview.ts` 的模拟实现，出 1280×820 浅／深色对照 | 截图可审阅；发现产品口径问题先回报 |
| U20b 后端 | 3.1 的抽取与两个命令、Rust 测试 | W-AC01–05 数据层断言通过；`wealth_summary` 回归不变 |
| U20c 接线与状态 | 前端接真实命令、五种状态、展开历史、窄窗 | 前端测试通过；尺寸矩阵截图 |
| U20d 验收与记录 | 全套检查、隔离原生、验证报告、USER_GUIDE 财富一节、CHANGELOG（未发版条目） | W-AC01–09 逐条有证据或未验说明；停在审阅 |
