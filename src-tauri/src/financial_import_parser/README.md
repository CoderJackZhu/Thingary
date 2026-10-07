# 金融历史 CSV 导入解析组件（financial_import_parser）

状态：**组件已实现并通过独立测试；尚未接入产品。** 本组件实现
[组件契约](../../docs/PLANNING_COMPONENT_CONTRACTS.md) §2 的「金融导入解析」边界与
[金融历史导入设计](../../docs/FINANCIAL_HISTORY_IMPORT_DESIGN.md) 中可在纯解析层验证的
部分。它不依赖 Store、SQLite、commands 或文件系统，全部数据为虚构样例。

## 组件边界

| 输入 | 输出 |
|---|---|
| 一个 UTF-8 CSV 文本、列映射、已知账户目录（可空）、显式 `today`、取消回调 | 契约 v1 预览：标准行 / 盘点组 / 可定位问题 / 计数 |

组件**不做**：数据库查重与写入、事务与回执、账户映射的最终确认、列值清理规则
（货币符号、千分位、分转元由调用方在预览层让用户显式选择后再传入纯文本）。

## 入口

```rust
use thingary_lib::financial_import_parser::{parse_import_v1, parse_import_request_json, template_csv, ImportContext};

// 今天是显式校验上下文，便于固定测试；cancel 在检查点被轮询，返回 true 即中止。
let ctx = ImportContext { today: "2026-10-07", cancel: &(|| false) };

// 便捷入口：JSON 字符串 → 预览（解码失败映射为稳定码 CONTRACT_INVALID）。
let preview = parse_import_request_json(request_json, &ctx)?;

// 类型化入口：调用方自行反序列化 ImportRequestV1 后调用。
let preview = parse_import_v1(&request, &ctx)?;

// 模板：BOM + 表头 + CRLF，五种 kind 各一份。
let template = template_csv("incomes")?;
```

请求 JSON（v1 字段固定，未知字段忽略）：

```json
{
  "contract_version": 1,
  "kind": "incomes",
  "csv_text": "income_key,date,net_income,hpf_deposit,note\ni1,2026-09-30,12000.50,,工资\n",
  "column_mapping": {"编号": "income_key"},
  "existing_accounts": [
    {"external_key": "acc_1", "account_id": "一串稳定ID", "name": "工资卡",
     "kind": "cash", "enabled_from": "2024-01-01", "disabled_from": null}
  ]
}
```

预览 JSON（节选）：

```json
{
  "contract_version": 1,
  "kind": "incomes",
  "rows": [{"row_kind": "incomes", "source_row": 2, "income_key": "i1",
            "date": "2026-09-30", "net_income_cents": "1200050",
            "hpf_deposit_cents": null, "note": "工资"}],
  "groups": [],
  "issues": [],
  "counts": {"rows_read": 1, "rows_valid": 1, "rows_error": 0,
             "groups_valid": 0, "groups_invalid": 0,
             "groups_requires_account_context": 0,
             "duplicates_same": 0, "duplicates_conflict": 0}
}
```

## 固定语义（调用方必须遵守）

- **contract_version ≠ 1**、未知 `kind`、文件超 20 MiB、数据行超 50000、目录非法、
  取消触发：返回 `Err(ImportContractError)`，**不产生预览**。错误码见下表。
- 其余全部内容问题都在 `issues` 里带稳定 `code`；**任何 error 级 issue 都不得提交**。
- **source_row** = 记录起始物理行（1 起，含表头行）。引号内换行的记录跨多行，
  其所有行级问题都指向起始行；`CSV_FORMAT` 的问题文本给出出错字符的精确
  「第 X 行第 Y 列」（可能是续行），`column` 字段此时为出错行内字符列。
- **金额**：元、最多两位小数、十进制；解析为整数分输出 `*_cents` 字符串。
  无浮点、无指数、无千分位/货币符号、无静默舍入；`-0` 仅在允许负数的
  净资产参考里归一为 `"0"`。`hpf_deposit` 空为 null（未知），写 `0` 是字符串 `"0"`。
