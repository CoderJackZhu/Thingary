# investment-review：投资区间复盘独立组件

现行规则：`docs/PRODUCT_RULES.md`「实际收入分类与投资区间核对」。

**状态：组件已由 `InvestmentReviewHost.tsx` 接入本期复盘。** 本目录继续保持无数据库和无损益复算的展示边界；宿主通过 `wealth.ts` 的 `investment_review_read/list/save/trash` 使用原生 Store，使用相同的待核对回执机制。保存时原样传回读取到的两端内容键，领域层再次比对；原区间列表保留删除和恢复入口。全部测试与浏览器预览使用虚构资料，原生验收需单独记录。

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

Rust 纯计算入口（由 Store 与契约测试复用）：

```rust
use investment_review_component::{review_interval, endpoint_value_key, ReviewInput, ReviewResult};
let result: ReviewResult = review_interval(&input); // 纯内存计算
let key = endpoint_value_key(&endpoint);            // 确认时内容键
```

## 测试

- Rust 契约示例：`cargo test --manifest-path src-tauri/Cargo.toml --example investment_review_contract`（§13.5 全部样例、重复 ID、顺序、类型／counted 变化、空范围、缺余额、过期内容键、只改备注、重叠、端点顺序、数值边界）。
- 前端：`tests/investment-review-model.test.mjs`（载荷校验／格式化／草稿工具）、`tests/investment-review-component.test.mjs`（卡片与核对窗的真实处理器交互），由 `npm run test:ui` 执行。

## 宿主与领域职责（本目录不实现）

1. **事实适配**：Store 从两次完整盘点挑选同一投资范围的 counted 成员构造 `InvestmentEndpointV1`（账户 ID／类型来自财富模块，不可凭名称猜测）；金额未知传 null，不补零。
2. **区间确认与失效**：保存核对记录时由领域生成两端 `value_key` 一并保存；起止盘点更正、类型／集合变化或端点删除时撤销就绪状态（核心已按内容键复核，Store 负责触发重查并提示）。
3. **重叠查询**：`overlapping_active_flow_ids` 由 Store 查询同范围活动汇总得出后传入；新增中间盘点不自动摊开旧区间，替换旧汇总需显式操作并保留删除恢复语义。
4. **持久化／回执**：沿用 generation、revision、request_id、防重与结果未知核对；每个有效范围和区间最多一份活动汇总，修改原记录而非叠加。
5. **导出／备份**：投资区间汇总随保存能力一起进入 Excel 导出与完整备份（含未知／零、区间、范围与确认状态）。
6. **收入明细只作核对线索**：已记录利息／现金分红在核对窗旁展示，不再加进总损益；未关联来源／去向的收入进未归属明细，不猜测归属。
7. **旧估计保护**：新增投资收入类型不直接灌进原工资／普通收入推导；出现新增分类或更正且旧推导未适配时，"估计存下／推算花销"标"此区间暂不提供旧口径估计"。

## 独立预览与收尾边界

开发服务启动后打开 `/src/investment-review/preview/index.html`，可用 `?state=ready-profit|ready-negative|not-recorded|incomplete-flow|stale-endpoints|scope-changed|empty|error` 切换夹具（具体状态链接由页面列出），`&theme=dark` 切换主题。全部虚构；结果为固定成对夹具，提交仅回显草稿，不声称重新计算或真实保存。该 HTML 不在默认发布入口中。

组合结果金额校验按最多 1000 个账户的合计上界处理，转入／转出及单账户输入仍沿用原上限，不能用单账户上限拒绝合法组合结果。重叠即使尚无本期记录也先标为待复核。核对窗在区间不可用时不提交，勾选未支持情形会撤销完整确认；解除该选项后必须重新确认。已就绪结果仍提供修改入口；范围变化时保留期末新增账户的余额事实，缺失的期初显示“—”。

宿主须将 busy 用于提交进行中及结果未知的冻结状态，保留原请求并提供核对入口；本组件仍不持有回执、不查询 Store，也不实现跨窗口或重启恢复。宿主切换资料库或区间应重建窗口并丢弃普通未提交草稿。所有新核对／修改提交仍须领域验证、冲突检查和事务保存。

宿主显示本期分类事实，将旧口径估计折叠在历史参考中；收入分类使旧口径不安全时明确暂不提供估计。核对窗内的现金分红等明细只作线索，不参与损益计算。结果未知可关闭弹窗，原请求保存在页面共用回执中，核对前禁止重复写入。

整页浏览器预览可用 `investment=ready-profit` 等同名夹具注入固定领域输出；该预览明确拒绝保存，不用另写一份前端损益计算伪装原生持久化。独立组件预览保持虚构内存交互。
