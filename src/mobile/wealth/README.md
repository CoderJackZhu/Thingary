# 手机账户与盘点

本目录只负责手机布局，业务数据、整数金额换算和回执协议沿用 `src/wealth.ts`、`currency.ts`、`holdings.ts`、`wealth-display.ts` 与现有 IPC。桌面界面和 Rust 后端保持不变。

## 路由

- `wealth.overview`：最近完整盘点净资产、3 月／1 年／全部趋势、资产结构、分组账户清单与支出模块入口。
- `wealth.accounts`：使用中／已停用／全部账户，分组小计。
- `wealth.account`（`id`）：账户趋势、全部历史、账户资料和删除误建账户。
- `wealth.accountEdit`（可选 `id`）：新增或编辑账户；包括外币、分组、启用／停用日期、计入范围、持仓和固定资产购入信息。
- `wealth.checkin`（可选 `id`、`date`）：新完整盘点或按稳定 ID 更正。传 `accountId` 时打开单账户快速更新，同样使用模态页面栈。
- `wealth.snapshots`：记录列表；传 `id` 时只读查看该次盘点。
- `wealth.compare`（可选 `from`、`to`）：任意两次盘点比较，按影响／类型排序，负债、计入范围变化、不计入账户分开核对。

支出、周期费用、虚拟资产和财务复盘只引用地基预留的 `spending.*` 路由，由相应模块提供内容。

## 录入与保存

新完整盘点的余额、份额与单价均不预填；上次金额只作参考。外币使用本次手填汇率，历史记录不重算。一个账户只记录一个持仓。更正时保留旧行及其历史计入范围、原币与持仓事实。

`model.ts` 只组织录入状态与写请求，换算调用已有纯函数，预览合计调用 `previewTotals`。所有应盘账户填齐后，完整盘点通过一次 `wealth_snapshot_save` 原子提交，不再逐账户调用快速更新。缺项与明确零分别处理；部分录入的合计标明范围，上次金额未知时比较保持未知。

账户与单账户更新分别使用 `wealth_account_save` 和 `wealth_quick_update`；盘点里标「已注销」的账户通过 `wealth_snapshot_save` 的 `close_accounts` 在同一事务里停用。写请求复用 `submit`、`request_id`、`generation`、修订与手机会话的回执核对，保存结果未知时不新增请求、不继续导航。普通表单取消不保存草稿。已有记录的账户保留历史，停用前最后盘点须为零；误建且没有记录的账户可移入最近删除。

## 开发验证

使用 `mobile-preview.html` 的虚构内存数据，不打开正式资料库。常用参数与地基 [README](../README.md#预览与截图) 相同。完整盘点补充支持 `mobile-state=unknown`（丢失响应及首次回执读取）和 `mobile-state=save-error`（提交失败且保留输入）。

自动回归在 `tests/mobile-wealth-*.test.mjs`，包括真实页面处理器的完整盘点单次提交、缺项拦截、账户完整字段、单账户更新、外币与持仓整数换算、更正和未知值。按仓库规范运行四项检查。浏览器尺寸和明暗验证仅覆盖前端，不能代表 iPhone 原生、触控键盘、VoiceOver 或 Tauri 宿主已经验收。