- **日期**：严格 `YYYY-MM-DD` 且日历合法（含闰年规则，年份 1900–9999），
  晚于 `today` 报 `DATE_FUTURE`。
- **键**：`account_key`/`snapshot_key`/`income_key`/`history_key` 去空白后 1–100 字。
  文件内重复键内容相同 → `DUPLICATE_KEY_SAME`（警告，保留首行）；
  内容不同 → `DUPLICATE_KEY_CONFLICT`（错误，保留首行）。同日同额不同
  `income_key` 永远是两笔。
- **列映射**：`column_mapping` 方向固定为 源列名 → 模板列名；源列名与模板列名
  相同的自动匹配；两个源列映射到同一模板列报 `COLUMN_MAPPING_CONFLICT`；
  目标不是模板列、源列不存在均致命（不产出行）。未映射的多余列给
  `EXTRA_COLUMN_IGNORED` 警告。
- **盘点（snapshots）**：提交单位是**组**而非行。组内日期必须一致、非空备注
  必须一致、一个账户一行、同一天只能一组。`groups[].validation` 取
  `valid` / `invalid` / `requires_account_context`：没有账户目录时永不声称完整；
  有目录时按「已启用且未停用（盘点日）」核对全部应盘点账户，缺行报
  `SNAPSHOT_MISSING_ACCOUNT`，账户未映射报 `ACCOUNT_UNMAPPED`，盘点日早于启用
  或不早于停用报 `ACCOUNT_NOT_ACTIVE`。目录里没有 external_key 的账户无法按键
  引用，不在导入侧完整性核对范围内（写入层仍须按真实数据库复核）。
- **计数口径**：表头解析成功时
  `rows_read = rows_valid + rows_error + duplicates_same + duplicates_conflict`。
  盘点行是账户级行数，盘点次数只看 `groups_*` 三个计数。字段数错误仍保留可辨认的组成员并使该组失效；组键无法辨认或 CSV 致命格式错误时，所有候选组失效。覆盖冲突行保留在 rows 供预览纠正，但只计入 rows_error，不计入 rows_valid；错误提示限流不影响完整的唯一错误行计数。
- **上限与容量**：20 MiB / 50000 数据行超限整体拒绝不截断；重复警告
  （`GROUP_REQUIRES_CONTEXT`、`ACCOUNT_NAME_CANDIDATE`、`ACCOUNT_KEY_MAPPED`、
  `EXTRA_COLUMN_IGNORED`）每码至多提示 100 条；`COVERAGE_OVERLAP` 至多 200 条，计数不受影响。

## 错误码表

硬错误（`Err`，无预览）：

| code | 含义 |
|---|---|
| CONTRACT_VERSION_UNSUPPORTED | contract_version 不是 1 |
| CONTRACT_INVALID | 请求 JSON 无法解析或缺少必需字段 |
| KIND_UNKNOWN | kind 不在五种支持类型内 |
| CONTEXT_INVALID | today 非法日期，或 existing_accounts 重复键/ID、非法日期/类型 |
| LIMIT_SIZE | 文本超过 20 MiB |
| LIMIT_ROWS | 数据行超过 50000 |
| CANCELLED | 取消回调返回 true |

行/文件级 issue（`severity: error` 阻止提交；`warning` 仅提示）：

