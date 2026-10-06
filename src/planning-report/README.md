# planning-report：决策报告只读展示组件

契约：`docs/PLANNING_COMPONENT_CONTRACTS.md` §3；设计：`docs/PLANNING_REVIEW_REPORT_DESIGN.md` §8。

- 输入：只读 `ReportInputV1`（`contract_version = 1`），边界用 `parseReportInput` 严格校验；未知版本返回明确错误。金额为十进制分字符串/null，比例为万分位整数/null，未知保留，不以 0 补齐。
- 组件不读数据库、不调用退休算法补字段、不建立事实存储。
- 三模式：current / baseline / comparison；五外围状态：loading / empty / error（读取失败或输入无法识别）/ partial（报告内 `status:'partial'`，带缺项横幅）/ ready。
- 隐私：完整与隐私输出从同一快照生成，`redactReport` 先脱敏（账户别名、自由名称别名化、备注隐藏、金额与派生比例清空标 hidden），渲染/复制/打印/文件名只接触脱敏视图；不做正则删数字。
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

未接入：真实 DTO 适配、产品入口（更多菜单/基准详情/比较入口）、原生 PDF 与文件对话框——由集成任务完成。
