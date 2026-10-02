# U19 · 售出保值率（统计页）开发方案与设计

日期：2026-10-01。状态：**已实现并自测（2026-10-01）；原生 UI 验收未做。** 实际进度见实施计划 U19。 来源：用户对比「有数」的洞悉功能后，选择只做保值率（平均保值率、总盈亏、排行），目标进展总览与文字摘要不做。产品设计 6.1 节已把「售出保值率」列为 P1（售价 ÷ 购入价；购入价为零或未知时不计算），本方案是它的落地。

本文件同时承载业务规则、界面、技术与任务拆分，因为范围只有统计页一张卡。规则与验收已迁入[产品设计 D29](../PRODUCT_DESIGN.md#d29-product)，进度登记在[实施计划 U19](../IMPLEMENTATION_PLAN.md#u19)，本文件只保留界面与技术部分。

## 1. 范围

**做：** 统计页新增「售出保值率」卡：平均保值率、总盈亏、总回收率、按保值率排序的明细、未参与清单。顺带修正同页「回收分析」卡的回收率口径（见 D29）。

**不做：** 新页面或侧栏入口；数据库迁移；按期间筛选；二手估值或对未售出物品估算保值；维护费计入保值率；目标进展总览；文字摘要；任何 AI。

## 2. 业务规则与验收

业务规则、回收分析口径修正、验收样例与 AC01–AC11 已迁入[产品设计 D29](../PRODUCT_DESIGN.md#d29-product)，本文件不再重复，只保留界面、技术与任务。原第 3 节（回收分析口径）一并迁入；以下编号保持原样，故没有第 3 节。

## 4. 界面

位置：统计页现有「日均成本排行」卡之后，独立一张卡，不新增侧栏入口，不改页面分区；复用 U16 的 tokens、`ui-card`、`ui-metrics`、`ui-table`、`segmented` 与既有 SVG，不引入新依赖。

文字线框（布局契约，不作为已验证视觉稿）：

```text
售出保值率                                          ⓘ
[平均保值率 61.67%] [总回收率 69.53%] [总盈亏 −¥3,900]
3 件参与 · 总购入 ¥12,800 · 总售出 ¥8,900
[从高到低 | 从低到高]
#  物品    购入价     售出价    差额       保值率
1  耳机    ¥2,000    ¥2,400   +¥400     120.00%
2  相机    ¥10,000   ¥6,500   −¥3,500    65.00%
3  键盘    ¥800      ¥0       −¥800       0.00%
▸ 2 件未参与：手机 购入金额未知 · 赠品 购入价为 ¥0，不计算
```

- 指标行三格，说明文字在数值下方。ⓘ 写明：只用购入价与售出价，不含维护费；平均为每件同权、总回收率按金额加权；购入价未知或为 ¥0 的物品不参与。
- 差额沿用 `changeText`，负数使用同一负号与颜色语义，不只靠颜色（带 +/− 符号）。保值率沿用 `rateText` 的负号，但本卡保值率不为负，显示为无符号百分比，需要时在实现中另写 `percentText`，不改 `rateText` 既有行为。
- 物品名是可聚焦按钮，打开原档案，沿用日均排行的 `onOpenAsset`；长名称截断并保留完整可访问文本。
- 不加图表：保值率明细已是排行，表格足够；若后续需要，只加数字加小横条，不加饼图。
- 状态：加载中；读取失败（带重新读取）；没有已售出物品（「还没有售出记录」）；有已售出但全部不可计算（指标显示「—」，下方只有未参与清单，不出现空表格、不出现 0% 或除零）；正常；只有一件可计算（平均与总回收率相同，照常显示）。
- 读取失败只影响本卡，不阻塞页面其他卡。切换排序方向不重新请求。

## 5. 技术方案

**后端**（`src-tauri/src/insights.rs`，不新增文件、不迁移表）：新增 `Store::resale_rate(today)`，单条 SQL 取已售出物品与有效售出记录，避免逐件读取：

```text
assets a JOIN sales s ON s.asset_id=a.id AND s.revoked_at IS NULL
WHERE a.deleted_at IS NULL AND a.lifecycle_state='sold'
  AND NOT EXISTS(… json_extract(p.payload,'$.exclude.statistics')=1)
```

返回结构 `ResaleRate { generation, today, included_count, total_purchase_cents, total_sale_cents, total_gain_cents, average_rate_hundredths: Option<i64>, weighted_rate_hundredths: Option<i64>, rows: Vec<ResaleRow>, excluded: Vec<Excluded> }`；`ResaleRow { id, name, purchase_cents, sale_cents, gain_cents, rate_hundredths, sold_date }`。金额累加用 `i128` 再转字符串；排序用交叉相乘比较精确比值，与现有 `by_ratio` 同法；复用 `Excluded` 结构。`included_count == 0` 时两个比率为 `None`，不输出 0。

**命令**：`commands.rs` 新增 `resale_rate`，与 `holding` 同形（`w.call` 加本地日期）；`lib.rs` 注册。

**前端**（`src/Stats.tsx`）：新增 `ResaleCard`，由 `StatsPage` 在 `HoldingCards` 之后渲染；独立 `useEffect` 取数，沿用 `live` 标志防竞态和 `retry` 模式。类型就近声明，格式化复用 `money`、`changeText`。浏览器预览：`visual-preview.ts` 增加 `resale_rate` 分支，数据取自预览记录的 `sale.fields.price_cents` 与资产购入价，规则与 Rust 一致，供视觉取证。

**不改：** schema、备份格式、`holding` 命令与日均排行、物品详情、导航、权限与 capability 配置（新命令按现有命令同样注册即可，实现时核对 Tauri 命令权限是否需要显式登记）。

## 6. 任务拆分

| 任务 | 内容 | 出口 | 状态（2026-10-01） |
|---|---|---|---|
| U19a 文档同步 | 规则与验收写入产品设计 D29，更新 6.1 节，登记实施计划与变更记录 | 各文档只维护所属内容，链接可达 | 完成；USER_GUIDE 与 README 现状按惯例待原生验收后再更新 |
| U19b 后端 | `resale_rate` 查询与命令；`stats_snapshot` 回收率口径修正；Rust 测试 | AC01–AC07、AC10、AC11 数据层断言通过 | 完成：新增 2 项 Rust 测试，insights 套件 7/7 |
| U19c 界面 | `ResaleCard`、预览分支与夹具、样式；单元与源码断言测试 | AC08–AC09，状态全覆盖，同尺寸对照截图 | 完成：`tests/resale.test.mjs` 5 项，浅/深/窄窗与五种状态截图 |
| U19d 验收 | 全套工程检查；隔离身份下原生验收 | AC01–AC11 各有证据或明确的未测边界 | 部分：工程检查与浏览器验收完成；**原生验收未做**（本轮环境为 Linux，无法构建 macOS 包） |

U19b 与 U19c 可分开提交；先修回收分析口径，保证页面上任何时刻都没有两个互相矛盾的回收率。不自动提交、推送、升版或安装，发布另按用户授权。

## 7. 验收证据

验收样例与条件见[产品设计 D29](../PRODUCT_DESIGN.md#d29-product)；各条的实际证据、命令结果与未测边界见[U19 验证报告](../verification/U19_RESALE_RATE_RESULT.md)。

## 8. 风险与已核对事项

- 「平均保值率」同时存在简单平均与金额加权两种读法，本方案两个都显示并写明口径；若用户只想要一个，保留平均保值率，总回收率移入 ⓘ。
- **已核对：虚拟资产不受影响。** 虚拟资产在独立的 `virtual_assets` 表，没有售出与生命周期，不进入 `assets` 查询。
- **已核对：命令无需登记权限。** `src-tauri/capabilities/main.json` 只有 `core:event:default`，`build.rs` 没有自定义命令清单，命令只需在 `lib.rs` 的 `invoke_handler` 注册，已完成。
- 「回收分析」口径修正会让现有显示的回收率下降（样例 77.73% → 69.53%），属于纠错，已写入变更记录，不静默变动。该卡保留一位小数（69.5%），新卡两位（69.53%），是同一数值的不同精度。