| code | 类别 |
|---|---|
| CSV_FORMAT / CSV_COLUMN_COUNT | 编码/格式：引号、字段数 |
| EMPTY_FILE / NO_DATA_ROWS | 空文件 / 只有表头 |
| DUPLICATE_HEADER / MISSING_COLUMN | 表头重复 / 缺必需列 |
| COLUMN_MAPPING_CONFLICT / _UNKNOWN_TARGET / _UNKNOWN_SOURCE / EXTRA_COLUMN_IGNORED | 列映射 |
| KEY_REQUIRED / KEY_LENGTH / FIELD_NUL | 外部键与空字符 |
| NAME_REQUIRED / NAME_LENGTH / PLATFORM_LENGTH / NOTE_LENGTH | 名称/平台/备注长度 |
| KIND_INVALID / BOOL_INVALID | 类型与布尔 |
| DATE_INVALID / DATE_REQUIRED / DATE_FUTURE / ACCOUNT_DATE_ORDER | 日期 |
| AMOUNT_REQUIRED / AMOUNT_INVALID / AMOUNT_NEGATIVE / AMOUNT_RANGE | 金额 |
| STATE_INVALID / COVERAGE_RANGE_INVALID / COVERAGE_OVERLAP | 完整性区间 |
| DUPLICATE_KEY_SAME（警告）/ DUPLICATE_KEY_CONFLICT | 文件内重复键 |
| SNAPSHOT_DUPLICATE_ACCOUNT / SNAPSHOT_GROUP_DATE_CONFLICT / SNAPSHOT_GROUP_NOTE_CONFLICT / SNAPSHOT_DATE_CONFLICT | 盘点组冲突 |
| ACCOUNT_UNMAPPED / ACCOUNT_NOT_ACTIVE / SNAPSHOT_MISSING_ACCOUNT | 账户目录核对 |
| GROUP_REQUIRES_CONTEXT（警告） | 缺账户目录，组未声称完整 |
| ACCOUNT_KEY_MAPPED（警告）/ ACCOUNT_NAME_CANDIDATE（警告） | 已映射/同名候选 |

## 模板与虚构样例（本目录 `samples/`）

| 文件 | 内容 |
|---|---|
| accounts.csv | 6 个账户，含 2026-01-01 停用的信用卡与未计入净资产的房贷 |
| snapshots.csv | 24 个月末完整盘点组（136 行），前 16 组含信用卡、后 8 组不含 |
| incomes.csv | 24 个月工资 + 同日同额不同键的奖金 + 一个明确零收入月 + 一个缴存未知月 |
| income_coverage.csv | 三段相邻 (from_date, to_date] 声明：complete / partial / unknown |
| net_worth_history.csv | 4 个历史总额参考点，含负值 |

全部数据虚构，可直接用于明日接入的手工与自动验证；`tests/financial_import_parser.rs`
用 `include_str!` 加载同一批文件作为样例回归。

## 明日 Store 接入步骤（由拥有方实施）

1. 在 `lib.rs` 登记模块：`mod financial_import_parser;`（子模块路径已显式声明，
   两种引入方式布局一致），commands 增加预览入口并把 IPC 载荷反序列化为
   `ImportRequestV1`。
2. 入口先校验文件字节（UTF-8、20 MiB）得到 `csv_text`，再把用户列映射整理为
   `column_mapping`；`today` 取本地自然日。
3. 解析 accounts 后，把「数据库现有账户 ∪ 本次解析出的账户（键为 account_key）」
   组装成 `existing_accounts` 目录再解析 snapshots，跨文件口径才完整。
4. 预览层展示 rows/groups/issues/counts；error 级 issue 阻止确认；`*_cents` 与
   null 原样传给写入层，不得先经过浮点。
5. 写入层独立完成：数据库查重（同键同值=相同、不同值=冲突）、外部键命名空间、
   完整性终检（真实账户有效期）、事务提交、回执与备份提醒——这些都不在本组件。

## 未验与边界

组件验证范围对应验收编号 I01（24 个月样例的完整组、映射、分金额）、I02（未知
缴存与明确 0）、I03（同日同额不同键保留）、I05（缺账户/空金额/重复行报组错）、
I06（总额参考独立类型）、I07（BOM/引号/换行/中文/非法日期/指数/超两位小数）、
I12（超限拒绝与取消）。**未验**：I04 预览后修改冲突、I08 故障注入回滚、I09 回执
重试、I10 切库失效、I11 备份恢复、原生选文件与解析进度取消 UI——这些属于数据库
与原生集成层，不能用内存桩冒充通过。
