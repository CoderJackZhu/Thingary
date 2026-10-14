# planning-report：决策报告只读展示组件

现行规则：`docs/PRODUCT_RULES.md`（当前报告）；组件边界以本文为准。

- 输入：只读 `ReportInputV1`（`contract_version = 1`），边界用 `parseReportInput` 严格校验；未知版本返回明确错误。所有必需可空字段必须显式传 null；校验后重新构造白名单快照，丢弃额外字段并脱离原输入引用。金额为十进制分字符串/null，比例为万分位整数/null，未知保留，不以 0 补齐。
- 组件不读数据库、不调用退休算法补字段、不建立事实存储。
- 三模式：current / baseline / comparison；五外围状态：loading / empty / error（读取失败或输入无法识别）/ partial（报告内 `status:'partial'`，带缺项横幅）/ ready。
- 隐私：完整与隐私输出从同一快照生成，`redactReport` 先脱敏（账户别名、自由名称别名化、备注隐藏、金额与派生比例清空标 hidden），渲染/复制/打印/文件名只接触脱敏视图；不做正则删数字。所有自由文本（包括标签、缺项、版本、ID、下一步说明）隐藏或局部别名化，读取/校验错误在隐私视图只给受控提示；保留日期、事实状态与缺项数量。当前报告的 model_version 若精确匹配正在运行的 planningModelVersion，则保留这一公开核心标识；其他版本字符串仍脱敏，不把任意自由文本当作公开元数据。
- 趋势：预计连线、参考虚线、实际稀疏圆点不连线不插值；隐私模式不渲染曲线。
- 导出：`printableHtml` 生成自包含 A4 可打印文档（escapeHtml 全量转义）；`copyText` 复制摘要；`exportFileName` 只含类型与日期。浏览器打印页码依赖浏览器页眉页脚；原生 PDF/文件对话框未验。

## 文件

| 文件 | 职责 |
|---|---|
| `model.ts` | 类型、校验、脱敏投影、格式化、趋势模型、复制文本、可打印 HTML |
| `PlanningReport.tsx` | React 展示组件（五状态、完整/隐私切换、复制/打印动作） |
| `fixtures.ts` | 固定虚构夹具（含敏感值与恶意名称，供脱敏断言） |
| `preview.tsx` | 独立预览入口（仅被根 `planning-report-preview.html` 引用） |
| `planning-report.css` | 组件样式（只用 theme.css 令牌） |

## 预览

```sh
npx vite --port 1431 --strictPort
# http://localhost:1431/planning-report-preview.html
```

测试：`npm run test:ui`（`tests/planning-report.test.mjs`）。

当前源码已接入 `current-adapter.ts` 与目标页 `PlanningCurrentReportDialog`：同批真实来源和领域能力映射为独立快照，默认隐私，提供完整切换与摘要复制。只展示资金、结构化条件、需求及可准确表达的结论；series/goals/differences 留空并披露未覆盖范围。影响计算的待核对项限制主结论，首次领取月金额基准与账户局部别名保持一致。普通读取刷新不改快照，切库／恢复／规划关闭丢弃。真实入口关闭打印，复制失败明确提示。

未接入：逐月趋势及逐项购买结果、命名方案、基准／比较入口、原生 PDF 与文件对话框。自动、浏览器与原生验收分别见 `docs/DEVELOPMENT.md#current-report-validation`，源码接入不代表已公开发布。
