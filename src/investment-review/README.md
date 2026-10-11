# investment-review：投资区间复盘独立组件

契约：`docs/PLANNING_SIMPLIFICATION_CONTRACT.md` §4；设计：`docs/PRODUCT_BOUNDARIES_DESIGN.md` §13（金额样例 §13.5）。

**状态：独立组件完成，尚未接入真实复盘。** 本目录是第二批 B2 的已备组件：不读数据库、不查询重叠、不做事务／回执、不持久化；输入与结果全部来自注入端口，测试与预览用虚构夹具。真实 Store、页面接入（`PlanningPage.tsx`／`IncomeDialog`）、schema 与导入导出由后续集成阶段完成（B1 收入分类 → B2 接入 → B3 全验）。

## 边界

- 损益公式只在 Rust 纯计算模块（`src-tauri/src/investment_review_component/`）中存在：`期末 − 期初 − 外部转入 + 对外转出`，整数分，带符号。UI 不复算损益、不汇总两端余额、不拼接内容键；余额变化与损益一律渲染端口返回的 `InvestmentReviewResultV1`。
- 比较条件：同一投资范围（相同账户 ID／类型／counted）、两端 counted 余额齐全；空范围是 `not_comparable/empty_scope`，不是零收益。类型仅 `investment/mixed/fund/bond`，现金／存款、公积金、负债混入按非法载荷拒绝。成员顺序不影响结果，重复 ID 是 `invalid`。
- 状态优先级：`invalid` → `not_comparable`（empty_scope、scope_changed、missing_balance）→ 引用／区间失效（stale_endpoints、overlapping_flow）→ `not_recorded`／`needs_review` → `ready`。理由使用稳定码（见 model.ts `REVIEW_REASONS`），UI 只做码→文案映射，不解析文案判断状态。
- 确认完整（`confirmed_complete=true`）时两个金额必须明确：留空是未知、`0` 是显式零，两者不同。流动区间为 `(期初, 期末]`。内容键（`endpoint_value_key`）由领域生成及复核，备注等非计算字段不在键内——备注更正不撤销确认，金额／日期／范围／类型更正会。
- 组件草稿（`FlowDraft`）只存在于调用方内存，关闭即丢弃；没有真实 ID／revision 的新输入由父级以草稿视图持有，提交后由 Store 建立记录，UI 不伪造已保存的修订号。

## 文件

| 文件 | 职责 |
|---|---|
| `model.ts` | 契约 DTO 镜像、载荷边界校验（parseReviewInput/parseReviewResult）、状态理由文案、分↔元转换与展示格式化、核对草稿类型与表单级检查 |
| `InvestmentReviewCard.tsx` | 展示卡：逐账户两端余额（来自输入事实）、按结果状态渲染损益／余额变化／理由与动作入口 |
| `InvestmentFlowDialog.tsx` | 核对窗：两个流动金额、未支持情形与完整确认、备注；受控草稿 + onDraftChange/onSubmit/onCancel 注入端口 |
| `fixtures.ts` | 虚构 input/result 夹具（§13.5 样例与各状态）；内容键为与 Rust 格式一致的字面量 |
| `investment-review.css` | 组件样式，只引用 `theme.css` 令牌 |

样式由集成方在页面引入（本目录组件不 import CSS，与 `planning-report` 一致）。

## 注入端口

```ts
// 展示卡：outer 为外围读取状态；ready 时 input/result 为端口载荷（unknown，组件内严格校验）
<InvestmentReviewCard outer={outer} onCheckFlow={…} onEditFlow={…} disabled={busy} />

// 核对窗：input 为当前区间（锁定的区间与账户表）；草稿由父级持有
<InvestmentFlowDialog input={input} initial={draft} issues={portIssues} busy={busy}
  onDraftChange={setDraft} onSubmit={draft => …} onCancel={() => …} />
```

`onSubmit` 只表达提交意图：调用方把 `draftToFlowPatch(draft)` 交给领域端口（未来 IPC / Store），收到 `rejected` 时把 `FieldIssueV1[]` 传回 `issues` 并保留草稿；`unresolved` 时冻结重复提交。组件不自行生成 request_id 或 revision。

Rust 侧入口（示例引入，未注册 IPC）：

```rust
use investment_review_component::{review_interval, endpoint_value_key, ReviewInput, ReviewResult};
let result: ReviewResult = review_interval(&input); // 纯内存计算
let key = endpoint_value_key(&endpoint);            // 确认时内容键
```

## 测试

- Rust 契约示例：`cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract`（§13.5 全部样例、重复 ID、顺序、类型／counted 变化、空范围、缺余额、过期内容键、只改备注、重叠、端点顺序、数值边界）。
- 前端：`tests/investment-review-model.test.mjs`（载荷校验／格式化／草稿工具）、`tests/investment-review-component.test.mjs`（卡片与核对窗的真实处理器交互），由 `npm run test:ui` 执行。

## 后续接入需求（本目录不实现）

1. **事实适配**：Store 从两次完整盘点挑选同一投资范围的 counted 成员构造 `InvestmentEndpointV1`（账户 ID／类型来自财富模块，不可凭名称猜测）；金额未知传 null，不补零。
2. **区间确认与失效**：保存核对记录时由领域生成两端 `value_key` 一并保存；起止盘点更正、类型／集合变化或端点删除时撤销就绪状态（核心已按内容键复核，Store 负责触发重查并提示）。
3. **重叠查询**：`overlapping_active_flow_ids` 由 Store 查询同范围活动汇总得出后传入；新增中间盘点不自动摊开旧区间，替换旧汇总需显式操作并保留删除恢复语义。
4. **持久化／回执**：沿用 generation、revision、request_id、防重与结果未知核对；每个有效范围和区间最多一份活动汇总，修改原记录而非叠加。
5. **导出／备份**：投资区间汇总随保存能力一起进入 Excel 导出与完整备份（含未知／零、区间、范围与确认状态）。
6. **收入明细只作核对线索**：已记录利息／现金分红在核对窗旁展示，不再加进总损益；未关联来源／去向的收入进未归属明细，不猜测归属。
7. **旧估计保护**：新增投资收入类型不直接灌进原工资／普通收入推导；出现新增分类或更正且旧推导未适配时，"估计存下／推算花销"标"此区间暂不提供旧口径估计"。
